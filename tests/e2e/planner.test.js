// GraphWalker ile senaryo üretimi (panel → native messaging → GraphWalker): çıkmaz node'lu
// graph'ta tüm edge'ler (birden fazla koşu, %100), aynı tohum aynı koşular, tüm node'lar, bir
// node'a ulaş, dolu senaryoda onay, strateji listesinin senaryoyu izlemesi, runner'da oynatma.
// Planlayıcı kurulu olmalı (runner\install-planner.cmd); değilse test atlanır (çıkış kodu 3).
// Kullanım: node tests/e2e/planner.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const OUT = outDir('planner');
const EXTENSION_ID = 'limihkoliileclgenbfinjjkgimopjen'; // manifest.json > key
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ana: A (geri döner), B (çıkmaz), C (geri döner)
const PAGES = {
  '/': '<!doctype html><title>Ana</title><button id="a" onclick="location.href=\'/a\'">A</button> <button id="b" onclick="location.href=\'/b\'">B</button> <button id="c" onclick="location.href=\'/c\'">C</button>',
  '/a': '<!doctype html><title>Sayfa A</title><button id="back" onclick="location.href=\'/\'">Geri</button>',
  '/b': '<!doctype html><title>Sayfa B</title><p>Son</p><a href="#">x</a>',
  '/c': '<!doctype html><title>Sayfa C</title><button id="back" onclick="location.href=\'/\'">Ana sayfa</button> <input id="q">',
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const config = path.join(process.env.LOCALAPPDATA ?? '', 'GraphRecorder', 'config.json');
  if (!fs.existsSync(config)) {
    console.log('ATLANDI: planlayıcı kurulu değil (runner\\install-planner.cmd).');
    process.exit(3);
  }
  // Kurulu sürüm (eski kurulumda cli yok: Java); aynı tohum iki sürümde farklı yol verir
  const cli = JSON.parse(fs.readFileSync(config, 'utf8')).cli ?? 'java';
  console.log(`GraphWalker: ${cli === 'rust' ? 'Rust' : 'Java'}`);
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGES[req.url.split('?')[0]] ?? 'yok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-plan-')), {
    executablePath: CHROME, headless: !HEADED, viewport: null, acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900', ...(HEADED ? ['--window-position=-2400,0'] : [])],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const id = sw.url().split('/')[2];
    check('eklenti kimliği manifest key\'inden', id === EXTENSION_ID, id);
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(BASE + '/');
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel/panel.html`);
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
    const local = () => panel.evaluate(() => ({ id: scenario.id, runs: scenario.runs, planner: scenario.planner }));
    const generate = async (strategy, { seed = '', target = null } = {}) => {
      await panel.selectOption('#scenario-strategy', strategy);
      if (target) await panel.selectOption('#scenario-target', target);
      if (!(await panel.isDisabled('#scenario-seed'))) await panel.fill('#scenario-seed', String(seed));
      await panel.click('#btn-scenario-generate');
      await sleep(200);
      if (await panel.evaluate(() => document.getElementById('confirm-dialog').open)) await panel.click('#btn-confirm-dialog-ok');
      await panel.waitForFunction(() => !planning, null, { timeout: 60000 });
      await sleep(300);
      return { ...(await local()), message: await panel.textContent('#message') };
    };

    // ---- Kayıt: Ana → A → Ana, Ana → C → Ana, Ana → B (çıkmaz) ----
    await createNode();
    for (const [go, back] of [['#a', '/a'], ['#c', '/c']]) {
      await page.click(go);
      await page.waitForURL(BASE + back);
      await createNode();
      await page.click('#back');
      await page.waitForURL(BASE + '/');
      await createNode();
    }
    await page.click('#b');
    await page.waitForURL(BASE + '/b');
    await createNode();
    let s = await getState();
    const nodeOf = (name) => s.nodes.find((n) => n.name === name).id;
    check('kayıt: 4 node, 5 edge', s.nodes.length === 4 && s.edges.length === 5, `${s.nodes.length} node, ${s.edges.length} edge`);

    // ---- Strateji listesi ----
    await panel.click('#scenario summary');
    await panel.click('#btn-scenario-new');
    await sleep(300);
    const options = await panel.$$eval('#scenario-strategy option', (os) => os.map((o) => o.value));
    check('strateji listesinde GraphWalker hedefleri', options.join(',') === 'manual,gw-edges,gw-nodes,gw-node', options.join(','));
    await panel.selectOption('#scenario-strategy', 'gw-edges');
    check('GraphWalker seçilince: tohum ve Üret, hedef node gizli', !(await panel.isHidden('#scenario-planner')) && await panel.isHidden('#scenario-target-label'));

    // ---- Tüm edge'ler: çıkmaz node, birden fazla koşu, %100 ----
    const started = Date.now();
    let r = await generate('gw-edges', { seed: 42 });
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const edgesCovered = new Set(r.runs.flat());
    // Yürüyüş B'ye varırsa orada kalır (çıkmaz node) ve kalanlar yeni koşularla kapsanır; e_B son
    // kapsanan edge'se kapsama B'ye varınca tamamlanır, tek koşu yeter (tohuma ve sürüme bağlı)
    check('tüm edge\'ler: %100 kapsama; birden fazla koşu ancak çıkmaz node\'da', edgesCovered.size === 5 && (r.runs.length === 1 || r.planner.deadEnd === nodeOf('v_B')), `${JSON.stringify(r.runs)} · ${seconds} sn`);
    check('planner bilgisi senaryoda (sürüm dahil)', r.planner.engine === 'graphwalker' && r.planner.cli === cli && r.planner.goal === 'edges' && r.planner.seed === 42 && (!r.planner.deadEnd || r.planner.deadEnd === nodeOf('v_B')), JSON.stringify(r.planner));
    check('bildirim ve özet', r.message.includes('5/5 edge') && (await panel.textContent('#scenario-summary')).includes(`GraphWalker${cli === 'rust' ? ' (Rust)' : ''}: tüm edge'ler (tohum 42)`), r.message);
    s = await getState();
    check('kaydedildi', JSON.stringify(s.scenarios[0].runs) === JSON.stringify(r.runs) && s.scenarios[0].planner.seed === 42);
    const firstRuns = JSON.stringify(r.runs);
    const scenario1 = r.id;

    // ---- Aynı tohum, ikinci senaryo: aynı koşular ----
    await panel.click('#btn-scenario-new');
    await sleep(300);
    r = await generate('gw-edges', { seed: 42 });
    check('aynı tohum aynı koşular', JSON.stringify(r.runs) === firstRuns, JSON.stringify(r.runs));

    // ---- Dolu senaryoda onay; tüm node'lar ----
    await panel.selectOption('#scenario-strategy', 'gw-nodes');
    await panel.click('#btn-scenario-generate');
    await sleep(200);
    const dialog = await panel.evaluate(() => ({ open: document.getElementById('confirm-dialog').open, text: document.getElementById('confirm-dialog-text').textContent }));
    check('dolu senaryoda onay soruldu', dialog.open && dialog.text.includes('değişecek'), dialog.text);
    await panel.click('#btn-confirm-dialog-cancel');
    check('vazgeçince koşular aynı', JSON.stringify((await local()).runs) === firstRuns);
    r = await generate('gw-nodes', { seed: 7 });
    const nodesCovered = new Set([s.startNodeId, ...r.runs.flat().map((e) => s.edges.find((x) => x.id === e).target)]);
    check('tüm node\'lar: 4/4', nodesCovered.size === 4 && r.planner.goal === 'nodes', JSON.stringify(r.runs));

    // ---- Bir node'a ulaş ----
    await panel.selectOption('#scenario-strategy', 'gw-node');
    check('node hedefinde tohum kapalı, hedef görünür', await panel.isDisabled('#scenario-seed') && !(await panel.isHidden('#scenario-target-label')));
    r = await generate('gw-node', { target: nodeOf('v_C') });
    const reach = r.runs[0].map((e) => s.edges.find((x) => x.id === e));
    check('node\'a ulaş: tek koşu, C\'de biter', r.runs.length === 1 && reach.at(-1).target === nodeOf('v_C') && r.planner.target === nodeOf('v_C'), JSON.stringify(r.runs));

    // ---- Strateji listesi seçili senaryoyu izler ----
    await panel.evaluate((sid) => [...document.querySelectorAll('#scenario-list li')].find((li) => li.querySelector('.name').textContent === 'Senaryo 1').click(), scenario1);
    await sleep(200);
    check('Senaryo 1 seçilince strateji "tüm edge\'ler"', (await panel.inputValue('#scenario-strategy')) === 'gw-edges');

    // ---- Elle düzeltme: "Elle seç"e dönülünce edge eklenir, planner elle olur ----
    await panel.selectOption('#scenario-strategy', 'manual');
    await panel.evaluate(() => { scenarioRun = scenario.runs.length - 1; renderScenario(); });
    const end = await panel.evaluate(() => runEnd(scenarioGraph(), scenario.runs[scenarioRun]));
    const next = s.edges.find((e) => e.source === end);
    if (next) {
      await panel.evaluate((eid) => { cy.getElementById(eid).emit('tap'); }, next.id);
      await sleep(300);
      check('elle düzeltme: planner elle', (await local()).planner.engine === 'manual');
      await panel.click('#btn-scenario-undo');
      await sleep(200);
    }

    // ---- Runner: üretilen senaryo ----
    await panel.selectOption('#scenario-strategy', 'gw-edges');
    r = await generate('gw-edges', { seed: 42 });
    const model = await panel.evaluate(() => graphWalkerModel());
    fs.writeFileSync(path.join(OUT, `${model.name}.json`), JSON.stringify(model));
    const download = panel.waitForEvent('download');
    await panel.click('#btn-scenario-download');
    const file = await download;
    const scenarioPath = path.join(OUT, file.suggestedFilename());
    await file.saveAs(scenarioPath);
    const runner = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(REPO, 'runner', 'run.js'), scenarioPath, '--out', path.join(OUT, 'run')]);
      let stdout = '';
      child.stdout.on('data', (b) => { stdout += b; });
      child.stderr.on('data', (b) => { stdout += b; });
      child.on('exit', (code) => resolve({ code, stdout }));
    });
    check('runner: GraphWalker senaryosu geçti', runner.code === 0, runner.stdout.split('\n').filter((l) => l.startsWith('Sonuç')).join(' ') || runner.stdout.slice(-300));

    // ---- Host bulunamazsa açıklama ----
    const text = await panel.evaluate(() => plannerHostError('Specified native messaging host not found.'));
    check('host yoksa: kurulumu söyler', text.includes('install-planner.cmd') && text.includes('plan.js'), text);
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
