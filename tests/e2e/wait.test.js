// Beklemeleri kaydetme testi: Ayarlar arayüzü, aksiyonlar arası bekleme, alt sınır, yazmanın
// bekleme sayılmaması, oturum zaman aşımı (e_Wait), anahtar kapalıyken kayıt yok, runner'da oynatma.
// Kullanım: node tests/e2e/wait.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');
const OUT = outDir('wait');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><html><head><title>Bankacilik</title></head><body>
<input id="q" placeholder="Ara"> <button id="clear" style="display:none">Temizle</button>
<button id="a">A</button> <button id="b">B</button> <button id="c" style="display:none">C</button>
<script>
  document.getElementById('a').onclick = () => { document.getElementById('c').style.display = 'inline-block'; };
  document.getElementById('q').addEventListener('input', (e) => { document.getElementById('clear').style.display = e.target.value ? 'inline-block' : 'none'; });
  // Oturum zaman aşımı: son tıklama ya da tuştan 4 sn sonra ekran kendiliğinden değişir.
  let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { document.body.innerHTML = '<p>Oturum sona erdi</p><button id="relogin">Tekrar giris</button>'; }, 4000); };
  addEventListener('click', arm, true); addEventListener('keydown', arm, true);
</script></body></html>`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const types = (actions) => actions.map((a) => a.type + (a.type === 'wait' ? `(${a.ms}ms,${a.changed})` : '')).join(', ');

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-wait-')), {
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
    const createNode = async (resolveTo) => {
      await page.bringToFront();
      const r = await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      let s = await getState();
      if (s.pending) { await send({ type: 'RESOLVE', targetId: resolveTo ?? null }); s = await getState(); }
      return { r, s };
    };

    // 1) Ayarlar arayüzü: varsayılan kapalı, alt sınır 1; kutu işaretlenince alt sınır açılır, Kaydet kaydeder
    await panel.bringToFront();
    await panel.click('#btn-settings');
    check('alt sınır varsayılan 1 ve kapalıyken pasif', await panel.inputValue('#settings-min-wait') === '1' && await panel.isDisabled('#settings-min-wait'));
    check('Kaydet başta pasif', await panel.isDisabled('#btn-settings-save'));
    check('otomatik bekleme varsayılan 10 ms, her zaman aktif', await panel.inputValue('#settings-auto-wait') === '10' && !(await panel.isDisabled('#settings-auto-wait')));
    await panel.check('#settings-record-waits');
    check('işaretleyince alt sınır aktif, Kaydet aktif', !(await panel.isDisabled('#settings-min-wait')) && !(await panel.isDisabled('#btn-settings-save')));
    await panel.fill('#settings-min-wait', '');
    await panel.click('#btn-settings-save');
    let stored = await panel.evaluate(() => chrome.storage.local.get('settings').then((r) => r.settings));
    check('kaydedildi; boş alt sınır varsayılana döndü', stored.recordWaits === true && stored.minWaitSeconds === 1, JSON.stringify(stored));
    check('alanda tekrar 1 yazıyor', await panel.inputValue('#settings-min-wait') === '1');
    await panel.click('#btn-settings-close');
    const status = await panel.textContent('#status');
    check('durum satırı', status.includes('Beklemeler kaydediliyor (en az 1,0 sn)'), JSON.stringify(status));

    // 2) Node'dan sonraki ilk aksiyondan önce bekleme, aksiyonlar arası bekleme, kısa boşluk, yazma
    await createNode();
    await page.bringToFront();
    await sleep(1500);            // node'dan sonra ≥ 1 sn: edge'in ilk aksiyonu bekleme
    await page.click('#a');
    await sleep(1500);            // ≥ 1 sn: bekleme
    await page.click('#b');
    await sleep(300);             // < 1 sn: bekleme yok
    await page.click('#b');
    await sleep(500);
    await page.click('#q');
    await page.keyboard.type('abc'); // yazarken "Temizle" belirir: bekleme sayılmamalı
    await sleep(1500);
    await page.click('#b');          // alan odaktan çıkar: önce Fill, sonra Tıkla
    await sleep(600);
    let { s } = await createNode();
    let edge = s.edges.at(-1);
    const acts = edge.actions;
    check('edge aksiyonları', types(acts).replace(/\(\d+ms,false\)/g, '(…,false)') === 'wait(…,false), click, wait(…,false), click, wait(10ms,null), click, wait(10ms,null), input, wait(10ms,null), click, wait(10ms,null)', types(acts));
    check('kaydedilen bekleme otomatiğin yerine geçti, otomatikler işaretli', !acts[2].auto && acts.filter((a) => a.auto).length === 4 && acts.at(-1).auto, types(acts));
    const [first, w] = acts.filter((a) => a.type === 'wait');
    check('node\'dan sonraki bekleme en az 1,4 sn, ekranı değiştirmedi', first && first.ms >= 1400 && first.changed === false, JSON.stringify(first));
    check('bekleme süresi 0,9–1,6 sn, ekranı değiştirmedi', w && w.ms >= 900 && w.ms <= 1600 && w.changed === false, JSON.stringify(w));
    check('yazma kendiliğinden değişim sayılmadı', !acts.some((a) => a.type === 'wait' && a.changed === true));

    // 3) Oturum zaman aşımı: aksiyon yok, ekran kendiliğinden değişir
    await sleep(6000);
    s = await getState();
    check('zaman aşımı bekleme olarak kaydedildi', s.buffer.length === 1 && s.buffer[0].type === 'wait' && s.buffer[0].changed === true, types(s.buffer));
    check('süresi değişime kadar (2,5–5 sn)', s.buffer[0]?.ms >= 2500 && s.buffer[0]?.ms <= 5000, String(s.buffer[0]?.ms));
    const row = await panel.evaluate(() => document.querySelector('#buffer').innerText);
    check('panel satırı', /Bekle\s+Wait → \d,\d sn/.test(row), JSON.stringify(row));
    // Bekleyen beklemenin süresi panelde ✎ ile değiştirilir
    await panel.click('#buffer .edit-wait');
    await panel.fill('#buffer .wait-input', '2.5');
    await panel.press('#buffer .wait-input', 'Enter');
    await sleep(300);
    s = await getState();
    check('bekleyen beklemenin süresi değişti', s.buffer[0]?.ms === 2500 && s.buffer[0]?.changed === true, JSON.stringify(s.buffer[0]));
    ({ s } = await createNode());
    edge = s.edges.at(-1);
    check('e_Wait edge\'i', edge.name === 'e_Wait' && edge.actions.length === 1 && edge.actions[0].ms === 2500, `${edge.name}: ${types(edge.actions)}`);
    // Edge'deki beklemenin süresi değişir, orijinal saklanır, geri alınır
    await send({ type: 'SET_WAIT', edgeId: edge.id, index: 0, ms: 1000 });
    s = await getState();
    let e = s.edges.find((x) => x.id === edge.id);
    check('edge beklemesi 1 sn, orijinal saklandı', e.actions[0].ms === 1000 && e.recordedActions?.[0]?.ms === 2500, JSON.stringify([e.actions[0].ms, e.recordedActions?.[0]?.ms]));
    const bad = await send({ type: 'SET_WAIT', edgeId: edge.id, index: 0, ms: -5 });
    check('negatif süre reddedildi', Boolean(bad?.error), JSON.stringify(bad));
    await send({ type: 'UNDO' });
    s = await getState();
    e = s.edges.find((x) => x.id === edge.id);
    check('geri al: 2,5 sn ve orijinal liste düştü', e.actions[0].ms === 2500 && !e.recordedActions, JSON.stringify(e.actions[0]));

    // 4) Anahtar kapalı: yalnızca otomatik bekleme; süre ayardan
    await send({ type: 'SET_SETTINGS', settings: { ...stored, recordWaits: false, autoWaitMs: 25 } });
    await page.bringToFront();
    await page.click('#relogin');
    await sleep(1500);
    await page.click('#relogin');
    await sleep(600);
    ({ s } = await createNode(s.currentNodeId));
    edge = s.edges.at(-1);
    check('kapalıyken yalnızca otomatik bekleme, ayardaki süreyle', types(edge.actions) === 'click, wait(25ms,null), click, wait(25ms,null)' && edge.actions.filter((a) => a.type === 'wait').every((a) => a.auto), types(edge.actions));
    model = await panel.evaluate(() => graphWalkerModel());
  } finally {
    await ctx.close();
  }

  const file = path.join(OUT, 'wait.json');
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
