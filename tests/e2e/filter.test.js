// Aksiyon filtresi: "Bekleyen aksiyonlar"da ve edge detayında işaretlenen türler gizlenir, görünenler
// asıl sıra numarasını korur, iki listenin filtresi ayrıdır, seçim panel yeniden açılınca kalır,
// otomatik bekleme ayrı bir türdür, kutu dışına tıklayınca kapanır.
// Kullanım: node tests/e2e/filter.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME } = require('./env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><html><head><title>Filtre</title></head><body>
<button id="a">Bir</button> <button id="b">Iki</button> <input id="q" placeholder="Ara">
</body></html>`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-filter-')), {
    executablePath: CHROME, headless: true, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(base);
    await sleep(800);
    const panelUrl = `chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`;
    let panel = await ctx.newPage();
    await panel.goto(panelUrl);
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const tab = await panel.evaluate((url) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.url.startsWith(url))), base);
    const createNode = async () => {
      await page.bringToFront();
      await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
      let s = await getState();
      if (s.pending) { await send({ type: 'RESOLVE', targetId: null }); s = await getState(); }
      return s;
    };
    // Listenin satırları: { n: gösterilen sıra numarası, text: tür, hidden }
    const rows = (list) => panel.$$eval(`#${list} > li`, (lis) => lis.map((li) => ({ n: li.value, type: li.querySelector('b').textContent, hidden: li.hidden })));
    const visible = async (list) => (await rows(list)).filter((r) => !r.hidden).map((r) => `${r.n}.${r.type}`).join(' ');
    const options = (box) => panel.$$eval(`#${box} .filter-menu label`, (ls) => ls.map((l) => `${l.textContent}${l.querySelector('input').checked ? ':x' : ''}`));
    const toggle = async (box, text) => {
      if (!(await panel.$eval(`#${box}`, (d) => d.open))) await panel.click(`#${box} > summary`);
      await panel.click(`#${box} .filter-menu label:has-text("${text}")`);
    };

    // ---- Kayıt: ilk node, sonra tıkla, tıkla, yaz, tıkla ----
    await createNode();
    await page.bringToFront();
    await page.click('#a');
    await sleep(300);
    await page.click('#b');
    await sleep(300);
    await page.fill('#q', 'x');
    await page.click('#a'); // alan odaktan çıkar: önce Yaz, sonra Tıkla
    await sleep(800);
    await panel.bringToFront();
    await sleep(300);
    check('bekleyen: 4 aksiyon, filtresiz', await visible('buffer') === '1.Tıkla 2.Tıkla 3.Yaz 4.Tıkla', await visible('buffer'));
    check('filtre kutusunda listedeki türler', JSON.stringify(await options('buffer-filter')) === JSON.stringify(['Tıkla', 'Yaz']), JSON.stringify(await options('buffer-filter')));

    // ---- "Tıkla" işaretlenince tıklamalar gizlenir, numara korunur ----
    await toggle('buffer-filter', 'Tıkla');
    await sleep(200);
    check('Tıkla gizli: yalnızca 3.Yaz görünür', await visible('buffer') === '3.Yaz', await visible('buffer'));
    check('başlıkta gizli sayısı, kutu açık kaldı', (await panel.textContent('#buffer-filter > summary')) === 'Filtrele · 3 gizli' && await panel.$eval('#buffer-filter', (d) => d.open), await panel.textContent('#buffer-filter > summary'));
    await panel.click('h1, header, body', { position: { x: 5, y: 5 } });
    check('kutu dışına tıklayınca kapandı', !(await panel.$eval('#buffer-filter', (d) => d.open)));

    // ---- Panel yeniden açılınca filtre kalır ----
    await panel.close();
    panel = await ctx.newPage();
    await panel.goto(panelUrl);
    await sleep(800);
    check('yeniden açılınca filtre hatırlandı', await visible('buffer') === '3.Yaz' && JSON.stringify(await options('buffer-filter')) === JSON.stringify(['Tıkla:x', 'Yaz']), `${await visible('buffer')} ${JSON.stringify(await options('buffer-filter'))}`);

    // ---- Edge: filtresi ayrı, otomatik bekleme ayrı tür ----
    const s = await createNode();
    const edge = s.edges.at(-1);
    await panel.bringToFront();
    await panel.evaluate((id) => { selectedId = id; renderDetails(); }, edge.id);
    await sleep(200);
    check('edge: bekleyen filtresi uygulanmadı, otomatik beklemeler görünür', await visible('details-actions') === '1.Tıkla 2.Bekle 3.Tıkla 4.Bekle 5.Yaz 6.Bekle 7.Tıkla 8.Bekle', await visible('details-actions'));
    check('edge filtre kutusu: otomatik bekleme ayrı satır', JSON.stringify(await options('details-filter')) === JSON.stringify(['Tıkla', 'Bekle (otomatik)', 'Yaz']), JSON.stringify(await options('details-filter')));
    await toggle('details-filter', 'Bekle (otomatik)');
    await sleep(200);
    check('otomatik beklemeler gizlendi, numaralar korundu', await visible('details-actions') === '1.Tıkla 3.Tıkla 5.Yaz 7.Tıkla', await visible('details-actions'));
    await toggle('details-filter', 'Tıkla');
    await sleep(200);
    check('iki tür gizli', await visible('details-actions') === '5.Yaz' && (await panel.textContent('#details-filter > summary')) === 'Filtrele · 7 gizli', await visible('details-actions'));
    await toggle('details-filter', 'Tıkla');
    await sleep(200);
    check('işaret kaldırılınca geri geldi', await visible('details-actions') === '1.Tıkla 3.Tıkla 5.Yaz 7.Tıkla', await visible('details-actions'));
    const saved = await panel.evaluate(() => JSON.parse(localStorage.getItem('actionFilters')));
    check('iki filtre ayrı saklandı', JSON.stringify(saved) === JSON.stringify({ details: ['wait:auto'], buffer: ['click'] }), JSON.stringify(saved));
    // Node seçilince edge filtresi gizlenir
    await panel.evaluate((id) => { selectedId = id; renderDetails(); }, s.nodes[0].id);
    check('node detayında filtre yok', await panel.$eval('#details-actions-head', (d) => d.hidden));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
