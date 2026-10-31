// Senaryonun kendi graph'ından oynatma testi: ana graph kopyadan sonra değişince panelde
// oynatma kopyayı oynatır, kart farkı söyler; "Ana graph'tan yenile" kopyayı yeniler.
// Kullanım: node tests/e2e/scenario-replay.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME } = require('./env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = {
  '/': () => '<!doctype html><title>Giris</title><button id="go" onclick="location.href=\'/app\'">Git</button>',
  '/app': () => '<!doctype html><title>Uygulama</title><h1>App</h1><button id="back">Geri</button>',
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = http.createServer((req, res) => {
    const render = PAGES[req.url.split('?')[0].split('#')[0]];
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(render ? render() : 'yok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-screplay-')), {
    executablePath: CHROME, headless: true, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page0 = ctx.pages()[0] ?? await ctx.newPage();
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    const errors = [];
    panel.on('pageerror', (e) => errors.push(e.message));
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const tabIdOf = (url) => panel.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.filter((t) => (t.url ?? '').startsWith(u)).map((t) => t.id)), url);
    const createNode = async (tabId) => {
      await sleep(700);
      await send({ type: 'CREATE_NODE', tabId });
      let s = await getState();
      if (s.pending) { await send({ type: 'RESOLVE', targetId: null }); s = await getState(); }
      return s;
    };
    const card = () => panel.evaluate(() => ({
      hidden: document.getElementById('replay-check').hidden,
      reasons: document.getElementById('replay-check-reasons').textContent,
      refresh: !document.getElementById('btn-replay-refresh').hidden,
    }));
    const replayFromStart = async () => {
      await page0.goto(BASE + '/');
      await page0.bringToFront();
      await sleep(800);
      await panel.evaluate(() => { replayResult = null; document.getElementById('btn-replay').click(); });
      await sleep(800);
    };
    const waitResult = async () => {
      await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 60000 });
      return panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}`) }));
    };

    // ---- KAYIT: Giris --(Git)--> Uygulama ----
    await page0.goto(BASE + '/');
    await page0.bringToFront();
    await sleep(500);
    const [T0] = await tabIdOf(BASE + '/');
    let s = await createNode(T0);
    await page0.click('#go');
    await page0.waitForURL('**/app');
    s = await createNode(T0);
    const edge = s.edges[0];
    check('kayıt: 2 node, 1 edge (tıklama + otomatik bekleme)', s.nodes.length === 2 && s.edges.length === 1 && edge.actions.map((a) => a.type).join('+') === 'click+wait', JSON.stringify(edge?.actions.map((a) => a.type)));

    // ---- SENARYO ----
    await panel.evaluate(async (id) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Kopya', planner: { engine: 'manual' }, runs: [[id]] });
      scenarioRun = 0;
      renderScenario();
    }, edge.id);
    // startReplay'e verilen senaryo bilgisi (monitör kodu gibi sarmalanır)
    await panel.evaluate(() => {
      const original = startReplay;
      startReplay = (options) => {
        window.lastReplayScenario = { id: options.scenario?.id, edges: options.scenario?.graph?.edges.map((e) => e.actions.length) };
        return original(options);
      };
    });

    // ---- Ana graph değişti: tıklama silindi; kopya hâlâ tıklıyor ----
    await send({ type: 'REMOVE_ACTION', edgeId: edge.id, index: 0 });
    s = await getState();
    check('ana graph: edge\'de yalnızca bekleme kaldı', s.edges[0].actions.map((a) => a.type).join('+') === 'wait');
    await replayFromStart();
    const c1 = await card();
    check('kart: ana graph\'ın değiştiği söyleniyor', !c1.hidden && c1.reasons.includes('Kopyadan sonra ana graph değişti') && c1.reasons.includes('kopyayı'), c1.reasons);
    check('kart: "Ana graph\'tan yenile" var', c1.refresh);
    await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    const r1 = await waitResult();
    check('kopya oynatıldı: geçti (silinen tıklama kopyada)', r1.status === 'passed', JSON.stringify(r1.steps));
    const passed = await panel.evaluate(() => window.lastReplayScenario);
    const scenarioId = await panel.evaluate(() => scenario.id);
    check('startReplay senaryoyu ve graph\'ını aldı', passed?.id === scenarioId && JSON.stringify(passed.edges) === '[2]', JSON.stringify(passed));

    // ---- Ana graph'tan yenile: kopya tıklamasız, oynatma kalır ----
    await replayFromStart();
    const c2 = await card();
    check('ikinci oynatma: kart yine açık', !c2.hidden && c2.refresh, c2.reasons);
    await panel.evaluate(() => document.getElementById('btn-replay-refresh').click());
    await panel.waitForFunction(() => scenario.graph.edges[0]?.actions.length === 1, null, { timeout: 10000 });
    // kontrol yeniden yapılır (sayfanın parmak izi istenir): kart sonra güncellenir
    await panel.waitForFunction(() => !document.getElementById('replay-check-reasons').textContent.includes('Kopyadan sonra'), null, { timeout: 5000 }).catch(() => {});
    const c3 = await card();
    check('yenileyince fark kalktı', c3.hidden || !c3.reasons.includes('Kopyadan sonra'), c3.reasons);
    const stored = (await getState()).scenarios[0].graph.edges[0].actions.map((a) => a.type).join('+');
    check('yenilenen kopya kaydedildi', stored === 'wait', stored);
    await replayFromStart();
    if (!(await card()).hidden) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    const r2 = await waitResult();
    check('yenilenmiş kopya oynatıldı: kaldı (tıklama yok)', r2.status === 'failed', JSON.stringify(r2.steps));
    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
