// Ekrana bakmayan monitörler (docs/07-monitorler.md > Ekrana bakmayan monitörler): JavaScript Error (olay
// tabanlı) ve Action Timeout (süre tabanlı). İkisi de sayfaya soru sormaz; sonucu oynatmanın kendi verisinden
// çıkar. Hataları bilerek atan ve bilerek takılan yerel bir sitede kayıt yapılır, sonra beş oynatma:
//   1) Normal hızda: hatalar doğru adımda ve doğru aksiyonda yakalanıyor mu (tıklamada atılan hata, yazarken
//      atılan hata, yakalanmayan Promise reddi, son aksiyondan sonra gecikmeyle gelen hata), sayılmaması
//      gerekenler sayılmıyor mu (oynatmadan önceki hata, eklentinin kendi dünyasındaki hata, yok sayma
//      deseni), süreler doğru aksiyona yazılıyor mu (takılan düğme, uzun süren ödeme), uyarıda doğru element
//      işaretleniyor mu (tıklanınca adı değişen düğme: aynı adlı öbür düğme DEĞİL), arayüz.
//   2) Yavaş oynatmada: vurgu ve aralar süreye sayılmıyor (ölçümler normal hızdakine yakın).
//   3) Yarıda kalan adım (element gelmiyor): süre sınırı aşıldıysa kırmızı, hatalar yine değerlendirilir.
//   4) Beklenen ekrana varılamayan adım: süre kırmızı; ekrana bakan node monitörü "kontrol edilemedi".
//   5) Otomatik beklemede fark edilen bozulma (ayrı graph): tıklamadan sonra uzun süre değişen sayfa ve geç atılan
//      hata, tıklamanın arkasındaki beklemenin kontrolünde görülür; uyarının yerinde bekleme değil tıklama yazmalı.
// Kullanım: node tests/e2e/monitor-js-timeout.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = outDir('monitor-js-timeout');

