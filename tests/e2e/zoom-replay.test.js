// Yakınlaştırma ve pencere boyutunun runner'da aynı ekranı kurduğunu dener: kayıt (gerçek zoom ve
// pencere boyutu) -> dışa aktarım -> runner (emülasyon). Yerel sunucu runner bitene kadar açık kalır.
// Kullanım: node tests/e2e/zoom-replay.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');
const OUT = outDir('zoom-replay');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><html><head><title>Zoom Replay</title><style>
  body { margin: 0; font: 16px sans-serif; } #wide { display: none; }
  @media (min-width: 1000px) { #wide { display: inline-block; } }
</style></head><body><button id="always">Always</button> <button id="wide">Wide only</button></body></html>`;

function runner(model, edges) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, 'runner', 'run.js'), model, '--path', edges, '--out', path.join(OUT, 'run')], { stdio: 'inherit' });
    child.on('exit', resolve);
  });
}

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-zoom-')), {
    executablePath: CHROME, headless: true, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  let model;
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
    const cdp = await ctx.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    async function node(target) { // target: 'new' ya da eşleşmede seçilecek node adı
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      const s = await getState();
      if (s.pending) {
        const id = target === 'new' ? null : s.pending.candidateIds.find((c) => s.nodes.find((n) => n.id === c).name === target);
        await send({ type: 'RESOLVE', targetId: id ?? null });
      }
    }
    await node('new');                                                   // n1: geniş düzen
    await panel.evaluate((id) => chrome.tabs.setZoom(id, 1.25), tab.id); await sleep(1500);
    await node('new');                                                   // %125: wide gizli
    await panel.evaluate((id) => chrome.tabs.setZoom(id, 1), tab.id); await sleep(1500);
    await node('v_ZoomReplay');                                          // geri: n1
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 900 } }); await sleep(1500);
    await node('new');                                                   // dar pencere: wide gizli
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 1200 } }); await sleep(1500);
    await node('v_ZoomReplay');                                          // geri: n1
    model = await panel.evaluate(() => graphWalkerModel());
  } finally {
    await ctx.close();
  }

  const m = model.models[0];
  for (const v of m.vertices) console.log(`${v.id} ${v.name} ${JSON.stringify(v.properties.viewport)} wide=${v.properties.elements.some((e) => e.key === 'button:wide')}`);
  for (const e of m.edges) console.log(`${e.id} ${e.name}: ${e.sourceVertexId} -> ${e.targetVertexId} ${JSON.stringify(e.properties.uiActions.map((a) => [a.type, a.viewport]))}`);
  const file = path.join(OUT, 'zoom.json');
  fs.writeFileSync(file, JSON.stringify(model, null, 2));
  const pathArg = m.edges.map((e) => e.id).join(',');

  console.log('\n=== runner: kayıttaki model');
  const a = await runner(file, pathArg);
  // Eski kayıt: yakınlaştırmanın varılan boyutu yok; runner oranlardan hesaplamalı.
  for (const e of m.edges) for (const action of e.properties.uiActions) if (action.type === 'zoom') delete action.viewport;
  const oldFile = path.join(OUT, 'zoom-noviewport.json');
  fs.writeFileSync(oldFile, JSON.stringify(model, null, 2));
  console.log('\n=== runner: yakınlaştırmada varılan boyut yok (oranlardan hesap)');
  const b = await runner(oldFile, pathArg);
  server.close();
  console.log(`\nçıkış kodları: ${a}, ${b}`);
  process.exit(a === 0 && b === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
