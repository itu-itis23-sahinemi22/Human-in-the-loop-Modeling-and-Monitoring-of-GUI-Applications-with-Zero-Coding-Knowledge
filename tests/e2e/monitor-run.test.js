// Monitörlerin kontrolü (docs/07-monitorler.md > Oynatmada kontrol): kuralları bilerek bozan yerel
// sayfalarda kayıt, dört monitör (tüm model, node, aksiyon) + bir kapalı monitör, panelde oynatma ve
// oynatma kartındaki ışık listesi (yalnızca yeşil / kırmızı, adım izi, ayrıntı, ekran görüntüsü),
// aksiyon tabanlı Input Validation (yazılan değer), bozulma ANINDA alınan görüntülü uyarılar
// (monitor-alarms:<graph>, Monitörler listesinde "Uyarılar (n)", yeniden açılışta duruyor), "Son kontrol",
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
      // Edge'in belirli aksiyonuna bağlı monitörler (iki katman: edge → aksiyon)
      { id: 'm6', type: 'inputValidation', scope: eDevam.id, action: { index: 0, type: 'input', label: 'Fill Telefon', target: 'input:phone' }, params: { selector: 'input:phone', pattern: '^0?5', mode: 'match', whenEmpty: 'skip' }, severity: 'error', enabled: true, name: 'Yazınca telefon 5 ile' },
      { id: 'm7', type: 'errorText', scope: eDevam.id, action: { index: 9, type: 'click', label: 'Devam', target: 'button:next' }, params: { pattern: '500' }, severity: 'error', enabled: true, name: 'Devam tıklanınca hata yok' }, // sıra yanlış (9): tür + hedefle bulunur
      { id: 'm8', type: 'errorText', scope: eDevam.id, action: { index: 5, type: 'click', label: 'Yok', target: 'button:yok' }, params: { pattern: '500' }, severity: 'error', enabled: true, name: 'aksiyonu silinmiş monitör' },
    ];
    const graphId = await activeId();
    await panel.evaluate(([key, items]) => chrome.storage.local.set({ [key]: { format: 'graph-recorder-monitors/v1', nextId: 100, items } }), ['monitors:' + graphId, M]);
    await sleep(400);
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    check('8 monitör yüklendi (1 kapalı); aksiyona bağlı olanların kapsamı aksiyonu söylüyor, silinmiş aksiyon işaretli', (await text('#monitors-badge')) === '8' && (await $('#monitors-list .monitor.disabled').count()) === 1
      && (await panel.$$eval('#monitors-list .monitor .scope', (els) => els.map((e) => e.textContent))).some((t) => t === `Edge: ${eDevam.name} · 1. Yaz Fill Telefon`)
      && (await panel.$$eval('#monitors-list .monitor .scope', (els) => els.map((e) => e.textContent))).some((t) => t === `Edge: ${eDevam.name} · 2. Tıkla Devam`)
      && (await panel.$$eval('#monitors-list .monitor .scope.orphan', (els) => els.map((e) => e.textContent))).some((t) => t.includes('aksiyon bulunamadı (6. Yok)')), (await panel.$$eval('#monitors-list .monitor .scope', (els) => els.map((e) => e.textContent))).join(' | '));

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
    check('oynatma sürerken ışık listesi açık: 7 etkin monitör, "kontrol ediliyor"', !during.hidden && during.rows === 7 && during.summary.includes('kontrol ediliyor') && during.running, during.summary);
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
    check('liste 7 satır (kapalı monitör yok), özet yalnızca kırmızı / yeşil sayar', rows.length === 7 && !rows.some((r) => r.name.includes('kapalı')) && (await text('#monitor-run-summary')) === '7 monitör · 5 kırmızı · 2 yeşil' && rows.every((r) => r.status === 'ok' || r.status === 'fail'), await text('#monitor-run-summary'));
    check('Font Size: kırmızı; adım izi [kırmızı, yeşil]; ayrıntı 3 pt metin; ekran görüntüsü', row('Font Size').status === 'fail' && row('Font Size').trail.join(',') === 'fail,ok' && row('Font Size').detail.includes('Adım 1') && row('Font Size').detail.includes('3 pt') && row('Font Size').shot, row('Font Size').detail);
    check('Error Text (tüm model): adım 2\'de kırmızı (500 metni)', row('Error Text · /').status === 'fail' && row('Error Text · /').trail.join(',') === 'ok,fail' && row('Error Text · /').detail.includes('Adım 2') && row('Error Text · /').detail.includes('500'), row('Error Text · /').detail);
    check('Input Validation (edge\'in tamamı): yalnızca Devam adımında, kırmızı, yazılan değer', row('Telefon 5 ile').status === 'fail' && row('Telefon 5 ile').trail.join(',') === 'fail' && row('Telefon 5 ile').scope === `Edge: ${eDevam.name}` && row('Telefon 5 ile').detail.includes('03121234567'), row('Telefon 5 ile').detail);
    check('aksiyona bağlı Input Validation (1. aksiyon): kırmızı, kapsamda aksiyon, ayrıntıda aksiyon 1/N', row('Yazınca telefon').status === 'fail' && row('Yazınca telefon').scope === `Edge: ${eDevam.name} · 1. Yaz Fill Telefon` && /aksiyon 1\/\d+: Fill Telefon/.test(row('Yazınca telefon').detail) && row('Yazınca telefon').shot, row('Yazınca telefon').detail);
    check('aksiyona bağlı Error Text (Devam tıklanınca; sıra yanlış kaydedilmiş, hedefle bulundu): kırmızı, 500 metni, aksiyon 2/N', row('Devam tıklanınca').status === 'fail' && row('Devam tıklanınca').scope === `Edge: ${eDevam.name} · 2. Tıkla Devam` && /aksiyon 2\/\d+: Devam/.test(row('Devam tıklanınca').detail) && row('Devam tıklanınca').detail.includes('500'), row('Devam tıklanınca').detail);
    check('aksiyonu silinmiş monitör: yeşil (kırmızı değil), "aksiyon edge\'de bulunamadı"', row('aksiyonu silinmiş').status === 'ok' && row('aksiyonu silinmiş').detail.includes("aksiyon edge'de bulunamadı") && row('aksiyonu silinmiş').scope.includes('aksiyon bulunamadı'), row('aksiyonu silinmiş').detail);
    check('Error Text (node Telefon, eski kayıtta "warning"): tek adım, yeşil', row('Telefon ekranında').status === 'ok' && row('Telefon ekranında').trail.join(',') === 'ok' && row('Telefon ekranında').scope === 'Node: v_Telefon' && row('Telefon ekranında').detail.includes('bozulma yok'), row('Telefon ekranında').detail);
    check('adım izi başlıkları adım ve edge adını söylüyor', row('Font Size').titles[0].startsWith(`Adım 1 (${eLogin.name} → v_Telefon)`) && row('Font Size').titles[1].startsWith(`Adım 2 (${eDevam.name} → v_Sepet)`), row('Font Size').titles.join(' | '));
    const shots = await panel.$$eval('#monitor-run-list img.shot', (imgs) => imgs.map((i) => i.src.slice(0, 22)));
    check('bozulan monitörlerin ekran görüntüsü var (jpeg data URL)', shots.length === 5 && shots.every((x) => x.startsWith('data:image/jpeg')), shots.join(','));
    await panel.click('#monitor-run-list img.shot');
    await sleep(200);
    check('küçük resme tıklayınca büyük görüntü penceresi', await panel.evaluate(() => document.getElementById('monitor-shot-dialog').open && document.getElementById('monitor-shot-image').naturalWidth > 100 && document.getElementById('monitor-shot-text').textContent.includes('Adım 1')));
    await shot('ekran-goruntusu');
    await panel.click('#btn-monitor-shot-close');

    // ---- Uyarılar: görüntü bozulma ANINDA alınır ve monitörün kendi yapısında saklanır ----
    // Input Validation Devam adımında telefon yazılınca bozulur; görüntü "Devam" tıklanmadan, Telefon
    // sayfasındayken alınmalı (adımın sonunda ekran Sepet olurdu). Error Text ise varılan Sepet ekranında.
    const alarms = (await store('monitor-alarms:' + graphId))['monitor-alarms:' + graphId];
    const alarmOf = (id) => alarms?.items.find((a) => a.monitorId === id);
    check('uyarılar storage\'da (monitor-alarms:<graph>): 5 uyarı, her biri görüntülü', alarms?.format === 'graph-recorder-monitor-alarms/v1' && alarms.items.length === 5 && alarms.items.every((a) => a.screenshot?.startsWith('data:image/jpeg') && a.source === 'replay'), JSON.stringify(alarms?.items.map((a) => [a.monitorId, a.where, a.url])));
    check('aksiyona bağlı uyarılar doğru anda: yazınca Telefon sayfasında, Devam tıklanınca Sepet sayfasında', alarmOf('m6')?.url === base + '/telefon' && alarmOf('m6').where.includes('aksiyon 1/') && alarmOf('m7')?.url === base + '/sepet' && alarmOf('m7').where.includes('aksiyon 2/') && !alarmOf('m8'), JSON.stringify([alarmOf('m6')?.where, alarmOf('m7')?.where]));
    check('Input Validation uyarısı: Telefon sayfasında, "Devam" tıklanmadan (aksiyon bilgisiyle)', alarmOf('m3')?.url === base + '/telefon' && alarmOf('m3').where.startsWith('Adım 2') && /aksiyon \d+\/\d+: /.test(alarmOf('m3').where) && alarmOf('m3').text.includes('03121234567'), JSON.stringify([alarmOf('m3')?.where, alarmOf('m3')?.url]));
    check('Font Size uyarısı Telefon ekranında (adım 1), Error Text uyarısı Sepet ekranında (adım 2)', alarmOf('m1')?.url === base + '/telefon' && alarmOf('m1').where.startsWith('Adım 1') && alarmOf('m2')?.url === base + '/sepet' && alarmOf('m2').where.startsWith('Adım 2') && alarmOf('m1').action === null, JSON.stringify([alarmOf('m1')?.url, alarmOf('m2')?.url]));
    const ivShot = await panel.evaluate(() => { const li = [...document.querySelectorAll('#monitor-run-list .led-row')].find((x) => x.textContent.includes('Telefon 5 ile')); li.querySelector('img.shot').click(); const t = document.getElementById('monitor-shot-text').textContent; document.getElementById('btn-monitor-shot-close').click(); return t; });
    check('ışık listesinde Input Validation görüntüsünün başlığı aksiyonu söylüyor', ivShot.includes('Adım 2') && ivShot.includes('aksiyon') && ivShot.includes('03121234567'), ivShot);

    // ---- Monitörler listesinde "Son kontrol" ve uyarılar ----
    const listVerdicts = await panel.$$eval('#monitors-list .monitor', (els) => els.map((li) => ({ name: li.querySelector('b').textContent, led: li.querySelector('.verdict .led')?.className.replace('led ', '') ?? null, text: li.querySelector('.verdict')?.textContent ?? '', alarms: li.querySelector('.alarms-open')?.textContent ?? null, shot: Boolean(li.querySelector('.alarms img.shot')) })));
    const lv = (name) => listVerdicts.find((v) => v.name.includes(name));
    check('Monitörler listesi: ışık ve "Son kontrol … (son oynatma)"', lv('Font Size · ≥ 4').led === 'fail' && lv('Font Size · ≥ 4').text.includes('Son kontrol') && lv('Font Size · ≥ 4').text.includes('(son oynatma)') && lv('Telefon ekranında').led === 'ok' && lv('kapalı').led === null, JSON.stringify(lv('Font Size · ≥ 4')));
    check('Monitörler listesi: bozulanlarda "Uyarılar (1)" ve son uyarının görüntüsü; geçende yok', lv('Font Size · ≥ 4').alarms === 'Uyarılar (1)' && lv('Font Size · ≥ 4').shot && lv('Telefon 5 ile').alarms === 'Uyarılar (1)' && lv('Telefon 5 ile').shot && lv('Telefon ekranında').alarms === null && lv('kapalı').alarms === null, JSON.stringify(listVerdicts.map((v) => [v.name.slice(0, 14), v.alarms, v.shot])));
    await shot('monitor-listesi-sonuc', '#monitors');
    await panel.evaluate(() => { [...document.querySelectorAll('#monitors-list .monitor')].find((x) => x.textContent.includes('Telefon 5 ile')).querySelector('.alarms-open').click(); });
    await sleep(200);
    const alarmsDialog = await panel.evaluate(() => ({ open: document.getElementById('monitor-alarms-dialog').open, title: document.getElementById('monitor-alarms-title').textContent, rows: [...document.querySelectorAll('#monitor-alarms-list .alarm')].map((li) => ({ where: li.querySelector('b').textContent, when: li.querySelector('.when').textContent, why: li.querySelector('.why').textContent, shot: Boolean(li.querySelector('img.shot')) })) }));
    check('uyarı listesi penceresi: 1 uyarı, yer (adım + aksiyon), zaman + adres, neden, görüntü', alarmsDialog.open && alarmsDialog.title.includes('Telefon 5 ile') && alarmsDialog.rows.length === 1 && alarmsDialog.rows[0].where.includes('aksiyon') && alarmsDialog.rows[0].when.includes('/telefon') && alarmsDialog.rows[0].why.includes('desene uymuyor') && alarmsDialog.rows[0].shot, JSON.stringify(alarmsDialog));
    await shot('uyari-listesi');
    await panel.click('#btn-monitor-alarms-done');

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
    const liveAlarms = (await store('monitor-alarms:' + graphId))['monitor-alarms:' + graphId];
    const liveAlarm = liveAlarms.items.at(-1);
    check('şimdi kontrol: bozulan Font Size için görüntülü uyarı eklendi (kaynak "şimdi")', liveAlarms.items.length === 6 && liveAlarm.monitorId === 'm1' && liveAlarm.source === 'live' && liveAlarm.where.startsWith('Şimdi kontrol') && liveAlarm.url === base + '/telefon' && liveAlarm.screenshot?.startsWith('data:image/jpeg') && (await panel.evaluate(() => [...document.querySelectorAll('#monitors-list .monitor')].find((x) => x.textContent.includes('Font Size · ≥ 4')).querySelector('.alarms-open').textContent)) === 'Uyarılar (2)', JSON.stringify([liveAlarms.items.length, liveAlarm.where, liveAlarm.url]));

    // ---- Uyarılar paneli yeniden açınca da duruyor; graph silinince anahtarıyla gidiyor ----
    await panel.reload();
    await sleep(900);
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    const afterReload = await panel.$$eval('#monitors-list .monitor', (els) => els.map((li) => [li.querySelector('b').textContent, li.querySelector('.alarms-open')?.textContent ?? null]));
    check('yeniden açılış: uyarılar yerinde (Font Size 2, Error Text 1, Telefon 1)', afterReload.some((r) => r[0].startsWith('Font Size · ≥ 4') && r[1] === 'Uyarılar (2)') && afterReload.some((r) => r[0].startsWith('Error Text') && r[1] === 'Uyarılar (1)') && afterReload.some((r) => r[0].startsWith('Telefon 5 ile') && r[1] === 'Uyarılar (1)'), JSON.stringify(afterReload));
    await panel.evaluate(() => { [...document.querySelectorAll('#monitors-list .monitor')].find((x) => x.textContent.includes('Error Text · /')).querySelector('.alarms-open').click(); });
    await sleep(150);
    await panel.click('#btn-monitor-alarms-clear'); await panel.click('#btn-monitor-alarms-clear'); // iki adımlı
    await sleep(300);
    const cleared = (await store('monitor-alarms:' + graphId))['monitor-alarms:' + graphId];
    check('"Uyarıları temizle" (iki adımlı) yalnızca o monitörün uyarılarını siler', cleared.items.length === 5 && !cleared.items.some((a) => a.monitorId === 'm2') && (await text('#monitor-alarms-hint')).includes('henüz uyarı vermedi'), JSON.stringify(cleared.items.map((a) => a.monitorId)));
    await panel.click('#btn-monitor-alarms-done');

    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
