// Monitör menüsü (docs/07-monitorler.md): tür kartları ve arama, node monitörü
// (element listesi, hazır desen, canlı deneme, özet cümlesi), tüm model monitörü, edge (aksiyon)
// monitörü, graph'ta sağ tık menüsü ve hale, node / edge detayındaki alt bölüm, filtreler,
// doğrulama, kaydedilmemiş değişiklik uyarısı, GraphWalker JSON'una yazılma (vertex ve edge) ve
// runner'ın okuması, graph başına ayrı saklama, yedekle birlikte dışa / içe aktarma, graph
// silinince anahtarın silinmesi, node silme / geri alma ile sahipsizlik, senaryo görünümünde salt
// okunurluk, panel yeniden açılınca kalıcılık, Sıfırla. Oynatmadaki kontrol: monitor-run.test.js
// Kullanım: node tests/e2e/monitors.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = outDir('monitors');

const html = (title, body) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const SITE = {
  '/': html('Login', '<h1>Giriş</h1><input id="user-name" placeholder="Kullanıcı adı"> <input id="password" type="password" placeholder="Şifre"> <button id="login" onclick="location.href=\'/telefon\'">Login</button>'),
  '/telefon': html('Telefon', '<h1>Telefon</h1><input id="phone" placeholder="Telefon"> <button id="next" onclick="location.href=\'/sepet\'">Devam</button>'),
  '/sepet': html('Sepet', '<h1>Sepet</h1><button class="del">Sil</button> <button class="del">Sil</button> <button id="home" onclick="location.href=\'/\'">Devam</button>'),
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
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(SITE[req.url.split('?')[0]] ?? 'yok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-monitors-')), {
    executablePath: CHROME, headless: !HEADED, viewport: null, acceptDownloads: true, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900', ...(HEADED ? ['--window-position=-2400,0'] : [])],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(base + '/');
    await sleep(500);
    const panel = await ctx.newPage();
    const panelUrl = `chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`;
    await panel.goto(panelUrl);
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
    const stored = async (id) => (await store('monitors:' + (id ?? await activeId())))['monitors:' + (id ?? await activeId())];
    const tab = await panel.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url ?? '').startsWith(u))), base);
    const createNode = async (resolveTo = null) => {
      await sleep(600);
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      if ((await getState()).pending) await send({ type: 'RESOLVE', targetId: resolveTo });
      await sleep(300);
    };
    const tap = async (id) => { await panel.evaluate((i) => { cy.getElementById(i).emit('tap'); }, id); await sleep(150); };
    const dialogOpen = () => panel.evaluate(() => document.getElementById('monitor-dialog').open);
    const pickType = (id) => $(`#monitor-cards .type-card[data-type="${id}"]`).click();
    const summary = () => text('#monitor-summary');
    const save = () => $('#btn-monitor-save').evaluate((b) => b.click()); // uzun formda buton pencerenin kaydırılan kısmında; fare tıklaması bazen boşa gidiyor (Playwright + dialog), DOM tıklaması aynı işleyiciyi çalıştırır
    const shot = async (name, selector = null) => { await (selector ? $(selector) : panel).screenshot({ path: path.join(OUT, `${name}.png`), ...(selector ? {} : { fullPage: true }) }); };

    // ---- Kayıt: Login → Telefon → Sepet (üç node, iki edge) ----
    await createNode();
    await page.click('#login');
    await page.waitForURL(base + '/telefon');
    await createNode();
    await page.fill('#phone', '05321234567'); // Telefon edge'i iki aksiyon: yaz + tıkla (aksiyon katmanı için)
    await page.click('#next');
    await page.waitForURL(base + '/sepet');
    await createNode();
    let s = await getState();
    const graphA = s.id;
    const byName = (name) => s.nodes.find((n) => n.name === name);
    const telefon = byName('v_Telefon');
    const sepet = byName('v_Sepet');
    check('kayıt: 3 node, 2 edge, adlar', s.nodes.length === 3 && s.edges.length === 2 && telefon && sepet && byName('v_Login'), s.nodes.map((n) => n.name).join(','));
    check('Telefon node\'unun parmak izinde input:phone var', telefon.elements.some((e) => e.key === 'input:phone'));

    // ---- Boş durum ----
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    check('bölüm Senaryo\'nun altında, boş ipucu, badge boş', (await panel.evaluate(() => document.getElementById('scenario').nextElementSibling?.id)) === 'monitors'
      && (await text('#monitors-empty')).includes('Henüz monitör yok') && (await text('#monitors-badge')) === '');
    check('"Seçili öğe" filtresi pasif', await $('#monitors-filter button[data-filter="selected"]').isDisabled());

    // ---- 1. adım: tür kartları ve arama ----
    await $('#btn-monitor-add').click();
    check('pencere 1. adımda açıldı: 5 tür kartı, 3 grup', (await dialogOpen()) && (await $('#monitor-cards .type-card').count()) === 5 && (await $('#monitor-cards .type-group').count()) === 3, `${await $('#monitor-cards .type-card').count()} kart`);
    check('kartta kontrol biçimi etiketi', (await text('#monitor-cards .type-card[data-type="inputValidation"] .when')) === 'Aksiyon tabanlı'
      && (await text('#monitor-cards .type-card[data-type="errorText"] .when')) === 'State tabanlı');
    await $('#monitor-search').fill('hata');
    check('arama süzüyor', (await $('#monitor-cards .type-card').count()) === 1 && (await $('#monitor-cards .type-card[data-type="errorText"]').count()) === 1);
    await $('#monitor-search').fill('YAZI');
    check('arama Türkçe büyük/küçük harf duyarsız', (await $('#monitor-cards .type-card[data-type="fontSize"]').count()) === 1);
    await $('#monitor-search').fill('');
    await $('#btn-monitor-cancel-type').click();
    check('1. adımda Vazgeç sormadan kapatır', !(await dialogOpen()));

    // ---- Node monitörü: Telefon ekranında alan deseni ab+a ----
    await tap(telefon.id);
    check('node seçili: detay kartı ve alt bölüm, filtre aktif', !(await $('#details-monitors').isHidden()) && !(await $('#monitors-filter button[data-filter="selected"]').isDisabled())
      && (await text('#details-monitors-title')).startsWith('Bu node\'un monitörleri'));
    await $('#btn-node-monitor-add').click();
    await pickType('inputValidation');
    check('2. adım: başlıkta tür, kontrol biçimi, kapsam node ve Telefon seçili', (await text('#monitor-type-name')) === 'Input Validation' && (await text('#monitor-type-hint')).includes('aksiyondan hemen sonra')
      && (await $('input[name="monitor-scope"][value="node"]').isChecked()) && (await $('#monitor-node').inputValue()) === telefon.id);
    check('edge seçeneği var ve açık (graph\'ta edge var)', !(await $('input[name="monitor-scope"][value="edge"]').isDisabled()) && (await $('#monitor-edge option').count()) === 2);
    const picks = await $('[data-key="selector"] .element-pick option').allTextContents();
    check('element listesi: Telefon ekranının alanları (parmak izinden)', picks.includes('input:phone') && !picks.includes('input:user-name') && !picks.some((t) => t.startsWith('button')), picks.join(' | '));
    await $('[data-key="selector"] .element-pick').selectOption('input:phone');
    check('listeden seçince alan doldu', (await $('[data-key="selector"] > label input').inputValue()) === 'input:phone');
    await $('[data-key="pattern"] .chip').first().click();
    await $('[data-key="pattern"] .tester input').fill('05321234567');
    check('hazır desen + canlı deneme: uyuyor', (await $('[data-key="pattern"] > label input').inputValue()) === '^0?5\\d{9}$' && (await text('[data-key="pattern"] .test-result')) === '✓ uyuyor');
    await $('[data-key="pattern"] > label input').fill('ab+a');
    check('desen değişince deneme: uymuyor', (await text('[data-key="pattern"] .test-result')) === '✗ uymuyor');
    await $('[data-key="pattern"] .tester input').fill('abbba');
    check('abbba ~ ab+a uyuyor', (await text('[data-key="pattern"] .test-result')) === '✓ uyuyor');
    check('özet cümlesi', (await summary()).includes("v_Telefon node'una her varıldığında") && (await summary()).includes('input:phone alanının değeri /ab+a/ desenine uymalı'), await summary());
    await shot('form-node', '#monitor-dialog');
    await save();
    await sleep(300);
    let m = await stored();
    check('storage monitors:<graph>: 1 monitör, kapsam Telefon', m.items.length === 1 && m.items[0].scope === telefon.id && m.items[0].type === 'inputValidation' && m.items[0].params.pattern === 'ab+a', JSON.stringify(m.items[0]));
    check('liste: otomatik ad, kapsam, ikon; mesaj', (await text('#monitors-list .monitor b')).trim() === 'Input Validation · input:phone ~ /ab+a/' && (await text('#monitors-list .monitor .scope')) === 'Node: v_Telefon'
      && (await $('#monitors-list .monitor b .type-icon').count()) === 1 && (await text('#message')).includes('eklendi'));
    check('alt bölümde 1 monitör', (await $('#details-monitors-list .monitor').count()) === 1);
    check('graph: Telefon haleli, Login değil', await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored') && cy.getElementById(id).style('underlay-opacity') > 0, telefon.id)
      && !(await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored'), byName('v_Login').id)));

    // ---- Doğrulama ve kaydedilmemiş değişiklik ----
    await $('#btn-monitor-add').click();
    await pickType('errorText');
    await $('[data-key="pattern"] > label input').fill('ab(+');
    await save();
    await sleep(100);
    check('geçersiz desen reddedildi', (await dialogOpen()) && (await text('[data-key="pattern"] .field-error')).includes('Geçersiz desen') && !(await $('#monitor-error').isHidden()));
    await $('[data-key="pattern"] > label input').fill('(a*)*');
    check('ağır desen uyarısı (engellemez)', !(await $('[data-key="pattern"] .field-warn').isHidden()) && (await text('[data-key="pattern"] .field-warn')).includes('ağır olabilir') && (await $('[data-key="pattern"] .tester input').getAttribute('maxlength')) === '200');
    await $('[data-key="pattern"] > label input').fill('^abc');
    check('sıradan desende uyarı yok', await $('[data-key="pattern"] .field-warn').isHidden());
    await $('[data-key="pattern"] > label input').fill('');
    await save();
    await sleep(100);
    check('boş zorunlu alan', (await text('[data-key="pattern"] .field-error')) === 'Bu alan gerekli.');
    await $('[data-key="pattern"] > label input').fill('^https');
    await $('#btn-monitor-cancel').click();
    check('kirli formda Vazgeç sorar', await panel.evaluate(() => document.getElementById('monitor-unsaved-dialog').open));
    await $('#btn-monitor-unsaved-back').click();
    check('"Geri dön" değeri korur', (await dialogOpen()) && (await $('[data-key="pattern"] > label input').inputValue()) === '^https');
    await panel.keyboard.press('Escape');
    await sleep(100);
    await $('#btn-monitor-unsaved-discard').click();
    await sleep(100);
    check('Esc + "Kaydetmeden çık": kapandı, kayıt yok', !(await dialogOpen()) && (await stored()).items.length === 1);

    // ---- Tüm model monitörü: 4 pt'den küçük yazı yok (Enter ile) ----
    await tap(telefon.id); // seçim dursun ama kapsam tüm model seçilecek
    await $('#btn-monitor-add').click();
    await pickType('fontSize');
    await $('input[name="monitor-scope"][value="global"]').check();
    check('varsayılan 4 pt, özet her node\'da', (await $('[data-key="min"] > label input').inputValue()) === '4' && (await summary()).includes("her adımdan sonra, her node'da"), await summary());
    check('özet: "Bozulursa kırmızı yanar", önem seçimi yok', (await summary()).endsWith('Bozulursa kırmızı yanar.') && (await panel.evaluate(() => !document.getElementById('monitor-severity'))), await summary());
    await $('[data-key="min"] > label input').press('Enter');
    await sleep(300);
    m = await stored();
    check('2 monitör; ikincisi tüm model', m.items.length === 2 && m.items[1].scope === 'global' && m.items[1].severity === 'error' && m.items[1].params.min === 4, JSON.stringify(m.items[1]));
    check('alt bölüm ipucu: tüm model monitörünü sayıyor', (await text('#details-monitors-hint')).includes('1 etkin monitör'));
    await shot('liste-ve-node');

    // ---- Edge (aksiyon) monitörü: sağ tık menüsünden ----
    const eTelefonEdge = s.edges.find((e) => e.source === telefon.id);
    const cxttap = async (id) => { await panel.evaluate((i) => { const t = i ? cy.getElementById(i) : cy; t.emit('cxttap', [{ originalEvent: { clientX: 200, clientY: 200 } }]); }, id); await sleep(150); };
    const menuTexts = () => panel.$$eval('#monitor-context-menu button', (bs) => bs.map((b) => b.textContent));
    await cxttap(eTelefonEdge.id);
    check('edge\'e sağ tık: menü açık, "edge\'ine monitör ekle"', !(await $('#monitor-context-menu').isHidden()) && (await menuTexts())[0] === `"${eTelefonEdge.name}" edge'ine monitör ekle` && (await menuTexts())[1].startsWith('Monitörlerini göster (0)'), (await menuTexts()).join(' | '));
    await shot('sag-tik-edge', '#graph');
    await $('#monitor-context-menu button').first().click();
    await sleep(200);
    await pickType('inputValidation');
    check('sağ tıktan açılan form: kapsam edge, e_Telefon seçili, menü kapandı', (await dialogOpen()) && (await $('input[name="monitor-scope"][value="edge"]').isChecked()) && (await $('#monitor-edge').inputValue()) === eTelefonEdge.id
      && (await $('#monitor-context-menu').isHidden()) && (await $('#monitor-edge option').allTextContents()).includes(`${eTelefonEdge.name} (v_Telefon → v_Sepet)`), (await $('#monitor-edge option').allTextContents()).join(' | '));
    const edgePicks = await $('[data-key="selector"] .element-pick option').allTextContents();
    check('edge kapsamında element listesi: çıkış ve varış ekranları', edgePicks.includes('input:phone') && !edgePicks.includes('input:user-name'), edgePicks.join(' | '));
    // İkinci katman: edge'in aksiyon listesi. Satır sayısı edge'in kayıttaki aksiyon sayısından alınır:
    // bazı ortamlarda kaydedici edge'e "Pencere boyutu" (ve arkasına otomatik bekleme) da ekler.
    const actionOptions = await $('#monitor-action option').allTextContents();
    const edgeActions = (await getState()).edges.find((e) => e.id === eTelefonEdge.id).actions;
    check('edge seçilince aksiyon listesi: "tamamı" + edge\'in her aksiyonu (yaz, bekle, tıkla, bekle, …)', !(await $('#monitor-action-row').isHidden()) && actionOptions.length === edgeActions.length + 1 && actionOptions[0].startsWith("Edge'in tamamı") && actionOptions[1] === '1. Yaz Fill Telefon (input:phone)' && actionOptions[2].startsWith('2. Bekle') && actionOptions[3].startsWith('3. Tıkla') && actionOptions[4].startsWith('4. Bekle'), actionOptions.join(' | '));
    check('özet (tamamı): "her aksiyonundan sonra"', (await summary()).includes(`${eTelefonEdge.name} edge'inin her aksiyonundan sonra`), await summary());
    await $('#monitor-action').selectOption('0');
    check('aksiyon seçilince alan aksiyonun hedefiyle doldu, ipucu aksiyonu söylüyor', (await $('[data-key="selector"] > label input').inputValue()) === 'input:phone' && (await text('#monitor-action-hint')).includes('hemen sonra') && (await text('#monitor-action-hint')).includes('input:phone'), await text('#monitor-action-hint'));
    await $('[data-key="pattern"] > label input').fill('^0?5');
    check('edge özet cümlesi: aksiyondan hemen sonra', (await summary()).includes(`${eTelefonEdge.name} edge'inin 1. Yaz Fill Telefon aksiyonundan hemen sonra`), await summary());
    await shot('form-edge-aksiyon', '#monitor-dialog');
    await save();
    await sleep(300);
    m = await stored();
    check('3 monitör; üçüncüsü edge kapsamlı, 1. aksiyona bağlı (tür + hedef + etiket saklanır)', m.items.length === 3 && m.items[2].scope === eTelefonEdge.id && m.items[2].action?.index === 0 && m.items[2].action.type === 'input' && m.items[2].action.target === 'input:phone' && m.items[2].action.label === 'Fill Telefon', JSON.stringify(m.items[2]));
    check('liste: kapsam "Edge: e_Telefon · 1. Yaz Fill Telefon"; edge graph\'ta haleli', (await text('#monitors-list .monitor:nth-child(3) .scope')) === `Edge: ${eTelefonEdge.name} · 1. Yaz Fill Telefon`
      && await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored') && cy.getElementById(id).style('underlay-opacity') > 0, eTelefonEdge.id), await text('#monitors-list .monitor:nth-child(3) .scope'));
    await $('#monitors-list .monitor:nth-child(3) .edit').click();
    await sleep(200);
    check('düzenle: aksiyon listede yeniden seçili geliyor', (await $('#monitor-action').inputValue()) === '0' && (await $('[data-key="selector"] > label input').inputValue()) === 'input:phone');
    await $('#btn-monitor-cancel').click();
    await sleep(100);
    await tap(eTelefonEdge.id);
    check('edge seçili: alt bölüm "Bu edge\'in monitörleri", 1 satır, buton metni', (await text('#details-monitors-title')).startsWith('Bu edge\'in monitörleri') && (await $('#details-monitors-list .monitor').count()) === 1
      && (await text('#btn-node-monitor-add')) === 'Bu edge\'e monitör ekle');
    await cxttap(null);
    check('boş alana sağ tık: "Tüm modele monitör ekle"', (await menuTexts())[0] === 'Tüm modele monitör ekle' && (await menuTexts())[1] === 'Tüm model monitörlerini göster (1)', (await menuTexts()).join(' | '));
    await panel.keyboard.press('Escape');
    check('Esc menüyü kapatır', await $('#monitor-context-menu').isHidden());
    await cxttap(telefon.id);
    await $('#monitor-context-menu button').nth(1).click();
    await sleep(200);
    check('"Monitörlerini göster": filtre seçili node, 1 satır', (await $('#monitors-filter button[data-filter="selected"]').textContent()).includes('v_Telefon') && (await $('#monitors-list .monitor').count()) === 1);
    await $('#monitors-list .monitor .delete').first().click(); // filtredeki tek satır: Telefon'un monitörü
    await sleep(200);
    await $('#btn-monitor-undo').click();
    await sleep(200);
    check('silme + geri al yerini ve kapsamını korur', (await stored()).items.length === 3 && (await stored()).items[0].scope === telefon.id);
    // Edge monitörünü kaldır: sonraki kontroller 2 monitörle (Telefon + tüm model) sürer
    await $('#monitors-filter button[data-filter="all"]').click();
    const exportedWithEdge = await panel.evaluate(() => graphWalkerModel());
    check('GraphWalker JSON: edge\'in properties.monitors alanı', exportedWithEdge.models[0].edges.find((e) => e.id === eTelefonEdge.id).properties.monitors?.length === 1
      && exportedWithEdge.models[0].properties.graphRecorder.monitors.items.length === 3);
    await $('#monitors-list .monitor:nth-child(3) .delete').click();
    await sleep(200);
    check('edge monitörü silindi, hale kalktı', (await stored()).items.length === 2 && !(await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored'), eTelefonEdge.id)));
    await tap(telefon.id);

    // ---- Filtreler, etkin kutusu, düzenleme ----
    await $('#monitors-filter button[data-filter="selected"]').click();
    check('filtre seçili node: 1', (await $('#monitors-list .monitor').count()) === 1);
    await $('#monitors-filter button[data-filter="global"]').click();
    check('filtre tüm model: 1', (await $('#monitors-list .monitor').count()) === 1 && (await text('#monitors-list .monitor .scope')) === 'Tüm model');
    await $('#monitors-filter button[data-filter="all"]').click();
    await $('#monitors-list .monitor .toggle').first().uncheck();
    await sleep(200);
    check('etkin kapatılınca storage ve hale', (await stored()).items[0].enabled === false && !(await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored'), telefon.id)));
    await $('#monitors-list .monitor .toggle').first().check();
    await sleep(200);
    await $('#monitors-list .monitor .edit').first().click();
    check('düzenle: 2. adım, tür kilitli, değerler dolu', (await text('#monitor-title')) === 'Monitörü düzenle' && (await $('#btn-monitor-change-type').isHidden()) && (await $('[data-key="pattern"] > label input').inputValue()) === 'ab+a');
    await $('#monitor-name').fill('Telefon deseni');
    await save();
    await sleep(300);
    check('düzenleme kaydedildi', (await stored()).items[0].name === 'Telefon deseni' && (await text('#monitors-list .monitor b')).trim() === 'Telefon deseni');

    // ---- GraphWalker JSON: indirme, içerik, runner okuyor ----
    const download = panel.waitForEvent('download');
    await panel.click('#btn-export');
    const file = await download;
    const modelFile = path.join(OUT, file.suggestedFilename());
    await file.saveAs(modelFile);
    const model = JSON.parse(fs.readFileSync(modelFile, 'utf8')).models[0];
    const items = model.properties.graphRecorder.monitors.items;
    check('model: graphRecorder.monitors 2 kayıt, biçim', items.length === 2 && model.properties.graphRecorder.monitors.format === 'graph-recorder-monitors/v1' && items.every((x) => x.name));
    check('vertex Telefon: properties.monitors 1; Login\'de alan yok', model.vertices.find((v) => v.id === telefon.id).properties.monitors?.length === 1 && !('monitors' in model.vertices.find((v) => v.name === 'v_Login').properties));
    check('Emir\'in alanları yerinde', model.properties.graphRecorder.format === 'graph-recorder/v5' && model.vertices.length === 3 && model.edges.length === 2 && model.edges.every((e) => e.properties.uiActions.length));
    const { loadModel } = await import(pathToFileURL(path.join(REPO, 'runner', 'lib', 'model.js')).href);
    const loaded = loadModel(modelFile);
    check('runner loadModel okuyor; vertex\'te monitors', loaded.vertices.size === 3 && loaded.vertices.get(telefon.id).monitors.length === 1);

    // ---- Graph başına ayrı: yeni graph'ta liste boş, dönünce geri ----
    await send({ type: 'NEW_GRAPH' });
    await sleep(600);
    const graphB = await activeId();
    check('yeni graph: monitör listesi boş', graphB !== graphA && (await text('#monitors-badge')) === '' && (await $('#monitors-list .monitor').count()) === 0);
    await $('#btn-monitor-add').click();
    await pickType('errorText');
    await save();
    await sleep(300);
    check('yeni graph\'a eklenen monitör kendi anahtarında', (await stored(graphB)).items.length === 1 && (await stored(graphA)).items.length === 2);
    await send({ type: 'SWITCH_GRAPH', id: graphA });
    await sleep(800);
    check('ilk graph\'a dönünce 2 monitör ve hale geri geldi', (await text('#monitors-badge')) === '2' && await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored'), telefon.id));

    // ---- Yedek: Dışa aktar monitörleri içerir; Yükle… yeni graph'a geri getirir ----
    await panel.evaluate(() => { document.getElementById('graphs').open = true; });
    const backupDownload = panel.waitForEvent('download');
    await panel.click('#btn-graph-export');
    const backupFile = path.join(OUT, (await backupDownload).suggestedFilename());
    await (await backupDownload).saveAs(backupFile);
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    check('yedekte monitörler', backup.format === 'graph-recorder-graph/v1' && backup.monitors?.items?.length === 2 && backup.nodes.length === 3);
    await panel.setInputFiles('#graph-file', backupFile);
    await sleep(300);
    if (await panel.evaluate(() => document.getElementById('confirm-dialog').open)) await panel.click('#btn-confirm-dialog-ok'); // bekleyen aksiyon varsa sorar
    await sleep(1200);
    const graphC = await activeId();
    const restored = await stored(graphC);
    check('yüklenen graph yeni ve aktif; monitörler geri geldi (node id korunur)', graphC !== graphA && graphC !== graphB && restored?.items.length === 2 && restored.items.some((x) => x.scope === telefon.id && x.name === 'Telefon deseni'), JSON.stringify(restored?.items.map((x) => x.scope)));
    check('yedek mesajı ve hale', (await text('#message')).includes('monitör de yüklendi') && await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored'), telefon.id), await text('#message'));
    check('ilk graph\'ın monitörleri değişmedi', (await stored(graphA)).items.length === 2);

    // ---- Graph silinince monitör anahtarı da silinir ----
    await send({ type: 'DELETE_GRAPH', id: graphB });
    await sleep(600);
    check('silinen graph\'ın monitörleri silindi', (await stored(graphB)) === undefined && (await stored(graphA)).items.length === 2);
    await send({ type: 'SWITCH_GRAPH', id: graphA });
    await sleep(800);

    // ---- Node silme → sahipsiz; geri al → düzeldi ----
    await send({ type: 'DELETE', id: telefon.id });
    await sleep(500);
    check('node silinince sahipsiz uyarısı ve satır', !(await $('#monitors-orphans').isHidden()) && (await $('#monitors-list .monitor.orphan').count()) === 1 && !(await $('#btn-monitor-orphans').isHidden()));
    const exportedNow = await panel.evaluate(() => graphWalkerModel());
    check('sahipsiz monitör dışa aktarılmıyor', exportedNow.models[0].properties.graphRecorder.monitors.items.length === 1);
    await shot('sahipsiz');
    await send({ type: 'UNDO' });
    await sleep(500);
    check('geri al: sahipsizlik kalktı, hale döndü', (await $('#monitors-orphans').isHidden()) && await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored'), telefon.id));

    // ---- Senaryo görünümü: salt okunur ----
    await panel.evaluate(() => { document.getElementById('scenario').open = true; });
    await panel.click('#btn-scenario-new');
    await sleep(400);
    const eLogin = (await getState()).edges.find((e) => e.target === telefon.id);
    await tap(eLogin.id);
    await sleep(600);
    check('senaryo oluştu ve koşuda 1 edge', (await getState()).scenarios.length === 1 && (await text('#scenario-summary')).includes('1/2 edge'), await text('#scenario-summary'));
    // Senaryo düzenlenirken (Elle seç) edge'e sağ tık → menü: koşuya adım EKLEMEMELİ (panel.js tıklamayı
    // "koşuya ekle" sayar; menü seçimi doğrudan yapar)
    await cxttap(eTelefonEdge.id);
    await $('#monitor-context-menu button').first().click();
    await sleep(300);
    check('senaryo düzenlenirken sağ tık menüsü: form açıldı, edge seçildi, koşu değişmedi (1/2 edge)', (await dialogOpen()) && (await text('#scenario-summary')).includes('1/2 edge') && (await panel.evaluate(() => selectedId)) === eTelefonEdge.id && (await text('#details-monitors-title')).startsWith('Bu edge\'in monitörleri'), await text('#scenario-summary'));
    await panel.keyboard.press('Escape');
    await sleep(150);
    await cxttap(eTelefonEdge.id);
    await $('#monitor-context-menu button').nth(1).click(); // "Monitörlerini göster"
    await sleep(300);
    check('"Monitörlerini göster" de koşuyu değiştirmiyor', (await text('#scenario-summary')).includes('1/2 edge') && (await $('#monitors-filter button[data-filter="selected"]').textContent()).includes(eTelefonEdge.name));
    await panel.evaluate(() => document.querySelectorAll('#view-tabs button')[1].click());
    await sleep(500);
    await tap(telefon.id);
    check('senaryo görünümü: Telefon kopyada haleli, alt bölüm salt okunur', await panel.evaluate(() => scenarioView) && await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored'), telefon.id)
      && (await $('#btn-node-monitor-add').isHidden()) && (await text('#details-monitors-hint')).includes('ana graph görünümünde') && (await $('#details-monitors-list .monitor .edit').first().isDisabled()));
    await panel.evaluate(() => document.querySelectorAll('#view-tabs button')[0].click());
    await sleep(400);
    await tap(telefon.id);
    check('ana graph görünümü: ekleme yine açık', !(await $('#btn-node-monitor-add').isHidden()));

    // ---- Panel yeniden açılınca kalıcılık ----
    await panel.reload();
    await sleep(1200);
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    check('yeniden açılış: monitörler ve hale yerinde', (await text('#monitors-badge')) === '2' && await panel.evaluate((id) => cy.getElementById(id).hasClass('monitored'), telefon.id));

    // ---- Sıfırla: graph boşalır, node monitörü sahipsiz, tüm model kalır ----
    await send({ type: 'RESET' });
    await sleep(600);
    check('sıfırla: monitörler duruyor, node monitörü sahipsiz', (await stored(graphA)).items.length === 2 && (await $('#monitors-list .monitor.orphan').count()) === 1);
    await $('#btn-monitor-orphans').click();
    await sleep(300);
    check('sahipsizleri sil', (await stored(graphA)).items.every((x) => x.scope === 'global'));

    // ---- Karanlık tema görüntüsü ----
    await panel.evaluate(() => { localStorage.setItem('theme', 'dark'); });
    await panel.reload();
    await sleep(1000);
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    await $('#btn-monitor-add').click();
    await shot('karanlik-kartlar', '#monitor-dialog');
    await $('#btn-monitor-cancel-type').click();

    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
