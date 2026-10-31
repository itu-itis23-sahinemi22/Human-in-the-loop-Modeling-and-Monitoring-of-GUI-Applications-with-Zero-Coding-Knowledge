// Bekleyen aksiyonları silme testi: ekranı değiştirmeyen aksiyon doğrudan silinir, değiştiren
// için uyarı; yazma sırasında silinen input geri gelmez; bayat liste koruması; karar beklerken
// silme yok; oluşan edge runner'da ve panelde oynatılır.
// Kullanım: node tests/e2e/buffer.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir, skipCleanup } = require('./env');
const OUT = outDir('buffer');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><html><head><title>Buffer</title></head><body>
<input id="q" placeholder="Ara"> <button id="a">A</button> <button id="b">B</button> <button id="x">X</button>
<button id="c" style="display:none">C</button>
<script>document.getElementById('a').onclick = () => { document.getElementById('c').style.display = 'inline-block'; };</script>
</body></html>`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const kinds = (actions) => actions.map((a) => a.type + (a.type === 'input' ? `=${a.value}` : a.type === 'click' ? `:${a.label}` : '')).join(', ');

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-buffer-')), {
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
    const createNode = () => send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
    const removeButtons = () => panel.$$eval('#buffer li .delete-action', (xs) => xs.length);
    const clickRemove = (i) => panel.evaluate((n) => document.querySelectorAll('#buffer li .delete-action')[n].click(), i);

    await page.bringToFront();
    await createNode();
    await page.click('#b');
    await sleep(600);
    await page.click('#x');
    await sleep(600);
    await page.click('#a');
    await sleep(800);
    let s = await getState();
    check('üç aksiyon bekliyor', kinds(s.buffer) === 'click:B, click:X, click:A', kinds(s.buffer));
    check('etkiler: değiştirmedi, değiştirmedi, değiştirdi', s.buffer.map((a) => a.changed).join() === 'false,false,true', s.buffer.map((a) => a.changed).join());
    check('her satırda sil butonu', await removeButtons() === 3);

    // Ekranı değiştirmeyen ortadaki: uyarısız silinir
    await clickRemove(1);
    await sleep(400);
    s = await getState();
    check('ortadaki silindi', kinds(s.buffer) === 'click:B, click:A', kinds(s.buffer));
    check('liste güncellendi', await panel.$$eval('#buffer li', (xs) => xs.length) === 2 && (await panel.textContent('#buffer-count')) === '2');

    // Ekranı değiştiren: uyarı, vazgeçince kalır
    await clickRemove(1);
    await sleep(300);
    const dialog = await panel.evaluate(() => ({ open: document.getElementById('delete-action-dialog').open, text: document.getElementById('delete-action-reasons').textContent }));
    check('değiştiren aksiyonda uyarı', dialog.open && dialog.text.includes('ekranı'), dialog.text);
    await panel.evaluate(() => document.getElementById('btn-delete-action-cancel').click());
    await sleep(300);
    check('vazgeçince silinmedi', (await getState()).buffer.length === 2);

    // Yazarken son input silinir, yazmaya devam edilir: yeni input, silinen geri gelmez
    await page.bringToFront();
    await page.click('#q');
    await page.keyboard.type('ab');
    await page.click('#x'); // alandan çıkınca değer kaydedilir
    await sleep(700);
    s = await getState();
    const typed = s.buffer.filter((a) => a.type === 'input');
    check('yazma kaydedildi', typed.length === 1 && typed[0].value === 'ab', kinds(s.buffer));
    const inputIndex = s.buffer.findIndex((a) => a.type === 'input');
    await panel.evaluate((n) => document.querySelectorAll('#buffer li .delete-action')[n].click(), inputIndex);
    await sleep(300);
    if (await panel.evaluate(() => document.getElementById('delete-action-dialog').open)) {
      await panel.evaluate(() => document.getElementById('btn-delete-action-confirm').click());
    }
    await sleep(300);
    s = await getState();
    check('input silindi', !s.buffer.some((a) => a.type === 'input'), kinds(s.buffer));
    await page.bringToFront();
    await page.focus('#q');
    await page.keyboard.type('cd');
    await page.click('#x');
    await sleep(700);
    s = await getState();
    const inputs = s.buffer.filter((a) => a.type === 'input');
    check('yeni input oluştu, tek input', inputs.length === 1 && inputs[0].value === 'abcd', kinds(s.buffer));

    // Bayat liste: zaman tutmazsa silinmez
    const before = s.buffer.length;
    const stale = await send({ type: 'REMOVE_BUFFERED', index: 0, time: 1 });
    check('bayat istek reddedildi', Boolean(stale?.error) && (await getState()).buffer.length === before, JSON.stringify(stale));

    // Node oluştur: edge kalan aksiyonlarla
    await page.bringToFront();
    await createNode();
    s = await getState();
    const edge = s.edges.at(-1);
    check('edge kalan aksiyonlarla oluştu (her birinin ardında otomatik bekleme)', kinds(edge.actions.filter((a) => !a.auto)) === 'click:B, click:A, click:X, input=abcd, click:X' && edge.actions.every((a, i) => (i % 2 === 1) === Boolean(a.auto)), kinds(edge.actions));
    check('buffer boş', s.buffer.length === 0 && await removeButtons() === 0);

    // Runner
    const model = await panel.evaluate(() => graphWalkerModel());
    const file = path.join(OUT, 'buffer.json');
    fs.writeFileSync(file, JSON.stringify(model));
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(REPO, 'runner', 'run.js'), file, '--path', edge.id, '--out', path.join(OUT, 'run')], { stdio: 'inherit' });
      child.on('exit', resolve);
    });
    check('runner geçti', code === 0, `çıkış kodu ${code}`);

    // Panelde oynatma
    await page.goto(base);
    await page.bringToFront();
    await sleep(800);
    await panel.evaluate(async (id) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Test', planner: { engine: 'manual' }, runs: [[id]] });
      scenarioRun = 0;
      renderScenario();
      document.getElementById('replay-slow').checked = false;
      document.getElementById('btn-replay').click();
    }, edge.id);
    await skipCleanup(panel); // temizlik penceresi: Temizlemeden oynat
    await sleep(800);
    if (await panel.evaluate(() => !document.getElementById('replay-check').hidden)) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 60000 });
    const result = await panel.evaluate(() => replayResult.status);
    check('panelde oynatma geçti', result === 'passed', result);

    // Karar beklerken silme yok: aynı ekrana dönülür (yeniden yükle), soru beklerken aksiyon yapılır
    await page.reload();
    await sleep(1000);
    await createNode();
    s = await getState();
    check('soru bekliyor', Boolean(s.pending));
    await page.bringToFront();
    await page.click('#x');
    await sleep(700);
    s = await getState();
    check('karar beklerken aksiyon buffer\'da, sil butonu yok', s.buffer.length > 0 && await removeButtons() === 0, `${s.buffer.length} aksiyon`);
    const locked = await send({ type: 'REMOVE_BUFFERED', index: 0, time: s.buffer[0].time });
    check('karar beklerken background reddetti', Boolean(locked?.error), JSON.stringify(locked));
    await send({ type: 'RESOLVE', targetId: s.pending.candidateIds[0] });
    await sleep(400);
    check('karardan sonra sil butonu döndü', await removeButtons() === (await getState()).buffer.length && (await getState()).buffer.length > 0);
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
