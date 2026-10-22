// Görsel karşılaştırma testi (onay kartı).
// Kullanım: node tests/e2e/compare.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');

const OUT = outDir('compare');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sayfa: sepet sayacı (etkileşimli değil) ve renkli afiş; link ve buton her sayfada aynı.
const NEXT = { '1-red': '2-blue', '2-blue': '2-red', '2-red': '1-red' };
function page(n, img) {
  const [nn, ni] = NEXT[`${n}-${img}`].split('-');
  return `<!doctype html><html><head><title>Sepet</title><style>body { margin: 0; font: 20px sans-serif; } p { margin: 16px; } #banner { height: 220px; margin: 16px; }</style></head><body>
<p>Sepet (<span id="count">${n}</span>)</p><div id="banner" style="background: ${img}"></div>
<p><a id="next" href="/?n=${nn}&img=${ni}">Ileri</a> <button id="buy">Satin al</button></p></body></html>`;
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = http.createServer((req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    res.setHeader('content-type', 'text/html');
    res.end(page(q.get('n') ?? '1', q.get('img') ?? 'red'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-cmp-')), {
    executablePath: CHROME, headless: true, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const tabPage = ctx.pages()[0] ?? await ctx.newPage();
    await tabPage.goto(`${base}?n=1&img=red`);
    await sleep(800);
    const panel = await ctx.newPage();
    await panel.setViewportSize({ width: 900, height: 1000 });
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    await tabPage.bringToFront();
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const tab = await panel.evaluate((url) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.url.startsWith(url))), base);
    const createNode = async () => { await tabPage.bringToFront(); await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId }); return getState(); };

    let s = await createNode();                                   // n: 1, kırmızı
    await tabPage.click('#next'); await sleep(1000);
    s = await createNode();                                       // eşleşen var: yeni node (2, mavi)
    check('aynı edge set: soru soruldu', Boolean(s.pending));
    await send({ type: 'RESOLVE', targetId: null });
    await tabPage.click('#next'); await sleep(1000);
    s = await createNode();                                       // 2, kırmızı: adaylar (2, mavi) ve (1, kırmızı)
    const [blue, red1] = s.pending.candidateIds;
    check('iki aday', s.pending.candidateIds.length === 2, JSON.stringify(s.pending.candidateIds));
    await sleep(1500);

    // 1) Karttaki oranlar ve sonuçlar
    const ratios = await panel.$$eval('#confirm-candidates .diff-ratio', (els) => els.map((e) => e.textContent));
    check('kartta her adayın altında görsel fark', ratios.length === 2 && ratios.every((t) => /^Görsel fark: <?%\d+,\d$/.test(t)), JSON.stringify(ratios));
    const result = (id) => panel.evaluate((id) => visualDiff(nodeById(id)).then((r) => r && { ratio: r.ratio, boxes: r.boxes, width: r.width }), id);
    const rRed = await result(red1);
    const rBlue = await result(blue);
    check('yalnızca sayaç farklı: düşük oran, tek bölge', rRed.ratio < 0.01 && rRed.boxes.length === 1, JSON.stringify({ ratio: rRed.ratio, boxes: rRed.boxes }));
    check('afişi farklı: yüksek oran', rBlue.ratio > 0.1 && rBlue.ratio > 10 * rRed.ratio, `${rBlue.ratio.toFixed(3)} vs ${rRed.ratio.toFixed(4)}`);
    // Kutu sayacın üstünde mi? (CSS piksel -> karşılaştırma ölçeği)
    const rect = await tabPage.evaluate(() => { const r = document.getElementById('count').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, vw: innerWidth }; });
    const scale = rRed.width / rect.vw;
    const box = rRed.boxes[0];
    const [cx, cy] = [rect.x * scale, rect.y * scale];
    check('kutu sayacın üstünde', cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height, `merkez (${cx.toFixed(0)},${cy.toFixed(0)}) kutu ${JSON.stringify(box)}`);
    const self = await panel.evaluate(() => compareScreenshots(state.pending.capture.screenshot, state.pending.capture.screenshot).then((r) => ({ ratio: r.ratio, boxes: r.boxes.length })));
    check('aynı görüntü: fark yok', self.ratio === 0 && self.boxes === 0, JSON.stringify(self));

    // 2) Karşılaştırma penceresi
    await panel.click('#confirm-candidates figure:nth-child(2) button.compare');
    await sleep(800);
    check('pencere açıldı, fark görünümü', await panel.isVisible('#compare-dialog') && await panel.locator('#compare-view canvas').count() === 1);
    const info = await panel.textContent('#compare-info');
    check('bilgi satırı', /^Görsel fark: <%0,1 · 1 farklı bölge$/.test(info), JSON.stringify(info));
    const warnings = await panel.textContent('#compare-warnings');
    check('adres farkı yazıyor', warnings.includes('Adres farklı') && warnings.includes('n=1') && warnings.includes('n=2'), JSON.stringify(warnings));
    await panel.locator('#compare-dialog').screenshot({ path: path.join(OUT, 'compare-diff.png') });
    await panel.click('#compare-modes button[data-mode="slider"]');
    await sleep(500);
    check('perde görünümü', await panel.locator('#compare-view img.over').count() === 1 && await panel.locator('#compare-view input[type="range"]').count() === 1);
    await panel.fill('#compare-view input[type="range"]', '30');
    await panel.locator('#compare-dialog').screenshot({ path: path.join(OUT, 'compare-slider.png') });
    await panel.click('#compare-modes button[data-mode="side"]');
    await sleep(500);
    check('yan yana görünümü', await panel.locator('#compare-view canvas').count() === 2);
    await panel.click('#compare-modes button[data-mode="diff"]');
    await panel.click('#compare-candidates button:nth-child(1)');
    await sleep(800);
    const infoBlue = await panel.textContent('#compare-info');
    check('adayı değiştirince oran değişti', infoBlue !== info && /^Görsel fark: %\d+,\d/.test(infoBlue), JSON.stringify(infoBlue));
    await panel.locator('#compare-dialog').screenshot({ path: path.join(OUT, 'compare-blue.png') });

    // 3) Pencereden karar
    await panel.click('#compare-candidates button:nth-child(2)');
    await sleep(500);
    await panel.click('#btn-compare-yes');
    await sleep(800);
    s = await getState();
    check('pencereden "Evet": edge seçilen adaya', s.pending === null && s.edges.at(-1).target === red1 && !(await panel.isVisible('#compare-dialog')), `hedef ${s.edges.at(-1)?.target}`);

    // 4) Görünen alan farklıysa uyarı
    const cdp = await ctx.newCDPSession(tabPage);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 1000 } });
    await sleep(1500);
    s = await createNode();
    check('pencere daraldı, eşleşen var', Boolean(s.pending), JSON.stringify(s.buffer?.map((a) => a.type)));
    if (s.pending) {
      await sleep(1000);
      await panel.click('#confirm-candidates figure:nth-child(2) button.compare');
      await sleep(800);
      const w = await panel.textContent('#compare-warnings');
      check('görünen alan uyarısı', w.includes('Görünen alanlar farklı'), JSON.stringify(w));
      await panel.click('#btn-compare-cancel');
    }
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nTüm kontroller geçti');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
