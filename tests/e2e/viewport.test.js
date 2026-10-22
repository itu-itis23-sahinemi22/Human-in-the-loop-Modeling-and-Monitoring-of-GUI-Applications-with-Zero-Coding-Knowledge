// Görünen alan testi: viewport kaydı, resize aksiyonu, zoom'un varılan viewport'u.
// Kullanım: node tests/e2e/viewport.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const OUT = outDir('viewport');

const PAGE = `<!doctype html><html><head><title>Viewport Test</title><style>
  body { margin: 0; font: 16px sans-serif; }
  #wide { display: none; }
  @media (min-width: 1000px) { #wide { display: inline-block; } }
  .spacer { height: 2000px; }
</style></head><body>
  <button id="always">Always</button>
  <button id="wide">Wide only</button>
  <a href="#x" id="link">Link</a>
  <div class="spacer"></div>
  <button id="bottom">Bottom</button>
</body></html>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-e2e-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME,
    headless: !HEADED,
    viewport: null, // gerçek pencere: boyutu CDP ile değiştireceğiz (kullanıcının sürüklemesi gibi)
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const extId = sw.url().split('/')[2];

    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(base);
    await sleep(800);
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel/panel.html`);
    await page.bringToFront();

    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const tab = await panel.evaluate((url) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.url.startsWith(url))), base);
    const cdp = await ctx.newCDPSession(page);
    const { windowId: cdpWindow } = await cdp.send('Browser.getWindowForTarget');
    const setWidth = (width) => cdp.send('Browser.setWindowBounds', { windowId: cdpWindow, bounds: { width } });
    const vp = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));

    // 1) İlk node: viewport'u kaydediliyor mu?
    const before = await vp();
    let r = await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
    let s = await getState();
    const n1 = s.nodes[0];
    check('ilk node oluştu', s.nodes.length === 1, JSON.stringify(r));
    check('node.viewport kaydedildi', n1?.viewport && n1.viewport.width === before.width && n1.viewport.height === before.height,
      JSON.stringify(n1?.viewport));
    check('ilk node geniş düzende (button:wide var)', n1?.elements.some((e) => e.key === 'button:wide'));
    check('urlKey (settings.js) background\'da çalışıyor', n1?.urlKey === base, `${n1?.urlKey} vs ${base}`);
    const mismatch = await panel.evaluate(() => countMismatch(new Map([['a', 1]]), new Map([['a', 2], ['b', 1]])));
    check('panel countMismatch (diffCounts)', mismatch === 'a 1 ≠ 2, b 0 ≠ 1', JSON.stringify(mismatch));

    // 2) Sürükleme: art arda boyut değişimi tek resize aksiyonu olmalı
    for (const w of [1150, 1100, 1050, 1000, 950, 900]) { await setWidth(w); await sleep(40); }
    await sleep(1200);
    const afterDrag = await vp();
    s = await getState();
    const resizes = s.buffer.filter((a) => a.type === 'resize');
    check('sürükleme tek resize aksiyonu', resizes.length === 1, `buffer: ${s.buffer.map((a) => a.type).join(',')}`);
    check('resize varılan boyutu taşıyor', resizes[0]?.viewport?.width === afterDrag.width && resizes[0]?.viewport?.height === afterDrag.height,
      `${JSON.stringify(resizes[0]?.viewport)} vs ${JSON.stringify(afterDrag)}`);
    check('resize ekranı değiştirdi (wide butonu gitti)', resizes[0]?.changed === true, `changed=${resizes[0]?.changed}`);
    const bufferText = await panel.evaluate(() => document.querySelector('#buffer').innerText);
    check('panel satırı', /Pencere boyutu\s+Resize → \d+×\d+/.test(bufferText), JSON.stringify(bufferText));

    // 3) Yakınlaştırma: resize aksiyonu üretmemeli, zoom varılan viewport'u saklamalı
    await panel.evaluate((id) => chrome.tabs.setZoom(id, 1.25), tab.id);
    await sleep(1500);
    const zoomed = await vp();
    s = await getState();
    const types = s.buffer.map((a) => a.type);
    const zoom = s.buffer.find((a) => a.type === 'zoom');
    check('zoom resize üretmedi', types.filter((t) => t === 'resize').length === 1, types.join(','));
    check('zoom aksiyonu var', Boolean(zoom) && zoom.label === 'Zoom in', JSON.stringify(zoom));
    check('zoom.viewport varılan boyut', zoom?.viewport?.width === zoomed.width && zoom?.viewport?.devicePixelRatio === zoomed.devicePixelRatio,
      `${JSON.stringify(zoom?.viewport)} vs ${JSON.stringify(zoomed)}`);
    await panel.bringToFront();
    await panel.screenshot({ path: path.join(OUT, 'panel-buffer.png') });
    await page.bringToFront();

    // 4) Tıklama + node: edge adı tıklamadan gelmeli, node yeni viewport'u taşımalı
    await page.click('#always');
    await sleep(600);
    r = await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
    s = await getState();
    if (s.pending) { r = await send({ type: 'RESOLVE', targetId: null }); s = await getState(); }
    const n2 = s.nodes.at(-1);
    const e1 = s.edges.at(-1);
    check('ikinci node yeni viewport ile', n2?.viewport?.width === zoomed.width && n2?.viewport?.devicePixelRatio === zoomed.devicePixelRatio,
      JSON.stringify(n2?.viewport));
    check('edge adı tıklamadan (resize/zoom atlandı mı?)', e1?.name === 'e_Always', `${e1?.name}: ${e1?.actions.map((a) => a.type).join(',')}`);

    // 5) Yalnızca resize'dan oluşan edge: adı e_Resize
    await setWidth(1200);
    await sleep(1200);
    r = await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
    s = await getState();
    if (s.pending) {
      const target = s.pending.candidateIds[0];
      r = await send({ type: 'RESOLVE', targetId: target });
      s = await getState();
    }
    const e2 = s.edges.at(-1);
    check('yalnızca resize edge adı e_Resize', e2?.name === 'e_Resize', `${e2?.name}: ${e2?.actions.map((a) => a.type).join(',')}`);

    // 6) Dışa aktarım
    const model = await panel.evaluate(() => graphWalkerModel());
    const m = model.models[0];
    check('format v5', m.properties.graphRecorder.format === 'graph-recorder/v5');
    check('vertex viewport', m.vertices.every((v) => v.properties.viewport?.width > 0), JSON.stringify(m.vertices.map((v) => v.properties.viewport)));
    const ui = m.edges.flatMap((e) => e.properties.uiActions);
    check('uiActions resize/zoom viewport taşıyor', ui.filter((a) => a.type === 'resize' || a.type === 'zoom').every((a) => a.viewport?.width > 0),
      JSON.stringify(ui.map((a) => [a.type, a.viewport])));
    check('uiActions changed taşımıyor', ui.every((a) => !('changed' in a)));

    // Node detay kartı: viewport metni
    await panel.bringToFront();
    await panel.evaluate((id) => { selectedId = id; renderDetails(); }, n2.id);
    const subtitle = await panel.evaluate(() => document.querySelector('#details-subtitle').textContent);
    check('node detayında viewport', /· \d+×\d+ @1\.25x$/.test(subtitle), JSON.stringify(subtitle));
    await panel.screenshot({ path: path.join(OUT, 'panel-node.png') });
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nTüm kontroller geçti');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
