// Birden fazla graph: otomatik ad, geçişte bekleyen aksiyon onayı, geçilen graph'ta sekme
// sorusu, yeniden adlandırma, dışa aktarma / yükleme (runner dahil), silme, kilitler, eski
// tek-'state' kaydının taşınması, panel yeniden açılınca kalıcılık.
// Kullanım: node tests/e2e/graphs.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = outDir('graphs');

const PAGES = {
  '/a': '<!doctype html><title>Site A</title><button id="next" onclick="location.href=\'/a2\'">Ileri</button> <button id="noop">Bos</button>',
  '/a2': '<!doctype html><title>Site A ikinci</title><button id="back" onclick="location.href=\'/a\'">Geri</button> <a href="#x">Link</a>',
  '/b': '<!doctype html><title>Site B</title><input id="q"> <button id="go">Ara</button>',
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGES[req.url.split('?')[0]] ?? 'yok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${server.address().port}`;
  const B = `http://localhost:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-graphs-')), {
    executablePath: CHROME, headless: !HEADED, viewport: null, acceptDownloads: true, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900', ...(HEADED ? ['--window-position=-2400,0'] : [])],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(A + '/a');
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    await sleep(500);
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const store = (keys) => panel.evaluate((k) => chrome.storage.local.get(k), keys);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const list = async () => (await store('graphs')).graphs;
    const T = await panel.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url ?? '').startsWith(u)).id), A);
    const { windowId } = await panel.evaluate((id) => chrome.tabs.get(id), T);
    const createNode = async (resolve = null) => {
      await sleep(700);
      await page.bringToFront();
      const r = await send({ type: 'CREATE_NODE', tabId: T, windowId });
      if ((await getState()).pending) await send({ type: 'RESOLVE', targetId: resolve });
      await sleep(200);
      return r;
    };
    const dialog = () => panel.evaluate(() => ({ open: document.getElementById('confirm-dialog').open, text: document.getElementById('confirm-dialog-text').textContent }));
    const rows = () => panel.$$eval('#graph-list li', (lis) => lis.map((li) => ({ name: li.querySelector('.name')?.textContent, meta: li.querySelector('.meta')?.textContent, active: li.classList.contains('active'), locked: li.classList.contains('locked') })));
    await panel.evaluate(() => { document.getElementById('graphs').open = true; });

    // ---- İlk açılış: tek boş graph ----
    let graphs = await list();
    check('ilk açılış: tek "Yeni graph"', graphs.length === 1 && graphs[0].name === 'Yeni graph' && graphs[0].auto === true, JSON.stringify(graphs));
    check('kart: rozet ve satır', (await panel.textContent('#graphs-badge')) === '1' && (await rows())[0].active);

    // ---- A sitesi: ad ilk node'dan ----
    await createNode();
    await page.click('#next');
    await page.waitForURL(A + '/a2');
    await createNode();
    graphs = await list();
    const idA = graphs[0].id;
    check('otomatik ad: başlangıç sayfasının başlığı', graphs[0].name === 'Site A' && graphs[0].nodes === 2 && graphs[0].edges === 1, JSON.stringify(graphs[0]));
    check('kart özeti aktif adı gösteriyor', (await panel.textContent('#graphs-active')).includes('Site A'));

    // ---- Bekleyen aksiyon varken yeni graph: onay ----
    await page.click('a');
    await sleep(600);
    check('bekleyen aksiyon var', (await getState()).buffer.length === 1);
    await panel.click('#btn-graph-new');
    let d = await dialog();
    check('yeni graph: onay soruldu', d.open && d.text.includes('1 aksiyon silinecek'), d.text);
    await panel.click('#btn-confirm-dialog-cancel');
    check('vazgeçince geçilmedi', (await store('activeGraph')).activeGraph === idA && (await getState()).buffer.length === 1);
    await panel.click('#btn-graph-new');
    await panel.click('#btn-confirm-dialog-ok');
    await sleep(600);
    graphs = await list();
    let s = await getState();
    const idB = (await store('activeGraph')).activeGraph;
    check('yeni graph açıldı ve aktif', graphs.length === 2 && idB !== idA && s.nodes.length === 0, JSON.stringify(graphs.map((g) => g.name)));
    const leftA = (await store('graph:' + idA))['graph:' + idA];
    check('bırakılan graph: node\'lar duruyor, bekleyen aksiyonlar ve sekme bağı silindi', leftA.nodes.length === 2 && leftA.buffer.length === 0 && leftA.tabId === null, `buffer ${leftA.buffer.length}, tab ${leftA.tabId}`);
    check('panel: graph boş çizildi', await panel.evaluate(() => cy.nodes().length) === 0);

    // ---- B sitesi ----
    await page.goto(B + '/b');
    await createNode();
    graphs = await list();
    check('ikinci graph: otomatik ad', graphs.find((g) => g.id === idB).name === 'Site B', JSON.stringify(graphs));

    // ---- A'ya geri: satıra tıklama; aktif sekme için soru ----
    await page.goto(A + '/a2');
    await sleep(500);
    await page.bringToFront();
    await panel.evaluate(() => [...document.querySelectorAll('#graph-list li')].find((li) => li.querySelector('.name').textContent === 'Site A').click());
    await sleep(300);
    d = await dialog();
    check("B'de bekleyen gezinme: geçiş onayı", d.open && d.text.includes(`"Site A" graph'ına geçilecek`), d.text);
    await panel.evaluate(() => document.getElementById('btn-confirm-dialog-ok').click()); // sekme önde kalsın
    await sleep(800);
    s = await getState();
    check('A\'ya geçildi: node\'lar geri geldi', s.id === idA && s.nodes.length === 2 && await panel.evaluate(() => cy.nodes().length) === 2);
    check('aktif sekme için soru soruldu', s.tabPrompt?.tabId === T && s.tabId === null, JSON.stringify(s.tabPrompt));
    check('soru metni graph değişimini söylüyor', (await panel.textContent('#tab-prompt-text')).includes('graph değişti'));
    const resumed = await send({ type: 'RESOLVE_TAB', follow: true });
    s = await getState();
    check('"Evet": kayıt A\'da bu sekmede sürüyor', s.tabId === T && resumed?.notice?.includes('sürüyor'), JSON.stringify(resumed));
    await page.click('#back');
    await page.waitForURL(A + '/a');
    await sleep(600);
    check('A\'da aksiyon kaydediliyor', (await getState()).buffer.some((a) => a.type === 'click'));

    // ---- Karar beklerken kilit ----
    await createNode(); // /a: v_SiteA ile aynı → soru
    await page.bringToFront();
    await send({ type: 'CREATE_NODE', tabId: T, windowId }).catch(() => null);
    s = await getState();
    if (!s.pending) {
      await page.click('#next');
      await page.waitForURL(A + '/a2');
      await sleep(500);
      await send({ type: 'CREATE_NODE', tabId: T, windowId });
      s = await getState();
    }
    check('soru bekliyor', Boolean(s.pending));
    const locked = await send({ type: 'SWITCH_GRAPH', id: idB });
    check('karar beklerken geçiş reddedildi', Boolean(locked?.error), JSON.stringify(locked));
    const lockedRows = await rows();
    check('karar beklerken satırlar ve Yeni graph kilitli', lockedRows.find((r) => !r.active).locked && await panel.isDisabled('#btn-graph-new'));
    await send({ type: 'RESOLVE', targetId: s.pending.candidateIds[0] });
    await sleep(300);

    // ---- Yeniden adlandırma ----
    await panel.evaluate(() => [...document.querySelectorAll('#graph-list li')].find((li) => li.classList.contains('active')).querySelector('button[title="Yeniden adlandır"]').click());
    await panel.fill('#graph-list input', 'Banka');
    await panel.press('#graph-list input', 'Enter');
    await sleep(400);
    graphs = await list();
    const renamed = graphs.find((g) => g.id === idA);
    check('yeniden adlandırıldı, otomatik ad kapandı', renamed.name === 'Banka' && renamed.auto === false, JSON.stringify(renamed));

    // ---- Dışa aktarma ----
    const download = panel.waitForEvent('download');
    await panel.click('#btn-graph-export');
    const file = await download;
    const backupPath = path.join(OUT, file.suggestedFilename());
    await file.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    s = await getState();
    check('yedek dosyası adı', file.suggestedFilename() === 'Banka.graph.json', file.suggestedFilename());
    check('yedek: biçim, node\'lar ekran görüntüleriyle', backup.format === 'graph-recorder-graph/v1' && backup.nodes.length === s.nodes.length && backup.nodes.every((n) => n.screenshot?.startsWith('data:image')) && !('buffer' in backup), `${backup.format} ${backup.nodes.length}`);

    // ---- Yükleme: yeni graph ----
    await panel.setInputFiles('#graph-file', backupPath);
    await sleep(300);
    if ((await dialog()).open) await panel.click('#btn-confirm-dialog-ok');
    await sleep(800);
    graphs = await list();
    s = await getState();
    const idC = s.id;
    const imported = graphs.find((g) => g.id === idC);
    check('yüklendi: yeni satır, adı benzersiz, aktif', graphs.length === 3 && imported?.name === 'Banka (2)' && imported.auto === false, JSON.stringify(graphs.map((g) => g.name)));
    check('yüklenen graph aynı: node, edge, ekran görüntüsü', JSON.stringify(s.nodes) === JSON.stringify(backup.nodes) && JSON.stringify(s.edges) === JSON.stringify(backup.edges) && s.startNodeId === backup.startNodeId);
    check('yüklenen graph: geçici alanlar boş', s.buffer.length === 0 && s.undo.length === 0 && s.tabId === null && s.currentNodeId === null);
    const bad = await send({ type: 'IMPORT_GRAPH', graph: { ...backup, edges: [...backup.edges, { id: 'e99', name: 'e_Kopuk', source: 'n1', target: 'n404', actions: [] }] } });
    check('bozuk yedek reddedildi', bad?.error?.includes('yüklenemedi') && (await list()).length === 3, JSON.stringify(bad));
    await panel.setInputFiles('#graph-file', { name: 'model.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ name: 'x', models: [] })) });
    await sleep(300);
    check('GraphWalker modeli: açıklamalı hata', (await panel.textContent('#message')).includes('GraphWalker modeli'), await panel.textContent('#message'));

    // ---- Runner: yüklenen graph'ın modeli ----
    const model = await panel.evaluate(() => graphWalkerModel());
    check('model adı graph adından (harf ve rakam)', model.name === 'Banka2', model.name);
    const modelPath = path.join(OUT, `${model.name}.json`);
    fs.writeFileSync(modelPath, JSON.stringify(model));
    const edgeIds = s.edges.filter((e) => e.source === s.startNodeId).map((e) => e.id).slice(0, 1);
    const runner = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(REPO, 'runner', 'run.js'), modelPath, '--path', edgeIds.join(','), '--out', path.join(OUT, 'run')]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (b) => { stdout += b; });
      child.stderr.on('data', (b) => { stderr += b; });
      child.on('exit', (status) => resolve({ status, stdout, stderr }));
    });
    check('runner yüklenen graph\'ın modeliyle geçti', runner.status === 0, runner.stdout.split('\n').filter((l) => l.startsWith('Sonuç')).join(' ') + runner.stderr);

    // ---- Kalıcılık: panel yeniden açılınca ----
    await panel.reload();
    await sleep(800);
    await panel.evaluate(() => { document.getElementById('graphs').open = true; });
    const after = await rows();
    check('panel yeniden açıldı: liste ve aktif graph aynı', after.length === 3 && after.find((r) => r.active)?.name === 'Banka (2)', JSON.stringify(after));

    // ---- Silme: aktif graph ----
    await panel.evaluate(() => [...document.querySelectorAll('#graph-list li')].find((li) => li.classList.contains('active')).querySelector('button[title="Sil"]').click());
    d = await dialog();
    check('silme onayı', d.open && d.text.includes('geri alınamaz') && d.text.includes('en son değişen'), d.text);
    await panel.click('#btn-confirm-dialog-ok');
    await sleep(800);
    graphs = await list();
    const activeNow = (await store('activeGraph')).activeGraph;
    const removed = await store('graph:' + idC);
    check('silindi; en son değişene geçildi', graphs.length === 2 && !graphs.some((g) => g.id === idC) && !removed['graph:' + idC] && [idA, idB].includes(activeNow), `aktif ${activeNow}`);
    // Aktif olmayan graph silinince geçiş olmaz
    const other = [idA, idB].find((id) => id !== activeNow);
    await send({ type: 'DELETE_GRAPH', id: other });
    graphs = await list();
    check('aktif olmayan silindi, aktif değişmedi', graphs.length === 1 && (await store('activeGraph')).activeGraph === activeNow);
    // Son graph silinince boş graph açılır
    await send({ type: 'DELETE_GRAPH', id: activeNow });
    await sleep(500);
    graphs = await list();
    check('son graph silindi: boş "Yeni graph"', graphs.length === 1 && graphs[0].nodes === 0 && graphs[0].name === 'Yeni graph', JSON.stringify(graphs));

    // ---- Eski sürümden taşıma: tek 'state' anahtarı ----
    const oldState = { ...leftA, tabId: 7, tabs: [{ id: 7, url: '' }] };
    delete oldState.id;
    await sw.evaluate(async (old) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ state: old });
      graphsPromise = null; // worker yeni yüklenmiş gibi
      statePromise = null;
    }, oldState);
    await panel.reload();
    await sleep(1000);
    const migrated = await store(null);
    const migratedGraphs = migrated.graphs ?? [];
    const migratedState = migrated['graph:' + migrated.activeGraph];
    check('taşıma: graph listede, adı başlıktan', migratedGraphs.length === 1 && migratedGraphs[0].name === 'Site A' && migratedGraphs[0].nodes === 2, JSON.stringify(migratedGraphs));
    check('taşıma: node\'lar ve edge\'ler aynı, eski anahtar silindi, sekme bağı sıfır', migratedState?.nodes.length === 2 && migratedState.edges.length === leftA.edges.length && !('state' in migrated) && migratedState.tabId === null);
    await panel.evaluate(() => { document.getElementById('graphs').open = true; });
    check('taşıma: panel çizdi', await panel.evaluate(() => cy.nodes().length) === 2 && (await rows())[0]?.name === 'Site A');
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
