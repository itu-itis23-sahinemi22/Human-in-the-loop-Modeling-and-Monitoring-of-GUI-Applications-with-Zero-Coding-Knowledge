// Senaryo listesi: önce "Yeni senaryo", kendiliğinden kayıt, seçim ve hatırlama, yeniden
// adlandırma, yürünemeyen senaryonun işareti, silme, graph başına liste, yedekte senaryolar,
// indirme adı, yükleme, hızlı tıklamalar.
// Kullanım: node tests/e2e/scenarios.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = outDir('scenarios');

const PAGES = {
  '/': '<!doctype html><title>Ana</title><button id="a" onclick="location.href=\'/a\'">A</button> <button id="b" onclick="location.href=\'/b\'">B</button>',
  '/a': '<!doctype html><title>Sayfa A</title><button id="back" onclick="location.href=\'/\'">Geri</button>',
  '/b': '<!doctype html><title>Sayfa B</title><p>Son</p><a href="#">x</a>',
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
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-scen-')), {
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
    const { windowId } = await panel.evaluate((id) => chrome.tabs.get(id), T);
    const createNode = async (resolve = null) => {
      await sleep(700);
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: T, windowId });
      const s = await getState();
      if (s.pending) await send({ type: 'RESOLVE', targetId: resolve === 'first' ? s.pending.candidateIds[0] : resolve });
    };
    const tap = (id) => panel.evaluate((x) => { cy.getElementById(x).emit('tap'); }, id);
    const rows = () => panel.$$eval('#scenario-list li', (lis) => lis.map((li) => ({ name: li.querySelector('.name')?.textContent, meta: li.querySelector('.meta')?.textContent, warn: Boolean(li.querySelector('.warn')), active: li.classList.contains('active') })));
    const clickRow = (name) => panel.evaluate((n) => [...document.querySelectorAll('#scenario-list li')].find((li) => li.querySelector('.name').textContent === n).click(), name);
    const rowButton = (name, title) => panel.evaluate(([n, t]) => [...document.querySelectorAll('#scenario-list li')].find((li) => li.querySelector('.name').textContent === n).querySelector(`button[title="${t}"]`).click(), [name, title]);
    const local = () => panel.evaluate(() => ({ id: scenario.id, name: scenario.name, start: scenario.start, runs: scenario.runs }));
    const stored = async () => (await getState()).scenarios;

    // ---- Kayıt: Ana → A → Ana, Ana → B (çıkmaz) ----
    await createNode();
    await page.click('#a');
    await page.waitForURL(BASE + '/a');
    await createNode();
    await page.click('#back');
    await page.waitForURL(BASE + '/');
    await createNode('first');
    await page.click('#b');
    await page.waitForURL(BASE + '/b');
    await createNode();
    let s = await getState();
    const nodeOf = (name) => s.nodes.find((n) => n.name === name).id;
    const edgeOf = (from, to) => s.edges.find((e) => e.source === nodeOf(from) && e.target === nodeOf(to)).id;
    const [toA, back, toB] = [edgeOf('v_Ana', 'v_A'), edgeOf('v_A', 'v_Ana'), edgeOf('v_Ana', 'v_B')];
    check('kayıt: 3 node, 3 edge', s.nodes.length === 3 && s.edges.length === 3);

    // ---- Boş liste: edge tıklaması senaryo oluşturmaz ----
    await panel.click('#scenario summary');
    check('boş: ipucu görünüyor, düzenleme gizli', !(await panel.isHidden('#scenario-empty')) && await panel.isHidden('#scenario-editor'));
    await tap(toA);
    await sleep(300);
    check('senaryo yokken edge tıklaması: senaryo yok, edge detayı açıldı', (await stored()).length === 0 && await panel.evaluate((id) => selectedId === id, toA));

    // ---- Senaryo 1: Ana → A → Ana ----
    await panel.click('#btn-scenario-new');
    await sleep(300);
    check('Yeni senaryo: "Senaryo 1" seçili, düzenleme açık', (await local()).name === 'Senaryo 1' && !(await panel.isHidden('#scenario-editor')) && (await rows())[0]?.active);
    await tap(toA);
    await tap(back); // hızlı ardışık iki tıklama
    await sleep(500);
    let list = await stored();
    check('kendiliğinden kaydedildi (hızlı iki tıklama dahil)', JSON.stringify(list[0].runs) === JSON.stringify([[toA, back]]), JSON.stringify(list[0].runs));

    // ---- Senaryo 2: Ana → B ----
    await panel.click('#btn-scenario-new');
    await sleep(300);
    await tap(toB);
    await sleep(400);
    // ---- Senaryo 3: başlangıç A, A → Ana ----
    await panel.click('#btn-scenario-new');
    await sleep(300);
    await panel.selectOption('#scenario-start', nodeOf('v_A'));
    await sleep(200);
    await tap(back);
    await sleep(400);
    list = await stored();
    check('üç senaryo saklandı', list.length === 3 && list.map((x) => x.name).join('|') === 'Senaryo 1|Senaryo 2|Senaryo 3', list.map((x) => x.name).join('|'));
    check('senaryo 3: başlangıç ve koşu', list[2].start === nodeOf('v_A') && JSON.stringify(list[2].runs) === JSON.stringify([[back]]));
    let r = await rows();
    check('liste: kapsama', r[0].meta === '2/3 edge · 1 koşu' && r[1].meta === '1/3 edge · 1 koşu' && r[2].active, JSON.stringify(r));

    // ---- Aralarında geçiş ----
    await clickRow('Senaryo 1');
    await sleep(200);
    let l = await local();
    check('Senaryo 1 seçildi: koşuları geldi', l.name === 'Senaryo 1' && JSON.stringify(l.runs) === JSON.stringify([[toA, back]]) && (await panel.textContent('#scenario-summary')).startsWith('Kapsama: 2/3 edge'));
    await clickRow('Senaryo 3');
    await sleep(200);
    l = await local();
    check('Senaryo 3 seçildi: başlangıcı geldi', l.start === nodeOf('v_A') && (await panel.inputValue('#scenario-start')) === nodeOf('v_A'));

    // ---- Yeniden adlandırma ----
    await rowButton('Senaryo 2', 'Yeniden adlandır');
    await panel.fill('#scenario-list input', 'Dal B');
    await panel.press('#scenario-list input', 'Enter');
    await sleep(400);
    await rowButton('Senaryo 3', 'Yeniden adlandır');
    await panel.fill('#scenario-list input', 'Senaryo 1');
    await panel.press('#scenario-list input', 'Enter');
    await sleep(400);
    list = await stored();
    check('yeniden adlandırma; aynı ad "(2)"', list.map((x) => x.name).join('|') === 'Senaryo 1|Dal B|Senaryo 1 (2)', list.map((x) => x.name).join('|'));
    check('seçili senaryonun adı çalışma kopyasında da', (await local()).name === 'Senaryo 1 (2)' && (await panel.textContent('#scenario-active')).includes('Senaryo 1 (2)'));

    // ---- Panel yeniden açılınca: liste ve seçim ----
    await clickRow('Dal B');
    await sleep(200);
    await panel.reload();
    await sleep(900);
    await panel.click('#scenario summary');
    l = await local();
    check('panel yeniden açıldı: seçim hatırlandı', l.name === 'Dal B' && JSON.stringify(l.runs) === JSON.stringify([[toB]]) && (await rows()).length === 3, JSON.stringify(l));

    // ---- İndirme adı ----
    const download = panel.waitForEvent('download');
    await panel.click('#btn-scenario-download');
    const file = await download;
    const scenarioPath = path.join(OUT, file.suggestedFilename());
    await file.saveAs(scenarioPath);
    const json = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
    check('indirilen dosya: ad ve içerik', file.suggestedFilename() === 'Ana-DalB.json' && json.name === 'Dal B' && json.model === 'Ana.json', `${file.suggestedFilename()} ${json.name} ${json.model}`);

    // ---- Yürünemeyen senaryo: edge silinir, geri alınır ----
    await send({ type: 'DELETE', id: toB });
    await sleep(500);
    r = await rows();
    const dal = r.find((x) => x.name === 'Dal B');
    check('edge silindi: Dal B ⚠ yürünemiyor', dal.warn && dal.meta === 'yürünemiyor', JSON.stringify(dal));
    // İndirme kapalı (runner ana modeli oynatır); panelde oynatma senaryonun graph'ını (kopya) oynatır, kopyada edge duruyor
    check('yürünemeyen: indirme kapalı, oynatma kopyayla açık', await panel.isDisabled('#btn-scenario-download') && !(await panel.isDisabled('#btn-replay')));
    check('senaryo silinmedi', (await stored()).some((x) => x.name === 'Dal B'));
    await send({ type: 'UNDO' });
    await sleep(500);
    r = await rows();
    check('geri alındı: işaret kalktı', !r.find((x) => x.name === 'Dal B').warn && !(await panel.isDisabled('#btn-scenario-download')));

    // ---- Yükleme: listeye eklenir ----
    await panel.setInputFiles('#scenario-file', scenarioPath);
    await sleep(500);
    list = await stored();
    check('yüklenen dosya yeni senaryo: "Dal B (2)" seçili', list.length === 4 && (await local()).name === 'Dal B (2)', list.map((x) => x.name).join('|'));

    // ---- Silme ----
    await rowButton('Dal B (2)', 'Sil');
    const dialog = await panel.evaluate(() => ({ open: document.getElementById('confirm-dialog').open, text: document.getElementById('confirm-dialog-text').textContent }));
    check('silme onayı', dialog.open && dialog.text.includes('"Dal B (2)" senaryosu silinecek (1 koşu)'), dialog.text);
    await panel.click('#btn-confirm-dialog-ok');
    await sleep(400);
    check('silindi; seçim kalktı, düzenleme gizli', (await stored()).length === 3 && (await local()).id === null && await panel.isHidden('#scenario-editor'));

    // ---- Graph başına liste ----
    await clickRow('Senaryo 1');
    await sleep(200);
    const graphMeta = await panel.evaluate(() => document.querySelector('#graph-list li.active .meta')?.textContent);
    check('graph satırında senaryo sayısı', graphMeta?.includes('3 senaryo'), graphMeta);
    const backup = await panel.evaluate(() => graphBackup());
    check('graph yedeğinde senaryolar', backup.scenarios?.length === 3);
    await send({ type: 'NEW_GRAPH' });
    await sleep(700);
    check('yeni graph: senaryo listesi boş', (await rows()).length === 0 && (await local()).id === null && !(await panel.isHidden('#scenario-empty')));
    await send({ type: 'IMPORT_GRAPH', graph: backup });
    await sleep(700);
    r = await rows();
    check('yedekten yüklenen graph: senaryolar geldi', r.length === 3 && r.map((x) => x.name).join('|') === 'Senaryo 1|Dal B|Senaryo 1 (2)', JSON.stringify(r));
    const graphs = (await panel.evaluate(() => chrome.storage.local.get('graphs'))).graphs;
    const original = graphs[0].id;
    await send({ type: 'SWITCH_GRAPH', id: original });
    await sleep(700);
    l = await local();
    check('ilk graph\'a dönüldü: son seçilen senaryo geldi', l.name === 'Senaryo 1' && (await rows()).length === 3, JSON.stringify(l));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
