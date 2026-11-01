// Senaryoya özel monitörler (docs/07-monitorler.md > Senaryoya özel monitörler): aynı edge'den geçen
// iki senaryo farklı beklenti taşır. Ana graph'ın monitörleri genel kural olarak her senaryoda kontrol
// edilir; senaryo sekmesinde eklenen monitör yalnızca o senaryo oynatılırken kontrol edilir ve
// senaryonun kopyasına bağlıdır. Liste (iki grup, etiketler, salt okunur genel kurallar), form
// (senaryo adı, kopyadan node listesi, "Bu senaryonun tamamı"), sağ tık menüsü, detay alt bölümü,
// oynatmada ışık listesi (Genel / Senaryo), uyarılar, "şimdi kontrol et", "Senaryo indir"
// dosyasında yuvaların dolması, graph yedeğiyle geri yükleme, senaryo ve graph silinince temizlik.
// Kullanım: node tests/e2e/monitor-scenario.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = outDir('monitor-scenario');

const CSS = '<style>body{font-family:sans-serif;font-size:14px}button{font-size:14px;min-height:28px;min-width:28px}</style>';
const html = (title, body) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title>${CSS}</head><body>${body}</body></html>`;
const SITE = {
  '/': html('Giris', '<h1>Giriş</h1><button id="go" onclick="location.href=\'/uygulama\'">Git</button>'),
  '/uygulama': html('Uygulama', '<h1>Uygulama</h1><p id="msg">Hoş geldiniz</p><button id="back" onclick="location.href=\'/\'">Geri</button>'),
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
    const page = SITE[req.url.split('?')[0]];
    if (!page) { res.statusCode = 404; res.end('yok'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(page);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-monitor-scenario-')), {
    executablePath: CHROME, headless: !HEADED, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'], acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900', ...(HEADED ? ['--window-position=-2400,0'] : [])],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(base + '/');
    await sleep(500);
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    await sleep(500);
    const errors = [];
    panel.on('pageerror', (e) => { errors.push(String(e)); if (process.env.DEBUG) console.log('  panel hata:', String(e)); });
    panel.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); if (process.env.DEBUG) console.log('  panel konsol:', m.text()); } });
    const $ = (sel) => panel.locator(sel);
    const text = (sel) => panel.textContent(sel);
    const texts = (sel) => panel.$$eval(sel, (els) => els.map((e) => e.textContent));
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const store = (keys) => panel.evaluate((k) => chrome.storage.local.get(k), keys);
    const activeId = async () => (await store('activeGraph')).activeGraph;
    const getState = async () => Object.values(await store('graph:' + await activeId()))[0];
    const storedScenarioMonitors = async (id) => (await store('scenario-monitors:' + id))['scenario-monitors:' + id];
    const tab = await panel.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url ?? '').startsWith(u))), base);
    const createNode = async (resolveTo = null) => { // resolveTo: "aynı node mu?" sorusunda o node
      await sleep(700);
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      if ((await getState()).pending) await send({ type: 'RESOLVE', targetId: resolveTo });
      await sleep(300);
    };
    const tap = async (id) => { await panel.evaluate((i) => { cy.getElementById(i).emit('tap'); }, id); await sleep(150); };
    const cxttap = async (id) => { await panel.evaluate((i) => { const t = i ? cy.getElementById(i) : cy; t.emit('cxttap', [{ originalEvent: { clientX: 200, clientY: 200 } }]); }, id); await sleep(150); };
    const dialogOpen = () => panel.evaluate(() => document.getElementById('monitor-dialog').open);
    const pickType = (id) => $(`#monitor-cards .type-card[data-type="${id}"]`).click();
    const save = () => $('#btn-monitor-save').evaluate((b) => b.click());
    const showView = async (id) => { await panel.evaluate((i) => showView(i), id); await sleep(300); };
    const shot = async (name) => { await panel.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); };
    // Panelde oynatma: seçili senaryonun ilk koşusu, açık sekme başlangıç sayfasında. Emir'in oynatmadan
    // önceki temizlik penceresi (varsa) "Temizlemeden oynat" ile geçilir; başlangıç kartı "Yine de oynat".
    const replayRun = async () => {
      await page.goto(base + '/');
      await page.bringToFront();
      await sleep(800);
      await panel.evaluate(() => { replayResult = null; document.getElementById('replay-slow').checked = false; document.getElementById('btn-replay').click(); });
      await panel.waitForFunction(() => {
        const cleanup = document.getElementById('cleanup-dialog');
        if (cleanup?.open) { document.getElementById('btn-cleanup-skip').click(); return false; }
        return Boolean(replay) || !document.getElementById('replay-check').hidden;
      }, null, { timeout: 15000 }).catch(() => {});
      await sleep(400);
      if (await panel.evaluate(() => !document.getElementById('replay-check').hidden)) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
      await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 90000 });
      return panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}`) }));
    };
    const ledRows = () => panel.$$eval('#monitor-run-list .led-row', (rows) => rows.map((r) => ({
      tag: r.querySelector('.tag')?.textContent ?? '', name: [...r.querySelector('b').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
      status: r.querySelector('.led').classList.contains('fail') ? 'fail' : 'ok', detail: r.querySelector('.detail').textContent,
    })));

    // ---- Kayıt: Giris → (Git) → Uygulama → (Geri) → Giris ----
    await createNode();
    await page.click('#go');
    await page.waitForURL(base + '/uygulama');
    await createNode();
    await page.click('#back');
    await page.waitForURL(base + '/');
    await createNode((await getState()).nodes[0].id); // Giris'e dönüş: aynı node
    const s = await getState();
    const graphId = s.id;
    const giris = s.nodes.find((n) => n.name === 'v_Giris');
    const uygulama = s.nodes.find((n) => n.name === 'v_Uygulama');
    const eGit = s.edges.find((e) => e.source === giris?.id);
    const eGeri = s.edges.find((e) => e.source === uygulama?.id);
    check('kayıt: 2 node, 2 edge', s.nodes.length === 2 && s.edges.length === 2 && eGit && eGeri, s.nodes.map((n) => n.name).join(','));

    // ---- Genel kurallar (ana graph'ın monitörleri; storage'a doğrudan, menü monitors.test.js'te) ----
    const G = [
      { id: 'm1', type: 'fontSize', scope: 'global', params: { min: 4, unit: 'pt' }, severity: 'error', enabled: true, name: 'Küçük yazı yok' },
      { id: 'm2', type: 'expectedText', scope: uygulama.id, params: { text: 'Uygulama', mode: 'present', caseSensitive: false }, severity: 'error', enabled: true, name: 'Başlık Uygulama' },
    ];
    await panel.evaluate(([key, items]) => chrome.storage.local.set({ [key]: { format: 'graph-recorder-monitors/v1', nextId: 3, items } }), ['monitors:' + graphId, G]);
    await sleep(400);
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    check('ana graph görünümü: 2 genel kural, genel kurallar grubu ve senaryo notu gizli', (await text('#monitors-badge')) === '2' && (await $('#monitors-general').isHidden())
      && (await $('#monitors-scenario-note').isHidden()) && (await $('#monitors-own-title').isHidden()) && (await text('#btn-monitor-add')) === 'Monitör ekle');

    // ---- İki senaryo: Kısa [Git], Uzun [Git, Geri] (aynı edge'den geçerler) ----
    await panel.evaluate(async ([a, b]) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Kısa', start: null, planner: { engine: 'manual' }, runs: [[a]] });
      await createScenario({ name: 'Uzun', start: null, planner: { engine: 'manual' }, runs: [[a, b]] });
    }, [eGit.id, eGeri.id]);
    await sleep(500);
    const scenarios = (await getState()).scenarios;
    const A = scenarios.find((sc) => sc.name === 'Kısa');
    const B = scenarios.find((sc) => sc.name === 'Uzun');
    check('iki senaryo kaydedildi, kopyaları var', A && B && A.graph?.edges.length === 1 && B.graph?.edges.length === 2, scenarios.map((sc) => sc.name).join(','));

    // ---- Senaryo görünümü (Kısa): kendi listesi boş, genel kurallar salt okunur ----
    await showView(A.id);
    check('senaryo sekmesi: başlık ve ipucu senaryoya, kendi listesi boş, buton "Bu senaryoya monitör ekle"', await panel.evaluate(() => scenarioView)
      && !(await $('#monitors-own-title').isHidden()) && (await text('#monitors-badge')) === '' && (await text('#monitors-empty')).includes('Bu senaryoya özel monitör yok')
      && (await text('#monitors-hint')).includes('yalnızca bu senaryo oynatılırken') && (await text('#btn-monitor-add')) === 'Bu senaryoya monitör ekle' && (await $('#btn-monitor-load').isHidden()));
    check('genel kurallar grubu: 2 satır, "Genel" etiketli, düğmeleri pasif', !(await $('#monitors-general').isHidden()) && (await text('#monitors-general-badge')) === '2'
      && (await $('#monitors-general-list .monitor.readonly').count()) === 2 && (await texts('#monitors-general-list .monitor .tag')).join(',') === 'Genel,Genel'
      && (await $('#monitors-general-list .monitor .edit').first().isDisabled()) && (await $('#monitors-general-list .monitor .delete').first().isDisabled()) && (await $('#monitors-general-list .monitor .toggle').first().isDisabled()));
    check('"Tüm model" filtresi senaryoda "Senaryonun tamamı"', (await text('#monitors-filter button[data-filter="global"]')) === 'Senaryonun tamamı');
    await shot('senaryo-bos');

    // ---- Formdan senaryo monitörü: Uygulama node'unda "Hoş geldiniz" (Expected Text) ----
    await $('#btn-monitor-add').click();
    check('pencere senaryo adıyla açıldı', (await dialogOpen()) && (await text('#monitor-title')) === 'Senaryo monitörü ekle · "Kısa"', await text('#monitor-title'));
    await pickType('expectedText');
    const nodeOptions = await $('#monitor-node option').allTextContents();
    check('2. adım: "Bu senaryonun tamamı", node listesi kopyadan, senaryo ipucu', (await text('#monitor-scope-global-text')).startsWith('Bu senaryonun tamamı')
      && nodeOptions.join(',') === 'v_Giris,v_Uygulama' && (await $('#monitor-edge option').count()) === 1 && (await text('#monitor-scope-hint')).includes('"Kısa" senaryosu oynatılırken'), nodeOptions.join(','));
    await $('input[name="monitor-scope"][value="node"]').check();
    await $('#monitor-node').selectOption(uygulama.id);
    await $('[data-key="text"] > label input').fill('Hoş geldiniz');
    await sleep(100);
    check('özet senaryo adıyla başlıyor', (await text('#monitor-summary')).startsWith('"Kısa" senaryosunda, testte v_Uygulama node\'una her varıldığında'), await text('#monitor-summary'));
    await save();
    await sleep(500);
    const smA = await storedScenarioMonitors(graphId);
    const a1 = smA?.scenarios?.[A.id]?.items?.[0];
    check('scenario-monitors:<graph> anahtarına senaryonun altına yazıldı; id senaryo id\'siyle', smA?.format === 'graph-recorder-scenario-monitors/v1' && a1?.id === `${A.id}.m1` && a1.scope === uygulama.id && a1.scenarioId === A.id && a1.params.text === 'Hoş geldiniz', JSON.stringify(smA));
    check('kendi listesinde 1 monitör, mesajda senaryo adı; genel liste değişmedi', (await text('#monitors-badge')) === '1' && (await $('#monitors-list .monitor').count()) === 1
      && (await text('#message')).includes('"Kısa" senaryosu') && (await store('monitors:' + graphId))['monitors:' + graphId].items.length === 2, await text('#message'));
    check('kopya storage\'da değişmedi: node yuvaları boş', (await getState()).scenarios.find((sc) => sc.id === A.id).graph.nodes.every((n) => Array.isArray(n.monitors) && n.monitors.length === 0));

    // ---- Sağ tık ve detay alt bölümü senaryo görünümünde ----
    await cxttap(uygulama.id);
    const menu = await texts('#monitor-context-menu button');
    check('sağ tık: "bu senaryo için monitör ekle" ve sayım (1 senaryo + 1 genel)', menu[0] === '"v_Uygulama" node\'una bu senaryo için monitör ekle' && menu[1] === 'Monitörlerini göster (2)', menu.join(' | '));
    await panel.keyboard.press('Escape');
    await tap(uygulama.id);
    const detailTags = await texts('#details-monitors-list .monitor .tag');
    check('detay alt bölümü: senaryo monitörü + genel kural etiketli, buton "bu senaryo için"', (await text('#details-monitors-badge')) === '2' && detailTags.join(',') === 'Senaryo,Genel'
      && (await $('#details-monitors-list .monitor.readonly').count()) === 1 && (await text('#btn-node-monitor-add')) === 'Bu node\'a bu senaryo için monitör ekle', detailTags.join(','));
    check('hale: Uygulama (senaryo + genel), Giris yok', await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored'), uygulama.id) && !(await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored'), giris.id)));
    await shot('senaryo-kisa');

    // ---- Uzun senaryosuna iki monitör (storage'a doğrudan): Uygulama'da "Sepetiniz boş" (bozulacak), senaryonun tamamı Font Size ----
    await showView(B.id);
    check('Uzun sekmesi: Kısa\'nın monitörü görünmüyor', (await text('#monitors-badge')) === '' && (await $('#monitors-list .monitor').count()) === 0);
    await panel.evaluate(([key, data, b, node]) => {
      data.scenarios[b] = { nextId: 3, items: [
        { id: `${b}.m1`, type: 'expectedText', scope: node, params: { text: 'Sepetiniz boş', mode: 'present', caseSensitive: false }, severity: 'error', enabled: true, name: 'Sepet boş yazısı', scenarioId: b },
        { id: `${b}.m2`, type: 'fontSize', scope: 'global', params: { min: 4, unit: 'pt' }, severity: 'error', enabled: true, name: 'Senaryoda küçük yazı yok', scenarioId: b },
      ] };
      return chrome.storage.local.set({ [key]: data });
    }, ['scenario-monitors:' + graphId, smA, B.id, uygulama.id]);
    await sleep(500);
    const scopes = await texts('#monitors-list .monitor .scope');
    check('Uzun: 2 monitör, kapsamlar "Node: v_Uygulama" ve "Senaryonun tamamı"', (await text('#monitors-badge')) === '2' && scopes.includes('Node: v_Uygulama') && scopes.includes('Senaryonun tamamı'), scopes.join(' | '));

    // ---- Ana graph görünümü: not ----
    await showView(null);
    check('ana graph: liste yine 2 genel kural, senaryo notu', (await text('#monitors-badge')) === '2' && (await $('#monitors-general').isHidden())
      && (await text('#monitors-scenario-note')).includes('senaryolara özel 3 monitör var (Kısa: 1, Uzun: 2)'), await text('#monitors-scenario-note'));

    // ---- Oynatma: Kısa → genel 2 + senaryonun 1'i, hepsi yeşil; Uzun'un monitörleri yok ----
    await panel.evaluate((id) => { selectScenario(id); rememberScenario(id); scenarioRun = 0; render(); }, A.id);
    await sleep(300);
    const rA = await replayRun();
    check('Kısa oynatıldı: geçti', rA.status === 'passed', JSON.stringify(rA.steps));
    const rowsA = await ledRows();
    check('ışık listesi: 3 satır (2 Genel, 1 Senaryo), hepsi yeşil', rowsA.length === 3 && rowsA.filter((r) => r.tag === 'Genel').length === 2 && rowsA.filter((r) => r.tag === 'Senaryo').length === 1
      && rowsA.every((r) => r.status === 'ok') && !rowsA.some((r) => r.name === 'Sepet boş yazısı'), JSON.stringify(rowsA));
    check('başlıkta sayım "3 monitör (2 genel, 1 senaryo)"', (await text('#monitor-run-summary')).startsWith('3 monitör (2 genel, 1 senaryo)'), await text('#monitor-run-summary'));
    await showView(A.id);
    check('Kısa sekmesinde kendi monitörünün "Son kontrol" satırı yeşil', (await $('#monitors-list .monitor .verdict .led.ok').count()) === 1 && (await text('#monitors-list .monitor .verdict')).includes('son oynatma'));
    await showView(null);

    // ---- Oynatma: Uzun → genel 2 + senaryonun 2'si; "Sepetiniz boş" kırmızı, uyarı senaryo monitörünün id'siyle ----
    await panel.evaluate((id) => { selectScenario(id); rememberScenario(id); scenarioRun = 0; render(); }, B.id);
    await sleep(300);
    const rB = await replayRun();
    check('Uzun oynatıldı: geçti (Emir\'in sonucu monitörden etkilenmez)', rB.status === 'passed', JSON.stringify(rB.steps));
    const rowsB = await ledRows();
    const sepet = rowsB.find((r) => r.name === 'Sepet boş yazısı');
    check('ışık listesi: 4 satır, "Sepet boş yazısı" kırmızı adım 1\'de, diğerleri yeşil', rowsB.length === 4 && sepet?.tag === 'Senaryo' && sepet.status === 'fail' && sepet.detail.startsWith('Adım 1 (e_Git → v_Uygulama)')
      && rowsB.filter((r) => r.status === 'ok').length === 3 && !rowsB.some((r) => r.name === 'Expected Text · "Hoş geldiniz"'), JSON.stringify(rowsB));
    const alarms = (await store('monitor-alarms:' + graphId))['monitor-alarms:' + graphId];
    check('uyarı senaryo monitörünün id\'siyle, görüntülü', alarms?.items.length === 1 && alarms.items[0].monitorId === `${B.id}.m1` && String(alarms.items[0].screenshot).startsWith('data:image/jpeg'), JSON.stringify(alarms?.items.map((a) => a.monitorId)));
    await shot('oynatma-uzun');

    // ---- "Bu ekranda şimdi kontrol et" senaryo görünümünde: genel + senaryonun monitörleri ----
    await page.goto(base + '/uygulama');
    await page.bringToFront();
    await sleep(500);
    await showView(B.id);
    await tap(uygulama.id);
    await $('#btn-monitor-check').click();
    await panel.waitForFunction(() => document.getElementById('message').textContent.includes('Şimdi kontrol edildi'), null, { timeout: 15000 });
    check('şimdi kontrol: 4 monitör (genel 2 + senaryonun 2), 1 kırmızı 3 yeşil', (await text('#message')).includes('1 kırmızı, 3 yeşil'), await text('#message'));

    // ---- "Senaryo indir": kopyadaki yuvalar dolu, liste dosyada; panelin kopyası değişmedi ----
    const download = panel.waitForEvent('download');
    await panel.evaluate(() => document.getElementById('btn-scenario-download').click());
    const file = path.join(OUT, (await download).suggestedFilename());
    await (await download).saveAs(file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const slot = json.graph?.nodes.find((n) => n.id === uygulama.id)?.monitors ?? [];
    check('senaryo dosyası: node yuvasında 1 monitör, listede 2, kopyada Giris yuvası boş', json.format === 'graph-recorder-scenario/v1' && slot.length === 1 && slot[0].id === `${B.id}.m1` && slot[0].scope === uygulama.id
      && json.monitors?.items.length === 2 && json.graph.nodes.find((n) => n.id === giris.id)?.monitors.length === 0 && json.runs.length === 1, JSON.stringify(json.monitors));
    check('panelin çalışma kopyası değişmedi', await panel.evaluate(() => scenario.graph.nodes.every((n) => n.monitors.length === 0)));
    await showView(null);

    // ---- Graph yedeği: senaryo monitörleri de yedekte; yükleyince senaryolarıyla geri gelir ----
    const backup = await panel.evaluate(() => graphBackup());
    check('yedekte senaryo monitörleri senaryo id\'siyle', backup.scenarioMonitors?.scenarios?.[A.id]?.length === 1 && backup.scenarioMonitors.scenarios[B.id]?.length === 2 && backup.monitors.items.length === 2);
    const backupFile = path.join(OUT, 'yedek.graph.json');
    fs.writeFileSync(backupFile, JSON.stringify(backup));
    await panel.evaluate(() => { document.getElementById('graphs').open = true; });
    await panel.setInputFiles('#graph-file', backupFile);
    await sleep(300);
    if (await panel.evaluate(() => document.getElementById('confirm-dialog').open)) await panel.click('#btn-confirm-dialog-ok');
    await sleep(1500);
    const graph2 = await activeId();
    const restored = await storedScenarioMonitors(graph2);
    check('yüklenen graph\'ta senaryo monitörleri geri geldi (senaryo id\'leri korunur)', graph2 !== graphId && restored?.scenarios?.[A.id]?.items.length === 1 && restored.scenarios[B.id]?.items.length === 2
      && restored.scenarios[B.id].items[0].id === `${B.id}.m1` && restored.scenarios[B.id].items[0].scope === uygulama.id, JSON.stringify(restored));
    check('yedek mesajı senaryo monitörlerini söylüyor', (await text('#message')).includes('Senaryolara özel 3 monitör yüklendi'), await text('#message'));
    await showView(B.id);
    check('yüklenen graph\'ın Uzun sekmesi: 2 monitör, kapsam adı kopyadan', (await text('#monitors-badge')) === '2' && (await texts('#monitors-list .monitor .scope')).includes('Node: v_Uygulama'));
    await showView(null);

    // ---- Silme: senaryo silinince monitörleri gider; monitör silme ve geri alma; graph silinince anahtar gider ----
    await send({ type: 'DELETE_SCENARIO', id: B.id });
    await sleep(600);
    const afterDelete = await storedScenarioMonitors(graph2);
    check('senaryo silinince monitörleri silindi, diğer senaryonunki kaldı', !afterDelete?.scenarios?.[B.id] && afterDelete?.scenarios?.[A.id]?.items.length === 1, JSON.stringify(afterDelete));
    await showView(A.id);
    await $('#monitors-list .monitor .delete').first().click();
    await sleep(400);
    check('senaryo monitörü silindi (genel kurallar duruyor)', (await text('#monitors-badge')) === '' && (await storedScenarioMonitors(graph2)).scenarios[A.id].items.length === 0 && (await text('#monitors-general-badge')) === '2');
    await $('#btn-monitor-undo').click();
    await sleep(400);
    check('geri al: senaryonun listesine döndü', (await text('#monitors-badge')) === '1' && (await storedScenarioMonitors(graph2)).scenarios[A.id].items[0].id === `${A.id}.m1`);
    await showView(null);
    await send({ type: 'SWITCH_GRAPH', id: graphId });
    await sleep(800);
    await send({ type: 'DELETE_GRAPH', id: graph2 });
    await sleep(600);
    check('graph silinince senaryo monitörleri anahtarı silindi; ilk graph\'ınki duruyor', (await storedScenarioMonitors(graph2)) === undefined && (await storedScenarioMonitors(graphId))?.scenarios?.[B.id]?.items.length === 2);

    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
