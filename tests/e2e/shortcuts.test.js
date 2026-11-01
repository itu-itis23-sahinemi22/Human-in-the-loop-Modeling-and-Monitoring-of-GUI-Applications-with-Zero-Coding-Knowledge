// "Node oluştur" kısayolu (manifest.json > commands): Chrome'un Alt+N'i eklentiye ataması, butonun
// ipucunda görünmesi, kısayolun butona basması, başka pencerenin kısayolunun yok sayılması, buton
// kilitliyken nedeninin söylenmesi. Gerçek tuş basışı denenmez: Playwright tuşları sayfaya gönderir,
// eklenti kısayolunu tetiklemez; bu yüzden panelin dinleyicisi (onShortcut) doğrudan çağrılır.
// Kullanım: node tests/e2e/shortcuts.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME } = require('./env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><html><head><title>Kisayol</title></head><body>
<button id="a">Bir</button> <button id="b">Iki</button>
</body></html>`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-shortcuts-')), {
    executablePath: CHROME, headless: true, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
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
    const shortcut = (t) => panel.evaluate((x) => onShortcut('create-node', x), t);
    const waitState = async (ok) => {
      for (let i = 0; i < 40; i++) {
        const s = await getState();
        if (s && ok(s)) return s;
        await sleep(200);
      }
      return getState();
    };

    // ---- Chrome kısayolu atadı; butonun ipucunda görünür ----
    const commands = await panel.evaluate(() => chrome.commands.getAll());
    const command = commands.find((c) => c.name === 'create-node');
    check('Chrome Alt+N\'i "Node oluştur"a atadı', command?.shortcut === 'Alt+N', JSON.stringify(commands));
    const titled = await panel.waitForFunction(() => document.getElementById('btn-node').title === 'Kısayol: Alt+N', null, { timeout: 5000 }).then(() => true, () => false);
    check('butonun ipucunda kısayol', titled, await panel.$eval('#btn-node', (b) => b.title));

    // ---- Kısayol "Node oluştur"a basar ----
    await page.bringToFront();
    await shortcut(tab);
    let s = await waitState((x) => x.nodes.length === 1);
    check('kısayol ilk node\'u oluşturdu', s.nodes.length === 1, `${s.nodes.length} node`);

    // ---- Başka pencerenin kısayolu bu paneli çalıştırmaz ----
    await page.click('#b');
    await waitState((x) => x.buffer.length === 1);
    await shortcut({ ...tab, windowId: tab.windowId + 1000 });
    await sleep(1500);
    s = await getState();
    check('başka penceredeki kısayol yok sayıldı', s.nodes.length === 1 && s.buffer.length === 1 && !s.pending, `${s.nodes.length} node, ${s.buffer.length} aksiyon`);

    // ---- Aynı pencerede ikinci node ----
    await page.bringToFront();
    await shortcut(tab);
    s = await waitState((x) => x.nodes.length === 2 || x.pending);
    if (s.pending) { await send({ type: 'RESOLVE', targetId: null }); s = await waitState((x) => x.nodes.length === 2); }
    check('kısayol ikinci node\'u oluşturdu (edge ile)', s.nodes.length === 2 && s.edges.length === 1, `${s.nodes.length} node, ${s.edges.length} edge`);

    // ---- Buton kilitliyken nedeni söylenir ----
    await panel.waitForFunction(() => document.getElementById('btn-node').disabled, null, { timeout: 5000 }).catch(() => {});
    await shortcut(tab);
    const message = await panel.$eval('#message', (m) => (m.hidden ? '' : m.textContent));
    check('bekleyen aksiyon yokken kısayol nedenini söyledi', message === 'Bekleyen aksiyon yok: önce sayfada bir aksiyon yap.', message);
    check('kilitliyken node oluşmadı', (await getState()).nodes.length === 2);
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
