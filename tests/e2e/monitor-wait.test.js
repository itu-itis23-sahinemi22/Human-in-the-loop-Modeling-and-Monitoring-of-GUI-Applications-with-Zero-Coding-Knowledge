// Bekleme aksiyonuna bağlı monitörler ve "olmamalı" kuralı: bir düğmeye basınca "Bekleyiniz…" mesajı çıkan,
// bir süre sonra aynı sayfada (yeni node yok) liste gelen yerel sitede kayıt (Beklemeleri kaydet açık:
// ekranı değiştiren bekleme edge'e girer); beklemeye bağlı Expected Text (olmamalı: "Bekleyiniz"; olmalı:
// "Yazdır" düğmesi) ve Expected Image (olmamalı: mesaj parçası); tıklamaya bağlı "Bekleyiniz olmalı".
// Hızlı sayfada hepsi yeşil; yavaş sayfada (liste bekleme bitince hâlâ gelmemiş) bekleme monitörleri
// kırmızı ve uyarı görüntüsünde "Bekleyiniz" var. Bekleme süresi ✎ ile değişince monitör bağlı kalır.
// Kullanım: node tests/e2e/monitor-wait.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME, outDir, skipCleanup } = require('./env');

const HEADED = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = outDir('monitor-wait');

let delay = 1500; // listenin gelme süresi (ms); test sırasında değiştirilir
const CSS = '<style>body{font-family:sans-serif;font-size:14px;margin:16px}button{font-size:14px;min-height:28px}'
  + '#msg{display:inline-block;padding:8px 12px;background:#1f6feb;color:#fff;border-radius:4px}</style>';
