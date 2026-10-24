// Monitörlerin kontrolü (docs/07-monitorler.md > Oynatmada kontrol): kuralları bilerek bozan yerel
// sayfalarda kayıt, dört monitör (tüm model, node, aksiyon) + bir kapalı monitör, panelde oynatma ve
// oynatma kartındaki ışık listesi (yalnızca yeşil / kırmızı, adım izi, ayrıntı, ekran görüntüsü),
// aksiyon tabanlı Input Validation (yazılan değer), Monitörler listesinde "Son kontrol",
// "Bu ekranda şimdi kontrol et", Emir'in oynatma sonucunun bozulmaması.
// Kullanım: node tests/e2e/monitor-run.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = outDir('monitor-run');

const CSS = '<style>body{font-family:sans-serif;font-size:14px}button,input{font-size:14px;min-height:28px;min-width:28px;box-sizing:border-box}</style>';
const html = (title, body) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title>${CSS}</head><body>${body}</body></html>`;
const SITE = {
  '/': html('Login', '<h1>Giriş</h1><input id="user-name" placeholder="Kullanıcı adı"> <input id="password" type="password" placeholder="Şifre"> <button id="login" onclick="location.href=\'/telefon\'">Login</button>'),
  // Telefon: 3 pt yazı (Font Size bozulur)
  '/telefon': html('Telefon', '<h1>Telefon</h1><input id="phone" placeholder="Telefon"> <button id="next" onclick="location.href=\'/sepet\'">Devam</button><p style="font-size:3pt">Gizlilik sözleşmesini kabul ediyorum</p>'),
  // Sepet: hata metni (Error Text bozulur)
  '/sepet': html('Sepet', '<h1>Sepet</h1><p>Toplam hesaplanamadı: 500 Internal Server Error</p><button id="home" onclick="location.href=\'/\'">Devam</button>'),
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    const page = SITE[req.url.split('?')[0]];
    if (!page) { res.statusCode = 404; res.end('yok'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(page);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-monitor-run-')), {
    executablePath: CHROME, headless: !HEADED, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900', ...(HEADED ? ['--window-position=-2400,0'] : [])],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(base + '/');
    await sleep(500);
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    await sleep(500);
    const errors = [];
    panel.on('pageerror', (e) => { errors.push(String(e)); if (process.env.DEBUG) console.log('  panel hata:', String(e)); });
    panel.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); if (process.env.DEBUG) console.log('  panel konsol:', m.text()); } });
    const $ = (sel) => panel.locator(sel);
    const text = (sel) => panel.textContent(sel);
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const store = (keys) => panel.evaluate((k) => chrome.storage.local.get(k), keys);
    const activeId = async () => (await store('activeGraph')).activeGraph;
    const getState = async () => Object.values(await store('graph:' + await activeId()))[0];
    const tab = await panel.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url ?? '').startsWith(u))), base);
    const createNode = async () => {
      await sleep(700);
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      if ((await getState()).pending) await send({ type: 'RESOLVE', targetId: null });
      await sleep(300);
    };
    const shot = async (name, selector = null) => { await (selector ? $(selector) : panel).screenshot({ path: path.join(OUT, `${name}.png`) }); };

    // ---- Kayıt: Login → (telefon yaz, Devam) → Sepet ----
    await createNode();
    await page.click('#login');
    await page.waitForURL(base + '/telefon');
    await createNode();
    await page.fill('#phone', '03121234567'); // 5 ile başlamıyor: Input Validation bozulacak
    await page.click('#next');
    await page.waitForURL(base + '/sepet');
    await createNode();
    const s = await getState();
    const byName = (name) => s.nodes.find((n) => n.name === name);
    const login = byName('v_Login');
    const telefon = byName('v_Telefon');
    const sepet = byName('v_Sepet');
    const eLogin = s.edges.find((e) => e.source === login.id);
    const eDevam = s.edges.find((e) => e.source === telefon.id);
    const kinds = (edge) => edge.actions.map((a) => a.type).filter((t) => t !== 'resize').join('+'); // bazı ortamlarda pencere boyutu değişimi de kaydedilir
    check('kayıt: 3 node, 2 edge; Devam edge\'inde yazma + tıklama', s.nodes.length === 3 && s.edges.length === 2 && kinds(eDevam) === 'input+click', s.edges.map(kinds).join(' | '));

    // ---- Monitörler (storage'a doğrudan; menü monitors.test.js'te sınanıyor) ----
    const M = [
      { id: 'm1', type: 'fontSize', scope: 'global', params: { min: 4, unit: 'pt' }, severity: 'error', enabled: true, name: null },
      { id: 'm2', type: 'errorText', scope: 'global', params: { pattern: '\\b(404|500|internal server error)\\b' }, severity: 'error', enabled: true, name: null },
      { id: 'm3', type: 'inputValidation', scope: eDevam.id, params: { selector: 'input:phone', pattern: '^0?5', mode: 'match', whenEmpty: 'skip' }, severity: 'error', enabled: true, name: 'Telefon 5 ile başlamalı' },
      { id: 'm4', type: 'errorText', scope: telefon.id, params: { pattern: 'hata oluştu' }, severity: 'warning', enabled: true, name: 'Telefon ekranında hata yok' }, // eski kayıt biçimi: 'warning' da kabul edilir
      { id: 'm5', type: 'fontSize', scope: 'global', params: { min: 12, unit: 'pt' }, severity: 'error', enabled: false, name: 'kapalı monitör' },
    ];
    const graphId = await activeId();
    await panel.evaluate(([key, items]) => chrome.storage.local.set({ [key]: { format: 'graph-recorder-monitors/v1', nextId: 100, items } }), ['monitors:' + graphId, M]);
    await sleep(400);
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    check('5 monitör yüklendi (1 kapalı)', (await text('#monitors-badge')) === '5' && (await $('#monitors-list .monitor.disabled').count()) === 1);

    // ---- Senaryo: iki edge tek koşu ----
    await panel.evaluate(async (ids) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Test', planner: { engine: 'manual' }, runs: [ids] });
      scenarioRun = 0;
      renderScenario();
    }, [eLogin.id, eDevam.id]);
    await sleep(300);
    check('oynatmadan önce ışık listesi gizli', await $('#monitor-run').isHidden());

    // ---- Oynatma ----
    await page.goto(base + '/');
    await page.bringToFront();
    await sleep(800);
    await panel.evaluate(() => { document.getElementById('replay-slow').checked = false; document.getElementById('btn-replay').click(); });
    await sleep(600);
    if (await panel.evaluate(() => !document.getElementById('replay-check').hidden)) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await sleep(900);
    const during = await panel.evaluate(() => ({ hidden: document.getElementById('monitor-run').hidden, rows: document.querySelectorAll('#monitor-run-list .led-row').length, summary: document.getElementById('monitor-run-summary').textContent, running: document.getElementById('monitor-run-summary').classList.contains('running') }));
    check('oynatma sürerken ışık listesi açık: 4 etkin monitör, "kontrol ediliyor"', !during.hidden && during.rows === 4 && during.summary.includes('kontrol ediliyor') && during.running, during.summary);
    await shot('oynatma-sirasinda', '#replay');
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 90000 });
    await sleep(300);
    const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}`), message: document.getElementById('message').textContent }));
    check('Emir\'in oynatması geçti (monitörler adımı bozmaz)', result.status === 'passed' && result.message.includes('Koşu geçti'), JSON.stringify(result));
    await shot('oynatma-sonu', '#replay');

    const rows = await panel.$$eval('#monitor-run-list .led-row', (els) => els.map((li) => ({
      status: li.className.replace('led-row ', ''),
      name: li.querySelector('.led-title b').textContent,
      scope: li.querySelector('.scope').textContent,
      trail: [...li.querySelectorAll('.trail i')].map((i) => i.className),
      titles: [...li.querySelectorAll('.trail i')].map((i) => i.title),
      detail: li.querySelector('.detail').textContent,
      shot: Boolean(li.querySelector('img.shot')),
    })));
    const row = (name) => rows.find((r) => r.name.includes(name));
    check('liste 4 satır (kapalı monitör yok), özet yalnızca kırmızı / yeşil sayar', rows.length === 4 && !rows.some((r) => r.name.includes('kapalı')) && (await text('#monitor-run-summary')) === '4 monitör · 3 kırmızı · 1 yeşil' && rows.every((r) => r.status === 'ok' || r.status === 'fail'), await text('#monitor-run-summary'));
    check('Font Size: kırmızı; adım izi [kırmızı, yeşil]; ayrıntı 3 pt metin; ekran görüntüsü', row('Font Size').status === 'fail' && row('Font Size').trail.join(',') === 'fail,ok' && row('Font Size').detail.includes('Adım 1') && row('Font Size').detail.includes('3 pt') && row('Font Size').shot, row('Font Size').detail);
    check('Error Text (tüm model): adım 2\'de kırmızı (500 metni)', row('Error Text · /').status === 'fail' && row('Error Text · /').trail.join(',') === 'ok,fail' && row('Error Text · /').detail.includes('Adım 2') && row('Error Text · /').detail.includes('500'), row('Error Text · /').detail);
    check('Input Validation (aksiyon): yalnızca Devam adımında, kırmızı, yazılan değer', row('Telefon 5 ile').status === 'fail' && row('Telefon 5 ile').trail.join(',') === 'fail' && row('Telefon 5 ile').scope === `Aksiyon: ${eDevam.name}` && row('Telefon 5 ile').detail.includes('03121234567'), row('Telefon 5 ile').detail);
    check('Error Text (node Telefon, eski kayıtta "warning"): tek adım, yeşil', row('Telefon ekranında').status === 'ok' && row('Telefon ekranında').trail.join(',') === 'ok' && row('Telefon ekranında').scope === 'Node: v_Telefon' && row('Telefon ekranında').detail.includes('bozulma yok'), row('Telefon ekranında').detail);
    check('adım izi başlıkları adım ve edge adını söylüyor', row('Font Size').titles[0].startsWith(`Adım 1 (${eLogin.name} → v_Telefon)`) && row('Font Size').titles[1].startsWith(`Adım 2 (${eDevam.name} → v_Sepet)`), row('Font Size').titles.join(' | '));
    const shots = await panel.$$eval('#monitor-run-list img.shot', (imgs) => imgs.map((i) => i.src.slice(0, 22)));
    check('bozulan adımların ekran görüntüsü var (jpeg data URL)', shots.length === 3 && shots.every((x) => x.startsWith('data:image/jpeg')), shots.join(','));
    await panel.click('#monitor-run-list img.shot');
    await sleep(200);
    check('küçük resme tıklayınca büyük görüntü penceresi', await panel.evaluate(() => document.getElementById('monitor-shot-dialog').open && document.getElementById('monitor-shot-image').naturalWidth > 100 && document.getElementById('monitor-shot-text').textContent.includes('Adım 1')));
    await shot('ekran-goruntusu');
    await panel.click('#btn-monitor-shot-close');

    // ---- Monitörler listesinde "Son kontrol" ----
    const listVerdicts = await panel.$$eval('#monitors-list .monitor', (els) => els.map((li) => ({ name: li.querySelector('b').textContent, led: li.querySelector('.verdict .led')?.className.replace('led ', '') ?? null, text: li.querySelector('.verdict')?.textContent ?? '' })));
    const lv = (name) => listVerdicts.find((v) => v.name.includes(name));
    check('Monitörler listesi: ışık ve "Son kontrol … (son oynatma)"', lv('Font Size · ≥ 4').led === 'fail' && lv('Font Size · ≥ 4').text.includes('Son kontrol') && lv('Font Size · ≥ 4').text.includes('(son oynatma)') && lv('Telefon ekranında').led === 'ok' && lv('kapalı').led === null, JSON.stringify(lv('Font Size · ≥ 4')));
    await shot('monitor-listesi-sonuc', '#monitors');

    // ---- Koşu değişince ışık listesi gizlenir ----
    await panel.evaluate(async () => { await createScenario({ name: 'Boş', planner: { engine: 'manual' }, runs: [[]] }); });
    await sleep(400);
    check('başka senaryoda ışık listesi gizli', await $('#monitor-run').isHidden());

    // ---- "Bu ekranda şimdi kontrol et": Telefon sayfasında, Telefon node'u seçili ----
    await page.goto(base + '/telefon');
    await page.bringToFront();
    await sleep(600);
    await panel.evaluate((id) => { cy.getElementById(id).emit('tap'); }, telefon.id);
    await sleep(150);
    await panel.click('#btn-monitor-check');
    await panel.waitForFunction(() => document.getElementById('message').textContent.includes('Şimdi kontrol edildi'), null, { timeout: 15000 });
    const liveMessage = await text('#message');
    const live = await panel.$$eval('#monitors-list .monitor', (els) => els.map((li) => ({ name: li.querySelector('b').textContent, led: li.querySelector('.verdict .led')?.className.replace('led ', '') ?? null, text: li.querySelector('.verdict')?.textContent ?? '' })));
    const lvv = (name) => live.find((v) => v.name.includes(name));
    check('şimdi kontrol: mesaj sayımları', liveMessage.startsWith('Şimdi kontrol edildi: 1 kırmızı, 2 yeşil'), liveMessage);
    check('şimdi kontrol: Font Size kırmızı "(şimdi, 127.0.0.1…)", Error Text (tüm model ve Telefon) yeşil, aksiyon monitörü eski sonucunda', lvv('Font Size · ≥ 4').led === 'fail' && lvv('Font Size · ≥ 4').text.includes('(şimdi, 127.0.0.1') && lvv('Error Text · /').led === 'ok' && lvv('Telefon ekranında').led === 'ok' && lvv('Telefon 5 ile').text.includes('(son oynatma)'), JSON.stringify([lvv('Font Size · ≥ 4'), lvv('Telefon 5 ile')]));
    await shot('simdi-kontrol', '#monitors');

    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
