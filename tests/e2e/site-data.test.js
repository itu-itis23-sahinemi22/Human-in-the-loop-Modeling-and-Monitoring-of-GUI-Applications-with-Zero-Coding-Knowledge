// Oynatmadan önce temizlik testi (panel.js > TEMİZLİK): "Koşuyu oynat"ın açtığı pencerede
// senaryonun siteleri ve silinebilecek veriler, varsayılan seçimsiz, site kutusu (hepsi / yarım),
// Vazgeç'in kaydetmemesi, temizlemeden oynatınca başlangıcın tutmaması, kısmi temizlikte kalan
// verinin başlangıcı yine bozması, "localStorage ve sessionStorage"ın ikisini birden silmesi, tam
// temizlikte oynatmanın geçmesi, seçimin senaryoda saklanması ve başka senaryoya geçince ayrı
// olması, seçilmeyen sitenin verisine dokunulmaması. Test sayfası çerez, localStorage ya da
// sessionStorage'dan biri varsa "giriş yapılmış" ekranı gösterir.
// Kullanım: node tests/e2e/site-data.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME } = require('./env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let OTHER = ''; // ikinci site (localhost: başka alan adı, çerezleri ayrı)

const SITE = {
  '/': () => `<!doctype html><title>Giris</title><div id="box"></div><p id="state"></p>
    <script>
      const kept = [document.cookie.includes('sid=') && 'cookie', localStorage.getItem('token') && 'local', sessionStorage.getItem('tab') && 'session'].filter(Boolean);
      state.textContent = kept.join(',') || 'temiz';
      box.innerHTML = kept.length ? '<button id="logout">Cikis</button>' : '<button id="login">Giris</button>';
      if (!kept.length) login.onclick = () => {
        document.cookie = 'sid=1; path=/';
        localStorage.setItem('token', '1');
        sessionStorage.setItem('tab', '1');
        location.href = '/home';
      };
    </script>`,
  '/home': () => `<!doctype html><title>Ana</title><button id="next" onclick="location.href='${OTHER}/other'">Diger site</button>`,
};
const OTHER_SITE = {
  // Açılınca kendi verisini yazar: temizlikte seçilmediği için durmalı
  '/': () => `<!doctype html><title>Diger</title><button id="b">B</button>
    <script>document.cookie = 'other=1; path=/'; localStorage.setItem('other', '1');</script>`,
  '/other': () => '<!doctype html><title>Diger sayfa</title><button id="o">O</button>',
  '/check': () => '<!doctype html><title>Kontrol</title>',
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

const serve = (pages) => http.createServer((req, res) => {
  const render = pages[req.url.split('?')[0]];
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(render ? render() : 'yok');
});

(async () => {
  const site = serve(SITE);
  const other = serve(OTHER_SITE);
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${site.address().port}`;
  OTHER = `http://localhost:${other.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-sitedata-')), {
    executablePath: CHROME, headless: true, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    const errors = [];
    panel.on('pageerror', (e) => errors.push(e.message));
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const storedCleanup = async (id) => (await getState()).scenarios.find((sc) => sc.id === id)?.cleanup;
    const createNode = async (tabId) => {
      await sleep(700);
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId });
      let s = await getState();
      if (s.pending) { await send({ type: 'RESOLVE', targetId: null }); s = await getState(); }
      return s;
    };
    // Pencere: siteler, türleri, seçililer, düğmeler
    const dialog = () => panel.evaluate(() => ({
      open: document.getElementById('cleanup-dialog').open,
      run: !document.getElementById('btn-cleanup-run').disabled,
      sites: [...document.querySelectorAll('#cleanup-sites .cleanup-site')].map((s) => ({
        origin: s.dataset.origin,
        start: s.querySelector('legend').textContent.includes('başlangıç'),
        types: [...s.querySelectorAll('.checklist input')].map((b) => b.value),
        labels: [...s.querySelectorAll('.checklist label')].map((l) => l.textContent.trim()),
        checked: [...s.querySelectorAll('.checklist input:checked')].map((b) => b.value),
        all: s.querySelector('.cleanup-all').checked,
        half: s.querySelector('.cleanup-all').indeterminate,
      })),
    }));
    // Tıklamalar sayfada yapılır: kayıt sekmesi önde kalsın ("Koşuyu oynat" açık sekmeyi alır)
    const click = (selector) => panel.evaluate((sel) => document.querySelector(sel).click(), selector);
    const box = (origin, type) => `#cleanup-sites .cleanup-site[data-origin="${origin}"] ${type ? `.checklist input[value="${type}"]` : '.cleanup-all'}`;
    const openDialog = async () => {
      await page.goto(BASE + '/');
      await page.bringToFront();
      await sleep(600);
      await panel.evaluate(() => { replayResult = null; document.getElementById('replay-slow').checked = false; document.getElementById('btn-replay').click(); });
      await panel.waitForFunction(() => document.getElementById('cleanup-dialog').open, null, { timeout: 10000 });
    };
    const card = () => panel.evaluate(() => ({ hidden: document.getElementById('replay-check').hidden, text: document.getElementById('replay-check-text').textContent }));
    // Başlangıç sitesine üç veriyi yeniden yazar (giriş yapılmış gibi); sessionStorage bu sekmede kalır
    const seed = async () => {
      await page.goto(BASE + '/');
      await page.evaluate(() => { document.cookie = 'sid=1; path=/'; localStorage.setItem('token', '1'); sessionStorage.setItem('tab', '1'); });
    };

    // ---- Kayıt: diğer sitenin verisi; Giris → (giriş) → Ana → (diğer site) → Diger sayfa ----
    await page.goto(OTHER + '/');
    await sleep(500);
    await page.goto(BASE + '/');
    await sleep(500);
    const [T] = await panel.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.filter((t) => (t.url ?? '').startsWith(u)).map((t) => t.id)), BASE);
    let s = await createNode(T);
    await page.click('#login');
    await page.waitForURL(BASE + '/home');
    s = await createNode(T);
    await page.click('#next');
    await page.waitForURL(OTHER + '/other');
    s = await createNode(T);
    check('kayıt: 3 node, 2 edge, iki site', s.nodes.length === 3 && s.edges.length === 2, `${s.nodes.length} node, ${s.edges.length} edge`);
    const id = await panel.evaluate(async (ids) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Temiz', planner: { engine: 'manual' }, runs: [ids] });
      scenarioRun = 0;
      renderScenario();
      return scenario.id;
    }, s.edges.map((e) => e.id));

    // ---- 1) Pencere: siteler ve türler; varsayılan seçimsiz ----
    await openDialog();
    let d = await dialog();
    check('pencere açıldı: iki site, başlangıç sitesi önce', d.open && d.sites.map((x) => `${x.origin}${x.start ? '*' : ''}`).join(' ') === `${BASE}* ${OTHER}`, JSON.stringify(d.sites.map((x) => x.origin)));
    const types = 'cookies,cache,cacheStorage,localStorage,indexedDB,serviceWorkers,fileSystems';
    check('her sitede 7 tür; localStorage ve sessionStorage tek seçenek', d.sites.length === 2 && d.sites.every((x) => x.types.join(',') === types && x.labels.includes('localStorage ve sessionStorage')), JSON.stringify(d.sites.map((x) => x.labels)));
    check('varsayılan: hiçbir şey seçili değil, "Temizle ve oynat" pasif', d.sites.every((x) => !x.checked.length) && !d.run);
    await click(box(BASE));
    d = await dialog();
    check('site kutusu: tüm türler seçilir, düğme açılır', d.sites[0].checked.length === 7 && d.sites[0].all && d.run);
    await click(box(BASE, 'cookies'));
    d = await dialog();
    check('bir tür kalkınca site kutusu yarım', !d.sites[0].all && d.sites[0].half && d.sites[0].checked.length === 6);
    await click('#btn-cleanup-cancel');
    check('Vazgeç: pencere kapandı, seçim kaydedilmedi', !(await dialog()).open && JSON.stringify(await storedCleanup(id)) === '{}', JSON.stringify(await storedCleanup(id)));

    // ---- 2) Temizlemeden oynat: sayfa giriş yapılmış, başlangıç tutmaz ----
    await openDialog();
    await click('#btn-cleanup-skip');
    await panel.waitForFunction(() => !document.getElementById('replay-check').hidden, null, { timeout: 15000 });
    let c = await card();
    check('temizlemeden: başlangıç tutmadı (veriler duruyor)', c.text.includes("Başlangıç node'ları aynı değil") && (await page.textContent('#state')) === 'cookie,local,session', `${c.text} · ${await page.textContent('#state')}`);
    await click('#btn-replay-cancel');

    // ---- 3) Kısmi temizlik: yalnızca çerezler; localStorage ve sessionStorage kalır ----
    await openDialog();
    await click(box(BASE, 'cookies'));
    await click('#btn-cleanup-run');
    await panel.waitForFunction(() => !document.getElementById('replay-check').hidden, null, { timeout: 20000 });
    c = await card();
    let left = await page.textContent('#state');
    check('kısmi: yalnızca çerez silindi', left === 'local,session', left);
    check('kısmi: kalan veri yüzünden başlangıç yine tutmadı', c.text.includes("Başlangıç node'ları aynı değil"), c.text);
    check('kısmi: seçim senaryoya kaydedildi', JSON.stringify(await storedCleanup(id)) === JSON.stringify({ [BASE]: ['cookies'] }), JSON.stringify(await storedCleanup(id)));
    await click('#btn-replay-cancel');

    // ---- 4) "localStorage ve sessionStorage": ikisi birden silinir, çerez kalır ----
    await seed();
    await openDialog();
    d = await dialog();
    check('pencere kayıtlı seçimle açıldı', d.sites[0].checked.join(',') === 'cookies' && d.sites[0].half && !d.sites[1].checked.length, JSON.stringify(d.sites[0].checked));
    await click(box(BASE, 'cookies'));
    await click(box(BASE, 'localStorage'));
    await click('#btn-cleanup-run');
    await panel.waitForFunction(() => !document.getElementById('replay-check').hidden, null, { timeout: 20000 });
    c = await card();
    left = await page.textContent('#state');
    check('localStorage ve sessionStorage: ikisi de silindi, çerez kaldı', left === 'cookie', left);
    check('localStorage ve sessionStorage: kalan çerez yüzünden başlangıç tutmadı', c.text.includes("Başlangıç node'ları aynı değil"), c.text);
    await click('#btn-replay-cancel');

    // ---- 5) Tam temizlik: başlangıç tutar, oynatma geçer ----
    await seed();
    await openDialog();
    await click(box(BASE));
    await click('#btn-cleanup-run');
    // Başlangıca gidiş kayıt sekmesinde "Git" aksiyonu olarak kaydedilir (bekleyen aksiyon):
    // kart açılır ama yalnızca onun silineceğini söyler, başlangıç farkı olmaz
    await panel.waitForFunction(() => !document.getElementById('replay-check').hidden || replay || replayResult, null, { timeout: 20000 });
    c = await card();
    if (!c.hidden) {
      const clean = await page.textContent('#state');
      check('tam temizlik: sayfa temiz açıldı, kartta başlangıç farkı yok', clean === 'temiz' && !c.text.includes("Başlangıç node'ları aynı değil"), `${clean} · ${c.text}`);
      await click('#btn-replay-anyway');
    }
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 60000 });
    const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}`) }));
    check('tam temizlik: oynatma geçti (giriş ve diğer site)', result.status === 'passed', JSON.stringify(result.steps));
    check('tam temizlik: seçim kaydedildi (7 tür)', (await storedCleanup(id))?.[BASE]?.length === 7 && !(await storedCleanup(id))?.[OTHER], JSON.stringify(await storedCleanup(id)));

    // ---- 6) Seçilmeyen sitenin verisi duruyor ----
    await page.goto(OTHER + '/check');
    const kept = await page.evaluate(() => ({ cookie: document.cookie, local: localStorage.getItem('other') }));
    check('diğer site: çerezi ve localStorage\'ı duruyor', kept.cookie.includes('other=1') && kept.local === '1', JSON.stringify(kept));

    // ---- 7) Seçim senaryoya ait: başka senaryoda boş, geri dönünce aynı ----
    await panel.evaluate(async (ids) => {
      await createScenario({ name: 'Ikinci', planner: { engine: 'manual' }, runs: [ids] });
      scenarioRun = 0;
      renderScenario();
    }, s.edges.map((e) => e.id));
    await openDialog();
    d = await dialog();
    check('başka senaryo: seçim boş', d.sites.every((x) => !x.checked.length));
    await click('#btn-cleanup-cancel');
    await panel.evaluate((sid) => { selectScenario(sid); render(); }, id);
    await openDialog();
    d = await dialog();
    check('ilk senaryoya dönünce: kayıtlı seçim', d.sites[0].checked.length === 7 && d.sites[0].all);
    await click('#btn-cleanup-cancel');
    check('konsolda hata yok', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    site.close();
    other.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
