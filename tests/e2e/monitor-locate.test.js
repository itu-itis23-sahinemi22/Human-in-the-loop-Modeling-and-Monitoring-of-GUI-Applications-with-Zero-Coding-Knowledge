// Hata yeri (docs/07-monitorler.md > Hata yeri): monitör bozulunca uyarı, ekran görüntüsünün yanında bozulan
// elementi de saklar ve onu görüntünün üstünde işaretler. Burada üç şey sınanır:
//   1) Sayfada yer bulma (monitor-probe.js): her türde doğru element, "Ekrandaki elementler" satır biçiminde
//      (etiket "metin" anahtar), DOM yolu, alan değeri sızmaz; görünen alanın dışı, taşanı gizleyen kutu,
//      sabit / mutlak kutular, bölünmüş metin, yer tutucu, boşluk ve harf katlama, çok sayıda parça.
//   2) Kutunun doğruluğu: saklanan kutu görüntüye taşınınca gerçekten o elementin üstüne düşüyor mu? Elementlerin
//      zemini ayırt edici renktedir; uyarının ekran görüntüsünde kutunun içindeki ortalama renk o renk, hemen
//      dışı beyaz olmalı (oynatmada, kaydırılmış sayfada ve %150 yakınlaştırmada).
//   3) Arayüz: küçük resimlerde ve "Bozulduğu andaki ekran" penceresinde kutular, bozulan element listesi,
//      işaret anahtarı, satır ↔ kutu, element olmayan durumlar, eski uyarılar, yeniden açılışta kalıcılık.
// Kullanım: node tests/e2e/monitor-locate.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME, outDir, skipCleanup } = require('./env');

const HEADED = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = outDir('monitor-locate');