const CSS = '<style>body{margin:0;background:#fff;font:14px sans-serif}h1{margin:20px}button,input{font-size:14px;min-height:28px;min-width:28px}</style>';
const html = (title, body) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title>${CSS}</head><body>${body}</body></html>`;
const BUSY = (ms) => `const t = Date.now(); while (Date.now() - t < ${ms}) {}`; // sayfayı kilitleyen iş (takılan sayfa)
const at = (left, top, color, extra = '') => `position:absolute;left:${left}px;top:${top}px;width:160px;height:40px;box-sizing:border-box;border:0;background:${color};${extra}`;
// Sitenin bozuk halleri (3. ve 4. oynatma): 'no-hesapla' Hesapla düğmesi yok, 'no-nav' Devam hiçbir yere gitmiyor
let broken = null;
const SITE = {
  // Mağaza: yüklenirken bir hata (oynatmadan önce: sayılmamalı); aynı adlı iki "Sepete ekle" düğmesi (kimliksiz:
  // türü yazısından gelir). İlki tıklanınca "Çıkar" olur ve hata atar; takılan "Hesapla"; her tuşta hata atan alan.
  '/': () => html('Magaza', `<h1>Mağaza</h1>
    <script>setTimeout(() => { throw new Error('eski hata: oynatmadan önce'); }, 0);</script>
    <button class="ekle" style="${at(40, 100, '#00c800')}" onclick="this.textContent = 'Çıkar'; throw new Error('Failed to add item to the cart.')">Sepete ekle</button>
    <button class="ekle" style="${at(40, 160, '#ffe600')}">Sepete ekle</button>
    ${broken === 'no-hesapla' ? '' : `<button id="hesapla" style="${at(260, 100, '#00e5ff')}" onclick="${BUSY(1200)}">Hesapla</button>`}
    <input id="name" aria-label="Ad" style="${at(260, 160, '#f0f')}" oninput="window.yok.deger = 1">
    <button id="go" style="position:absolute;left:40px;top:240px" onclick="${broken === 'no-nav' ? '' : "location.href='/odeme'"}">Devam</button>`),
  // Ödeme: yakalanmayan Promise reddi (ekran değişmez); "Öde" sayfayı 8 sn kilitler, sonra Bitti'ye gider
  '/odeme': () => html('Odeme', `<h1>Ödeme</h1>
    <button id="kupon" style="${at(40, 100, '#ffa500')}" onclick="Promise.reject(new Error('kupon reddedildi'))">Kupon</button>
    <button id="ode" style="position:absolute;left:40px;top:180px" onclick="${BUSY(8000)} location.href='/bitti'">Öde</button>`),
  // Bitti: tıklamadan 3 sn sonra hata (son aksiyonun kontrolünden sonra, beklenen ekran beklenirken), 3,5 sn sonra Son
  '/bitti': () => html('Bitti', `<h1>Bitti</h1>
    <button id="son" style="position:absolute;left:40px;top:100px" onclick="setTimeout(() => { throw new Error('geç hata'); }, 3000); setTimeout(() => { location.href = '/son'; }, 3500)">Bitir</button>`),
  '/son': () => html('Son', '<h1>Son</h1><button id="kapat" style="margin:20px">Kapat</button> <button id="yeni" style="margin:20px">Yeni sipariş</button>'),
  // Yükle (5. oynatma): tıklanınca sayfa 6 sn boyunca değişir (sayaç), 4,5 sn'de bir hata atar, sonunda "Tamam" düğmesi
  // gelir. Oynatma her aksiyondan sonra sayfanın durulmasını en fazla 3 sn bekler: tıklamanın kendi kontrolünde süre
  // ~3 sn'dir ve hata henüz atılmamıştır; ikisi de arkasındaki otomatik beklemenin kontrolünde görülür.
  '/yukle': () => html('Yukle', `<h1>Yükle</h1><p id="sayac">0</p>
    <button id="yukle" style="${at(40, 100, '#00c800')}" onclick="yukle()">Yükle</button>
    <script>function yukle() {
      const started = Date.now();
      const tick = setInterval(() => {
        document.getElementById('sayac').textContent = Date.now() - started;
        if (Date.now() - started < 6000) return;
        clearInterval(tick);
        document.body.insertAdjacentHTML('beforeend', '<button id="tamam" style="position:absolute;left:260px;top:100px">Tamam</button>');
      }, 100);
      setTimeout(() => { throw new Error('geç yükleme hatası'); }, 4500);
    }</script>`),
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;
// "… 1,2 sn sürdü …" → 1.2
const seconds = (text, pattern) => { const found = pattern.exec(text ?? ''); return found ? Number(found[1].replace(',', '.')) : NaN; };

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    const page = SITE[req.url.split('?')[0]];
    if (!page) { res.statusCode = 404; res.end('yok'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(page());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-monitor-js-timeout-')), {
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
    // Görüntüde bir kutunun içindeki ortalama renk (box ve viewport aynı birimde, uyarıda saklandığı gibi)
    const meanColor = (dataUrl, box, viewport, inset = 0.25) => panel.evaluate(async ([url, b, v, k]) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = canvas.getContext('2d');
      g.drawImage(bitmap, 0, 0);
      const sx = bitmap.width / v.width, sy = bitmap.height / v.height;
      const d = g.getImageData(Math.round((b.x + b.w * k) * sx), Math.round((b.y + b.h * k) * sy), Math.max(1, Math.round(b.w * (1 - 2 * k) * sx)), Math.max(1, Math.round(b.h * (1 - 2 * k) * sy))).data;
      let r = 0, gr = 0, bl = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; bl += d[i + 2]; }
      const n = d.length / 4;
      return { r: Math.round(r / n), g: Math.round(gr / n), b: Math.round(bl / n) };
    }, [dataUrl, box, viewport, inset]);
    const isGreen = (c) => c.g > 150 && c.r < 100 && c.b < 100;
    const isCyan = (c) => c.r < 110 && c.g > 150 && c.b > 150;
    const isMagenta = (c) => c.r - c.g > 60 && c.b - c.g > 60;
    const isOrange = (c) => c.r > 180 && c.g > 110 && c.g < 210 && c.b < 110;

    // =========================================================================================
    // KAYIT: Mağaza → Ödeme → Bitti → Son
    // =========================================================================================
    await createNode();
    await page.locator('.ekle').first().click(); // hata atar, yazısı "Çıkar" olur
    await page.click('#hesapla');                 // 1,2 sn takılır
    await page.fill('#name', 'Ali');              // her tuşta TypeError
    await page.click('#go');
    await page.waitForURL(base + '/odeme');
    await createNode();
    await page.click('#kupon');                   // yakalanmayan Promise reddi
    await page.click('#ode');                     // 8 sn takılır, sonra gider
    await page.waitForURL(base + '/bitti', { timeout: 20000 });
    await createNode();
    await page.click('#son');                     // 3 sn sonra hata, 3,5 sn sonra gider
    await page.waitForURL(base + '/son', { timeout: 20000 });
    await createNode();
    const s = await getState();
    const node = (name) => s.nodes.find((n) => n.name === name);
    const [nMagaza, nOdeme, nBitti, nSon] = ['v_Magaza', 'v_Odeme', 'v_Bitti', 'v_Son'].map(node);
    const e1 = s.edges.find((e) => e.source === nMagaza?.id);
    const e2 = s.edges.find((e) => e.source === nOdeme?.id);
    const e3 = s.edges.find((e) => e.source === nBitti?.id);
    // Bazı ortamlarda pencere boyutu değişimi de kaydedilir ('resize'); aksiyonların sırası bu yüzden kayıttan okunur
    const kinds = (edge) => (edge?.actions ?? []).filter((a) => a.type !== 'wait' && a.type !== 'resize').map((a) => a.type).join(' ');
    const waited = (edge) => (edge?.actions ?? []).every((a, i) => a.type === 'wait' || edge.actions[i + 1]?.type === 'wait');
    check('kayıt: 4 node, 3 edge (Mağaza: tıkla, tıkla, yaz, tıkla); her aksiyonun arkasında otomatik bekleme', s.nodes.length === 4 && s.edges.length === 3 && Boolean(nMagaza && nOdeme && nBitti && nSon)
      && kinds(e1) === 'click click input click' && kinds(e2) === 'click click' && kinds(e3) === 'click' && [e1, e2, e3].every(waited), [e1, e2, e3].map((e) => (e?.actions ?? []).map((a) => a.type).join(' ')).join(' | '));
    const real = (edge, k) => edge.actions.map((a, i) => (a.type !== 'wait' && a.type !== 'resize' ? i : -1)).filter((i) => i >= 0)[k]; // k'inci gerçek aksiyonun sırası
    const [iEkle, iHesapla, iName, iGo] = [0, 1, 2, 3].map((k) => real(e1, k));
    const [iKupon, iOde] = [0, 1].map((k) => real(e2, k));
    const iSon = real(e3, 0);
    const nth = (edge, i) => `${i + 1}/${edge.actions.length}`; // "3/8"
    check('ilk "Sepete ekle"nin kaydı: türü yazısından ("button:Sepete ekle"), ekrandaki 1.si', e1.actions[iEkle].target?.key === 'button:Sepete ekle' && e1.actions[iEkle].target.index === 1, JSON.stringify(e1.actions[iEkle].target));
    const label = (edge, i) => edge.actions[i].label;
    const ref = (edge, i) => panel.evaluate(([id, index]) => { const e = state.edges.find((x) => x.id === id); return monitorActionRef(e.actions[index], index, e.actions); }, [edge.id, i]);

    // =========================================================================================
    // MONİTÖRLER (storage'a doğrudan; form aşağıda ayrıca sınanıyor)
    // =========================================================================================
    const M = (id, type, scope, params, extra = {}) => ({ id, type, scope, params, severity: 'error', enabled: true, name: null, ...extra });
    const items = [
      M('j1', 'jsError', 'global', { ignore: '' }, { name: 'JS hata yok' }),
      M('j2', 'jsError', 'global', { ignore: 'FAILED TO ADD|reddedildi' }, { name: 'JS hata yok (bilinenler hariç)' }),
      M('j3', 'jsError', e1.id, { ignore: '' }, { name: 'Devam tıklanırken hata yok', action: await ref(e1, iGo) }),
      M('j4', 'jsError', e1.id, { ignore: '' }, { name: 'Eklerken hata yok', action: await ref(e1, iEkle) }),
      M('j5', 'jsError', nOdeme.id, { ignore: '' }, { name: 'Ödemeye varan adımda hata yok' }),
      M('t1', 'actionTimeout', 'global', { maxSeconds: 6 }, { name: 'Aksiyon en fazla 6 sn' }),
      M('t2', 'actionTimeout', e1.id, { maxSeconds: 1 }, { name: 'Hesapla en fazla 1 sn', action: await ref(e1, iHesapla) }),
      M('t3', 'actionTimeout', e1.id, { maxSeconds: 30 }, { name: 'Devam en fazla 30 sn', action: await ref(e1, iGo) }),
      M('t4', 'actionTimeout', nBitti.id, { maxSeconds: 2 }, { name: 'Bitti\'ye varan adım hızlı' }),
      M('t5', 'actionTimeout', e1.id, { maxSeconds: 5 }, { name: 'Beklemeye bağlı süre', action: await ref(e1, iEkle + 1) }),
      M('t6', 'actionTimeout', 'global', { maxSeconds: 30 }, { name: 'Aksiyon en fazla 30 sn' }),
      M('s1', 'errorText', 'global', { pattern: '\\b500\\b' }, { name: 'Ekranda 500 yok' }),
      M('s2', 'errorText', nOdeme.id, { pattern: '\\b500\\b' }, { name: 'Ödeme ekranında 500 yok' }),
    ];
    const graphId = await activeId();
    await panel.evaluate(([key, list]) => chrome.storage.local.set({ [key]: { format: 'graph-recorder-monitors/v1', nextId: 100, items: list } }), ['monitors:' + graphId, items]);
    await sleep(400);
    await panel.evaluate(() => { document.getElementById('monitors').open = true; });
    const listed = await panel.$$eval('#monitors-list .monitor', (els) => els.map((li) => ({ name: li.querySelector('b').textContent, scope: li.querySelector('.scope').textContent, params: li.querySelector('.params').textContent })));
    const lm = (name) => listed.find((x) => x.name.includes(name));
    check('Monitörler listesi: 13 monitör; satırda kontrol biçimi ("Olay tabanlı" / "Süre tabanlı") ve parametreler', listed.length === 13 && lm('JS hata yok (bilinenler').params === 'Olay tabanlı · Yok sayılacak hatalar (desen): FAILED TO ADD|reddedildi'
      && lm('JS hata yok').params.startsWith('Olay tabanlı') && lm('Aksiyon en fazla 6').params === 'Süre tabanlı · En fazla (saniye): 6' && lm('Hesapla en fazla').scope === `Edge: ${e1.name} · ${iHesapla + 1}. Tıkla Hesapla`, JSON.stringify(listed.map((x) => [x.name, x.scope, x.params])));

    // Senaryo: üç edge tek koşu
    await panel.evaluate(async (ids) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Sipariş', planner: { engine: 'manual' }, runs: [ids] });
      scenarioRun = 0;
      renderScenario();
      showView(null); // Ana graph sekmesi: monitörler listesi genel kurallar
    }, [e1.id, e2.id, e3.id]);
    await sleep(300);

    // Oynatma: Mağaza sayfası yeniden yüklenir (ilk düğme yine "Sepete ekle"), seçili koşu oynatılır
    const play = async ({ slow = false, start = '/' } = {}) => {
      await page.goto(base + start);
      await page.bringToFront();
      await sleep(800);
      await panel.evaluate((isSlow) => { replayResult = null; document.getElementById('replay-slow').checked = isSlow; document.getElementById('btn-replay').click(); }, slow);
      await panel.waitForFunction(() => {
        const cleanup = document.getElementById('cleanup-dialog');
        if (cleanup?.open) { document.getElementById('btn-cleanup-skip').click(); return false; }
        return Boolean(replay) || !document.getElementById('replay-check').hidden;
      }, null, { timeout: 15000 }).catch(() => {});
      await sleep(400);
      if (await panel.evaluate(() => !document.getElementById('replay-check').hidden)) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
      await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 120000 });
      await sleep(400);
      return panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}`), durations: replayResult.steps.map((x) => x.duration) }));
    };
    const ledRows = async () => {
      const rows = await panel.$$eval('#monitor-run-list .led-row', (els) => els.map((li) => ({
        status: li.className.replace('led-row ', ''),
        name: li.querySelector('.led-title b').textContent,
        trail: [...li.querySelectorAll('.trail i')].map((i) => i.className),
        titles: [...li.querySelectorAll('.trail i')].map((i) => i.title),
        detail: li.querySelector('.detail').textContent,
        shot: Boolean(li.querySelector('img.shot')),
        boxes: li.querySelectorAll('.fault-box').length,
        thumbTitle: li.querySelector('.shot-figure')?.title ?? '',
      })));
      return (name) => rows.find((r) => r.name.includes(name));
    };
    const alarmsNow = async (id = graphId) => (await store('monitor-alarms:' + id))['monitor-alarms:' + id]?.items ?? [];

    // Eklentinin kendi dünyasında (content script'lerin çalıştığı ortam) bir hata: Mağaza'da "Sepete ekle"ye tıklanınca
    // atılır. Sayfanın hatası değildir, sayılmamalı. Test, sayfaya ikinci bir DevTools oturumuyla bağlanıp dinleyiciyi
    // o ortama kurar ve hatanın gerçekten atıldığını kendi oturumundan görür.
    const cdp = await ctx.newCDPSession(page);
    let worlds = [];
    const seen = [];
    cdp.on('Runtime.executionContextsCleared', () => { worlds = []; });
    cdp.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
    cdp.on('Runtime.exceptionThrown', (e) => seen.push(String(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text).split('\n')[0]));
    await cdp.send('Runtime.enable');
    const plantForeignError = async () => {
      await sleep(300);
      const world = worlds.filter((w) => w.auxData?.type === 'isolated' && String(w.origin).startsWith('chrome-extension://')).at(-1);
      if (!world) return false;
      await cdp.send('Runtime.evaluate', { contextId: world.id, expression: 'document.addEventListener("click", (e) => { if (e.target.classList && e.target.classList.contains("ekle")) throw new Error("eklenti dünyasında hata"); }, true); 1' });
      return true;
    };

    // =========================================================================================
    // 1) NORMAL HIZDA OYNATMA
    // =========================================================================================
    page.once('load', () => {}); // (yüklenme oynatmanın içinde beklenir)
    const planted = (async () => { for (let i = 0; i < 50; i++) { await sleep(100); if ((await page.title()) === 'Magaza' && await plantForeignError()) return true; } return false; })();
    const run1Promise = play();
    check('eklentinin dünyasına hata atan dinleyici kuruldu (oynatma başlamadan)', await planted);
    const run1 = await run1Promise;
    check('Emir\'in oynatması geçti: monitörler adımı bozmaz', run1.status === 'passed' && run1.steps.length === 3, JSON.stringify(run1));
    check('eklentinin dünyasındaki hata gerçekten atıldı (testin kendi oturumu gördü), sayfanın hataları da', seen.includes('Error: eklenti dünyasında hata') && seen.includes('Error: Failed to add item to the cart.') && seen.some((x) => x.startsWith('TypeError')), seen.join(' | '));
    await shot('1-oynatma-sonu', '#replay');
    let row = await ledRows();
    const summary1 = await text('#monitor-run-summary');
    check('ışık listesi: 13 monitör; 7 kırmızı (j1, j2, j4, j5, t1, t2, t4), 6 yeşil', summary1 === '13 monitör · 7 kırmızı · 6 yeşil', summary1);

    // ---- JavaScript Error: tüm model ----
    const j1 = row('JS hata yok');
    check('j1 (tüm model): üç adımda da kırmızı; ayrıntı ilk bozulan adımı, aksiyonu ve konsoldaki hata satırını söylüyor', j1.status === 'fail' && j1.trail.join(',') === 'fail,fail,fail'
      && j1.detail.startsWith(`Adım 1 (${e1.name} → v_Odeme) · aksiyon ${nth(e1, iEkle)}: ${label(e1, iEkle)}: JavaScript hatası: "Uncaught Error: Failed to add item to the cart." (sayfa:`), j1.detail);
    check('j1 adım 1: TEK hata sayıldı: oynatmadan önceki hata ("eski hata") ve eklentinin dünyasındaki hata sayılmadı', !j1.titles[0].includes('eski hata') && !j1.titles[0].includes('eklenti') && !/\d+ JavaScript hatası/.test(j1.titles[0]), j1.titles[0]);
    check('j1 adım 2: yakalanmayan Promise reddi, Kupon aksiyonunda; yeri sayfanın adıyla ("odeme:satır:sütun")', j1.titles[1].includes(`aksiyon ${nth(e2, iKupon)}: Kupon`) && /JavaScript hatası: "Uncaught \(in promise\) Error: kupon reddedildi" \(odeme:\d+:\d+\)$/.test(j1.titles[1]), j1.titles[1]);
    check('j1 adım 3: son aksiyondan sonra gelen hata adımın sonunda yakalandı (aksiyon değil, adım)', j1.titles[2].startsWith(`Adım 3 (${e3.name} → v_Son): JavaScript hatası: "Uncaught Error: geç hata"`), j1.titles[2]);
    // ---- JavaScript Error: yok sayma deseni ----
    const j2 = row('bilinenler hariç');
    check('j2 (yok sayma deseni, harf duyarsız): adım 1\'de eklerken atılan hata sayılmadı; yazarken atılan TypeError yakalandı (yazma aksiyonunda), not düşüldü', j2.trail.join(',') === 'fail,ok,fail'
      && j2.titles[0].includes(`aksiyon ${nth(e1, iName)}: ${label(e1, iName)}`) && j2.titles[0].includes('JavaScript hatası: "Uncaught TypeError: Cannot set properties of undefined (setting \'deger\')"') && j2.titles[0].endsWith('(1 hata yok sayıldı: desene uyuyor)'), j2.titles[0]);
    check('j2 adım 2: tek hata desene uyuyor: yeşil, sayılmadığı yazılı; adım 3: desene uymayan geç hata kırmızı', j2.titles[1].endsWith('JavaScript hatası yok (1 hata yok sayıldı: desene uyuyor)') && j2.titles[2].includes('geç hata'), j2.titles[1]);
    // ---- JavaScript Error: aksiyona ve node'a bağlı ----
    const j3 = row('Devam tıklanırken');
    const j4 = row('Eklerken hata yok');
    const j5 = row('Ödemeye varan');
    check('j3 (Devam aksiyonuna bağlı): o aksiyon oynatılırken hata yok: yeşil (önceki aksiyonların hataları onun değil)', j3.status === 'ok' && j3.trail.join(',') === 'ok' && j3.detail.includes('JavaScript hatası yok'), j3.detail);
    check('j4 (Sepete ekle aksiyonuna bağlı): kırmızı, yalnızca o aksiyonun hatası', j4.status === 'fail' && j4.detail.includes(`aksiyon ${nth(e1, iEkle)}`) && j4.detail.includes('Failed to add item to the cart.') && !/\d+ JavaScript hatası/.test(j4.detail), j4.detail);
    check('j5 (Ödeme node\'una bağlı): yalnızca o node\'a varan adımda (adım 1) değerlendirildi, kırmızı', j5.status === 'fail' && j5.trail.join(',') === 'fail' && j5.detail.startsWith('Adım 1'), j5.detail);

    // ---- Action Timeout ----
    const t1 = row('Aksiyon en fazla 6');
    check('t1 (tüm model, 6 sn): adım 1 ve 3 yeşil, adım 2 kırmızı: 8 sn takılan "Öde" aksiyonu, bittiği anda', t1.status === 'fail' && t1.trail.join(',') === 'ok,fail,ok'
      && new RegExp(`aksiyon ${nth(e2, iOde)}: Öde: süre aşıldı: aksiyon ${nth(e2, iOde)} "Öde" \\d+,?\\d* sn sürdü \\(sınır 6 sn\\)`).test(t1.titles[1]), t1.titles.join(' | '));
    const odeSeconds = seconds(t1.titles[1], /"Öde" (\d+,?\d*) sn sürdü/);
    check('t1: "Öde"nin ölçülen süresi sayfanın kilitli kaldığı 8 sn\'yi kapsıyor (8–11 sn)', odeSeconds >= 8 && odeSeconds < 11, String(odeSeconds));
    check('t1 yeşil adımlar: en uzun aksiyon ve adımın toplamı yazılı; adım 1\'in en uzunu takılan "Hesapla" (1,2 sn kilit)', new RegExp(`en uzun aksiyon \\d+,?\\d* sn sürdü \\(aksiyon ${nth(e1, iHesapla)} "Hesapla"; sınır 6 sn\\) · adım toplam \\d+,?\\d* sn$`).test(t1.titles[0])
      && seconds(t1.titles[0], /en uzun aksiyon (\d+,?\d*) sn/) >= 1.2 && /en uzun aksiyon \d+,?\d* sn sürdü \(aksiyon \d+\/\d+ "[^"]+"; sınır 6 sn\) · adım toplam/.test(t1.titles[2]), `${t1.titles[0]} | ${t1.titles[2]}`);
    const t2 = row('Hesapla en fazla');
    check('t2 (Hesapla aksiyonuna bağlı, 1 sn): kırmızı, aksiyon bittiği anda', t2.status === 'fail' && new RegExp(`aksiyon ${nth(e1, iHesapla)}: Hesapla: süre aşıldı: aksiyon ${nth(e1, iHesapla)} "Hesapla" \\d+,?\\d* sn sürdü \\(sınır 1 sn\\)`).test(t2.detail), t2.detail);
    const t3 = row('Devam en fazla');
    check('t3 (Devam aksiyonuna bağlı, 30 sn): yeşil, aksiyonun süresi yazılı', t3.status === 'ok' && /aksiyon \d+,?\d* sn sürdü \(sınır 30 sn\)/.test(t3.detail), t3.detail);
    const t4 = row('varan adım hızlı');
    check('t4 (Bitti node\'una bağlı, 2 sn): yalnızca adım 2\'de, kırmızı', t4.status === 'fail' && t4.trail.join(',') === 'fail' && t4.detail.startsWith('Adım 2') && t4.detail.includes('"Öde"'), t4.detail);
    const t5 = row('Beklemeye bağlı');
    check('t5 (bir beklemeye bağlı): yeşil ama kontrol edilemedi: beklemenin süresi ölçülmez', t5.status === 'ok' && t5.detail.includes('bekleme aksiyonu: süresi kayıttan gelir, ölçülmez'), t5.detail);
    const t6 = row('Aksiyon en fazla 30');
    check('t6 (tüm model, 30 sn): üç adımda yeşil; adım 2\'nin en uzunu "Öde"', t6.status === 'ok' && t6.trail.join(',') === 'ok,ok,ok' && new RegExp(`en uzun aksiyon \\d+,?\\d* sn sürdü \\(aksiyon ${nth(e2, iOde)} "Öde"; sınır 30 sn\\)`).test(t6.titles[1]), t6.titles.join(' | '));
    const fastTimes = [0, 1, 2].map((i) => ({ slowest: seconds(t6.titles[i], /en uzun aksiyon (\d+,?\d*) sn/), total: seconds(t6.titles[i], /adım toplam (\d+,?\d*) sn/) }));
    check('ölçülen toplam, Emir\'in ölçtüğü adım süresini aşmıyor (monitör kontrolleri ve beklemeler sayılmaz) ve boş değil', fastTimes.every((t, i) => t.total > 0.5 && t.total * 1000 <= run1.durations[i] + 100), JSON.stringify([fastTimes, run1.durations]));
    check('ekrana bakan monitörler etkilenmedi: s1 üç adımda, s2 adım 1\'de yeşil', row('Ekranda 500 yok').trail.join(',') === 'ok,ok,ok' && row('Ödeme ekranında').trail.join(',') === 'ok');

    // ---- Uyarılar: doğru an, doğru element ----
    const alarms = await alarmsNow();
    const alarmsOf = (id) => alarms.filter((a) => a.monitorId === id);
    check('uyarılar: j1 3, j2 2, j4 1, j5 1, t1 1, t2 1, t4 1; hepsi görüntülü', ['j1', 'j2', 'j4', 'j5', 't1', 't2', 't4'].map((id) => alarmsOf(id).length).join(',') === '3,2,1,1,1,1,1' && alarms.length === 10 && alarms.every((a) => a.screenshot?.startsWith('data:image/jpeg')), JSON.stringify(alarms.map((a) => [a.monitorId, a.where])));
    const a1 = alarmsOf('j1')[0];
    const target1 = a1.targets?.[0];
    check('j1 adım 1 uyarısı: Mağaza sayfasında, ilk aksiyonda; işaretlenen element TIKLANAN düğme (artık "Çıkar"), aynı adlı öbür düğme değil', a1.url === base + '/' && a1.action?.index === iEkle && a1.targets.length === 1
      && target1.tag === 'button' && target1.text === 'Çıkar' && target1.key === 'button:Çıkar' && target1.note === 'hata bu aksiyon oynatılırken oluştu' && near(target1.rect.x, 40) && near(target1.rect.y, 100) && near(target1.rect.w, 160) && near(target1.rect.h, 40), JSON.stringify(target1));
    check('GÖRÜNTÜDE DOĞRULAMA: kutunun içi tıklanan düğmenin yeşil zemini (öbür düğme sarı)', isGreen(await meanColor(a1.screenshot, target1.visible, a1.viewport)), JSON.stringify(await meanColor(a1.screenshot, target1.visible, a1.viewport)));
    const a2 = alarmsOf('j1')[1];
    check('j1 adım 2 uyarısı: Ödeme sayfasında, Kupon düğmesi işaretli (turuncu zemin)', a2.url === base + '/odeme' && a2.targets?.[0]?.tag === 'button#kupon' && isOrange(await meanColor(a2.screenshot, a2.targets[0].visible, a2.viewport)), JSON.stringify(a2.targets));
    const a3 = alarmsOf('j1')[2];
    check('j1 adım 3 uyarısı: adımın sonunda (aksiyonsuz), Son sayfasında; aksiyonun elementi artık ekranda değil: element yok', a3.action === null && a3.url === base + '/son' && Array.isArray(a3.targets) && a3.targets.length === 0 && a3.where === `Adım 3 (${e3.name} → v_Son)`, JSON.stringify([a3.where, a3.url, a3.targets]));
    const aName = alarmsOf('j2')[0];
    check('j2 uyarısı: yazarken atılan hata; işaretlenen element yazılan alan (eflatun zemin), adıyla (değeriyle değil)', aName.action?.index === iName && aName.targets?.[0]?.tag === 'input#name' && aName.targets[0].text === 'Ad' && aName.targets[0].key === 'input:name'
      && isMagenta(await meanColor(aName.screenshot, { ...aName.targets[0].visible, x: aName.targets[0].visible.x + aName.targets[0].visible.w * 0.5, w: aName.targets[0].visible.w * 0.5 }, aName.viewport)), JSON.stringify(aName.targets));
    const aSlow = alarmsOf('t2')[0];
    check('t2 uyarısı: takılan "Hesapla" düğmesi işaretli (camgöbeği zemin), notu "süresi sınırı aşan aksiyon"', aSlow.action?.index === iHesapla && aSlow.targets?.[0]?.tag === 'button#hesapla' && aSlow.targets[0].note === 'süresi sınırı aşan aksiyon' && isCyan(await meanColor(aSlow.screenshot, aSlow.targets[0].visible, aSlow.viewport)), JSON.stringify(aSlow.targets));
    const aPay = alarmsOf('t1')[0];
    check('t1 uyarısı: "Öde" bittiği anda; sayfa çoktan Bitti\'ye geçti, düğme ekranda yok: element yok', aPay.action?.index === iOde && aPay.url === base + '/bitti' && Array.isArray(aPay.targets) && aPay.targets.length === 0, JSON.stringify([aPay.url, aPay.targets]));

    // ---- Arayüz: küçük resim, "Bozulduğu andaki ekran" penceresi, uyarı listesi ----
    check('ışık listesinde küçük resim: aksiyonun elementi kutuyla işaretli, başlık "aksiyonun elementi" diyor ("bozulan" değil)', j1.shot && j1.boxes === 1 && j1.thumbTitle.includes('aksiyonun elementi: button "Çıkar"') && !j1.thumbTitle.includes('bozulan'), j1.thumbTitle);
    await panel.evaluate(() => { [...document.querySelectorAll('#monitor-run-list .led-row')].find((x) => x.textContent.includes('JS hata yok') && !x.textContent.includes('bilinenler')).querySelector('.shot-figure').click(); });
    await sleep(300);
    const dialog = await panel.evaluate(() => ({
      open: document.getElementById('monitor-shot-dialog').open,
      title: document.getElementById('monitor-shot-targets-title').textContent,
      text: document.getElementById('monitor-shot-text').textContent,
      rows: [...document.querySelectorAll('#monitor-shot-target-list .fault-item')].map((li) => li.textContent),
      note: document.getElementById('monitor-shot-targets-note').textContent,
      boxes: document.querySelectorAll('#monitor-shot-figure .fault-box').length,
    }));
    check('pencere: başlık "Aksiyonun elementi"; satırda element ve neden gösterildiği; altında açıklama', dialog.open && dialog.title === 'Aksiyonun elementi' && dialog.boxes === 1 && dialog.rows.length === 1 && dialog.rows[0].includes('button') && dialog.rows[0].includes('"Çıkar"')
      && dialog.rows[0].includes('hata bu aksiyon oynatılırken oluştu') && dialog.note.startsWith('Bu monitör ekrandaki bir elemente bakmaz; gösterilen, ilgili aksiyonun elementidir.') && dialog.text.includes('Failed to add item to the cart.'), JSON.stringify(dialog));
    await shot('1-pencere-aksiyonun-elementi');
    await panel.click('#btn-monitor-shot-close');
    await panel.evaluate(() => { [...document.querySelectorAll('#monitor-run-list .led-row')].find((x) => x.textContent.includes('Aksiyon en fazla 6')).querySelector('.shot-figure').click(); });
    await sleep(300);
    const dialogNone = await panel.evaluate(() => ({ title: document.getElementById('monitor-shot-targets-title').textContent, rows: document.querySelectorAll('#monitor-shot-target-list .fault-item').length, note: document.getElementById('monitor-shot-targets-note').textContent }));
    check('pencere (element yok): nedeni yazılı (aksiyon ekranı değiştirdi)', dialogNone.title === 'Aksiyonun elementi' && dialogNone.rows === 0 && dialogNone.note.startsWith('İşaretlenecek element yok: bu monitör ekrandaki bir elemente bakmaz') && dialogNone.note.includes('aksiyon ekranı değiştirdi'), JSON.stringify(dialogNone));
    await panel.click('#btn-monitor-shot-close');
    await panel.evaluate(() => { [...document.querySelectorAll('#monitors-list .monitor')].find((x) => x.querySelector('b').textContent.includes('Hesapla en fazla')).querySelector('.alarms-open').click(); });
    await sleep(200);
    const alarmRow = await panel.evaluate(() => [...document.querySelectorAll('#monitor-alarms-list .alarm')].map((li) => ({ where: li.querySelector('b').textContent, why: li.querySelector('.why').textContent, what: li.querySelector('.what').textContent })));
    check('uyarı listesi: yer (adım + aksiyon), neden (ölçülen süre) ve "Aksiyonun elementi: …"', alarmRow.length === 1 && alarmRow[0].where.includes(`aksiyon ${nth(e1, iHesapla)}: Hesapla`) && alarmRow[0].why.startsWith(`süre aşıldı: aksiyon ${nth(e1, iHesapla)} "Hesapla"`) && alarmRow[0].what === 'Aksiyonun elementi: button#hesapla "Hesapla"', JSON.stringify(alarmRow));
    await shot('1-uyari-listesi');
    await panel.click('#btn-monitor-alarms-done');
    const lastChecks = await panel.$$eval('#monitors-list .monitor', (els) => els.map((li) => ({ name: li.querySelector('b').textContent, led: li.querySelector('.verdict .led')?.className.replace('led ', '') ?? null, text: li.querySelector('.verdict')?.textContent ?? '' })));
    const lc = (name) => lastChecks.find((x) => x.name.includes(name));
    check('Monitörler listesi: "Son kontrol … (son oynatma)" yeni türlerde de', lc('JS hata yok').led === 'fail' && lc('JS hata yok').text.includes('(son oynatma)') && lc('Aksiyon en fazla 30').led === 'ok' && lc('Aksiyon en fazla 30').text.includes('3 adımda kontrol edildi, bozulma yok'), JSON.stringify(lc('Aksiyon en fazla 30')));

    // ---- "Bu ekranda şimdi kontrol et": ekrana bakmayan monitörler atlanır, son oynatma sonuçları kalır ----
    await page.bringToFront();
    await panel.click('#btn-monitor-check');
    await panel.waitForFunction(() => document.getElementById('message').textContent.includes('Şimdi kontrol edildi'), null, { timeout: 15000 });
    const liveMessage = await text('#message');
    const afterLive = await panel.$$eval('#monitors-list .monitor', (els) => els.map((li) => ({ name: li.querySelector('b').textContent, text: li.querySelector('.verdict')?.textContent ?? '' })));
    check('şimdi kontrol: yalnızca ekrana bakan monitör kontrol edildi (1 yeşil); 4 tüm model monitörü atlandı ve sonuçları silinmedi', liveMessage.startsWith('Şimdi kontrol edildi: 1 yeşil (4 monitör yalnızca oynatmada kontrol edilir; atlandı)')
      && afterLive.find((x) => x.name.includes('JS hata yok')).text.includes('(son oynatma)') && afterLive.find((x) => x.name.includes('Aksiyon en fazla 30')).text.includes('(son oynatma)') && afterLive.find((x) => x.name.includes('Ekranda 500 yok')).text.includes('(şimdi'), liveMessage);
    check('şimdi kontrol yeni uyarı üretmedi', (await alarmsNow()).length === 10);

    // =========================================================================================
    // 2) YAVAŞ OYNATMA: vurgu (0,5 sn) ve aralar (0,4 sn) süreye sayılmaz
    // =========================================================================================
    const run2 = await play({ slow: true });
    row = await ledRows();
    const t6slow = row('Aksiyon en fazla 30');
    const slowTimes = [0, 1, 2].map((i) => ({ slowest: seconds(t6slow.titles[i], /en uzun aksiyon (\d+,?\d*) sn/), total: seconds(t6slow.titles[i], /adım toplam (\d+,?\d*) sn/) }));
    check('yavaş oynatma geçti; gerçekte belirgin biçimde uzun sürdü (adım 1: 8 aksiyon × ara + vurgular)', run2.status === 'passed' && run2.durations[0] > run1.durations[0] + 3000, JSON.stringify([run1.durations, run2.durations]));
    check('yavaş oynatmada ölçülen süreler normal hızdakine yakın: vurgu ve aralar sayılmadı (adım 1 toplamı en çok 1 sn fazla; gerçekte 3+ sn uzadı)', slowTimes.every((t) => t.total > 0.3) && slowTimes[0].total < fastTimes[0].total + 1 && slowTimes[1].total < fastTimes[1].total + 1 && slowTimes[2].total < fastTimes[2].total + 1, JSON.stringify([fastTimes, slowTimes, run2.durations]));
    check('yavaş oynatmada sonuçlar aynı: t1 [yeşil, kırmızı, yeşil], t2 kırmızı (Hesapla 1,2 sn kilitli), t6 yeşil; j1 üç adımda kırmızı, j3 yeşil', row('Aksiyon en fazla 6').trail.join(',') === 'ok,fail,ok' && row('Hesapla en fazla').status === 'fail' && t6slow.trail.join(',') === 'ok,ok,ok'
      && row('JS hata yok').trail.join(',') === 'fail,fail,fail' && row('Devam tıklanırken').status === 'ok', [row('Aksiyon en fazla 6').trail.join(','), row('Hesapla en fazla').detail].join(' | '));
    check('yavaş oynatmada "Öde" yine 8 sn\'yi kapsıyor, "Hesapla" 1,2 sn\'yi (düşülen yalnızca oynatmanın kendi beklemeleri)', seconds(row('Aksiyon en fazla 6').titles[1], /"Öde" (\d+,?\d*) sn sürdü/) >= 8 && seconds(row('Hesapla en fazla').detail, /"Hesapla" (\d+,?\d*) sn sürdü/) >= 1.2, `${row('Aksiyon en fazla 6').titles[1]} | ${row('Hesapla en fazla').detail}`);
    await shot('2-yavas-oynatma', '#replay');

    // =========================================================================================
    // 3) YARIDA KALAN ADIM: "Hesapla" düğmesi yok; oynatma elementi 10 sn bekler, adım kalır
    // =========================================================================================
    broken = 'no-hesapla';
    const run3 = await play();
    row = await ledRows();
    check('oynatma kaldı: "Hesapla" aksiyonu oynatılamadı (element bulunamadı)', run3.status === 'failed' && run3.steps[0].includes(`Aksiyon ${nth(e1, iHesapla)}`) && run3.steps[0].includes('element bulunamadı'), JSON.stringify(run3.steps));
    check('t1 (6 sn): yarıda kalan adımda süre çoktan aşıldı: kırmızı, takılan aksiyon ve geçen süreyle; kalan adımlar oynatılmadı', row('Aksiyon en fazla 6').status === 'fail'
      && new RegExp(`Adım 1 .* aksiyon ${nth(e1, iHesapla)}: Hesapla: süre aşıldı: aksiyon ${nth(e1, iHesapla)} "Hesapla" 1\\d,?\\d* sn sürdü ve adım tamamlanamadı \\(sınır 6 sn\\)`).test(row('Aksiyon en fazla 6').detail)
      && row('Aksiyon en fazla 6').titles[1].includes('adım oynatılmadı'), row('Aksiyon en fazla 6').detail);
    check('t2 (Hesapla\'ya bağlı, 1 sn): kırmızı; t6 (30 sn): sınır aşılmadı, adım "tamamlanamadı" (kırmızı değil); t3 (Devam\'a bağlı): aksiyonu oynatılmadı', row('Hesapla en fazla').status === 'fail' && row('Hesapla en fazla').detail.includes('adım tamamlanamadı')
      && row('Aksiyon en fazla 30').status === 'ok' && row('Aksiyon en fazla 30').titles[0].endsWith('adım tamamlanamadı') && row('Devam en fazla').status === 'ok' && row('Devam en fazla').detail.includes('adım tamamlanamadı'), `${row('Aksiyon en fazla 30').titles[0]} | ${row('Devam en fazla').detail}`);
    check('yarıda kalan adımda hatalar yine değerlendirildi: j1 kırmızı (eklerken atılan hata, ilk aksiyonda), j2 yeşil ve sayılmayan hata notuyla; ekrana bakan s1 "adım tamamlanamadı"', row('JS hata yok').detail.includes(`aksiyon ${nth(e1, iEkle)}`) && row('JS hata yok').detail.includes('Failed to add')
      && row('bilinenler hariç').trail[0] === 'ok' && row('bilinenler hariç').titles[0].endsWith('JavaScript hatası yok (1 hata yok sayıldı: desene uyuyor)') && row('Ekranda 500 yok').titles[0].endsWith('adım tamamlanamadı'), `${row('bilinenler hariç').titles[0]} | ${row('Ekranda 500 yok').titles[0]}`);
    const brokeAlarm = (await alarmsNow()).filter((a) => a.monitorId === 't1').at(-1);
    check('yarıda kalan adımın süre uyarısı: "Hesapla" aksiyonunda, Mağaza sayfasında (takıldığı ekran), element yok (hiç gelmedi)', brokeAlarm.action?.index === iHesapla && brokeAlarm.url === base + '/' && Array.isArray(brokeAlarm.targets) && brokeAlarm.targets.length === 0 && brokeAlarm.text.includes('adım tamamlanamadı'), JSON.stringify([brokeAlarm.where, brokeAlarm.text]));

    // =========================================================================================
    // 4) BEKLENEN EKRANA VARILAMAYAN ADIM: "Devam" hiçbir yere gitmiyor; doğrulama 10 sn bekler
    // =========================================================================================
    broken = 'no-nav';
    const run4 = await play();
    row = await ledRows();
    check('oynatma kaldı: adım 1 beklenen ekrana (Ödeme) varamadı', run4.status === 'failed' && run4.steps[0].endsWith(':failed'), JSON.stringify(run4.steps));
    check('t1 (6 sn): kırmızı: son aksiyondan sonra 10+ sn geçti ve beklenen ekrana varılamadı', row('Aksiyon en fazla 6').status === 'fail' && /Adım 1 \([^)]*\): süre aşıldı: aksiyon \d+\/\d+ "[^"]+" sonrası 1\d,?\d* sn geçti ve beklenen ekrana varılamadı \(sınır 6 sn\)/.test(row('Aksiyon en fazla 6').detail), row('Aksiyon en fazla 6').detail);
    // "Devam" edge'in son gerçek aksiyonuysa süresine beklenen ekranın gelmesi de girer (bitmemiş: değerlendirilmez); kayıtta
    // arkasına bir 'resize' düştüyse (bazı ortamlar) "Devam"ın kendi süresi tamdır ve yeşildir
    const goIsLast = e1.actions.findLastIndex((a) => a.type !== 'wait') === iGo;
    check('t6 (30 sn): sınır aşılmadı ama ekran gelmedi: değerlendirilmedi (kırmızı değil); t3 (Devam\'a bağlı): son aksiyonsa o da; t2 (Hesapla) yine kendi süresiyle kırmızı', row('Aksiyon en fazla 30').status === 'ok' && row('Aksiyon en fazla 30').titles[0].endsWith('beklenen ekrana varılamadı: süre değerlendirilmedi (sınır 30 sn)')
      && row('Devam en fazla').status === 'ok' && (goIsLast ? row('Devam en fazla').detail.includes('beklenen ekrana varılamadı: süre değerlendirilmedi') : /aksiyon \d+,?\d* sn sürdü \(sınır 30 sn\)/.test(row('Devam en fazla').detail))
      && row('Hesapla en fazla').status === 'fail', `${row('Aksiyon en fazla 30').titles[0]} | ${row('Devam en fazla').detail}`);
    check('node monitörleri: ekrana bakan s2 "node\'a varılamadı" (kontrol edilemedi); ekrana bakmayan j5 yine değerlendirildi (kırmızı)', row('Ödeme ekranında').status === 'ok' && row('Ödeme ekranında').detail.includes('node\'a varılamadı') && row('Ödemeye varan').status === 'fail', `${row('Ödeme ekranında').detail} | ${row('Ödemeye varan').detail}`);
    broken = null;

    // =========================================================================================
    // FORM: tür kartları, kapsam ve aksiyon metinleri, doğrulama
    // =========================================================================================
    await panel.evaluate(() => document.getElementById('btn-monitor-add').click());
    await sleep(200);
    const cards = await panel.$$eval('#monitor-cards .type-card', (els) => els.map((c) => ({ type: c.dataset.type, when: c.querySelector('.when').textContent, group: c.closest('.cards').previousElementSibling.textContent })));
    check('tür kartları: JavaScript Error "Hata izleme" altında "Olay tabanlı"; Action Timeout "Performans" altında "Süre tabanlı"', cards.find((c) => c.type === 'jsError')?.when === 'Olay tabanlı' && cards.find((c) => c.type === 'jsError').group === 'Hata izleme'
      && cards.find((c) => c.type === 'actionTimeout')?.when === 'Süre tabanlı' && cards.find((c) => c.type === 'actionTimeout').group === 'Performans', JSON.stringify(cards));
    await shot('form-tur-kartlari');
    await $('#monitor-cards .type-card[data-type="jsError"]').click();
    await sleep(150);
    check('JavaScript Error formu: "Tüm model: her adımda"; desen isteğe bağlı; özet cümlesi', (await text('#monitor-scope-global-text')) === 'Tüm model: her adımda kontrol edilir' && (await text('#monitor-params .monitor-param[data-key="ignore"] label span')).includes('isteğe bağlı')
      && (await text('#monitor-summary')) === 'Testte her adımda: sayfada yakalanmamış JavaScript hatası oluşmamalı. Bozulursa kırmızı yanar.', await text('#monitor-summary'));
    await panel.evaluate((id) => { document.querySelector('input[name="monitor-scope"][value="edge"]').click(); const select = document.getElementById('monitor-edge'); select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); }, e1.id);
    await sleep(150);
    check('JavaScript Error, edge: "Edge\'in tamamı (her aksiyondan sonra ve adımın sonunda)"; ipucu olaya göre', (await panel.evaluate(() => document.getElementById('monitor-action').options[0].textContent)) === 'Edge\'in tamamı (her aksiyondan sonra ve adımın sonunda)'
      && (await text('#monitor-action-hint')).includes('Yalnızca bir aksiyon oynatılırken olana bakmak için listeden seçin'), await text('#monitor-action-hint'));
    const pickAction = async (index) => { await panel.evaluate((value) => { const select = document.getElementById('monitor-action'); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }, String(index)); await sleep(100); };
    await pickAction(iEkle);
    check('JavaScript Error, aksiyon seçilince: ipucu ve özet "… aksiyonu oynatılırken"', (await text('#monitor-action-hint')) === 'Yalnızca bu aksiyon oynatılırken olana bakılır (aksiyondan hemen sonra kontrol edilir).'
      && (await text('#monitor-summary')).startsWith(`Testte ${e1.name} edge'inin ${iEkle + 1}. Tıkla ${label(e1, iEkle)} aksiyonu oynatılırken: sayfada yakalanmamış JavaScript hatası oluşmamalı`), await text('#monitor-summary'));
    await $('#monitor-params .monitor-param[data-key="ignore"] > label input').fill('a(');
    await panel.evaluate(() => document.getElementById('btn-monitor-save').click());
    await sleep(150);
    check('geçersiz yok sayma deseni kaydedilmez', (await panel.evaluate(() => document.getElementById('monitor-dialog').open)) && (await text('#monitor-params .monitor-param[data-key="ignore"] .field-error')).includes('Geçersiz desen'));
    await $('#monitor-params .monitor-param[data-key="ignore"] > label input').fill('analytics');
    await panel.evaluate(() => document.getElementById('btn-monitor-save').click());
    await sleep(400);
    const savedJs = (await store('monitors:' + graphId))['monitors:' + graphId].items.at(-1);
    check('kaydedildi: tür, kapsam (edge + aksiyon), parametre; listede adı "JavaScript Error · /analytics/ hariç"', savedJs.type === 'jsError' && savedJs.scope === e1.id && savedJs.action?.index === iEkle && savedJs.params.ignore === 'analytics'
      && (await panel.$$eval('#monitors-list .monitor b', (els) => els.map((b) => b.textContent))).some((n) => n.includes('JavaScript Error · /analytics/ hariç')), JSON.stringify(savedJs));

    await panel.evaluate(() => document.getElementById('btn-monitor-add').click());
    await sleep(200);
    await $('#monitor-cards .type-card[data-type="actionTimeout"]').click();
    await sleep(150);
    const limitField = await panel.evaluate(() => { const input = document.querySelector('#monitor-params .monitor-param[data-key="maxSeconds"] label input'); return { type: input.type, value: input.value, min: input.min, max: input.max, step: input.step }; });
    check('Action Timeout formu: sayı alanı (varsayılan 5, 2–60, adım 0,5); özet cümlesi', JSON.stringify(limitField) === JSON.stringify({ type: 'number', value: '5', min: '2', max: '60', step: '0.5' })
      && (await text('#monitor-summary')) === 'Testte her adımda: hiçbir aksiyon 5 saniyeden uzun sürmemeli (kayıttaki beklemeler ve yavaş oynatmanın araları sayılmaz). Bozulursa kırmızı yanar.', `${JSON.stringify(limitField)} ${await text('#monitor-summary')}`);
    await panel.evaluate((id) => { document.querySelector('input[name="monitor-scope"][value="edge"]').click(); const select = document.getElementById('monitor-edge'); select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); }, e1.id);
    await sleep(150);
    check('Action Timeout, edge: "Edge\'in tamamı (her aksiyonun süresi)"; ipucu süreye göre', (await panel.evaluate(() => document.getElementById('monitor-action').options[0].textContent)) === 'Edge\'in tamamı (her aksiyonun süresi)'
      && (await text('#monitor-action-hint')).includes('Yalnızca bir aksiyonun süresine bakmak için listeden seçin; seçilmezse edge\'in her aksiyonuna bakılır.'), await text('#monitor-action-hint'));
    await pickAction(iEkle + 1); // ilk aksiyonun arkasındaki otomatik bekleme
    const waitHint = await text('#monitor-action-hint');
    await panel.evaluate(() => document.getElementById('btn-monitor-save').click());
    await sleep(150);
    check('Action Timeout bir beklemeye bağlanamaz: ipucu söyler, kayıt reddedilir', waitHint.startsWith('Bekleme aksiyonunun süresi kayıttan gelir, ölçülmez') && (await panel.evaluate(() => document.getElementById('monitor-dialog').open)) && (await text('#monitor-error')).includes('Bekleme aksiyonunun süresi ölçülmez'), `${waitHint} | ${await text('#monitor-error')}`);
    await pickAction(iHesapla);
    check('Action Timeout, aksiyon seçilince: ipucu aksiyonun süresini tarif eder; özet "… aksiyonu oynatılırken: aksiyon 5 saniyeden uzun sürmemeli"', (await text('#monitor-action-hint')).startsWith('Yalnızca bu aksiyonun süresine bakılır: aksiyon başladıktan sonra testin devam edebilmesine kadar geçen süre')
      && (await text('#monitor-summary')).includes(`${iHesapla + 1}. Tıkla Hesapla aksiyonu oynatılırken: aksiyon 5 saniyeden uzun sürmemeli`), await text('#monitor-summary'));
    await $('#monitor-params .monitor-param[data-key="maxSeconds"] > label input').fill('1');
    await panel.evaluate(() => document.getElementById('btn-monitor-save').click());
    await sleep(150);
    check('sınır 2 sn\'nin altında olamaz (en hızlı sayfada bile bir aksiyon ~1 sn sürer)', (await panel.evaluate(() => document.getElementById('monitor-dialog').open)) && (await text('#monitor-params .monitor-param[data-key="maxSeconds"] .field-error')) === 'En az 2 olmalı.');
    await $('#monitor-params .monitor-param[data-key="maxSeconds"] > label input').fill('2.5');
    await sleep(100);
    await shot('form-action-timeout');
    await panel.evaluate(() => document.getElementById('btn-monitor-save').click());
    await sleep(400);
    const savedTime = (await store('monitors:' + graphId))['monitors:' + graphId].items.at(-1);
    check('kaydedildi: sınır 2,5 sn, Hesapla aksiyonuna bağlı; listede adı "Action Timeout · ≤ 2,5 sn"', savedTime.type === 'actionTimeout' && savedTime.params.maxSeconds === 2.5 && savedTime.action?.index === iHesapla
      && (await panel.$$eval('#monitors-list .monitor b', (els) => els.map((b) => b.textContent))).some((n) => n.includes('Action Timeout · ≤ 2,5 sn')), JSON.stringify(savedTime));

    // "Şimdi kontrol et": ekrana bakan monitör kalmayınca (s1, s2 kapalı) açıklayıcı mesaj
    await panel.evaluate(async () => { for (const m of monitors.items) if (m.type === 'errorText') m.enabled = false; await saveMonitorList(null); renderMonitors(); });
    await sleep(300);
    await panel.click('#btn-monitor-check');
    await sleep(500);
    check('şimdi kontrol, yalnızca ekrana bakmayan monitörler varken: "yalnızca oynatmada kontrol edilir"', (await text('#message')).startsWith('Bu ekranda kontrol edilebilecek monitör yok: 4 etkin monitör (JavaScript Error, Action Timeout) yalnızca oynatmada kontrol edilir'), await text('#message'));

    // =========================================================================================
    // 5) OTOMATİK BEKLEMEDE FARK EDİLEN BOZULMA (ayrı graph): uyarının yerinde bekleme değil, ilgili aksiyon
    // =========================================================================================
    // Kayıt her aksiyonun arkasına 10 ms'lik bir bekleme koyar. Aksiyonun süresi o beklemenin durulmasını da kapsar;
    // aksiyondan sonra gelen hata da çoğu zaman o beklemede yakalanır. Uyarı "aksiyon 2/2: Bekle 0,01 sn" dememeli:
    // kullanıcının kaydettiği aksiyon tıklamadır.
    await send({ type: 'NEW_GRAPH' });
    await sleep(600);
    const graphLate = await activeId();
    await page.goto(base + '/yukle');
    await sleep(500);
    await createNode();
    await page.click('#yukle');
    await page.waitForSelector('#tamam', { timeout: 20000 });
    await createNode();
    const sLate = await getState();
    const eY = sLate.edges[0];
    const nTamam = sLate.nodes.find((n) => n.id === eY?.target);
    const iY = eY ? real(eY, 0) : -1;
    check('kayıt (yeni graph): 2 node, 1 edge; tıklamanın arkasında otomatik bekleme', graphLate !== graphId && sLate.nodes.length === 2 && sLate.edges.length === 1 && kinds(eY) === 'click' && eY.actions[iY + 1]?.type === 'wait' && eY.actions[iY + 1].ms < 1000, (eY?.actions ?? []).map((a) => `${a.type}${a.ms ?? ''}`).join(' '));
    await panel.evaluate(([key, list]) => chrome.storage.local.set({ [key]: { format: 'graph-recorder-monitors/v1', nextId: 100, items: list } }), ['monitors:' + graphLate, [
      M('w1', 'jsError', 'global', { ignore: '' }, { name: 'Geç hata yok' }),
      M('w2', 'actionTimeout', 'global', { maxSeconds: 4.5 }, { name: 'Yükleme en fazla 4,5 sn' }),
    ]]);
    await sleep(400);
    await panel.evaluate(async (ids) => {
      await createScenario({ name: 'Yükleme', planner: { engine: 'manual' }, runs: [ids] });
      scenarioRun = 0;
      renderScenario();
      showView(null);
    }, [eY.id]);
    await sleep(300);
    const run5 = await play({ start: '/yukle' });
    row = await ledRows();
    check('oynatma geçti (tek adım)', run5.status === 'passed' && run5.steps.length === 1, JSON.stringify(run5));
    const w1 = row('Geç hata yok');
    const w2 = row('Yükleme en fazla');
    const whereY = `Adım 1 (${eY.name} → ${nTamam.name}) · aksiyon ${nth(eY, iY)}: Yükle: `;
    check('w1 (JavaScript Error): tıklamadan 4,5 sn sonra atılan hata yakalandı; yerinde tıklama yazıyor, bekleme değil', w1.status === 'fail' && w1.detail.startsWith(`${whereY}JavaScript hatası: "Uncaught Error: geç yükleme hatası" (yukle:`) && !w1.detail.includes('Bekle'), w1.detail);
    const yukleSeconds = seconds(w2.detail, /"Yükle" (\d+,?\d*) sn sürdü/);
    check('w2 (Action Timeout, 4,5 sn): kırmızı; yerinde süreyi aşan tıklama yazıyor, bekleme değil', w2.status === 'fail' && new RegExp(`^${whereY.replace(/[()]/g, '\\$&')}süre aşıldı: aksiyon ${nth(eY, iY)} "Yükle" \\d+,?\\d* sn sürdü \\(sınır 4,5 sn\\)$`).test(w2.detail) && !w2.detail.includes('Bekle'), w2.detail);
    check('w2: ölçülen süre tıklamanın kendi durulmasından (en fazla 3 sn) uzun: bozulma beklemenin kontrolünde fark edildi', yukleSeconds >= 5 && yukleSeconds < 9, String(yukleSeconds));
    const lateAlarms = await alarmsNow(graphLate);
    const [aErr, aTime] = ['w1', 'w2'].map((id) => lateAlarms.find((a) => a.monitorId === id));
    check('uyarılar: ikisi de tıklama aksiyonuyla kayıtlı (sıra, ad), aynı anda alınmış tek görüntüyle', lateAlarms.length === 2 && [aErr, aTime].every((a) => a?.action?.index === iY && a.action.label === 'Yükle' && a.action.count === eY.actions.length && a.where === whereY.slice(0, -2))
      && aErr.screenshot === aTime.screenshot, JSON.stringify(lateAlarms.map((a) => [a.monitorId, a.where, a.action])));
    check('w1 uyarısı: işaretlenen element tıklanan düğme (yeşil zemin), notu "hata bu aksiyondan sonra oluştu"', aErr.targets?.[0]?.tag === 'button#yukle' && aErr.targets[0].note === 'hata bu aksiyondan sonra oluştu' && isGreen(await meanColor(aErr.screenshot, aErr.targets[0].visible, aErr.viewport)), JSON.stringify(aErr.targets));
    check('w2 uyarısı: aynı düğme, notu "süresi sınırı aşan aksiyon"', aTime.targets?.[0]?.tag === 'button#yukle' && aTime.targets[0].note === 'süresi sınırı aşan aksiyon', JSON.stringify(aTime.targets));
    await shot('5-beklemede-fark-edilen', '#replay');

    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
