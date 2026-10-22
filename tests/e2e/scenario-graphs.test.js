// Senaryo graph'ları: kopyanın içeriği (koşuların geçtiği kısım, monitors, ekran görüntüsü yok),
// sekme şeridi ve listeyle eşlik, senaryo görünümünde yalnızca kendi node / edge'leri, salt okunur
// detay, "Ana graph'ta göster" ve "Kullanan senaryolar", senaryo görünümündeyken kaydın sürmesi,
// ana graph değişince uyarı ve "Ana graph'tan yenile", indirilen dosyada graph.
// Kullanım: node tests/e2e/scenario-graphs.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const OUT = outDir('scenario-graphs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ana: A (geri döner), B (çıkmaz), C (geri döner, D'ye gider)
const PAGES = {
  '/': '<!doctype html><title>Ana</title><button id="a" onclick="location.href=\'/a\'">A</button> <button id="b" onclick="location.href=\'/b\'">B</button> <button id="c" onclick="location.href=\'/c\'">C</button>',
  '/a': '<!doctype html><title>Sayfa A</title><button id="back" onclick="location.href=\'/\'">Geri</button>',
  '/b': '<!doctype html><title>Sayfa B</title><p>Son</p><a href="#">x</a>',
  '/c': '<!doctype html><title>Sayfa C</title><button id="back" onclick="location.href=\'/\'">Ana sayfa</button> <button id="d" onclick="location.href=\'/d\'">D</button>',
  '/d': '<!doctype html><title>Sayfa D</title><p>D</p><input id="q">',
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGES[req.url.split('?')[0]] ?? 'yok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-sgraph-')), {
    executablePath: CHROME, headless: !HEADED, viewport: null, acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900', ...(HEADED ? ['--window-position=-2400,0'] : [])],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(BASE + '/');
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    await sleep(500);
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const T = await panel.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url ?? '').startsWith(u)).id), BASE);
    const { windowId } = await panel.evaluate((tab) => chrome.tabs.get(tab), T);
    const createNode = async () => {
      await sleep(700);
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: T, windowId });
      const s = await getState();
      if (s.pending) await send({ type: 'RESOLVE', targetId: s.pending.candidateIds[0] });
    };
    const tap = (id) => panel.evaluate((x) => { cy.getElementById(x).emit('tap'); }, id);
    const tabs = () => panel.$$eval('#view-tabs button', (bs) => bs.map((b) => ({ text: b.textContent, active: b.classList.contains('active') })));
    const clickTab = (text) => panel.evaluate((t) => [...document.querySelectorAll('#view-tabs button')].find((b) => b.textContent.replace(' •', '') === t).click(), text);
    const drawn = () => panel.evaluate(() => ({ nodes: cy.nodes().map((n) => n.id()).sort(), edges: cy.edges().map((e) => e.id()).sort(), scenarioView: document.getElementById('graph').classList.contains('scenario-view') }));
    const activeRow = () => panel.evaluate(() => document.querySelector('#scenario-list li.active .name')?.textContent);
    const sorted = (xs) => [...xs].sort();

    // ---- Kayıt ----
    await createNode();
    for (const [go, url] of [['#a', '/a'], ['#c', '/c']]) {
      await page.click(go);
      await page.waitForURL(BASE + url);
      await createNode();
      await page.click('#back');
      await page.waitForURL(BASE + '/');
      await createNode();
    }
    await page.click('#b');
    await page.waitForURL(BASE + '/b');
    await createNode();
    let s = await getState();
    const node = (name) => s.nodes.find((n) => n.name === name).id;
    const edge = (from, to) => s.edges.find((e) => e.source === node(from) && e.target === node(to)).id;
    const [toA, backA, toC, backC, toB] = [edge('v_Ana', 'v_A'), edge('v_A', 'v_Ana'), edge('v_Ana', 'v_C'), edge('v_C', 'v_Ana'), edge('v_Ana', 'v_B')];
    check('kayıt: 4 node, 5 edge', s.nodes.length === 4 && s.edges.length === 5);
    check('senaryo yokken sekme şeridi gizli', await panel.isHidden('#view-tabs'));

    // ---- İki senaryo ----
    await panel.click('#scenario summary');
    await panel.click('#btn-scenario-new');
    await sleep(300);
    await tap(toA);
    await tap(backA);
    await sleep(500);
    await panel.click('#btn-scenario-new');
    await sleep(300);
    for (const id of [toC, backC]) await tap(id);
    await panel.click('#btn-scenario-new-run');
    await tap(toB);
    await sleep(600);
    s = await getState();
    const [s1, s2] = s.scenarios;
    check('kopya: Senaryo 1 yalnızca Ana, A ve iki edge', JSON.stringify(sorted(s1.graph.nodes.map((n) => n.id))) === JSON.stringify(sorted([node('v_Ana'), node('v_A')])) && JSON.stringify(sorted(s1.graph.edges.map((e) => e.id))) === JSON.stringify(sorted([toA, backA])), JSON.stringify(s1.graph.edges.map((e) => e.name)));
    check('kopya: Senaryo 2 Ana, C, B ve üç edge', s2.graph.nodes.length === 3 && s2.graph.edges.length === 3);
    check('kopya: her öğede monitors: [], ekran görüntüsü yok', [...s1.graph.nodes, ...s1.graph.edges].every((x) => Array.isArray(x.monitors) && !x.monitors.length && !('screenshot' in x)) && s1.graph.nodes[0].elements);

    // ---- Sekmeler ----
    let t = await tabs();
    check('sekmeler: Ana graph, Senaryo 1, Senaryo 2', t.map((x) => x.text).join('|') === 'Ana graph|Senaryo 1|Senaryo 2' && t[0].active, JSON.stringify(t));
    await clickTab('Senaryo 1');
    await sleep(300);
    let d = await drawn();
    check('Senaryo 1 sekmesi: yalnızca kendi node ve edge\'leri, kesik çerçeve', d.scenarioView && d.nodes.length === 2 && JSON.stringify(d.edges) === JSON.stringify(sorted([toA, backA])), JSON.stringify(d));
    check('sekme listede de seçti', (await activeRow()) === 'Senaryo 1');
    check('görünüm notu', (await panel.textContent('#view-note-text')).includes('"Senaryo 1" senaryosunun graph\'ı: 2 node · 2 edge') && await panel.isHidden('#btn-view-refresh'));
    await clickTab('Senaryo 2');
    await sleep(300);
    d = await drawn();
    check('Senaryo 2 sekmesi: üç node, üç edge', d.nodes.length === 3 && d.edges.length === 3 && (await activeRow()) === 'Senaryo 2', JSON.stringify(d));
    await panel.evaluate(() => [...document.querySelectorAll('#scenario-list li')].find((li) => li.querySelector('.name').textContent === 'Senaryo 1').click());
    await sleep(300);
    d = await drawn();
    t = await tabs();
    check('senaryo görünümünde listeden seçmek görünümü geçirir', d.edges.length === 2 && t.find((x) => x.active)?.text === 'Senaryo 1', JSON.stringify(t));

    // ---- Salt okunur: edge tıklaması koşuya eklemez, detay açar ----
    const runsBefore = JSON.stringify((await getState()).scenarios[0].runs);
    await tap(toA);
    await sleep(300);
    const details = await panel.evaluate(() => ({
      hidden: document.getElementById('details').hidden, title: document.getElementById('details-title').textContent,
      save: document.getElementById('btn-save').hidden, del: document.getElementById('btn-delete').hidden, main: document.getElementById('btn-show-main').hidden,
      readOnly: document.getElementById('details-name').readOnly, editable: document.querySelectorAll('#details-actions .delete-action').length,
    }));
    check('senaryo görünümünde edge: koşu değişmedi, salt okunur detay', JSON.stringify((await getState()).scenarios[0].runs) === runsBefore && !details.hidden && details.title.includes('"Senaryo 1" senaryosunda') && details.save && details.del && !details.main && details.readOnly && details.editable === 0, JSON.stringify(details));
    check('ipucu: düzenlemek için Ana graph', (await panel.textContent('#scenario-hint')).includes('"Ana graph" sekmesine'));
    await tap(node('v_A'));
    await sleep(200);
    check('node detayı: ekran görüntüsü ana graph\'tan', await panel.evaluate(() => !document.getElementById('details-shot').hidden && document.getElementById('details-shot').src.startsWith('data:image')));

    // ---- Ana graph'ta göster ve Kullanan senaryolar ----
    await panel.click('#btn-show-main');
    await sleep(300);
    d = await drawn();
    const users = await panel.textContent('#details-scenarios');
    check('Ana graph\'ta göster: ana görünüm, aynı node seçili', !d.scenarioView && d.nodes.length === 4 && await panel.evaluate((id) => selectedId === id, node('v_A')), JSON.stringify(d));
    check('kullanan senaryolar: Senaryo 1', users === 'Kullanan senaryolar: Senaryo 1', users);
    await tap(node('v_Ana'));
    await sleep(200);
    check('başlangıç node\'unu iki senaryo kullanıyor', (await panel.textContent('#details-scenarios')) === 'Kullanan senaryolar: Senaryo 1, Senaryo 2');
    await panel.evaluate(() => [...document.querySelectorAll('#details-scenarios a')].find((a) => a.textContent === 'Senaryo 2').click());
    await sleep(300);
    d = await drawn();
    check('bağlantı: Senaryo 2 görünümü, node seçili', d.scenarioView && d.nodes.length === 3 && (await tabs()).find((x) => x.active)?.text === 'Senaryo 2' && !(await panel.isHidden('#details')));

    // ---- Senaryo görünümündeyken kayıt sürer ----
    await page.goto(BASE + '/c');
    await sleep(500);
    await send({ type: 'SET_CURRENT', id: node('v_C'), tabId: T });
    await page.bringToFront();
    await page.click('#d');
    await page.waitForURL(BASE + '/d');
    await createNode();
    s = await getState();
    d = await drawn();
    check('kayıt sürdü: ana graph\'ta yeni node, senaryo görünümü değişmedi', s.nodes.length === 5 && s.nodes.some((n) => n.name === 'v_D') && d.nodes.length === 3 && d.scenarioView, `${s.nodes.length} node; çizilen ${d.nodes.length}`);

    // ---- Ana graph değişti: uyarı, kopya aynı, yenile ----
    await send({ type: 'DELETE', id: backA });
    await send({ type: 'RENAME', id: node('v_A'), name: 'v_SayfaA' });
    await sleep(400);
    t = await tabs();
    check('sekmede değişiklik işareti', t.find((x) => x.text.startsWith('Senaryo 1'))?.text === 'Senaryo 1 •' && t.find((x) => x.text.startsWith('Senaryo 2'))?.text === 'Senaryo 2', JSON.stringify(t));
    await clickTab('Senaryo 1');
    await sleep(300);
    d = await drawn();
    const drift = await panel.textContent('#view-drift');
    check('kopya aynen duruyor', d.edges.length === 2 && d.edges.includes(backA));
    check('uyarı: silindi ve değişti, yenile butonu', drift.includes('silindi') && drift.includes('değişti') && !(await panel.isHidden('#btn-view-refresh')), drift);
    check('çizilen adı kopyadaki (v_A)', await panel.evaluate((id) => cy.getElementById(id).data('label'), node('v_A')) === 'v_A');
    await panel.click('#btn-view-refresh');
    await sleep(600);
    d = await drawn();
    s = await getState();
    check('yenilendi: silinen edge kopyadan düştü, ad güncel', d.edges.length === 1 && s.scenarios[0].graph.nodes.some((n) => n.name === 'v_SayfaA') && await panel.isHidden('#btn-view-refresh'), JSON.stringify(d.edges));
    check('listede yürünemiyor', await panel.evaluate(() => [...document.querySelectorAll('#scenario-list li')].find((li) => li.querySelector('.name').textContent === 'Senaryo 1').querySelector('.warn') !== null));
    await send({ type: 'UNDO' }); // ad değişikliği geri alınmaz (geri al yalnızca silmeler); edge geri gelir
    await sleep(400);
    const added = await panel.textContent('#view-drift');
    check('silme geri alındı: kopyada eksik edge "eklendi" uyarısı', added.includes('eklendi') && !(await panel.isHidden('#btn-view-refresh')), added);
    await panel.click('#btn-view-refresh');
    await sleep(500);
    check('yeniden yenilendi: iki edge', (await drawn()).edges.length === 2 && await panel.isHidden('#btn-view-refresh'));

    // ---- İndirilen senaryoda graph ----
    const download = panel.waitForEvent('download');
    await panel.click('#btn-scenario-download');
    const file = await download;
    const saved = path.join(OUT, file.suggestedFilename());
    await file.saveAs(saved);
    const json = JSON.parse(fs.readFileSync(saved, 'utf8'));
    check('indirilen dosyada graph', json.graph?.edges.length === 2 && json.graph.nodes.every((n) => Array.isArray(n.monitors)));

    // ---- Graph değişince ana görünüme döner ----
    await send({ type: 'NEW_GRAPH' });
    await sleep(700);
    d = await drawn();
    check('yeni graph: ana görünüm, sekmeler gizli', !d.scenarioView && await panel.isHidden('#view-tabs') && await panel.isHidden('#view-note'));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
