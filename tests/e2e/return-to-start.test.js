// "Başlangıç node'una dön": başka sitedeyken adrese getirme, gezinmenin kayda
// GoTo olarak girmesi, giriş gerektiren başlangıçta yönlendirme uyarısı, okunamayan sayfa.
// Kullanım: node tests/e2e/return-to-start.test.js [--headed]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, REPO, EXT, CHROME, outDir, skipCleanup } = require('./env');

const HEADED = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// /app giriş ister: çerez yoksa giriş sayfasına yönlendirir (saucedemo inventory gibi).
function respond(req, res) {
  const url = req.url.split('?')[0];
  const authed = (req.headers.cookie ?? '').includes('auth=1');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (url === '/') {
    return res.end(`<!doctype html><title>Giris</title><input id="user" placeholder="Kullanici"> <button id="login" type="button">Giris</button>
      <script>login.onclick = () => { if (user.value === 'ali') { document.cookie = 'auth=1; path=/'; location.href = '/app'; } };</script>`);
  }
  if (url === '/app') {
    if (!authed) { res.statusCode = 302; res.setHeader('location', '/'); return res.end(); }
    return res.end(`<!doctype html><title>Uygulama</title><button id="show">Goster</button> <span id="slot"></span>
      <script>show.onclick = () => { slot.innerHTML = '<button id="hide">Gizle</button>'; };</script>`);
  }
  if (url === '/other') return res.end('<!doctype html><title>Baska</title><a href="#">Baska site</a> <button>Bir</button> <button>Iki</button>');
  res.end('yok');
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = http.createServer(respond);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const BASE = `http://127.0.0.1:${port}`;
  const OTHER = `http://localhost:${port}/other`; // başka site (yakınlaştırma site başına)
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-return-')), {
    executablePath: CHROME, headless: !HEADED, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900', '--screen-info={0,0 1920x1080}', ...(HEADED ? ['--window-position=-2400,0'] : [])],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    await page.goto(BASE + '/');
    await page.bringToFront();
    const T = await panel.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url ?? '').startsWith(u)).id), BASE);
    const { windowId } = await panel.evaluate((id) => chrome.tabs.get(id), T);
    const createNode = async () => {
      await sleep(700);
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: T, windowId });
      const s = await getState();
      if (s.pending) await send({ type: 'RESOLVE', targetId: null });
      return getState();
    };
    const card = () => panel.evaluate(() => ({
      hidden: document.getElementById('replay-check').hidden,
      text: document.getElementById('replay-check-text').textContent,
      reasons: document.getElementById('replay-check-reasons').textContent,
      fit: !document.getElementById('btn-replay-fit').hidden, fitText: document.getElementById('btn-replay-fit').textContent,
      anyway: !document.getElementById('btn-replay-anyway').hidden,
      message: document.getElementById('message').textContent,
    }));
    const pressReturn = async () => {
      await panel.evaluate(() => document.getElementById('btn-replay-fit').click());
      await sleep(300);
      await panel.waitForFunction(() => !document.getElementById('btn-replay-fit').disabled, null, { timeout: 20000 });
      await sleep(300);
    };
    const useScenario = (start, run) => panel.evaluate(async ([s, r]) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Test', planner: { engine: 'manual' }, start: s, runs: [r] });
      scenarioRun = 0;
      renderScenario();
      document.getElementById('replay-slow').checked = false;
    }, [start, run]);
    const tryReplay = async () => {
      await page.bringToFront();
      await panel.evaluate(() => document.getElementById('btn-replay').click());
      await skipCleanup(panel); // temizlik penceresi: Temizlemeden oynat
      await sleep(900);
    };

    // ---- Kayıt: giriş → uygulama → göster ----
    let s = await createNode();
    const n1 = s.currentNodeId;
    await page.fill('#user', 'ali');
    await page.click('#login');
    await page.waitForURL(BASE + '/app');
    s = await createNode();
    const n2 = s.currentNodeId;
    await page.click('#show');
    s = await createNode();
    check('kayıt: 3 node, 2 edge', s.nodes.length === 3 && s.edges.length === 2);
    const recorded = s.nodes.find((n) => n.id === n1).viewport;
    const run = s.edges.map((e) => e.id);

    // ---- Başka sitede, farklı pencere boyutu ve yakınlaştırmayla ----
    await useScenario(null, run);
    await page.goto(OTHER);
    await panel.evaluate(([w, id]) => Promise.all([chrome.windows.update(w, { width: 1000, height: 720 }), chrome.tabs.setZoom(id, 1.25)]), [windowId, T]);
    await sleep(600);
    await tryReplay();
    let c = await card();
    check('başka sitede: kart, başlangıç aynı değil', !c.hidden && c.text.includes("Başlangıç node'ları aynı değil"), c.text);
    check('buton: adres', c.fit && c.fitText === "Başlangıç node'una dön", c.fitText);
    const bufferBefore = (await getState()).buffer.length;
    await pressReturn();
    const fitted = await page.evaluate(() => ({ url: location.href, width: innerWidth, height: innerHeight, devicePixelRatio }));
    check('başlangıç adresine gidildi', fitted.url === BASE + '/', fitted.url);
    c = await card();
    check('kartta yalnızca bekleyen aksiyon uyarısı kaldı', c.hidden ? c.message.includes('Koşuyu oynat') : (!c.fit && c.text === 'Oynatmadan önce:' && c.reasons.includes('silinecek') && !c.reasons.includes('beklenen')), JSON.stringify(c));
    s = await getState();
    const goto = s.buffer.find((a) => a.type === 'navigate' && a.url === BASE + '/');
    check('gezinme kayda GoTo olarak girdi', s.buffer.length > bufferBefore && Boolean(goto), s.buffer.map((a) => `${a.type}:${a.label}`).join(', '));
    if (!c.hidden) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 60000 });
    const result = await panel.evaluate(() => replayResult.status);
    check('oynatma geçti', result === 'passed', result);

    // ---- Giriş gerektiren başlangıç: çıkış yapılmış, site yönlendirir ----
    await ctx.clearCookies();
    await useScenario(n2, run.slice(1));
    await page.goto(OTHER);
    await sleep(600);
    await tryReplay();
    c = await card();
    check('uygulama başlangıçlı senaryo: buton adres', !c.hidden && c.fit, c.fitText);
    await pressReturn();
    c = await card();
    const landed = await page.evaluate(() => location.href);
    check('site giriş sayfasına yönlendirdi', landed === BASE + '/', landed);
    check('yönlendirme söylendi, uyarı kaldı', c.message.includes('başka bir adrese yönlendirdi') && c.message.includes(BASE + '/') && !c.hidden && c.text.includes('aynı değil'), JSON.stringify(c));
    await panel.evaluate(() => document.getElementById('btn-replay-cancel').click());

    // ---- Okunamayan sayfa (about:blank): kart, oynatma butonu yok, dön çalışır ----
    await page.goto('about:blank');
    await useScenario(null, run);
    await sleep(500);
    await tryReplay();
    c = await card();
    check('okunamayan sayfa: kart ve neden', !c.hidden && c.reasons.includes('okunamadı') && c.fit, JSON.stringify(c));
    check('okunamayan sayfa: "Yine de oynat" yok', !c.anyway);
    await pressReturn();
    const back = await page.evaluate(() => location.href);
    c = await card();
    check('okunamayan sayfadan başlangıca dönüldü', back === BASE + '/' && (c.hidden || !c.reasons.includes('okunamadı')), `${back} ${JSON.stringify(c)}`);
    check('"Yine de oynat" geri geldi', c.hidden || c.anyway);
    await panel.evaluate(() => document.getElementById('btn-replay-cancel').click());

    // ---- Yalnızca boyut farklı: kart boyut için buton göstermez, oynatma boyutu kendisi kurar ----
    await panel.evaluate(([w]) => chrome.windows.update(w, { width: 1000, height: 720 }), [windowId]);
    await sleep(600);
    await panel.evaluate(() => { replayResult = null; });
    await tryReplay();
    c = await card();
    check('yalnızca boyut: dön butonu ve boyut uyarısı yok', c.hidden || (!c.fit && !c.reasons.includes('Görünen alan')), JSON.stringify(c));
    if (!c.hidden) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 60000 });
    const sized = await panel.evaluate(() => ({ status: replayResult.status, warnings: replayResult.steps.flatMap((x) => x.warnings) }));
    check('yalnızca boyut: oynatma geçti, uyarı yok', sized.status === 'passed' && !sized.warnings.length, JSON.stringify(sized));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
