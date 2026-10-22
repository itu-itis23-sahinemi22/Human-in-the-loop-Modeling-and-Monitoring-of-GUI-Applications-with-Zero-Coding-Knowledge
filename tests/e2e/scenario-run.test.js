// Senaryo ortak kısmı: panelde elle senaryo ve önizleme, indirme/yükleme, runner'da çoklu koşu,
// üç rapor (JSON, HTML, JUnit), başarısız koşuda rapor içeriği.
// Kullanım: node tests/e2e/scenario-run.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');

const OUT = outDir('scenario-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const SITE = {
  '/': html('Ana', '<a id="a" href="/a">A sayfasi</a> <a id="b" href="/b">B sayfasi</a>'),
  '/a': html('A', '<h1>A</h1><a id="home" href="/">Ana sayfa</a>'),
  '/b': html('B', '<h1>B</h1><button id="buy">Satin al</button>'), // çıkmaz: buradan link yok
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const runner = (args) => new Promise((resolve) => {
  let output = '';
  const child = spawn(process.execPath, [path.join(REPO, 'runner', 'run.js'), ...args]);
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('exit', (code) => resolve({ code, output }));
});

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(SITE[req.url] ?? 'yok'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-scn-')), {
    executablePath: CHROME, headless: true, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'], acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  let modelFile;
  let scenarioFile;
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(base);
    await sleep(800);
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const tab = await panel.evaluate((url) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.url.startsWith(url))), base);
    const createNode = async (resolveTo) => {
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      let s = await getState();
      if (s.pending) { await send({ type: 'RESOLVE', targetId: resolveTo ?? null }); s = await getState(); }
      return s;
    };

    // Kayıt: ana -> A -> ana, ana -> B (çıkmaz)
    let s = await createNode();
    const home = s.nodes[0].id;
    await page.click('#a'); await sleep(900); s = await createNode();
    await page.click('#home'); await sleep(900); s = await createNode(home);
    await page.click('#b'); await sleep(900); s = await createNode();
    const edge = (from, to) => s.edges.find((e) => s.nodes.find((n) => n.id === e.source).title === from && s.nodes.find((n) => n.id === e.target).title === to).id;
    const [toA, toHome, toB] = [edge('Ana', 'A'), edge('A', 'Ana'), edge('Ana', 'B')];
    check('kayıt: 3 node, 3 edge (B çıkmaz)', s.nodes.length === 3 && s.edges.length === 3);

    // 1) Panel: senaryo bölümü, elle yol
    await panel.click('#scenario summary');
    await panel.click('#btn-scenario-new');
    await sleep(300);
    await sleep(300);
    const tap = (id) => panel.evaluate((id) => { cy.getElementById(id).emit('tap'); }, id);
    const text = (sel) => panel.textContent(sel);
    check('strateji: Elle seç', (await panel.inputValue('#scenario-strategy')) === 'manual');
    check('ipucu: başlangıçtan çıkan edge', (await text('#scenario-hint')).includes('"v_Ana" node\'undan çıkan'), await text('#scenario-hint'));
    const nextCount = await panel.evaluate(() => cy.edges('.run-next').length);
    check('gidilebilecek edge\'ler kesik çizgili (2)', nextCount === 2, String(nextCount));
    await tap(toB);
    await sleep(200);
    check('koşu 1: B (çıkmaz)', (await text('#scenario-summary')).startsWith('Kapsama: 1/3 edge · 2/3 node · 1 koşu'), await text('#scenario-summary'));
    check('ipucu: çıkmaz node', (await text('#scenario-hint')).includes('çıkmaz bir node'), await text('#scenario-hint'));
    check('önizleme: koşunun edge\'i vurgulu, vardığı node işaretli', await panel.evaluate((id) => cy.getElementById(id).hasClass('run-edge') && cy.nodes('.run-end').length === 1 && cy.elements('.faded').length > 0, toB));
    await tap(toA);
    await sleep(200);
    const err = await panel.textContent('#message');
    check('geçersiz edge reddedildi', err.includes('node\'undan çıkmıyor'), err);
    await panel.click('#btn-scenario-new-run');
    await tap(toA);
    await tap(toHome);
    await sleep(200);
    check('koşu 2: A ve geri', (await text('#scenario-summary')).startsWith('Kapsama: 3/3 edge · 3/3 node · 2 koşu'), await text('#scenario-summary'));
    check('koşu sekmeleri', (await panel.$$eval('#scenario-runs button', (b) => b.map((x) => x.textContent))).join('|') === 'Koşu 1 (1)|Koşu 2 (2)');
    check('edge üzerinde sıra numarası', await panel.evaluate((id) => cy.getElementById(id).data('order') === '1', toA));
    await panel.click('#btn-scenario-undo');
    check('geri al: son edge', (await panel.$$eval('#scenario-runs button', (b) => b.map((x) => x.textContent))).join('|') === 'Koşu 1 (1)|Koşu 2 (1)');
    await tap(toHome);
    check('panel kapanınca önizleme kalkıyor', await (async () => { await panel.click('#scenario summary'); await sleep(200); const n = await panel.evaluate(() => cy.elements('.faded').length); await panel.click('#scenario summary'); return n === 0; })());

    // 2) İndir (model ile aynı klasöre) ve geri yükle
    const model = await panel.evaluate(() => graphWalkerModel());
    modelFile = path.join(OUT, `${model.name}.json`);
    fs.writeFileSync(modelFile, JSON.stringify(model));
    const download = panel.waitForEvent('download');
    await panel.click('#btn-scenario-download');
    const file = await download;
    scenarioFile = path.join(OUT, file.suggestedFilename());
    await file.saveAs(scenarioFile);
    const json = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
    check('senaryo dosyası', json.format === 'graph-recorder-scenario/v1' && json.model === `${model.name}.json` && JSON.stringify(json.runs) === JSON.stringify([[toB], [toA, toHome]]) && json.coverage.edges.join('/') === '3/3', JSON.stringify(json));
    await panel.click('#btn-scenario-clear');
    await panel.setInputFiles('#scenario-file', scenarioFile);
    await sleep(500);
    check('geri yüklendi', (await text('#message')).includes('yüklendi: 2 koşu') && (await text('#scenario-summary')).includes('3/3 edge'), await text('#message'));
  } finally {
    await ctx.close();
  }

  // 3) Runner: iki koşu, üç rapor
  let r = await runner([scenarioFile, '--out', path.join(OUT, 'ok')]);
  check('runner: iki koşu geçti', r.code === 0 && /Sonuç: GEÇTİ · 5\/5 adım · 2 koşu/.test(r.output), r.output.split('\n').filter((l) => l.startsWith('Sonuç')).join(''));
  const report = JSON.parse(fs.readFileSync(path.join(OUT, 'ok', 'report.json'), 'utf8'));
  check('report.json', report.summary.runs === 2 && report.summary.passed === 5 && report.coverage.edges.join('/') === '3/3' && report.runs[1].steps.length === 3, JSON.stringify(report.summary));
  const junitOk = fs.readFileSync(path.join(OUT, 'ok', 'junit.xml'), 'utf8');
  check('junit.xml: 2 testsuite, 5 testcase, 0 hata', (junitOk.match(/<testsuite /g) ?? []).length === 2 && (junitOk.match(/<testcase /g) ?? []).length === 5 && junitOk.includes('failures="0"'));
  check('report.html: GEÇTİ', fs.readFileSync(path.join(OUT, 'ok', 'report.html'), 'utf8').includes('class="verdict pass">GEÇTİ'));

  // 4) Bozuk model: ilk koşu kırılır, ikinci yine çalışır
  const broken = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
  const e = broken.models[0].edges.find((x) => x.id === json_toB(scenarioFile));
  e.targetVertexId = broken.models[0].startElementId; // B'ye giden edge "ana sayfaya varır" dendi
  fs.writeFileSync(modelFile, JSON.stringify(broken));
  const brokenScenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
  brokenScenario.runs = [[e.id, brokenScenario.runs[1][0]], brokenScenario.runs[1]]; // 1. koşu: B (kırılır) + bir edge daha (atlanır)
  const brokenFile = path.join(OUT, 'bozuk-senaryo.json');
  fs.writeFileSync(brokenFile, JSON.stringify(brokenScenario));
  r = await runner([brokenFile, '--out', path.join(OUT, 'fail')]);
  check('bozuk: çıkış kodu 1, ikinci koşu çalıştı', r.code === 1 && /Sonuç: KALDI · 4\/6 adım · 2 koşu \(1 koşu kaldı\)/.test(r.output), r.output.split('\n').filter((l) => l.startsWith('Sonuç')).join(''));
  const junitFail = fs.readFileSync(path.join(OUT, 'fail', 'junit.xml'), 'utf8');
  check('junit: 1 hata, 1 atlandı', junitFail.includes('failures="1"') && junitFail.includes('skipped="1"') && junitFail.includes('<failure message="Beklenen ekrana (v_Ana) varılmadı">'));

  // HTML raporu tarayıcıda: görsel fark çizildi mi, XML geçerli mi?
  const browser = await chromium.launch({ executablePath: CHROME });
  const viewer = await browser.newPage();
  await viewer.goto(`file:///${path.join(OUT, 'fail', 'report.html').replace(/\\/g, '/')}`);
  await sleep(1500);
  const visual = await viewer.evaluate(() => {
    const canvas = document.querySelector('canvas[data-expected]');
    return { canvas: canvas ? canvas.width : 0, caption: canvas?.nextElementSibling.textContent, diffRows: document.querySelectorAll('table.diff tbody tr').length, images: document.querySelectorAll('.shots img').length };
  });
  check('report.html: fark tablosu, iki görüntü, görsel fark çizildi', visual.canvas > 0 && visual.images === 2 && visual.diffRows > 0 && /fark (<)?%/.test(visual.caption), JSON.stringify(visual));
  await viewer.screenshot({ path: path.join(OUT, 'report-fail.png'), fullPage: true });
  const parse = await viewer.evaluate((xml) => !new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror'), junitFail);
  check('junit.xml geçerli XML', parse);
  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nTüm kontroller geçti');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

function json_toB(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).runs[0][0];
}