const page = () => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Hizmetler</title>${CSS}</head><body>
<h1>Hizmetler</h1><button id="sgk">SGK kaydı</button><div id="out"></div>
<script>
const DELAY = ${delay};
document.getElementById('sgk').onclick = () => {
  const out = document.getElementById('out');
  out.innerHTML = '<div id="msg">Bekleyiniz, SGK kayıtlarınız getiriliyor…</div>';
  // Liste etkileşimli elementler içerir (bağlantılar, düğme): kaydedici ekranı edge set'iyle tanır, düz metin değişimini görmez
  setTimeout(() => { out.innerHTML = '<h2>SGK kayıtları</h2><ul><li><a href="#2024" id="y2024">2024 – 12 ay</a></li><li><a href="#2025" id="y2025">2025 – 9 ay</a></li></ul><button id="print">Yazdır</button>'; }, DELAY);
};
</script></body></html>`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] !== '/') { res.statusCode = 404; res.end('yok'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(page());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-monitor-wait-')), {
    executablePath: CHROME, headless: !HEADED, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900', ...(HEADED ? ['--window-position=-2400,0'] : [])],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const tabPage = ctx.pages()[0] ?? await ctx.newPage();
    await tabPage.goto(base + '/');
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
      await tabPage.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      if ((await getState()).pending) await send({ type: 'RESOLVE', targetId: resolveTo });
      await sleep(300);
    };
    const shot = async (name, selector = null) => { await (selector ? $(selector) : panel).screenshot({ path: path.join(OUT, `${name}.png`), ...(selector ? {} : { fullPage: true }) }); };
    const cropOfTab = async (box) => panel.evaluate(async ([{ x, y, width, height }, tabId]) => {
      const { windowId } = await chrome.tabs.get(tabId);
      const png = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      const bitmap = await createImageBitmap(await (await fetch(png)).blob());
      const w = Math.round(width), h = Math.round(height);
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext('2d').drawImage(bitmap, Math.round(x), Math.round(y), w, h, 0, 0, w, h);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const data = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
      return { data, width: w, height: h };
    }, [box, tab.id]);

    // ---- Ayar: beklemeleri kaydet (alt sınır 1 sn) ----
    const settings = (await store('settings')).settings ?? {};
    await send({ type: 'SET_SETTINGS', settings: { ...settings, recordWaits: true, minWaitSeconds: 1 } });
    await sleep(300);

    // ---- Kayıt: Hizmetler → (SGK kaydı tıkla, "Bekleyiniz…", 1,5 sn sonra liste) → SGK ----
    await tabPage.goto(base + '/');
    await sleep(500);
    await createNode();
    await tabPage.click('#sgk');
    await sleep(250);
    const waitCrop = await cropOfTab(await tabPage.locator('#msg').boundingBox()); // mesaj kutusu, bekleme sürerken
    await sleep(3200); // liste 1,5 sn'de gelir; kaydedici değişimi görür → ekranı değiştiren bekleme
    await createNode();
    let s = await getState();
    const hizmetler = s.nodes.find((n) => n.name === 'v_Hizmetler');
    const sgk = s.nodes.find((n) => n.id !== hizmetler?.id); // aynı adres, aynı başlık: adı v_Hizmetler_2 olur
    const edge = s.edges.find((e) => e.source === hizmetler?.id);
    const kinds = (e) => e.actions.map((a) => a.type).filter((t) => t !== 'resize').join('+'); // bazı ortamlarda pencere boyutu da kaydedilir
    const waitIndex = edge?.actions.findIndex((a) => a.type === 'wait') ?? -1;
    const clickIndex = edge?.actions.findIndex((a) => a.type === 'click') ?? -1;
    check('kayıt: 2 node, edge\'de tıklama + ekranı değiştiren bekleme (liste aynı sayfada geldi)', s.nodes.length === 2 && sgk && edge && kinds(edge) === 'click+wait' && edge.actions[waitIndex].changed === true && edge.actions[waitIndex].ms >= 1000, edge ? `${kinds(edge)} ${JSON.stringify(edge.actions[waitIndex])}` : 'edge yok');
    check('parça: "Bekleyiniz" kutusu kesildi', waitCrop.data.startsWith('data:image/png') && waitCrop.width > 100 && waitCrop.height > 20, `${waitCrop.width}×${waitCrop.height}`);
    // Bekleme süresi 2,5 sn'ye alınır (Emir'in ✎'si): hızlı sayfada liste gelmiş, yavaşta gelmemiş olsun
    await send({ type: 'SET_WAIT', edgeId: edge.id, index: waitIndex, ms: 2500 });
    await sleep(200);
    s = await getState();
    const A = s.edges.find((e) => e.id === edge.id).actions;
    check('bekleme 2,5 sn oldu', A[waitIndex].ms === 2500);

    // ---- Form: bekleme aksiyonu listede süresiyle; ipucu; "Kural" seçeneği ----
    await panel.bringToFront();
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    await panel.evaluate((i) => { cy.getElementById(i).emit('cxttap', [{ originalEvent: { clientX: 200, clientY: 200 } }]); }, edge.id);
    await sleep(150);
    await $('#monitor-context-menu button').first().click();
    await sleep(200);
    await $('#monitor-cards .type-card[data-type="expectedText"]').click();
    await sleep(150);
    const options = await $('#monitor-action option').allTextContents();
    check('aksiyon listesi: bekleme süresiyle ("Bekle 2,5 sn")', options.some((o) => /^\d+\. Bekle 2,5 sn$/.test(o)), options.join(' | '));
    await $('#monitor-action').selectOption(String(waitIndex));
    await sleep(100);
    check('bekleme seçilince ipucu: "bittikten hemen sonra", olmalı / olmamalı', (await text('#monitor-action-hint')).includes('Bekleme (2,5 sn) bittikten hemen sonra') && (await text('#monitor-action-hint')).includes('olmamalı'), await text('#monitor-action-hint'));
    const modes = await $('[data-key="mode"] option').allTextContents();
    check('Kural: Ekranda olmalı / olmamalı (varsayılan olmalı)', modes.join('|') === 'Ekranda olmalı|Ekranda olmamalı' && (await $('[data-key="mode"] select').inputValue()) === 'present');
    await $('[data-key="text"] > label input').fill('Bekleyiniz');
    await $('[data-key="mode"] select').selectOption('absent');
    await sleep(100);
    check('özet: "… Bekle 2,5 sn aksiyonundan hemen sonra: görünen yazıların hiçbirinde Bekleyiniz geçmemeli"', (await text('#monitor-summary')).includes(`${edge.name} edge'inin ${waitIndex + 1}. Bekle 2,5 sn aksiyonundan hemen sonra: görünen yazıların hiçbirinde Bekleyiniz geçmemeli`), await text('#monitor-summary'));
    await shot('form-bekleme', '#monitor-dialog');
    await $('#btn-monitor-save').evaluate((b) => b.click());
    await sleep(400);
    let m = (await store('monitors:' + await activeId()))['monitors:' + await activeId()];
    check('kaydedildi: bekleme aksiyonuna bağlı (hedef wait:2500), kural absent, ad "… yok"', m.items.length === 1 && m.items[0].action?.type === 'wait' && m.items[0].action.target === 'wait:2500' && m.items[0].params.mode === 'absent'
      && (await text('#monitors-list .monitor b')) === 'Expected Text · "Bekleyiniz" yok' && (await text('#monitors-list .monitor .scope')) === `Edge: ${edge.name} · ${waitIndex + 1}. Bekle 2,5 sn`, JSON.stringify(m.items[0]));

    // ---- Diğer monitörler storage'a ----
    const graphId = await activeId();
    const ref = (i) => ({ index: i, type: A[i].type, label: A[i].label, target: A[i].type === 'wait' ? `wait:${A[i].ms}` : (A[i].target?.key ?? null) });
    const M = [
      m.items[0],
      { id: 'w2', type: 'expectedText', scope: edge.id, action: ref(waitIndex), params: { text: 'Yazdır', mode: 'present', caseSensitive: false }, severity: 'error', enabled: true, name: 'Bekleme sonrası liste geldi' }, // listeyle gelen düğme ("SGK kayıtları" mesajın "SGK kayıtlarınız"ında da geçer)
      { id: 'w3', type: 'expectedImage', scope: edge.id, action: ref(waitIndex), params: { image: waitCrop, mode: 'absent', similarity: 90 }, severity: 'error', enabled: true, name: 'Bekleme sonrası mesaj kutusu yok' },
      { id: 'w4', type: 'expectedText', scope: edge.id, action: ref(clickIndex), params: { text: 'Bekleyiniz', mode: 'present', caseSensitive: false }, severity: 'error', enabled: true, name: 'Tıklayınca Bekleyiniz var' },
    ];
    await panel.evaluate(([key, items]) => chrome.storage.local.set({ [key]: { format: 'graph-recorder-monitors/v1', nextId: 100, items } }), ['monitors:' + graphId, M]);
    await sleep(400);
    check('4 monitör, hepsi aksiyonlu', (await text('#monitors-badge')) === '4' && (await $('#monitors-list .monitor .scope.orphan').count()) === 0);

    // ---- Senaryo + maskeli değer yok; hızlı sayfa (liste 0,8 sn'de): hepsi yeşil ----
    await panel.evaluate(async (id) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Test', planner: { engine: 'manual' }, runs: [[id]] });
      scenarioRun = 0;
      renderScenario();
    }, edge.id);
    await sleep(300);
    const replay = async () => {
      await tabPage.goto(base + '/');
      await tabPage.bringToFront();
      await sleep(800);
      await panel.evaluate(() => { replayResult = null; document.getElementById('replay-slow').checked = false; document.getElementById('btn-replay').click(); }); // önceki koşunun sonucu bekleme koşulunu erken sağlamasın
      await skipCleanup(panel); // temizlik penceresi: Temizlemeden oynat
      await sleep(600);
      if (await panel.evaluate(() => !document.getElementById('replay-check').hidden)) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
      await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 90000 });
      await sleep(300);
      const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}`) }));
      const rows = await panel.$$eval('#monitor-run-list .led-row', (els) => els.map((li) => ({ status: li.className.replace('led-row ', ''), name: li.querySelector('.led-title b').textContent, scope: li.querySelector('.scope').textContent, detail: li.querySelector('.detail').textContent, shot: Boolean(li.querySelector('img.shot')) })));
      return { result, rows, row: (name) => rows.find((r) => r.name.startsWith(name)) };
    };
    delay = 800;
    const fast = await replay();
    check('hızlı sayfa: Emir\'in oynatması geçti', fast.result.status === 'passed', JSON.stringify(fast.result));
    check('hızlı: "Bekleyiniz yok" yeşil (metin ekranda yok, beklendiği gibi)', fast.row('Expected Text · "Bekleyiniz" yok').status === 'ok' && fast.row('Expected Text · "Bekleyiniz" yok').detail.includes('metin ekranda yok') && fast.row('Expected Text · "Bekleyiniz" yok').detail.includes('beklendiği gibi'), fast.row('Expected Text · "Bekleyiniz" yok').detail);
    check('hızlı: liste geldi yeşil; mesaj kutusu yok yeşil', fast.row('Bekleme sonrası liste').status === 'ok' && fast.row('Bekleme sonrası mesaj').status === 'ok' && fast.row('Bekleme sonrası mesaj').detail.includes('görüntü ekranda yok'), fast.row('Bekleme sonrası mesaj').detail);
    check('hızlı: tıklamadan hemen sonra "Bekleyiniz" var (yeşil); bekleme bitince gitmiş', fast.row('Tıklayınca').status === 'ok' && fast.row('Tıklayınca').detail.includes('Bekleyiniz'), fast.row('Tıklayınca').detail);
    await shot('hizli-oynatma', '#replay');

    // ---- Bekleme süresi değişince (✎) monitörler bağlı kalır ----
    await send({ type: 'SET_WAIT', edgeId: edge.id, index: waitIndex, ms: 3000 });
    await sleep(400);
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    const scopes = await panel.$$eval('#monitors-list .monitor .scope', (els) => els.map((e) => e.textContent + (e.classList.contains('orphan') ? ' [SAHİPSİZ]' : '')));
    check('bekleme 3 sn olunca monitörler aynı beklemeye bağlı ("Bekle 3 sn"), sahipsiz değil', scopes.filter((t) => t.endsWith(`${waitIndex + 1}. Bekle 3 sn`)).length === 3 && !scopes.some((t) => t.includes('SAHİPSİZ')), scopes.join(' | '));
    // Oynatma senaryonun graph'ını (kopya) oynatır: yeni süre "Ana graph'tan yenile" ile kopyaya alınır
    await panel.evaluate(() => persistScenario());
    await sleep(300);

    // ---- Yavaş sayfa (liste 6 sn'de): bekleme bitince "Bekleyiniz" hâlâ ekranda ----
    delay = 6000;
    const slow = await replay();
    check('yavaş: "Bekleyiniz yok" kırmızı, "metin hâlâ ekranda", görüntülü, aksiyon "Bekle 3 sn"', slow.row('Expected Text · "Bekleyiniz" yok').status === 'fail' && slow.row('Expected Text · "Bekleyiniz" yok').detail.includes('metin hâlâ ekranda') && slow.row('Expected Text · "Bekleyiniz" yok').detail.includes(`aksiyon ${waitIndex + 1}/${A.length}: Bekle 3 sn`) && slow.row('Expected Text · "Bekleyiniz" yok').shot, slow.row('Expected Text · "Bekleyiniz" yok').detail);
    check('yavaş: liste gelmedi kırmızı; mesaj kutusu hâlâ ekranda kırmızı (görüntü bulundu)', slow.row('Bekleme sonrası liste').status === 'fail' && slow.row('Bekleme sonrası mesaj').status === 'fail' && slow.row('Bekleme sonrası mesaj').detail.includes('hâlâ ekranda'), slow.row('Bekleme sonrası mesaj').detail);
    check('yavaş: tıklama monitörü yine yeşil', slow.row('Tıklayınca').status === 'ok');
    const alarms = (await store('monitor-alarms:' + graphId))['monitor-alarms:' + graphId];
    const slowAlarms = alarms.items.filter((a) => a.where.includes('Bekle 3 sn'));
    check('uyarılar: 3 tanesi bekleme anında, görüntülü, aynı sayfada', slowAlarms.length === 3 && slowAlarms.every((a) => a.screenshot?.startsWith('data:image/jpeg') && a.url === base + '/'), JSON.stringify(alarms.items.map((a) => [a.monitorId, a.where])));
    if (slowAlarms[0]?.screenshot) fs.writeFileSync(path.join(OUT, 'uyari-bekleyiniz.jpg'), Buffer.from(slowAlarms[0].screenshot.split(',')[1], 'base64'));
    await shot('yavas-oynatma', '#replay');
    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
