// Expected Text ve Expected Image monitörlerinin uçtan uca testi: yerel bir sitede (Login → Home → Login)
// kayıt; node'lara bağlı metin ve görüntü monitörleri; formdan PNG yükleme (dosya seçme) ve doğrulama;
// "Bu ekranda şimdi kontrol et"; oynatmada yeşil / kırmızı, uyarı görüntüsü (görüntü monitörünün çekimi
// uyarı için de kullanılır); ölçek farkı (2× parça); dışa aktarımda görüntü. Eski türlerle karışık.
// Kullanım: node tests/e2e/monitor-expect.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = outDir('monitor-expect');

const CSS = '<style>body{font-family:sans-serif;font-size:14px;margin:16px}button,input{font-size:14px;min-height:28px;min-width:28px;box-sizing:border-box}'
  + '#msg{display:inline-block;padding:6px 10px;background:#e2231a;color:#fff;font-weight:bold;border-radius:4px}</style>';
const html = (title, body) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title>${CSS}</head><body>${body}</body></html>`;
const SITE = {
  // Login düğmesi <input type="submit">: yazısı innerText'te yok, değerinden okunur
  '/': html('Login', '<h1>Giriş</h1><input id="user-name" placeholder="Username"> <input id="password" type="password" placeholder="Password"> <input type="submit" id="login" value="Login" onclick="location.href=\'/home\'">'),
  // Home: kırmızı mesaj kutusu (görüntü parçası), iki satıra yayılan metin, gizli metin
  '/home': html('Home', '<h1>Hoş geldin</h1><div id="msg">Epic sadface: Password is required</div><h2>Sepetiniz</h2><p>boş</p><p style="display:none">Gizli metin</p><button id="logout" onclick="location.href=\'/\'">Logout</button>'),
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
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-monitor-expect-')), {
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
    const createNode = async (resolveTo = null) => {
      await sleep(600);
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      if ((await getState()).pending) await send({ type: 'RESOLVE', targetId: resolveTo });
      await sleep(300);
    };
    const shot = async (name, selector = null) => { await (selector ? $(selector) : panel).screenshot({ path: path.join(OUT, `${name}.png`), ...(selector ? {} : { fullPage: true }) }); };
    // Açık sekmenin görüntüsünden bir parça (png data URL + boyut), kullanıcının ekran görüntüsünden
    // kestiği parça gibi; scale ile büyütülmüş hali (Retina'dan alınmış gibi) de üretilebilir
    const cropOfTab = async (box, scale = 1) => panel.evaluate(async ([{ x, y, width, height }, tabId, s]) => {
      const { windowId } = await chrome.tabs.get(tabId);
      const png = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      const bitmap = await createImageBitmap(await (await fetch(png)).blob());
      const w = Math.round(width * s), h = Math.round(height * s);
      const canvas = new OffscreenCanvas(w, h);
      const c = canvas.getContext('2d');
      c.imageSmoothingEnabled = s !== 1;
      c.drawImage(bitmap, Math.round(x), Math.round(y), Math.round(width), Math.round(height), 0, 0, w, h);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const data = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
      return { data, width: w, height: h };
    }, [box, tab.id, scale]);

    // ---- Kayıt: Login → Home → Login (iki edge; ikinci adım Login node'una VARIR) ----
    await createNode();
    await page.fill('#user-name', 'standard_user');
    await page.fill('#password', 'secret_sauce');
    await page.click('#login');
    await page.waitForURL(base + '/home');
    await createNode();
    let s = await getState();
    const login = s.nodes.find((n) => n.name === 'v_Login');
    await page.click('#logout');
    await page.waitForURL(base + '/');
    await createNode(login.id);
    s = await getState();
    const home = s.nodes.find((n) => n.name === 'v_Home');
    const eLogin = s.edges.find((e) => e.source === login.id);
    const eLogout = s.edges.find((e) => e.source === home.id);
    check('kayıt: 2 node, 2 edge (Login → Home → Login)', s.nodes.length === 2 && s.edges.length === 2 && eLogin?.target === home.id && eLogout?.target === login.id, s.edges.map((e) => `${e.name}:${e.source}>${e.target}`).join(' | '));

    // ---- Parçalar: Home'daki mesaj kutusu, Login düğmesi (sekme görüntüsünden kesilir) ----
    await page.goto(base + '/home');
    await page.bringToFront();
    await sleep(500);
    const msgCrop = await cropOfTab(await page.locator('#msg').boundingBox());
    const msgCrop2x = await cropOfTab(await page.locator('#msg').boundingBox(), 2);
    await page.goto(base + '/');
    await sleep(500);
    const loginCrop = await cropOfTab(await page.locator('#login').boundingBox());
    check('parçalar kesildi: mesaj kutusu ve Login düğmesi (png, makul boyut)', msgCrop.data.startsWith('data:image/png;base64,') && msgCrop.width > 100 && msgCrop.height > 15 && msgCrop2x.width === msgCrop.width * 2 && loginCrop.width > 30, `${msgCrop.width}×${msgCrop.height}, 2×: ${msgCrop2x.width}×${msgCrop2x.height}, login: ${loginCrop.width}×${loginCrop.height}`);
    fs.writeFileSync(path.join(OUT, 'parca-mesaj.png'), Buffer.from(msgCrop.data.split(',')[1], 'base64'));

    // ---- Form: Expected Image, dosya yükleme, doğrulama, önizleme ----
    await panel.bringToFront();
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    await $('#btn-monitor-add').click();
    check('tür kartları: Expected Text ve Expected Image "İşlevsel izleme" altında, state tabanlı', (await $('#monitor-cards .type-card[data-type="expectedText"] .when').textContent()) === 'State tabanlı'
      && (await $('#monitor-cards .type-card[data-type="expectedImage"] .when').textContent()) === 'State tabanlı' && (await $('#monitor-cards .type-card').count()) === 5);
    await $('#monitor-search').fill('görüntü');
    check('arama: "görüntü" yalnızca Expected Image', (await $('#monitor-cards .type-card').count()) === 1 && (await $('#monitor-cards .type-card[data-type="expectedImage"]').count()) === 1);
    await $('#monitor-cards .type-card[data-type="expectedImage"]').click();
    await $('input[name="monitor-scope"][value="node"]').check();
    await $('#monitor-node').selectOption(home.id);
    check('görüntü alanı: dosya kutusu, önizleme boş, benzerlik 90', (await $('[data-key="image"] input[type="file"]').count()) === 1 && (await text('[data-key="image"] .image-info')) === 'Henüz görüntü yok.' && (await $('[data-key="similarity"] > label input').inputValue()) === '90');
    await $('#btn-monitor-save').evaluate((b) => b.click());
    await sleep(150);
    check('görüntüsüz kaydetme: alan hatası', (await text('[data-key="image"] .field-error')).includes('Bir görüntü yükleyin') && (await panel.evaluate(() => document.getElementById('monitor-dialog').open)));
    await $('[data-key="image"] input[type="file"]').setInputFiles({ name: 'mesaj.png', mimeType: 'image/png', buffer: Buffer.from(msgCrop.data.split(',')[1], 'base64') });
    await sleep(300);
    check('yüklenince önizleme ve boyut; özet cümlesi boyutu söylüyor', !(await $('[data-key="image"] .image-preview img').isHidden()) && (await text('[data-key="image"] .image-info')) === `${msgCrop.width}×${msgCrop.height} px`
      && (await text('#monitor-summary')).includes(`yüklenen görüntü (${msgCrop.width}×${msgCrop.height} px) ekranda bulunmalı (benzerlik en az %90)`) && (await $('[data-key="image"] .field-error').isHidden()), await text('#monitor-summary'));
    await shot('form-goruntu', '#monitor-dialog');
    await $('[data-key="image"] input[type="file"]').setInputFiles({ name: 'not.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
    await sleep(200);
    check('yanlış dosya türü: hata, eski görüntü kalır', (await text('[data-key="image"] .field-error')).includes('PNG, JPEG') && (await text('[data-key="image"] .image-info')) === `${msgCrop.width}×${msgCrop.height} px`);
    await $('#btn-monitor-save').evaluate((b) => b.click());
    await sleep(400);
    let m = (await store('monitors:' + await activeId()))['monitors:' + await activeId()];
    const saved = m.items[0];
    check('kaydedildi: expectedImage, Home node, görüntü data URL + boyut, ad kendiliğinden', m.items.length === 1 && saved.type === 'expectedImage' && saved.scope === home.id && saved.params.image.data === msgCrop.data && saved.params.image.width === msgCrop.width && saved.params.similarity === 90
      && (await text('#monitors-list .monitor b')) === `Expected Image · ${msgCrop.width}×${msgCrop.height} px` && (await $('#monitors-list .monitor img.needle').count()) === 1, JSON.stringify({ ...saved, params: { ...saved.params, image: { ...saved.params.image, data: saved.params.image.data.slice(0, 30) } } }));
    await $('#monitors-list .monitor .edit').click();
    await sleep(200);
    check('düzenle: önizleme kayıtlı görüntüyle dolu, Kaldır görünür', !(await $('[data-key="image"] .image-preview img').isHidden()) && !(await $('[data-key="image"] .image-clear').isHidden()));
    await $('[data-key="image"] .image-clear').click();
    await sleep(100);
    check('Kaldır: önizleme boşaldı', (await text('[data-key="image"] .image-info')) === 'Henüz görüntü yok.' && (await $('[data-key="image"] .image-preview img').isHidden()));
    await panel.keyboard.press('Escape');
    await sleep(150);
    check('kaydetmeden çıkınca sorar', await panel.evaluate(() => document.getElementById('monitor-unsaved-dialog').open));
    await $('#btn-monitor-unsaved-discard').click();
    await sleep(150);

    // ---- Diğer monitörler storage'a (form monitors.test.js'te sınanıyor) ----
    const graphId = await activeId();
    const et = (id, scope, t, extra = {}, name = null) => ({ id, type: 'expectedText', scope, params: { text: t, caseSensitive: false }, severity: 'error', enabled: true, name, ...extra });
    const ei = (id, scope, image, name, similarity = 90) => ({ id, type: 'expectedImage', scope, params: { image, similarity }, severity: 'error', enabled: true, name });
    const M = [
      saved,
      et('t1', home.id, 'Password is required', {}, 'Home: şifre uyarısı var'),
      et('t2', home.id, 'Username is required', {}, 'Home: kullanıcı adı uyarısı var'),
      et('t3', home.id, 'password IS required', {}, 'Home: harf duyarsız'),
      { ...et('t4', home.id, 'password IS required', {}, 'Home: harf duyarlı'), params: { text: 'password IS required', caseSensitive: true } },
      et('t5', login.id, 'Login', {}, 'Login: düğme yazısı'),
      et('t6', home.id, 'Sepetiniz boş', {}, 'Home: iki satıra yayılan'),
      et('t7', home.id, 'Gizli metin', {}, 'Home: gizli metin'),
      ei('i2', home.id, loginCrop, 'Home: Login düğmesi (yok)'),
      ei('i3', login.id, loginCrop, 'Login: Login düğmesi'),
      ei('i4', home.id, msgCrop2x, 'Home: mesaj 2× parça'),
      ei('i5', 'global', msgCrop, 'Tüm model: mesaj'),
    ];
    await panel.evaluate(([key, items]) => chrome.storage.local.set({ [key]: { format: 'graph-recorder-monitors/v1', nextId: 100, items } }), ['monitors:' + graphId, M]);
    await sleep(400);
    check('12 monitör listede', (await text('#monitors-badge')) === '12');

    // ---- "Bu ekranda şimdi kontrol et": Home sayfasında, Home node'u seçili ----
    await page.goto(base + '/home');
    await page.bringToFront();
    await sleep(600);
    await panel.evaluate((id) => { cy.getElementById(id).emit('tap'); }, home.id);
    await sleep(150);
    await panel.click('#btn-monitor-check');
    await panel.waitForFunction(() => document.getElementById('message').textContent.includes('Şimdi kontrol edildi'), null, { timeout: 20000 });
    const live = await panel.$$eval('#monitors-list .monitor', (els) => els.map((li) => ({ name: li.querySelector('b').textContent, led: li.querySelector('.verdict .led')?.className.replace('led ', '') ?? null, text: li.querySelector('.verdict')?.textContent ?? '' })));
    const lv = (name) => live.find((v) => v.name.startsWith(name));
    check('şimdi: metin var → yeşil, bulunduğu satırla', lv('Home: şifre').led === 'ok' && lv('Home: şifre').text.includes('metin bulundu: "Epic sadface: Password is required"'), lv('Home: şifre').text);
    check('şimdi: metin yok → kırmızı', lv('Home: kullanıcı').led === 'fail' && lv('Home: kullanıcı').text.includes('beklenen metin ekranda yok: "Username is required"'), lv('Home: kullanıcı').text);
    check('şimdi: harf duyarsız yeşil; duyarlı kırmızı ve "yalnızca büyük/küçük harf farkıyla var"', lv('Home: harf duyarsız').led === 'ok' && lv('Home: harf duyarlı').led === 'fail' && lv('Home: harf duyarlı').text.includes('yalnızca büyük/küçük harf farkıyla var'), lv('Home: harf duyarlı').text);
    check('şimdi: iki satıra yayılan metin bulunur (notuyla); gizli metin bulunmaz', lv('Home: iki satıra').led === 'ok' && lv('Home: iki satıra').text.includes('birden çok satıra yayılmış') && lv('Home: gizli').led === 'fail', lv('Home: iki satıra').text + ' | ' + lv('Home: gizli').text);
    check('şimdi: formdan yüklenen mesaj parçası → yeşil, benzerlik %90+', lv('Expected Image ·').led === 'ok' && /benzerlik %(9\d|100)/.test(lv('Expected Image ·').text), lv('Expected Image ·').text);
    check('şimdi: 2× parça 0.5 ölçekte bulunur', lv('Home: mesaj 2×').led === 'ok' && lv('Home: mesaj 2×').text.includes('0.5× ölçekte'), lv('Home: mesaj 2×').text);
    check('şimdi: Login düğmesi parçası Home\'da yok → kırmızı, "ekranda yok"', lv('Home: Login').led === 'fail' && lv('Home: Login').text.includes('beklenen görüntü') && lv('Home: Login').text.includes('ekranda yok'), lv('Home: Login').text);
    check('şimdi: tüm model mesaj parçası yeşil; Login node\'unun monitörleri bu kontrolde sonuçsuz', lv('Tüm model').led === 'ok' && lv('Login: düğme yazısı').led === null && lv('Login: Login düğmesi').led === null, JSON.stringify([lv('Tüm model'), lv('Login: düğme yazısı')]));
    const liveAlarms = (await store('monitor-alarms:' + graphId))['monitor-alarms:' + graphId];
    check('şimdi: bozulan 4 monitör için görüntülü uyarı (metin 3, görüntü 1)', liveAlarms.items.length === 4 && liveAlarms.items.every((a) => a.source === 'live' && a.screenshot?.startsWith('data:image/jpeg') && a.url === base + '/home') && liveAlarms.items.some((a) => a.monitorId === 'i2'), JSON.stringify(liveAlarms.items.map((a) => a.monitorId)));
    await shot('simdi-kontrol', '#monitors');

    // ---- Senaryo + oynatma: adım 1 Home'a, adım 2 Login'e varır ----
    await panel.evaluate(async (ids) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Test', planner: { engine: 'manual' }, runs: [ids] });
      scenarioRun = 0;
      renderScenario();
    }, [eLogin.id, eLogout.id]);
    await sleep(300);
    await panel.evaluate((edges) => { for (const k of maskedKeys(edges)) replaySecrets[k] = 'secret_sauce'; }, [eLogin, eLogout]);
    await page.goto(base + '/');
    await page.bringToFront();
    await sleep(800);
    await panel.evaluate(() => { document.getElementById('replay-slow').checked = false; document.getElementById('btn-replay').click(); });
    await sleep(600);
    if (await panel.evaluate(() => !document.getElementById('replay-check').hidden)) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 90000 });
    await sleep(300);
    const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}`) }));
    check('Emir\'in oynatması geçti (2 adım)', result.status === 'passed' && result.steps.length === 2, JSON.stringify(result));
    const rows = await panel.$$eval('#monitor-run-list .led-row', (els) => els.map((li) => ({
      status: li.className.replace('led-row ', ''), name: li.querySelector('.led-title b').textContent, trail: [...li.querySelectorAll('.trail i')].map((i) => i.className), detail: li.querySelector('.detail').textContent, shot: Boolean(li.querySelector('img.shot')),
    })));
    const row = (name) => rows.find((r) => r.name.startsWith(name));
    check('oynatma: Home metin/görüntü monitörleri adım 1\'de: var olanlar yeşil', row('Home: şifre').status === 'ok' && row('Home: harf duyarsız').status === 'ok' && row('Home: iki satıra').status === 'ok' && row('Expected Image ·').status === 'ok' && row('Home: mesaj 2×').status === 'ok', rows.map((r) => `${r.name}:${r.status}`).join(' | '));
    check('oynatma: olmayanlar kırmızı, görüntülü (metin ve görüntü)', row('Home: kullanıcı').status === 'fail' && row('Home: kullanıcı').shot && row('Home: Login').status === 'fail' && row('Home: Login').shot && row('Home: gizli').status === 'fail', row('Home: Login').detail);
    check('oynatma: Login node\'una varınca (adım 2) düğme yazısı ve düğme görüntüsü yeşil', row('Login: düğme yazısı').status === 'ok' && row('Login: düğme yazısı').detail.includes('Adım 2') && row('Login: Login düğmesi').status === 'ok' && row('Login: Login düğmesi').detail.includes('Adım 2'), row('Login: Login düğmesi').detail);
    check('oynatma: tüm model mesaj parçası: adım 1 yeşil, adım 2 (Login ekranı) kırmızı → kırmızı', row('Tüm model').status === 'fail' && row('Tüm model').trail.join(',') === 'ok,fail' && row('Tüm model').detail.includes('Adım 2'), row('Tüm model').detail);
    const alarms = (await store('monitor-alarms:' + graphId))['monitor-alarms:' + graphId];
    const replayAlarms = alarms.items.filter((a) => a.source === 'replay');
    const alarmOf = (id) => replayAlarms.find((a) => a.monitorId === id);
    check('oynatma uyarıları: Home\'dakiler /home görüntüsüyle, tüm model olan /\'de (Login ekranı), hepsi görüntülü', replayAlarms.length === 5 && alarmOf('t2')?.url === base + '/home' && alarmOf('i2')?.url === base + '/home' && alarmOf('i5')?.url === base + '/' && replayAlarms.every((a) => a.screenshot?.startsWith('data:image/jpeg')), JSON.stringify(replayAlarms.map((a) => [a.monitorId, a.url])));
    await shot('oynatma-sonu', '#replay');

    // ---- Dışa aktarma: görüntü de modele yazılır ----
    const exported = await panel.evaluate(() => graphWalkerModel());
    const exp = exported.models[0].properties.graphRecorder.monitors.items;
    check('GraphWalker JSON: 12 monitör; görüntü monitöründe data URL ve boyut', exp.length === 12 && exp.filter((x) => x.type === 'expectedImage').every((x) => x.params.image.data.startsWith('data:image/png;base64,') && x.params.image.width > 0), String(exp.length));
    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
