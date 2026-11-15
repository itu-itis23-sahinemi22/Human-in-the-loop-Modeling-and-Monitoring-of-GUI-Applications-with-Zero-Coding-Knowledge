// Sürükle-bırak testi: HTML5 sürükleme (draggable kart → kutu), fareyle sürükleme (kaydırıcı:
// mesafe; etiket → çöp kutusu: bırakılan element) kaydı ve panelde / runner'da oynatma. Sürükleme
// doğru oynatılmazsa sayfa ekranı değiştirmez (butonlar çıkmaz) ve adım kalır. Sürüklemenin ardından
// tarayıcının ürettiği 'click' kaydedilmez.
// Kullanım: node tests/e2e/drag.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir, skipCleanup } = require('./env');
const OUT = outDir('drag');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Kart: HTML5 (draggable), Bitti kutusuna bırakılınca "Tasindi" butonu çıkar.
// Ses: fareyle sürüklenen kaydırıcı (izi 300 px); %80'in üstünde bırakılınca "Yuksek" çıkar.
// Etiket: fareyle sürüklenir, imleci izler; Cop kutusunun üstünde bırakılınca "Silindi" çıkar.
const PAGE = `<!doctype html><html><head><title>Surukle</title><style>
  body { font: 16px sans-serif; margin: 20px; }
  .zone { width: 200px; height: 80px; border: 2px dashed #888; margin: 10px 0; }
  #card { width: 120px; padding: 8px; background: #ddf; }
  #track { position: relative; width: 300px; height: 30px; background: #eee; margin: 30px 0; }
  #thumb { position: absolute; left: 0; top: 0; width: 30px; height: 30px; }
  #bin { width: 150px; height: 80px; background: #fdd; margin-left: 400px; }
</style></head><body>
<div id="card" draggable="true">Kart</div>
<div id="zone" class="zone">Bitti</div>
<span id="cardSlot"></span>
<div id="track"><button id="thumb">Ses</button></div>
<span id="loudSlot"></span>
<p><button id="chip">Etiket</button></p>
<div id="bin">Cop</div>
<span id="binSlot"></span> <span id="clicks"></span>
<script>
  const $ = (id) => document.getElementById(id);
  $('card').addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'kart'));
  $('zone').addEventListener('dragover', (e) => e.preventDefault());
  $('zone').addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.getData('text/plain') === 'kart' && !$('moved')) {
      $('zone').append($('card'));
      $('cardSlot').innerHTML = '<button id="moved">Tasindi</button>';
    }
  });
  let sliding = false; let value = 0;
  $('thumb').addEventListener('mousedown', (e) => { sliding = true; e.preventDefault(); });
  let chipFrom = null;
  $('chip').addEventListener('mousedown', (e) => { chipFrom = { x: e.clientX, y: e.clientY }; e.preventDefault(); });
  document.addEventListener('mousemove', (e) => {
    if (sliding) {
      const r = $('track').getBoundingClientRect();
      value = Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100)));
      $('thumb').style.left = (value * 0.9) + '%';
    }
    if (chipFrom) $('chip').style.transform = 'translate(' + (e.clientX - chipFrom.x) + 'px,' + (e.clientY - chipFrom.y) + 'px)';
  });
  document.addEventListener('mouseup', (e) => {
    if (sliding && value >= 80 && !$('loud')) $('loudSlot').innerHTML = '<button id="loud">Yuksek</button>';
    sliding = false;
    if (chipFrom) {
      if (document.elementsFromPoint(e.clientX, e.clientY).includes($('bin')) && !$('gone')) $('binSlot').innerHTML = '<button id="gone">Silindi</button>';
      $('chip').style.transform = '';
      chipFrom = null;
    }
  });
  // Etikete tıklanırsa sayılır: sürüklemenin ardından gelen click kayda girmemeli
  $('chip').addEventListener('click', () => { $('clicks').textContent = 'tiklandi'; });
</script></body></html>`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const real = (actions) => actions.filter((a) => !a.auto && a.type !== 'resize'); // otomatik bekleme ve ortama bağlı resize sayılmaz
const types = (actions) => real(actions).map((a) => a.type).join(', ');

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-drag-')), {
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
    const tab = await panel.evaluate((url) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.url.startsWith(url))), base);
    const createNode = async () => {
      await sleep(700);
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      let s = await getState();
      if (s.pending) { await send({ type: 'RESOLVE', targetId: null }); s = await getState(); }
      return s;
    };
    const center = async (selector) => {
      const box = await page.locator(selector).boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const dragMouse = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
    };

    // ---- 1) Kayıt ----
    let s = await createNode();
    await page.bringToFront();
    await dragMouse(await center('#card'), await center('#zone'));
    await sleep(800);
    s = await getState();
    let drag = real(s.buffer).at(-1);
    check('HTML5: tek drag, native, bırakılan yer #zone', types(s.buffer) === 'drag' && drag.native === true && drag.to?.selector === '#zone' && drag.selector === '#card', `${types(s.buffer)} ${JSON.stringify(drag)}`);
    check('HTML5: etiket "Drag Kart → Bitti", ekranı değiştirdi', drag?.label === 'Drag Kart → Bitti' && drag.changed === true, `${drag?.label} ${drag?.changed}`);
    s = await createNode();

    const thumb = await center('#thumb');
    await dragMouse(thumb, { x: thumb.x + 260, y: thumb.y });
    await sleep(800);
    s = await getState();
    drag = real(s.buffer).at(-1);
    // Fare koordinatları kesirli olabilir: mesafe ±1 px
    check('kaydırıcı: tek drag, bırakılan yer yok (iz onu içeriyor), mesafe ~+260', types(s.buffer) === 'drag' && !drag.to && Math.abs(drag.dx - 260) <= 1 && Math.abs(drag.dy) <= 1 && !drag.native, `${types(s.buffer)} ${JSON.stringify(drag)}`);
    check('kaydırıcı: etiket "Drag Ses (+26…, …)", hedef button:thumb', /^Drag Ses \(\+2(59|60|61), -?[01]\)$/.test(drag?.label ?? '') && drag.target?.key === 'button:thumb', `${drag?.label} ${JSON.stringify(drag?.target)}`);
    s = await createNode();

    await dragMouse(await center('#chip'), await center('#bin'));
    await sleep(800);
    s = await getState();
    drag = real(s.buffer).at(-1);
    check('etiket → çöp: tek drag (click kaydedilmedi), bırakılan yer #bin', types(s.buffer) === 'drag' && drag.to?.selector === '#bin', `${types(s.buffer)} ${JSON.stringify(drag)}`);
    s = await createNode();
    check('kayıt: 4 node, 3 edge', s.nodes.length === 4 && s.edges.length === 3, `${s.nodes.length} node, ${s.edges.length} edge`);
    const edges = s.edges.map((e) => e.id);

    // ---- 2) Panelde oynatma ----
    await panel.evaluate(async (ids) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Surukle', planner: { engine: 'manual' }, runs: [ids] });
      scenarioRun = 0;
      renderScenario();
    }, edges);
    await page.goto(base);
    await page.bringToFront();
    await sleep(800);
    await panel.evaluate(() => { replayResult = null; document.getElementById('replay-slow').checked = false; document.getElementById('btn-replay').click(); });
    await skipCleanup(panel);
    await sleep(800);
    if (await panel.evaluate(() => !document.getElementById('replay-check').hidden)) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 60000 });
    const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => ({ name: x.name, status: x.status, error: x.error ?? null, warnings: x.warnings })) }));
    const summary = JSON.stringify(result.steps);
    check('panelde oynatma geçti (kart taşındı, ses yüksek, etiket silindi)', result.status === 'passed', summary);
    check('oynatmada uyarı yok (bırakılan yerler bulundu)', result.steps.every((x) => !x.warnings.length), summary);
    model = await panel.evaluate(() => graphWalkerModel());
    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
  }

  // ---- 3) Runner ----
  const file = path.join(OUT, 'drag.json');
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
