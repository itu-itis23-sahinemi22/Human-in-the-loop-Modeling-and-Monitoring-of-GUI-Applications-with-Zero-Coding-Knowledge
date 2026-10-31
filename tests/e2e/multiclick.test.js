// Çoklu tıklama testi: Ayarlar (varsayılan açık, Tıkla'ya bağlı kutu), çift / üçlü / beşli
// tıklamanın tek aksiyon olarak kaydı, metne çift tıklamanın yine metin seçimi olması, ayar
// kapalıyken ayrı tıklamalar, panelde ve runner'da oynatma (sayfa dblclick ve tıklama sayacını görür).
// Kullanım: node tests/e2e/multiclick.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir, skipCleanup } = require('./env');
const OUT = outDir('multiclick');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Begen: dblclick olayı; Satir: üçüncü tıklama (event.detail); Logo: beşinci tıklama
const PAGE = `<!doctype html><html><head><title>Coklu</title></head><body>
<p><button id="like">Begen</button> <span id="likeSlot"></span></p>
<p><button id="row">Satir</button> <span id="rowSlot"></span></p>
<p><button id="logo">Logo</button> <span id="logoSlot"></span></p>
<p id="text">Merhaba dunya</p>
<script>
  like.addEventListener('dblclick', () => { likeSlot.innerHTML = '<button id="liked">Begenildi</button>'; });
  row.addEventListener('click', (e) => { if (e.detail === 3) rowSlot.innerHTML = '<button id="tripled">Uclu</button>'; });
  logo.addEventListener('click', (e) => { if (e.detail === 5) logoSlot.innerHTML = '<button id="many">Besli</button>'; });
</script></body></html>`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const types = (actions) => actions.filter((a) => !a.auto).map((a) => a.type + (a.type === 'multiclick' ? `×${a.count}` : '')).join(', ');

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-multiclick-')), {
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
    const errors = [];
    panel.on('pageerror', (e) => errors.push(e.message));
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const storedSettings = () => panel.evaluate(() => chrome.storage.local.get('settings').then((r) => r.settings));
    const tab = await panel.evaluate((url) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.url.startsWith(url))), base);
    const createNode = async () => {
      await sleep(700);
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      let s = await getState();
      if (s.pending) { await send({ type: 'RESOLVE', targetId: null }); s = await getState(); }
      return s;
    };

    // ---- 1) Ayarlar: kutu listede, varsayılan açık; Tıkla'ya bağlı ----
    const click = '#settings-actions input[value="click"]';
    const multi = '#settings-actions input[value="multiclick"]';
    await panel.bringToFront();
    await panel.click('#btn-settings');
    check('Çoklu tıklama listede, varsayılan açık', await panel.locator(multi).count() === 1 && await panel.isChecked(multi) && await panel.isEnabled(multi));
    check('listede Tıkla\'nın hemen ardından', await panel.evaluate(() => [...document.querySelectorAll('#settings-actions input')].map((b) => b.value).slice(0, 2).join(',')) === 'click,multiclick');
    await panel.uncheck(click);
    check('Tıkla kapanınca: işareti kalkar, kutu pasif', !(await panel.isChecked(multi)) && await panel.isDisabled(multi));
    await panel.check(click);
    check('Tıkla yeniden açılınca: kutu açılır ama işaretsiz kalır', await panel.isEnabled(multi) && !(await panel.isChecked(multi)));
    await panel.check(multi);
    check('varsayılana dönünce taslak temiz (Kaydet pasif)', await panel.isDisabled('#btn-settings-save'));
    await panel.uncheck(click);
    await panel.click('#btn-settings-save');
    let stored = await storedSettings();
    check('Tıkla kapalı kaydedildi: ikisi de disabledActions\'ta', ['click', 'multiclick'].every((t) => stored.disabledActions.includes(t)), JSON.stringify(stored.disabledActions));
    await panel.click('#btn-settings-close');
    await panel.click('#btn-settings');
    check('tekrar açınca: Çoklu tıklama işaretsiz ve pasif, taslak temiz', !(await panel.isChecked(multi)) && await panel.isDisabled(multi) && await panel.isDisabled('#btn-settings-save'));
    await panel.check(click);
    await panel.check(multi);
    await panel.click('#btn-settings-save');
    stored = await storedSettings();
    check('varsayılana dönüldü', !stored.disabledActions.includes('click') && !stored.disabledActions.includes('multiclick'), JSON.stringify(stored.disabledActions));
    await panel.click('#btn-settings-close');

    // ---- 2) Kayıt: çift, üçlü, beşli tıklama tek aksiyon ----
    let s = await createNode();
    await page.bringToFront();
    await page.dblclick('#like');
    await sleep(800);
    s = await getState();
    const double = s.buffer.at(-1);
    check('çift tıklama: tek multiclick ×2, ekranı değiştirdi', types(s.buffer) === 'multiclick×2' && double.changed === true, types(s.buffer));
    // Hedef state ile aynı düzeyde: anahtar önce id'den (fingerprint.js > elementKey)
    check('çift tıklama: etiket ve hedef', double?.label === 'Double click Begen' && double?.target?.key === 'button:like', `${double?.label} ${JSON.stringify(double?.target)}`);
    s = await createNode();
    check('edge adı çift tıklamadan', s.edges.at(-1).name.startsWith('e_DoubleClick'), s.edges.at(-1).name);

    await page.click('#row', { clickCount: 3 });
    await sleep(800);
    s = await getState();
    check('üçlü tıklama: tek multiclick ×3 "Triple click Satir"', types(s.buffer) === 'multiclick×3' && s.buffer.at(-1).label === 'Triple click Satir' && s.buffer.at(-1).changed === true, `${types(s.buffer)} ${s.buffer.at(-1)?.label}`);
    s = await createNode();

    await page.click('#logo', { clickCount: 5 });
    await sleep(800);
    s = await getState();
    check('beşli tıklama: tek multiclick ×5 "Click Logo ×5"', types(s.buffer) === 'multiclick×5' && s.buffer.at(-1).label === 'Click Logo ×5', `${types(s.buffer)} ${s.buffer.at(-1)?.label}`);
    s = await createNode();
    check('kayıt: 4 node, 3 edge', s.nodes.length === 4 && s.edges.length === 3, `${s.nodes.length} node, ${s.edges.length} edge`);
    const edges = s.edges.map((e) => e.id);

    // ---- 3) Panelde oynatma ----
    await panel.evaluate(async (ids) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Coklu', planner: { engine: 'manual' }, runs: [ids] });
      scenarioRun = 0;
      renderScenario();
    }, edges);
    await page.goto(base);
    await page.bringToFront();
    await sleep(800);
    await panel.evaluate(() => { replayResult = null; document.getElementById('replay-slow').checked = false; document.getElementById('btn-replay').click(); });
    await skipCleanup(panel); // temizlik penceresi: Temizlemeden oynat
    await sleep(800);
    if (await panel.evaluate(() => !document.getElementById('replay-check').hidden)) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 60000 });
    const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}`) }));
    check('panelde oynatma geçti (dblclick, 3. ve 5. tıklama sayfada)', result.status === 'passed', JSON.stringify(result.steps));
    model = await panel.evaluate(() => graphWalkerModel());

    // ---- 4) Metne çift tıklamak yine metin seçimi ----
    await page.bringToFront();
    await page.dblclick('#text');
    await sleep(500);
    s = await getState();
    check('metne çift tıklama: select (multiclick değil)', types(s.buffer) === 'select', types(s.buffer));
    await send({ type: 'REMOVE_BUFFERED', index: 0, time: s.buffer[0].time });

    // ---- 5) Ayar kapalıyken her tıklama ayrı ----
    await send({ type: 'SET_SETTINGS', settings: { ...stored, disabledActions: ['multiclick'] } });
    await page.bringToFront();
    await page.dblclick('#like');
    await sleep(800);
    s = await getState();
    check('Çoklu tıklama kapalı: iki ayrı click', types(s.buffer) === 'click, click' && s.buffer.every((a) => a.label === 'Begen'), `${types(s.buffer)} ${s.buffer.map((a) => a.label).join('|')}`);
    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
  }

  // ---- 6) Runner ----
  const file = path.join(OUT, 'multiclick.json');
  fs.writeFileSync(file, JSON.stringify(model, null, 2));
  const ids = model.models[0].edges.map((e) => e.id).join(',');
  console.log(`\n=== runner (${ids})`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, 'runner', 'run.js'), file, '--path', ids, '--out', path.join(OUT, 'run')], { stdio: 'inherit' });
    child.on('exit', resolve);
  });
  check('runner geçti', code === 0, `çıkış kodu ${code}`);
  server.close();
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nTüm kontroller geçti');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