const CSS = '<style>body{margin:0;background:#fff;font:14px sans-serif}h1{margin:20px}p{margin:20px}button{font-size:14px;min-height:28px;min-width:28px}</style>';
const html = (title, body) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title>${CSS}</head><body>${body}</body></html>`;
const SITE = {
  // Giriş: yeşil zeminli telefon alanı bilinen yerde (120,180 300×40)
  '/': html('Giris', `<h1>Giriş</h1><form id="giris">
    <input id="phone" name="phone" aria-label="Telefon" style="position:absolute;left:120px;top:180px;width:300px;height:40px;box-sizing:border-box;border:0;padding:0 8px;background:#00c800;font-size:14px">
    <button id="go" type="button" style="position:absolute;left:120px;top:260px" onclick="location.href='/sonuc'">Devam</button></form>`),
  // Sonuç: hata metni (sarı), "Bekleyiniz" (camgöbeği), 3 pt yazı (eflatun), taşanı gizleyen kutunun dışında ve sayfanın
  // aşağısında birer 3 pt yazı, kırmızı | mavi görüntü
  '/sonuc': html('Sonuc', `<h1>Sonuç</h1>
    <div id="logo" style="position:absolute;left:600px;top:20px;width:64px;height:32px;background:linear-gradient(90deg,#f00 50%,#00f 50%)"></div>
    <p id="msg">İşlem sırasında <b id="err" style="background:#ffe600">500 Internal Server Error</b> oluştu.</p>
    <p id="wait">Lütfen <span id="w" style="background:#00e5ff">Bekleyiniz</span> işlem sürüyor</p>
    <p><small id="tiny" style="font-size:4px;background:#f0f">çok küçük yazı</small></p>
    <div id="clip" style="margin:20px;width:120px;height:20px;overflow:hidden"><div style="margin-top:60px;font-size:4px">kutunun dışında</div></div>
    <button id="back" style="margin:20px" onclick="location.href='/'">Geri</button>
    <div style="height:2000px"></div><p id="far" style="font-size:4px">aşağıdaki küçük yazı</p>`),
  // Laboratuvar: yer bulmanın sınır durumları (doğrudan MONITOR_PROBE ile)
  '/lab': html('Lab', `<h1>Lab</h1>
    <input id="pw" type="password" name="sifre" aria-label="Şifre" value="gizli123"> <div id="note" contenteditable="true" aria-label="Not" style="display:inline-block;min-width:80px">özel içerik</div>
    <div id="box-static" style="width:100px;height:20px;overflow:hidden"><span style="position:absolute;left:400px;top:100px">MUTLAK-SERBEST</span><span style="position:fixed;left:400px;top:130px">SABIT-SERBEST</span></div>
    <div id="box-rel" style="position:relative;width:100px;height:20px;overflow:hidden"><span style="position:absolute;left:0;top:60px">MUTLAK-TUTULAN</span></div>
    <p id="split">Hata <b>kodu</b> 500</p>
    <p><input id="ph" placeholder="Arama kutusu"> <input id="btn" type="submit" value="Gönder düğmesi"></p>
    <p id="tr">Bugün GİRİŞ yapıldı ve işlem tamamlandı</p>
    <p id="ws">internal
         server    error</p>
    <p id="adj">Kod 500 Internal Server Error, tutar 1500 TL, sonra 404</p>
    <p><input id="ghost" value="x" style="visibility:hidden"></p>
    <h2 id="up" style="margin:20px;text-transform:uppercase">büyük harf</h2>
    <ul id="many">${'<li>TEKRAR</li>'.repeat(14)}</ul>
    <div id="cut" style="position:fixed;left:20px;bottom:-22px;height:30px;line-height:30px">YARIM</div>`),
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;

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
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-monitor-locate-')), {
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
    const panelUrl = `chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`;
    await panel.goto(panelUrl);
    await sleep(500);
    const errors = [];
    panel.on('pageerror', (e) => { errors.push(String(e)); if (process.env.DEBUG) console.log('  panel hata:', String(e)); });
    panel.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); if (process.env.DEBUG) console.log('  panel konsol:', m.text()); } });
    const $ = (sel) => panel.locator(sel);
    const text = (sel) => panel.textContent(sel);
    const texts = (sel) => panel.$$eval(sel, (els) => els.map((e) => e.textContent));
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
    // Sayfada doğrudan kontrol (panelin gönderdiği mesajın aynısı): tek kontrolün sonucu
    const probe = (type, params) => panel.evaluate(([id, t, p]) => chrome.tabs.sendMessage(id, { type: 'MONITOR_PROBE', checks: [{ id: 'x', type: t, params: p }] }, { frameId: 0 }).then((r) => ({ ...r.results.x, viewport: r.viewport })), [tab.id, type, params]);
    const absent = (needle, caseSensitive = false) => probe('expectedText', { text: needle, mode: 'absent', caseSensitive });
    // Görüntüde bir kutunun içindeki ortalama renk. box ve viewport aynı birimde (uyarıda saklandığı gibi); inset:
    // kenarlardan içeri pay (jpeg kenarları bulanıklaştırır). shift: kutu kendi yüksekliğinin katı kadar kaydırılır (dışı).
    const meanColor = (dataUrl, box, viewport, { inset = 0.2, shift = 0 } = {}) => panel.evaluate(async ([url, b, v, k, dy]) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = canvas.getContext('2d');
      g.drawImage(bitmap, 0, 0);
      const sx = bitmap.width / v.width, sy = bitmap.height / v.height;
      const x = Math.round((b.x + b.w * k) * sx), y = Math.round((b.y + b.h * k + b.h * dy) * sy);
      const w = Math.max(1, Math.round(b.w * (1 - 2 * k) * sx)), h = Math.max(1, Math.round(b.h * (1 - 2 * k) * sy));
      const d = g.getImageData(x, y, w, h).data;
      let r = 0, gr = 0, bl = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; bl += d[i + 2]; }
      const n = d.length / 4;
      return { r: Math.round(r / n), g: Math.round(gr / n), b: Math.round(bl / n), width: bitmap.width, height: bitmap.height };
    }, [dataUrl, box, viewport, inset, shift]);
    const isGreen = (c) => c.g > 150 && c.r < 100 && c.b < 100;
    const isYellow = (c) => c.r > 140 && c.g > 120 && c.b < 110 && c.r - c.b > 80;
    const isCyan = (c) => c.r < 110 && c.g > 120 && c.b > 130;
    const isMagenta = (c) => c.r - c.g > 40 && c.b - c.g > 40;
    const isWhite = (c) => c.r > 235 && c.g > 235 && c.b > 235;

    // =========================================================================================
    // 1) SAYFADA YER BULMA: sınır durumları (Lab sayfası, doğrudan MONITOR_PROBE)
    // =========================================================================================
    await page.goto(base + '/lab');
    await page.bringToFront();
    await sleep(600);
    const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio }));

    const pw = await probe('inputValidation', { selector: '#pw', pattern: '^x', mode: 'match', whenEmpty: 'check' });
    check('şifre alanı: bozulan element alanın adıyla; değer ne sonuçta ne elementte', pw.status === 'fail' && pw.targets.length === 1 && pw.targets[0].tag === 'input#pw' && pw.targets[0].text === 'Şifre' && pw.targets[0].key === 'input:pw'
      && !JSON.stringify(pw).includes('gizli123') && pw.viewport.width === view.width && pw.viewport.height === view.height && pw.viewport.ratio === view.ratio, JSON.stringify(pw));
    const note = await probe('inputValidation', { selector: '#note', pattern: '^x', mode: 'match', whenEmpty: 'check' });
    check('contenteditable alan: elementin metni alanın adı (içeriği değil)', note.status === 'fail' && note.targets[0].tag === 'div#note' && note.targets[0].text === 'Not' && !JSON.stringify(note.targets).includes('özel'), JSON.stringify(note.targets));
    const okResult = await probe('inputValidation', { selector: '#pw', pattern: '^g', mode: 'match', whenEmpty: 'check' });
    check('bozulmayan sonuçta hedef yok (yer yalnızca bozulunca aranır)', okResult.status === 'ok' && okResult.targets === undefined);

    const free = await absent('MUTLAK-SERBEST');
    const fixed = await absent('SABIT-SERBEST');
    const held = await absent('MUTLAK-TUTULAN');
    check('taşma: konumlandırılmamış kutunun içindeki mutlak ve sabit kutu görünür (kesilmez), kutusu bilinen yerde', free.targets[0].visible && near(free.targets[0].rect.x, 400) && near(free.targets[0].rect.y, 100, 3)
      && fixed.targets[0].visible && near(fixed.targets[0].rect.y, 130, 3) && free.targets[0].hidden === null, JSON.stringify([free.targets[0], fixed.targets[0]]));
    check('taşma: konumlandırılmış kutunun dışında kalan mutlak kutu "clipped" (görüntüde işaretlenmez)', held.status === 'fail' && held.targets[0].visible === null && held.targets[0].hidden === 'clipped' && held.targets[0].rect !== null, JSON.stringify(held.targets[0]));

    const split = await absent('Hata kodu 500');
    check('birden çok düğüme bölünmüş metin: metni içeren en içteki element (p#split)', split.targets.length === 1 && split.targets[0].tag === 'p#split' && split.targets[0].visible !== null, JSON.stringify(split.targets));
    const placeholder = await absent('Arama kutusu');
    const submit = await absent('gönder düğmesi');
    check('yer tutucu ve düğme değeri: o alan / düğme', placeholder.targets[0]?.tag === 'input#ph' && submit.targets[0]?.tag === 'input#btn' && submit.targets[0].key === 'input:btn', JSON.stringify([placeholder.targets, submit.targets]));

    const word = await absent('giriş');
    const line = await page.evaluate(() => { const r = document.getElementById('tr').getBoundingClientRect(); return { x: r.x, w: r.width }; });
    check('harf katlama ("GİRİŞ" ~ "giriş"): yalnızca o sözcük işaretli (satırın tamamı değil)', word.status === 'fail' && word.targets[0].tag === 'p#tr' && word.targets[0].rect.w < 80 && word.targets[0].rect.x > line.x + 30, JSON.stringify(word.targets[0].rect));
    const upper = await absent('BÜYÜK HARF', true);
    check('text-transform ile büyüyen metin (düğümde küçük harf): element olarak bulunur (h2#up)', upper.status === 'fail' && upper.targets[0]?.tag === 'h2#up', JSON.stringify(upper.targets));
    const spaced = await probe('errorText', { pattern: 'internal server error' });
    check('hata metni: kaynağında satır sonu / çok boşluk olan metin de düğümünde işaretlenir', spaced.status === 'fail' && spaced.targets[0]?.tag === 'p#ws' && spaced.targets[0].rect.w > 60 && spaced.targets[0].visible !== null, JSON.stringify(spaced.targets));

    const phrase = await probe('errorText', { pattern: '\\b(404|500|internal server error)\\b' });
    const adj = phrase.targets.filter((t) => t.tag === 'p#adj');
    const span = (from, to) => page.evaluate(([a, b]) => { const node = document.getElementById('adj').firstChild; const r = document.createRange(); r.setStart(node, node.nodeValue.indexOf(a)); r.setEnd(node, node.nodeValue.indexOf(b) + b.length); const q = r.getBoundingClientRect(); return { x: q.x, w: q.width }; }, [from, to]);
    const whole = await span('500 Internal', 'Server Error');
    const amount = await span('1500', '1500');
    check('hata metni: desenin tuttuğu her yer işaretli; art arda tutanlar ("500" + "Internal Server Error") tek kutu, "1500"ün içindeki 500 işaretli değil', phrase.status === 'fail' && adj.length === 2
      && near(adj[0].rect.x, whole.x) && near(adj[0].rect.w, whole.w) && adj[1].rect.w < 40 && adj.every((t) => t.rect.x + t.rect.w <= amount.x + 1 || t.rect.x >= amount.x + amount.w - 1), JSON.stringify([adj.map((t) => t.rect), whole, amount]));
    const ghost = await probe('inputValidation', { selector: '#ghost', pattern: '^a', mode: 'match', whenEmpty: 'check' });
    check('visibility: hidden alan: bozulur, yeri bilinir ama görüntüde işaretlenmez ("unrendered")', ghost.status === 'fail' && ghost.targets[0].tag === 'input#ghost' && ghost.targets[0].rect !== null && ghost.targets[0].visible === null && ghost.targets[0].hidden === 'unrendered', JSON.stringify(ghost.targets));

    const many = await absent('TEKRAR');
    check('çok sayıda parça: ilk 10 listelenir, kalanı sayılır (more 4)', many.targets.length === 10 && many.more === 4 && many.targets.every((t) => t.tag === 'li' && t.path.join('>') === 'ul#many'), JSON.stringify([many.targets.length, many.more, many.targets[0]]));
    const cut = await absent('YARIM');
    check('görünen alanın kenarında kesilen element: görünen kısmı kutunun tamamından küçük', cut.targets[0].visible !== null && cut.targets[0].visible.h < cut.targets[0].rect.h - 5 && near(cut.targets[0].visible.y + cut.targets[0].visible.h, view.height), JSON.stringify(cut.targets[0]));
    // Ad eşliği: aynı element "Ekrandaki elementler" ağacında (dom-tree.js) hangi satırsa hata yerinde de o (etiket, metin, anahtar)
    const tree = await panel.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'DOM_TREE' }, { frameId: 0 }), tab.id);
    const flatten = (nodes) => nodes.flatMap((n) => [n, ...flatten(n.children)]);
    const rows = flatten(tree.tree);
    const sameRow = (target) => { const row = rows.find((r) => r.tag === target.tag); return Boolean(row) && row.text === target.text && row.key === target.key; };
    const named = [pw.targets[0], placeholder.targets[0], submit.targets[0], split.targets[0], upper.targets[0], word.targets[0], cut.targets[0]];
    check('bozulan elementin adı, "Ekrandaki elementler" ağacındaki satırıyla aynı: alan, yer tutuculu alan, düğme, paragraf, başlık', named.every(sameRow) && rows.length > 10, JSON.stringify(named.filter((t) => !sameRow(t)).map((t) => [t.tag, t.text, t.key, rows.find((r) => r.tag === t.tag) ?? null])));
    const missing = await probe('expectedText', { text: 'Sayfada olmayan bir metin', mode: 'present', caseSensitive: false });
    check('beklenen metin yok: bozulur ama hedef listesi boş (olmayanın yeri yok)', missing.status === 'fail' && Array.isArray(missing.targets) && missing.targets.length === 0 && missing.more === 0);

    // =========================================================================================
    // 2) OYNATMA: Giriş → (telefon yaz, Devam) → Sonuç; uyarılar bozulan elementle
    // =========================================================================================
    await page.goto(base + '/');
    await page.bringToFront();
    await sleep(500);
    await createNode();
    await page.fill('#phone', 'abc'); // 05 ile başlamıyor: Input Validation yazınca bozulur
    await page.click('#go');
    await page.waitForURL(base + '/sonuc');
    await createNode();
    const s = await getState();
    const giris = s.nodes.find((n) => n.name === 'v_Giris');
    const sonuc = s.nodes.find((n) => n.name === 'v_Sonuc');
    const edge = s.edges.find((e) => e.source === giris?.id);
    check('kayıt: 2 node, 1 edge (yaz + tıkla)', s.nodes.length === 2 && s.edges.length === 1 && Boolean(sonuc) && edge.actions.some((a) => a.type === 'input') && edge.actions.some((a) => a.type === 'click'), s.nodes.map((n) => n.name).join(','));

    // Görüntü monitörünün parçası: 64×32, sol yarı kırmızı, sağ yarı mavi (sayfadaki #logo)
    const needle = await panel.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#f00'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#00f'; g.fillRect(32, 0, 32, 32); return c.toDataURL('image/png'); });
    const M = [
      { id: 'm1', type: 'inputValidation', scope: edge.id, params: { selector: 'input:phone', pattern: '^05', mode: 'match', whenEmpty: 'skip' }, severity: 'error', enabled: true, name: 'Telefon 05 ile' },
      { id: 'm2', type: 'errorText', scope: 'global', params: { pattern: '\\b(404|500 internal server error)\\b' }, severity: 'error', enabled: true, name: 'Hata metni yok' },
      { id: 'm3', type: 'expectedText', scope: 'global', params: { text: 'bekleyiniz', mode: 'absent', caseSensitive: false }, severity: 'error', enabled: true, name: 'Bekleyiniz yok' },
      { id: 'm4', type: 'fontSize', scope: 'global', params: { min: 4, unit: 'pt' }, severity: 'error', enabled: true, name: 'Küçük yazı yok' },
      { id: 'm5', type: 'expectedImage', scope: sonuc.id, params: { image: { data: needle, width: 64, height: 32 }, mode: 'absent', similarity: 90 }, severity: 'error', enabled: true, name: 'Logo yok' },
      { id: 'm6', type: 'expectedText', scope: sonuc.id, params: { text: 'Teşekkürler', mode: 'present', caseSensitive: false }, severity: 'error', enabled: true, name: 'Teşekkür yazısı' },
    ];
    const graphId = await activeId();
    await panel.evaluate(([key, items]) => chrome.storage.local.set({ [key]: { format: 'graph-recorder-monitors/v1', nextId: 100, items } }), ['monitors:' + graphId, M]);
    await sleep(400);
    await panel.evaluate(async (ids) => {
      document.getElementById('monitors').open = true;
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Test', planner: { engine: 'manual' }, runs: [ids] });
      scenarioRun = 0;
      renderScenario();
      showView(null); // Ana graph sekmesi: monitörler listesi genel kurallar
    }, [edge.id]);
    await sleep(300);
    await page.goto(base + '/');
    await page.bringToFront();
    await sleep(800);
    await panel.evaluate(() => { document.getElementById('replay-slow').checked = false; document.getElementById('btn-replay').click(); });
    await skipCleanup(panel);
    await sleep(600);
    if (await panel.evaluate(() => !document.getElementById('replay-check').hidden)) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 90000 });
    await sleep(400);
    const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}`) }));
    check('oynatma geçti (monitörler adımı bozmaz), 6 monitör kırmızı', result.status === 'passed' && (await text('#monitor-run-summary')) === '6 monitör · 6 kırmızı', `${JSON.stringify(result)} ${await text('#monitor-run-summary')}`);

    const alarms = (await store('monitor-alarms:' + graphId))['monitor-alarms:' + graphId];
    const alarmOf = (id) => alarms.items.find((a) => a.monitorId === id);
    check('6 uyarı; hepsinde hata yeri alanları (targets dizi, viewport)', alarms.items.length === 6 && alarms.items.every((a) => Array.isArray(a.targets) && (a.targets.length === 0 || a.viewport?.width > 0)), JSON.stringify(alarms.items.map((a) => [a.monitorId, a.targets?.length, a.viewport])));

    // ---- Input Validation: alan, yazıldığı anda (Devam tıklanmadan) ----
    const a1 = alarmOf('m1');
    const t1 = a1.targets[0];
    check('Input Validation: bozulan element telefon alanı, "Ekrandaki elementler" satır biçiminde ve DOM yoluyla', a1.targets.length === 1 && t1.tag === 'input#phone' && t1.text === 'Telefon' && t1.key === 'input:phone' && t1.path.join(' › ') === 'form#giris'
      && t1.hidden === null && a1.url === base + '/' && a1.more === 0, JSON.stringify(t1));
    check('kutu sayfadaki yeriyle aynı (120,180 300×40), tamamı görünüyor', near(t1.rect.x, 120) && near(t1.rect.y, 180) && near(t1.rect.w, 300) && near(t1.rect.h, 40) && JSON.stringify(t1.visible) === JSON.stringify(t1.rect), JSON.stringify(t1.rect));
    const right = { x: t1.visible.x + t1.visible.w * 0.4, y: t1.visible.y, w: t1.visible.w * 0.6, h: t1.visible.h }; // yazılan "abc" solda; sağ taraf düz zemin
    const c1 = await meanColor(a1.screenshot, right, a1.viewport);
    const c1out = await meanColor(a1.screenshot, right, a1.viewport, { shift: -1.5 });
    check('GÖRÜNTÜDE DOĞRULAMA: kutunun içi alanın yeşil zemini, hemen üstü beyaz (kutu gerçekten alanın üstünde)', isGreen(c1) && isWhite(c1out) && near(c1.width / a1.viewport.width, c1.height / a1.viewport.height, 0.01), JSON.stringify([c1, c1out]));

    // ---- Error Text: yalnızca eşleşen metin ----
    const a2 = alarmOf('m2');
    const t2 = a2.targets[0];
    const err = await page.evaluate(() => { const r = document.getElementById('err').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    check('Error Text: eşleşen metnin kutusu (b#err), paragrafın tamamı değil; DOM yolu p#msg', a2.targets.length === 1 && t2.tag === 'b#err' && t2.text === '500 Internal Server Error' && t2.key === null && t2.path.join(' › ') === 'p#msg'
      && near(t2.rect.x, err.x) && near(t2.rect.w, err.w) && near(t2.rect.y, err.y, 3), JSON.stringify([t2, err]));
    const c2 = await meanColor(a2.screenshot, t2.visible, a2.viewport, { inset: 0.1 });
    const c2out = await meanColor(a2.screenshot, t2.visible, a2.viewport, { shift: -2 });
    check('GÖRÜNTÜDE DOĞRULAMA: Error Text kutusunun içi sarı, üstü beyaz', isYellow(c2) && isWhite(c2out), JSON.stringify([c2, c2out]));

    // ---- Expected Text (olmamalı): ekrandaki sözcük ----
    const a3 = alarmOf('m3');
    const t3 = a3.targets[0];
    const c3 = await meanColor(a3.screenshot, t3.visible, a3.viewport, { inset: 0.1 });
    check('Expected Text (olmamalı): hâlâ ekrandaki "Bekleyiniz" sözcüğü (span#w), içi camgöbeği', t3.tag === 'span#w' && t3.text === 'Bekleyiniz' && t3.path.join(' › ') === 'p#wait' && isCyan(c3), JSON.stringify([t3, c3]));

    // ---- Font Size: görünen önce; taşmanın dışındaki ve sayfanın aşağısındaki işaretlenmez ----
    const a4 = alarmOf('m4');
    const c4 = await meanColor(a4.screenshot, a4.targets[0].visible, a4.viewport, { inset: 0.05 });
    check('Font Size: 3 küçük yazı; önce ekranda görünen (small#tiny, "3 pt"), sonra kutunun dışındaki ("clipped") ve aşağıdaki ("below")', a4.targets.length === 3 && a4.targets[0].tag === 'small#tiny' && a4.targets[0].note === '3 pt' && a4.targets[0].visible !== null
      && a4.targets[1].hidden === 'clipped' && a4.targets[1].visible === null && a4.targets[1].path.join(' › ') === 'div#clip' && a4.targets[2].tag === 'p#far' && a4.targets[2].hidden === 'below' && a4.more === 0, JSON.stringify(a4.targets.map((t) => [t.tag, t.hidden, t.note])));
    check('GÖRÜNTÜDE DOĞRULAMA: görünen küçük yazının kutusu eflatun zeminin üstünde', isMagenta(c4), JSON.stringify(c4));

    // ---- Expected Image (olmamalı): bulunan bölge ----
    const a5 = alarmOf('m5');
    const t5 = a5.targets[0];
    const c5 = await meanColor(a5.screenshot, t5.visible, a5.viewport, { inset: 0.1 });
    const px = c1.width / a1.viewport.width; // görüntü pikseli / CSS pikseli (retina ekranda 2)
    check('Expected Image (olmamalı): bulunan bölge görüntü pikseliyle, sayfadaki görüntünün (600,20 64×32) içinde; ölçü alanı görüntünün boyutu', a5.targets.length === 1 && t5.tag === 'ekran bölgesi' && t5.rect.w >= 64 && t5.rect.h >= 32
      && t5.rect.x >= 600 * px - 1 && t5.rect.x + t5.rect.w <= 664 * px + 1 && t5.rect.y >= 20 * px - 1 && t5.rect.y + t5.rect.h <= 52 * px + 1
      && a5.viewport.width === c5.width && a5.viewport.height === c5.height && c5.g < 70 && c5.r > 80 && c5.b > 80, JSON.stringify([t5, a5.viewport, c5]));
    check('Expected Text (olmalı, yok): uyarı var ama işaretlenecek element yok', alarmOf('m6').targets.length === 0 && alarmOf('m6').viewport === null && alarmOf('m6').screenshot.startsWith('data:image/'));

    // =========================================================================================
    // 3) ARAYÜZ
    // =========================================================================================
    // ---- Işık listesi: küçük resimlerde kutu ----
    const ledBoxes = await panel.$$eval('#monitor-run-list .led-row', (rows) => Object.fromEntries(rows.map((li) => [li.querySelector('.led-title b').textContent.trim(), {
      thumb: Boolean(li.querySelector('.shot-figure.thumb img.shot')), boxes: li.querySelectorAll('.shot-figure.thumb .fault-box').length, title: li.querySelector('.shot-figure')?.title ?? '',
    }])));
    check('ışık listesi: her küçük resimde görüntüde olan element kadar kutu (Font Size 1, beklenen metin 0)', ledBoxes['Telefon 05 ile'].boxes === 1 && ledBoxes['Hata metni yok'].boxes === 1 && ledBoxes['Bekleyiniz yok'].boxes === 1
      && ledBoxes['Küçük yazı yok'].boxes === 1 && ledBoxes['Logo yok'].boxes === 1 && ledBoxes['Teşekkür yazısı'].boxes === 0 && ledBoxes['Teşekkür yazısı'].thumb && ledBoxes['Telefon 05 ile'].title.includes('bozulan: input#phone "Telefon"'), JSON.stringify(ledBoxes));
    const thumbGeometry = await panel.evaluate(() => {
      const li = [...document.querySelectorAll('#monitor-run-list .led-row')].find((x) => x.textContent.includes('Telefon 05 ile'));
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const img = li.querySelector('img.shot');
      return { figure: rect(li.querySelector('.shot-figure')), canvas: rect(li.querySelector('.shot-canvas')), box: rect(li.querySelector('.fault-box')), natural: img.naturalWidth / img.naturalHeight };
    });
    const tg = thumbGeometry;
    check('küçük resim: kenarlığıyla 56×40, görüntü oranı korunarak kırpılı (içini tam kaplar); kutu kırpılmış görüntüde doğru yerde', near(tg.figure.w, 56, 0.5) && near(tg.figure.h, 40, 0.5) && near(tg.canvas.w / tg.canvas.h, tg.natural, 0.02) && near(tg.canvas.h, 38, 0.5) && tg.canvas.w >= 53.5 && near(tg.canvas.y, tg.figure.y + 1, 0.5)
      && near(tg.canvas.x + tg.canvas.w / 2, tg.figure.x + tg.figure.w / 2, 0.5)
      && near(tg.box.x + tg.box.w / 2, tg.canvas.x + tg.canvas.w * ((t1.visible.x + t1.visible.w / 2) / a1.viewport.width), 1) && near(tg.box.y + tg.box.h / 2, tg.canvas.y + tg.canvas.h * ((t1.visible.y + t1.visible.h / 2) / a1.viewport.height), 1), JSON.stringify(tg));
    await shot('isik-listesi', '#replay');

    // ---- "Bozulduğu andaki ekran": Input Validation ----
    await panel.click('#monitor-run-list .led-row:has-text("Telefon 05 ile") img.shot');
    await sleep(300);
    const dialog = () => panel.evaluate(() => {
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const figure = document.getElementById('monitor-shot-figure');
      const img = document.getElementById('monitor-shot-image');
      return {
        open: document.getElementById('monitor-shot-dialog').open, title: document.getElementById('monitor-shot-targets-title').textContent, note: document.getElementById('monitor-shot-targets-note').textContent,
        figureHidden: figure.hidden, img: rect(img), natural: [img.naturalWidth, img.naturalHeight],
        boxes: [...figure.querySelectorAll('.fault-box')].map((b) => ({ ...rect(b), label: b.querySelector('.fault-label')?.textContent ?? '', labelBox: b.querySelector('.fault-label') ? rect(b.querySelector('.fault-label')) : null,
          shown: getComputedStyle(b).display !== 'none', active: b.classList.contains('active'), border: parseFloat(getComputedStyle(b).borderLeftWidth) })),
        rows: [...document.querySelectorAll('#monitor-shot-target-list .fault-item')].map((li) => ({ index: li.querySelector('.fault-index').hidden ? null : li.querySelector('.fault-index').textContent, tag: li.querySelector('.dom-tag').textContent, text: li.querySelector('.dom-text').textContent, key: li.querySelector('code').textContent,
          path: li.querySelector('.fault-path').hidden ? '' : li.querySelector('.fault-path').textContent, note: li.querySelector('.fault-note').hidden ? '' : li.querySelector('.fault-note').textContent, unmarked: li.classList.contains('unmarked'), active: li.classList.contains('active'), zoomed: li.classList.contains('zoomed') })),
        toggleHidden: document.getElementById('monitor-shot-mark').closest('label').hidden, focused: figure.classList.contains('focused'),
        zoomed: figure.classList.contains('zoomed'), figure: { x: figure.getBoundingClientRect().x + figure.clientLeft, y: figure.getBoundingClientRect().y + figure.clientTop, w: figure.clientWidth, h: figure.clientHeight },
      };
    });
    let d = await dialog();
    check('pencere: tek kutu, etiketi elementin adı; altında bozulan element satırı (etiket "metin" anahtar) ve DOM\'daki yeri', d.open && d.title === 'Bozulan element' && d.boxes.length === 1 && d.boxes[0].label === 'input#phone' && d.rows.length === 1
      && d.rows[0].tag === 'input#phone' && d.rows[0].text === '"Telefon"' && d.rows[0].key === 'input:phone' && d.rows[0].path === 'DOM\'daki yeri: form#giris › input#phone' && d.rows[0].index === null && !d.rows[0].unmarked && d.note === '' && !d.toggleHidden, JSON.stringify(d));
    const inner = (box) => ({ x: box.x + box.border, y: box.y + box.border, w: box.w - 2 * box.border, h: box.h - 2 * box.border }); // kenarlık elementin dışında kalır
    const expected = (target, alarm, img) => ({ x: img.x + (target.visible.x / alarm.viewport.width) * img.w, y: img.y + (target.visible.y / alarm.viewport.height) * img.h, w: (target.visible.w / alarm.viewport.width) * img.w, h: (target.visible.h / alarm.viewport.height) * img.h });
    const sameBox = (a, b) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
    check('pencere: kutunun içi, büyütülmüş görüntüde tam elementin alanı; görüntü oranı bozulmamış', sameBox(inner(d.boxes[0]), expected(t1, a1, d.img)) && near(d.img.w / d.img.h, d.natural[0] / d.natural[1], 0.01) && d.img.w > 300, JSON.stringify([inner(d.boxes[0]), expected(t1, a1, d.img), d.img]));
    await shot('pencere-input-validation', '#monitor-shot-dialog');
    // Yan panel genişliğinde (dar): görüntü küçülür, kutu oranla yerinde kalır, etiket görüntünün içinde
    const wide = await panel.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await panel.setViewportSize({ width: 420, height: 860 });
    await sleep(300);
    d = await dialog();
    const within = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
    check('dar panelde (420 px): görüntü panele sığar, kutu yine tam elementin üstünde, etiket görüntünün içinde', d.img.w < 420 && d.img.w > 300 && near(d.img.w / d.img.h, d.natural[0] / d.natural[1], 0.01)
      && sameBox(inner(d.boxes[0]), expected(t1, a1, d.img)) && d.boxes[0].label === 'input#phone' && within(d.boxes[0].labelBox, d.img), JSON.stringify([d.img, inner(d.boxes[0]), expected(t1, a1, d.img), d.boxes[0].labelBox]));
    await shot('pencere-dar-panel');
    // Yakından bakma: dar panelde görüntü küçük; satıra tıklayınca o elemente yakınlaşır, yeniden tıklayınca geri döner
    const fitWidth = d.img.w;
    await panel.click('#monitor-shot-target-list .fault-item >> nth=0');
    await sleep(300);
    d = await dialog();
    check('satıra tıklayınca görüntü elemente yakınlaşır: görüntü büyür, kutu pencerenin içinde ve ortasında, yine tam elementin üstünde', d.zoomed && d.img.w > fitWidth * 2 && within(d.boxes[0], d.figure) && sameBox(inner(d.boxes[0]), expected(t1, a1, d.img))
      && near(d.boxes[0].x + d.boxes[0].w / 2, d.figure.x + d.figure.w / 2, 3) && inner(d.boxes[0]).w > d.figure.w * 0.6 && inner(d.boxes[0]).w <= t1.visible.w + 1 && d.rows[0].zoomed, JSON.stringify([d.zoomed, d.img, d.figure, inner(d.boxes[0])]));
    await shot('pencere-dar-panel-yakin');
    await panel.click('#monitor-shot-figure .fault-box');
    await sleep(200);
    d = await dialog();
    check('kutuya (ya da satıra) yeniden tıklayınca eski haline döner', !d.zoomed && near(d.img.w, fitWidth, 1) && sameBox(inner(d.boxes[0]), expected(t1, a1, d.img)) && !d.rows[0].zoomed, JSON.stringify([d.zoomed, d.img]));
    await panel.setViewportSize(wide);
    await sleep(300);
    await panel.click('#monitor-shot-mark'); // işaretleri kapat
    d = await dialog();
    check('"Görüntüde işaretle" kapatılınca kutu gizlenir (ham görüntü), açılınca geri gelir', d.boxes.length === 1 && !d.boxes[0].shown);
    await panel.click('#monitor-shot-mark');
    check('… açılınca geri gelir', (await dialog()).boxes[0].shown);
    await panel.click('#btn-monitor-shot-close');

    // ---- Font Size: birden çok element, bir kısmı görüntüde değil ----
    await panel.click('#monitor-run-list .led-row:has-text("Küçük yazı yok") img.shot');
    await sleep(300);
    d = await dialog();
    check('pencere (Font Size): başlık "Bozulan elementler (3)", satırlar numaralı; görüntüde olmayan ikisi işaretsiz ve nedeni yazılı', d.title === 'Bozulan elementler (3)' && d.rows.map((r) => r.index).join(',') === '1,2,3' && d.boxes.length === 1 && d.boxes[0].label === '1'
      && d.rows[0].note === '3 pt' && !d.rows[0].unmarked && d.rows[1].unmarked && d.rows[1].note.includes('taşanı gizleyen') && d.rows[2].unmarked && d.rows[2].note.includes('altında') && d.note.includes('2 element o an ekran görüntüsünün içinde değil'), JSON.stringify([d.title, d.rows, d.note]));
    await panel.hover('#monitor-shot-target-list .fault-item >> nth=0');
    d = await dialog();
    check('satırın üzerine gelince kutusu öne çıkar', d.boxes[0].active && d.rows[0].active && d.focused);
    await panel.hover('#monitor-shot-title');
    check('… ayrılınca eski haline döner', !(await dialog()).focused);
    await shot('pencere-font-size', '#monitor-shot-dialog');
    await panel.click('#btn-monitor-shot-close');

    // ---- Expected Image: bölge; Expected Text (olmalı): element yok ----
    await panel.click('#monitor-run-list .led-row:has-text("Logo yok") img.shot');
    await sleep(300);
    d = await dialog();
    check('pencere (Expected Image): "Bozulan bölge", kutu bölgenin üstünde', d.title === 'Bozulan bölge' && d.rows[0].tag === 'ekran bölgesi' && d.rows[0].text === '"64×32 px"' && d.rows[0].note.includes('benzerlik') && sameBox(inner(d.boxes[0]), expected(t5, a5, d.img)), JSON.stringify([d.rows, inner(d.boxes[0]), expected(t5, a5, d.img)]));
    await panel.click('#btn-monitor-shot-close');
    await panel.click('#monitor-run-list .led-row:has-text("Teşekkür yazısı") img.shot');
    await sleep(300);
    d = await dialog();
    check('pencere (beklenen metin yok): kutu ve liste yok, nedeni yazıyor, anahtar gizli; görüntü yine var', d.boxes.length === 0 && d.rows.length === 0 && d.note.includes('beklenen metin ekranda bulunamadığı için') && d.toggleHidden && !d.figureHidden && d.natural[0] > 100, JSON.stringify(d));
    await panel.click('#btn-monitor-shot-close');

    // ---- Monitörler listesi ve uyarı listesi ----
    const listBoxes = await panel.$$eval('#monitors-list .monitor', (els) => Object.fromEntries(els.map((li) => [li.querySelector('b').textContent.trim(), li.querySelectorAll('.alarms .shot-figure.thumb .fault-box').length])));
    check('Monitörler listesi: son uyarının küçük resminde de kutu', listBoxes['Telefon 05 ile'] === 1 && listBoxes['Hata metni yok'] === 1 && listBoxes['Teşekkür yazısı'] === 0, JSON.stringify(listBoxes));
    await panel.evaluate(() => { [...document.querySelectorAll('#monitors-list .monitor')].find((x) => x.textContent.includes('Hata metni yok')).querySelector('.alarms-open').click(); });
    await sleep(300);
    const alarmRows = await panel.$$eval('#monitor-alarms-list .alarm', (els) => els.map((li) => ({ what: li.querySelector('.what').hidden ? '' : li.querySelector('.what').textContent, boxes: li.querySelectorAll('.shot-figure.thumb .fault-box').length, where: li.querySelector('b').textContent })));
    check('uyarı listesi: satırda "Bozulan: …" ve işaretli küçük resim', alarmRows.length === 1 && alarmRows[0].what === 'Bozulan: b#err "500 Internal Server Error"' && alarmRows[0].boxes === 1 && alarmRows[0].where.startsWith('Adım 1'), JSON.stringify(alarmRows));
    await shot('uyari-listesi', '#monitor-alarms-dialog');
    await panel.click('#monitor-alarms-list .alarm img.shot');
    await sleep(300);
    d = await dialog();
    check('uyarı listesinden açılan pencere: Error Text kutusu etiketli (b#err), yeri doğru', d.open && d.boxes[0]?.label === 'b#err' && d.rows[0].path === 'DOM\'daki yeri: p#msg › b#err' && sameBox(inner(d.boxes[0]), expected(t2, a2, d.img)), JSON.stringify([d.rows, d.boxes]));
    await shot('pencere-error-text', '#monitor-shot-dialog');
    await panel.click('#btn-monitor-shot-close');
    await panel.click('#btn-monitor-alarms-done');

    // =========================================================================================
    // 4) ESKİ UYARILAR ve KALICILIK (uyarı sınırı dolmadan: graph başına son 20 uyarı saklanır)
    // =========================================================================================
    // Hata yeri saklanmadan önceki biçimde bir uyarı (targets alanı yok)
    await panel.evaluate(async ([key, shotUrl]) => {
      const data = (await chrome.storage.local.get(key))[key];
      data.items.push({ id: 'a' + data.nextId++, monitorId: 'm6', at: Date.now(), source: 'replay', where: 'Eski uyarı', text: 'eski biçim', url: '', screenshot: shotUrl, step: null, action: null });
      await chrome.storage.local.set({ [key]: data });
    }, ['monitor-alarms:' + graphId, a1.screenshot]);
    await sleep(400);
    await panel.reload();
    await sleep(900);
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    await sleep(300);
    await panel.evaluate(() => { [...document.querySelectorAll('#monitors-list .monitor')].find((x) => x.textContent.includes('Teşekkür yazısı')).querySelector('.alarms-open').click(); });
    await sleep(300);
    const oldRows = await panel.$$eval('#monitor-alarms-list .alarm', (els) => els.map((li) => ({ where: li.querySelector('b').textContent, what: li.querySelector('.what').hidden, boxes: li.querySelectorAll('.fault-box').length })));
    check('eski uyarı (hata yeri alanı yok): listede görüntüsüyle, kutusuz', oldRows[0].where === 'Eski uyarı' && oldRows[0].what && oldRows[0].boxes === 0, JSON.stringify(oldRows));
    await panel.click('#monitor-alarms-list .alarm >> nth=0 >> img.shot');
    await sleep(300);
    d = await dialog();
    check('eski uyarının penceresi: görüntü var, kutu yok, "element bilgisi yok" notu', d.open && d.boxes.length === 0 && d.rows.length === 0 && d.note.includes('bozulan element bilgisi yok') && d.natural[0] > 100, d.note);
    await panel.click('#btn-monitor-shot-close');
    await panel.click('#btn-monitor-alarms-done');
    await panel.evaluate(() => { [...document.querySelectorAll('#monitors-list .monitor')].find((x) => x.textContent.includes('Telefon 05 ile')).querySelector('.alarms-open').click(); });
    await sleep(300);
    await panel.click('#monitor-alarms-list .alarm >> nth=0 >> img.shot');
    await sleep(300);
    d = await dialog();
    check('panel yeniden açılınca: saklanan uyarı kutusuyla ve element satırıyla geri geliyor', d.boxes.length === 1 && d.boxes[0].label === 'input#phone' && d.rows[0].key === 'input:phone' && sameBox(inner(d.boxes[0]), expected(t1, a1, d.img)), JSON.stringify([d.boxes, d.rows]));
    await panel.click('#btn-monitor-shot-close');
    await panel.click('#btn-monitor-alarms-done');

    // =========================================================================================
    // 5) "ŞİMDİ KONTROL ET": kaydırma, yakınlaştırma, çekimin ölçümü tutmadığı durumlar
    // =========================================================================================
    const liveAlarm = async (id) => {
      const before = ((await store('monitor-alarms:' + graphId))['monitor-alarms:' + graphId]).nextId;
      await page.bringToFront();
      await sleep(400);
      await panel.evaluate(() => { document.getElementById('message').textContent = ''; document.getElementById('btn-monitor-check').click(); });
      await panel.waitForFunction(() => document.getElementById('message').textContent.includes('Şimdi kontrol edildi'), null, { timeout: 20000 });
      const now = (await store('monitor-alarms:' + graphId))['monitor-alarms:' + graphId];
      return now.items.find((a) => a.monitorId === id && Number(a.id.slice(1)) >= before && a.source === 'live');
    };
    await page.evaluate(() => scrollTo(0, 40));
    const scrolled = await liveAlarm('m2');
    const ts = scrolled?.targets[0];
    const cs = ts?.visible ? await meanColor(scrolled.screenshot, ts.visible, scrolled.viewport, { inset: 0.1 }) : null;
    check('kaydırılmış sayfa (40 px): kutu yeni yerinde (y 40 px yukarıda), içi yine sarı', Boolean(cs) && near(ts.rect.y, t2.rect.y - 40, 2) && near(ts.rect.x, t2.rect.x) && isYellow(cs), JSON.stringify([ts?.rect, t2.rect, cs]));
    await page.evaluate(() => scrollTo(0, 120)); // hata metni artık görünen alanın üstünde
    const above = (await liveAlarm('m2'))?.targets[0];
    check('hata metni kaydırılıp görünen alanın üstünde kalınca: element yine bulunur, "above" (görüntüde işaretlenmez)', above?.tag === 'b#err' && above.visible === null && above.hidden === 'above' && above.rect.y < 0, JSON.stringify(above));
    await page.evaluate(() => scrollTo(0, 40));
    await panel.evaluate((id) => chrome.tabs.setZoom(id, 1.5), tab.id);
    await sleep(600);
    const zoomed = await liveAlarm('m3');
    const tz = zoomed?.targets[0];
    const cz = tz?.visible ? await meanColor(zoomed.screenshot, tz.visible, zoomed.viewport, { inset: 0.1 }) : null;
    const zoomView = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }));
    check('%150 yakınlaştırma: ölçü alanı küçülür (CSS pikseli), görüntü aynı boyda; kutu oranla yine sözcüğün üstünde (camgöbeği)', Boolean(cz) && zoomed.viewport.width === zoomView.width && zoomView.width < a3.viewport.width && cz.width === c3.width && isCyan(cz), JSON.stringify([zoomed?.viewport, zoomView, tz?.visible, cz]));
    await panel.evaluate((id) => chrome.tabs.setZoom(id, 1), tab.id);
    await sleep(400);
    await page.evaluate(() => scrollTo(0, 0));
    // Dokunmatik yakınlaştırma (pinch ×2) + kaydırma: görüntü, görünen alanın yalnızca yakınlaşılan kısmını gösterir
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await cdp.send('Input.synthesizeScrollGesture', { x: 300, y: 300, xDistance: -80, yDistance: -40, speed: 2000 });
    await sleep(500);
    const pinch = await page.evaluate(() => ({ scale: visualViewport.scale, left: visualViewport.offsetLeft, top: visualViewport.offsetTop, width: innerWidth, dpr: devicePixelRatio, scrollY }));
    const pinched = await liveAlarm('m2');
    const tp = pinched?.targets[0];
    const cp = tp?.visible ? await meanColor(pinched.screenshot, tp.visible, pinched.viewport, { inset: 0.1 }) : null;
    check('dokunmatik yakınlaştırma (×2, kaydırılmış): alan yakınlaşılan kısım (görüntünün yarısı kadar CSS pikseli), kutu ona göre; görüntüde yine hata metninin üstünde (sarı)', pinch.scale === 2 && pinch.left > 0 && Boolean(cp)
      && near(pinched.viewport.width, pinch.width / 2) && near(pinched.viewport.height, cp.height / (2 * pinch.dpr)) && near(tp.rect.x, t2.rect.x - pinch.left, 2) && near(tp.rect.y, t2.rect.y - pinch.top - pinch.scrollY, 2) && isYellow(cp), JSON.stringify([pinch, pinched?.viewport, tp?.rect, cp]));
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await cdp.detach();
    await sleep(300);
    await page.evaluate(() => scrollTo(0, 0));

    // ---- Görüntü, sayfanın ölçtüğü alanın tamamı olmayabilir ----
    // Oynatma kayıttaki pencere boyutunu taklit eder, üstte "hata ayıklama" çubuğu durur: görüntü o zaman sayfanın yalnızca
    // gerçekten görünen kısmıdır (yukarıdaki oynatmada da olur: uyarının alanı 761 yerine 708 çıkabilir). Burada çekim
    // taklit edilir: alttan 60, sağdan 300 px kırpık. Kutu yine elementin üstünde olmalı (ölçek aynı).
    const stubCapture = (crop) => panel.evaluate((cut) => {
      window.realCapture ??= chrome.tabs.captureVisibleTab.bind(chrome.tabs);
      chrome.tabs.captureVisibleTab = !cut ? window.realCapture : async (windowId) => {
        const bitmap = await createImageBitmap(await (await fetch(await window.realCapture(windowId, { format: 'png' }))).blob());
        const canvas = new OffscreenCanvas(bitmap.width - cut.right, bitmap.height - cut.bottom);
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
        return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
      };
      return chrome.tabs.captureVisibleTab !== window.realCapture;
    }, crop);
    check('(test düzeneği) çekim taklit edilebiliyor', await stubCapture({ right: 300, bottom: 60 }) === true);
    const cropped = await liveAlarm('m2');
    const tc = cropped?.targets[0];
    const cc = tc?.visible && cropped.viewport ? await meanColor(cropped.screenshot, tc.visible, cropped.viewport, { inset: 0.1 }) : null;
    const full = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    check('görüntü ölçülen alandan kısa ve darsa: alan görüntünün gösterdiği kadar, kutu yine hata metninin üstünde (sarı)', Boolean(cc) && near(cropped.viewport.width, full.width - 300 / full.dpr, 0.5) && near(cropped.viewport.height, cc.height / full.dpr, 0.5)
      && cropped.viewport.height <= full.height - 60 / full.dpr + 1 && isYellow(cc), JSON.stringify([cropped?.viewport, full, cc]));
    await stubCapture(null);

    // Alanı bilinmeyen uyarı (elementler var, görüntünün hangi kısmı gösterdiği yok): liste var, kutu yok, nedeni yazıyor
    await panel.evaluate(async ([key, shotUrl, target]) => {
      const data = (await chrome.storage.local.get(key))[key];
      data.items.push({ id: 'a' + data.nextId++, monitorId: 'm2', at: Date.now(), source: 'live', where: 'Alansız uyarı', text: 'elle yazıldı', url: '', screenshot: shotUrl, step: null, action: null, targets: [target], more: 0, viewport: null });
      await chrome.storage.local.set({ [key]: data });
    }, ['monitor-alarms:' + graphId, a2.screenshot, t2]);
    await sleep(400);
    await panel.evaluate(() => { [...document.querySelectorAll('#monitors-list .monitor')].find((x) => x.textContent.includes('Hata metni yok')).querySelector('.alarms-open').click(); });
    await sleep(300);
    const newest = await panel.$eval('#monitor-alarms-list .alarm', (li) => ({ where: li.querySelector('b').textContent, boxes: li.querySelectorAll('.fault-box').length, what: li.querySelector('.what').textContent }));
    await panel.click('#monitor-alarms-list .alarm >> nth=0 >> img.shot');
    await sleep(300);
    d = await dialog();
    check('alanı bilinmeyen uyarı: görüntü ve element satırı var, kutu yok, nedeni yazıyor', newest.where === 'Alansız uyarı' && newest.boxes === 0 && newest.what.includes('b#err') && d.boxes.length === 0 && d.rows.length === 1 && d.rows[0].unmarked
      && d.toggleHidden && d.note.includes('hangi kısmını gösterdiği bilinmiyor') && d.natural[0] > 100, JSON.stringify([newest, d.rows, d.note]));
    await panel.click('#btn-monitor-shot-close');
    await panel.click('#btn-monitor-alarms-done');

    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
