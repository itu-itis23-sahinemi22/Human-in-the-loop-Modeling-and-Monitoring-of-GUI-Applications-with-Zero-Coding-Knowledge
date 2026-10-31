// Fareyle üzerine gelme testi: Ayarlar (varsayılan kapalı), CSS :hover menü, JS mouseenter kartı,
// değişim olmayan üzerine gelme, fare dururken gelen değişimin bekleme sayılması, runner'da oynatma.
// Kullanım: node tests/e2e/hover.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');
const OUT = outDir('hover');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><html><head><title>Magaza</title><style>
  ul { list-style: none; margin: 0; padding: 0; }
  .menu { display: inline-block; position: relative; padding: 4px; }
  .sub { display: none; position: absolute; top: 100%; left: 0; background: #eee; }
  .menu:hover .sub { display: block; }
  #buy { display: none; }
  #card { margin-top: 120px; width: 200px; height: 80px; background: #ddd; }
</style></head><body>
<ul><li class="menu"><a id="products" href="#p">Urunler</a><ul class="sub"><li><a id="item1" href="#i1">Bir</a></li></ul></li></ul>
<button id="plain">Sade</button>
<div id="card">Kart <button id="buy">Satin al</button></div>
<button id="arm">Zamanlayici</button>
<script>
  card.onmouseenter = () => { buy.style.display = 'inline-block'; };
  card.onmouseleave = () => { buy.style.display = 'none'; };
  arm.onclick = () => setTimeout(() => { const b = document.createElement('button'); b.id = 'late'; b.textContent = 'Gec'; document.body.append(b); }, 2000);
</script></body></html>`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const types = (actions) => actions.map((a) => a.type + (a.type === 'hover' ? `(${a.selector},${a.changed})` : a.type === 'wait' ? `(${a.changed})` : '')).join(', ');

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-hover-')), {
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
    const createNode = async () => {
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      let s = await getState();
      if (s.pending) { await send({ type: 'RESOLVE', targetId: null }); s = await getState(); }
      return s;
    };

    // 1) Ayarlar: "Üzerine gelme" listede, varsayılan işaretsiz; işaretleyip kaydet (beklemeler de açık)
    await panel.bringToFront();
    await panel.click('#btn-settings');
    const hoverBox = '#settings-actions input[value="hover"]';
    check('Üzerine gelme listede, varsayılan kapalı', await panel.locator(hoverBox).count() === 1 && !(await panel.isChecked(hoverBox)));
    check('diğer tipler varsayılan açık', await panel.isChecked('#settings-actions input[value="click"]'));
    await panel.check(hoverBox);
    await panel.check('#settings-record-waits');
    await panel.click('#btn-settings-save');
    let stored = await panel.evaluate(() => chrome.storage.local.get('settings').then((r) => r.settings));
    check('kaydedildi: enabledActions', JSON.stringify(stored.enabledActions) === '["hover"]' && stored.disabledActions.length === 0, JSON.stringify(stored));
    await panel.click('#btn-settings-close');
    await panel.click('#btn-settings');
    check('tekrar açınca işaretli', await panel.isChecked(hoverBox));
    await panel.click('#btn-settings-close');

    await createNode();
    await page.bringToFront();
    await page.mouse.move(700, 700);
    await sleep(500);

    // 2) Ekranı değiştirmeyen üzerine gelme kaydedilmez
    await page.hover('#plain');
    await sleep(800);
    let s = await getState();
    check('sade butonun üzerine gelme kaydedilmedi', s.buffer.length === 0, types(s.buffer));

    // 3) CSS :hover menü: üzerine gelme + alt menüye tıklama. Node'dan beri 1 sn'den uzun
    // geçti: edge'in ilk aksiyonu ekranı değiştirmeyen bekleme.
    await page.hover('#products');
    await sleep(800);
    s = await getState();
    const hover = s.buffer.at(-1);
    check('CSS menü: hover kaydedildi, ekranı değiştirdi', types(s.buffer) === 'wait(false), hover(#products,true)', types(s.buffer));
    check('hedef kayıttaki düzeyde', hover?.target?.key === 'a:products', JSON.stringify(hover?.target));
    await page.click('#item1');
    await sleep(600);
    s = await createNode();
    let edge = s.edges.at(-1);
    check('edge: wait, hover, click → e_Bir', types(edge.actions.filter((a) => !a.auto)) === 'wait(false), hover(#products,true), click' && edge.name === 'e_Bir', `${edge.name}: ${types(edge.actions)}`);

    // 4) JS mouseenter kartı (etkileşimli olmayan tetikleyici)
    await page.hover('#card');
    await sleep(1000);
    s = await getState();
    check('JS kart: hover kaydedildi', s.buffer.length === 1 && s.buffer[0].type === 'hover' && s.buffer[0].selector === '#card' && s.buffer[0].changed === true, types(s.buffer));
    s = await createNode();
    edge = s.edges.at(-1);
    check('edge adı e_HoverKart…', edge.name.startsWith('e_HoverKart'), `${edge.name}: ${types(edge.actions)}`);

    // 5) Fare dururken gelen değişim üzerine gelme değil, bekleme
    await page.click('#arm');
    await sleep(3500);
    s = await getState();
    check('fare dururken değişim: hover değil, bekleme', types(s.buffer) === 'click, wait(true)', types(s.buffer));
    s = await createNode();

    // 6) Ayar kapalıyken üzerine gelme kaydedilmez
    await send({ type: 'SET_SETTINGS', settings: { ...stored, enabledActions: [] } });
    await page.bringToFront();
    await page.hover('#products');
    await sleep(800);
    s = await getState();
    check('kapalıyken hover yok', !s.buffer.some((a) => a.type === 'hover'), types(s.buffer));
    model = await panel.evaluate(() => graphWalkerModel());
  } finally {
    await ctx.close();
  }

  const file = path.join(OUT, 'hover.json');
  fs.writeFileSync(file, JSON.stringify(model, null, 2));
  const edges = model.models[0].edges.map((e) => e.id).join(',');
  console.log(`\n=== runner (${edges})`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, 'runner', 'run.js'), file, '--path', edges, '--out', path.join(OUT, 'run')], { stdio: 'inherit' });
    child.on('exit', resolve);
  });
  check('runner geçti', code === 0, `çıkış kodu ${code}`);
  server.close();
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nTüm kontroller geçti');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
