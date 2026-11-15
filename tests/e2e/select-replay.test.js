// Metin seçme ve oynatılamayan aksiyon testi: sayfadaki metne çift tıklayarak ve alanda
// Shift+okla seçim kaydı ('select'), Ctrl+C ('clipboard'); panelde ve runner'da oynatma. Seçim
// geri kurulmazsa sayfa ekranı değiştirmez (seçime tepki veren butonlar çıkmaz) ve adım kalır.
// clipboard henüz oynatılamaz: atlanır, adıma uyarı yazılır, adım yine geçer.
// Kullanım: node tests/e2e/select-replay.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir, skipCleanup } = require('./env');
const OUT = outDir('select-replay');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sayfa seçime tepki verir: "dunya" seçilince Paylas, alanda "Veli" seçilince Tamam butonu çıkar
// (ör. alıntı paylaşma balonu). Ileri'ye basınca Bitti çıkar.
const PAGE = `<!doctype html><html><head><title>Secim</title></head><body>
<p id="quote">Merhaba dunya</p>
<p><input id="who" value="Ali Veli"></p>
<p><span id="shareSlot"></span> <span id="okSlot"></span></p>
<p><button id="next">Ileri</button> <span id="doneSlot"></span></p>
<script>
  const $ = (id) => document.getElementById(id);
  document.addEventListener('selectionchange', () => {
    if (getSelection().toString().trim() === 'dunya' && !$('share')) $('shareSlot').innerHTML = '<button id="share">Paylas</button>';
  });
  $('who').addEventListener('select', () => {
    const f = $('who');
    if (f.value.slice(f.selectionStart, f.selectionEnd) === 'Veli' && !$('ok')) $('okSlot').innerHTML = '<button id="ok">Tamam</button>';
  });
  $('next').addEventListener('click', () => { $('doneSlot').innerHTML = '<button id="done">Bitti</button>'; });
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
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-select-')), {
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

    // ---- 1) Kayıt ----
    let s = await createNode();
    await page.bringToFront();
    // "dunya" kelimesinin ortasına çift tıkla (kelime seçilir)
    const word = await page.evaluate(() => {
      const text = document.getElementById('quote').firstChild;
      const range = document.createRange();
      range.setStart(text, 8);
      range.setEnd(text, 13);
      const r = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.dblclick(word.x, word.y);
    await sleep(800);
    s = await getState();
    const pageSelect = real(s.buffer).at(-1);
    check('sayfada çift tıklama: select "dunya", ekranı değiştirdi', types(s.buffer) === 'select' && pageSelect.text === 'dunya' && pageSelect.changed === true, `${types(s.buffer)} ${JSON.stringify(pageSelect)}`);
    s = await createNode();

    await page.click('#who');
    await page.keyboard.press('End');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
    await sleep(800);
    s = await getState();
    const fieldSelect = real(s.buffer).find((a) => a.type === 'select');
    check('alanda Shift+ok: select "Veli" aralığı 4-8', fieldSelect?.text === 'Veli' && fieldSelect.start === 4 && fieldSelect.end === 8, `${types(s.buffer)} ${JSON.stringify(fieldSelect)}`);
    s = await createNode();

    await page.keyboard.press('Control+C');
    await sleep(300);
    await page.click('#next');
    await sleep(800);
    s = await getState();
    check('Ctrl+C ve Ileri: clipboard, click', types(s.buffer) === 'clipboard, click', types(s.buffer));
    s = await createNode();
    check('kayıt: 4 node, 3 edge', s.nodes.length === 4 && s.edges.length === 3, `${s.nodes.length} node, ${s.edges.length} edge`);
    const edges = s.edges.map((e) => e.id);

    // ---- 2) Panelde oynatma ----
    await panel.evaluate(async (ids) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Secim', planner: { engine: 'manual' }, runs: [ids] });
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
    const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => ({ status: x.status, error: x.error ?? null, warnings: x.warnings })) }));
    const summary = JSON.stringify(result.steps);
    check('panelde oynatma geçti (seçimler geri kuruldu: Paylas ve Tamam çıktı)', result.status === 'passed', summary);
    check('seçim adımlarında uyarı yok', result.steps.slice(0, 2).every((x) => !x.warnings.some((w) => w.includes('seçim'))), summary);
    check('clipboard atlandı, uyarısı adımda', result.steps[2]?.warnings.some((w) => w.includes('henüz oynatılamıyor; atlandı')), summary);
    model = await panel.evaluate(() => graphWalkerModel());
    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
  }

  // ---- 3) Runner ----
  const file = path.join(OUT, 'select.json');
  fs.writeFileSync(file, JSON.stringify(model, null, 2));
  const ids = model.models[0].edges.map((e) => e.id).join(',');
  console.log(`\n=== runner (${ids})`);
  let output = '';
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, 'runner', 'run.js'), file, '--path', ids, '--out', path.join(OUT, 'run')]);
    child.stdout.on('data', (d) => { output += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', resolve);
  });
  check('runner geçti (seçimler geri kuruldu)', code === 0, `çıkış kodu ${code}`);
  check('runner: clipboard atlandı uyarısı', output.includes('henüz oynatılamıyor; atlandı'));
  server.close();
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nTüm kontroller geçti');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
