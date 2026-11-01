// Ekrandaki elementler kartı (DOM ağacı): yalnızca ekranda görünen elementler, sarmalayıcıların
// katlanması, gizlilerin atılması, satırın üzerine gelince sayfada çerçeve (sayfanın DOM izleyicisine
// görünmeden), kayda dokunmama, node oluşturulurken çerçevenin kalkması, her aksiyondan ve
// kaydırmadan sonra yenilenme, kapatılan dalın kapalı kalması, okunamayan sayfa.
// Kullanım: node tests/e2e/dom-tree.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, EXT, CHROME } = require('./env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// React'teki gibi iç içe sarmalayıcılar; ekranda olmayan ya da gizli parçalar; taşanı gizleyen
// bir carousel; tıklayınca görünen bir mesaj; sayfanın çok aşağısında bir yazı.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Agac</title><style>
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .track { width: 290px; overflow: hidden; white-space: nowrap; }
  .slide { display: inline-block; width: 300px; }
  .far { margin-top: 2000px; }
</style></head><body>
<div id="root"><div class="css-a"><div class="css-b"><main>
  <h1>Ürünler</h1>
  <div class="css-c"><div class="css-d"><button id="buy">Satın al</button></div></div>
  <input id="q" placeholder="Ara">
  <p>Toplam <b>3</b> ürün</p>
  <span class="sr">Ekran okuyucu metni</span>
  <div style="display:none"><button id="hidden">Gizli</button></div>
  <div style="visibility:hidden">Görünmez yazı</div>
  <div class="track"><div class="slide">Slayt 1</div><div class="slide">Slayt 2</div></div>
  <button id="show" onclick="document.getElementById('msg').hidden = false">Göster</button>
  <p id="msg" hidden>Kaydedildi</p>
</main></div></div></div>
<p class="far">Aşağıdaki yazı</p>
</body></html>`;
const EXPECTED = '0 div#root | 1 main | 2 h1 Ürünler | 2 button#buy Satın al | 2 input#q Ara | 2 p Toplam ürün | 3 b 3 | 2 div Slayt 1 | 2 button#show Göster';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-domtree-')), {
    executablePath: CHROME, headless: true, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(base);
    await sleep(800);
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
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
    const until = (fn, arg = null) => panel.waitForFunction(fn, arg, { timeout: 8000 }).then(() => true, () => false);
    // Ağacın satırları, sırayla: { depth, tag, text, key, interactive }
    const rows = () => panel.$$eval('#dom-tree-list .dom-row', (els) => els.map((row) => {
      let depth = 0;
      for (let n = row.parentElement; n.id !== 'dom-tree-list'; n = n.parentElement) if (n.localName === 'ul') depth++;
      return {
        depth, tag: row.querySelector('.dom-tag').textContent, text: row.querySelector('.dom-text').textContent.replace(/^"|"$/g, ''),
        key: row.querySelector('code').textContent, interactive: row.classList.contains('interactive'),
      };
    }));
    const lines = async () => (await rows()).map((r) => `${r.depth} ${r.tag}${r.text ? ' ' + r.text : ''}`).join(' | ');
    const hasText = (text) => until((t) => [...document.querySelectorAll('#dom-tree-list .dom-text')].some((s) => s.textContent === `"${t}"`), text);
    const hover = (tag) => panel.evaluate((t) => [...document.querySelectorAll('#dom-tree-list .dom-tag')].find((s) => s.textContent === t)
      .closest('.dom-row').dispatchEvent(new MouseEvent('mouseenter')), tag);
    const leave = () => panel.evaluate(() => document.getElementById('dom-tree-list').dispatchEvent(new MouseEvent('mouseleave')));
    // Sayfadaki çerçeve (görünmüyorsa null) ve bir elementin kutusu
    const frame = () => page.evaluate(() => {
      const box = document.querySelector('graph-recorder-frame')?.shadowRoot.firstElementChild;
      if (!box || box.style.display === 'none') return null;
      const r = box.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, label: box.textContent };
    });
    const frameLabel = (prefix) => page.waitForFunction((p) => {
      const box = document.querySelector('graph-recorder-frame')?.shadowRoot.firstElementChild;
      return Boolean(box) && box.style.display !== 'none' && box.textContent.startsWith(p);
    }, prefix, { timeout: 5000 }).then(() => true, () => false);
    const frameHidden = () => page.waitForFunction(() => {
      const box = document.querySelector('graph-recorder-frame')?.shadowRoot.firstElementChild;
      return !box || box.style.display === 'none';
    }, null, { timeout: 5000 }).catch(() => {});
    const rectOf = (selector) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }, selector);
    const around = (box, r) => Boolean(box) && ['left', 'top'].every((k) => Math.abs(box[k] - (r[k] - 2)) < 1.5) && ['right', 'bottom'].every((k) => Math.abs(box[k] - (r[k] + 2)) < 1.5);

    // ---- Kayıt başlar; kart açılınca ağaç gelir ----
    await createNode();
    await page.bringToFront();
    await panel.evaluate(() => { document.getElementById('dom-tree').open = true; });
    check('kart açılınca ağaç geldi', await until(() => document.querySelectorAll('#dom-tree-list .dom-row').length > 0));
    check('sarmalayıcılar katlandı, gizliler ve ekran dışı yok, sıra ve girinti doğru', await lines() === EXPECTED, await lines());
    const keys = (await rows()).filter((r) => r.interactive).map((r) => r.key);
    check('etkileşimli satırlar parmak izi anahtarıyla', JSON.stringify(keys) === JSON.stringify(['button:buy', 'input:q', 'button:show']), JSON.stringify(keys));
    check('rozette satır sayısı, durumda sayfa', await panel.textContent('#dom-tree-count') === '9' && (await panel.textContent('#dom-tree-status')).startsWith('Agac'),
      `${await panel.textContent('#dom-tree-count')} / ${await panel.textContent('#dom-tree-status')}`);

    // ---- Satırın üzerine gelince sayfada çerçeve; sayfanın DOM izleyicisi görmez ----
    await hover('button#buy');
    check('üzerine gelince buton çerçevelendi, etiketiyle', await frameLabel('button#buy') && around(await frame(), await rectOf('#buy')), JSON.stringify(await frame()));
    await page.evaluate(() => {
      window.treeRecords = 0;
      new MutationObserver((list) => { window.treeRecords += list.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await hover('h1');
    check('çerçeve başka satıra taşındı', await frameLabel('h1') && around(await frame(), await rectOf('h1')), JSON.stringify(await frame()));
    await leave();
    await frameHidden();
    check('satırdan çıkınca çerçeve kalktı', !(await frame()));
    check('çerçeve taşınırken ve kalkarken sayfanın DOM izleyicisi bir şey görmedi', await page.evaluate(() => window.treeRecords) === 0, String(await page.evaluate(() => window.treeRecords)));
    check('ağaç ve çerçeve kayda girmedi', (await getState()).buffer.length === 0, JSON.stringify((await getState()).buffer.map((a) => a.type)));

    // ---- Kullanıcının kapattığı dal, ağaç yenilenince kapalı kalır ----
    await panel.evaluate(() => {
      [...document.querySelectorAll('#dom-tree-list details')].find((d) => d.querySelector(':scope > summary .dom-tag').textContent === 'p').open = false;
    });
    await sleep(200);
    await panel.evaluate(() => document.getElementById('btn-dom-tree-refresh').click());
    await sleep(800);
    const pOpen = await panel.evaluate(() => [...document.querySelectorAll('#dom-tree-list details')].find((d) => d.querySelector(':scope > summary .dom-tag').textContent === 'p')?.open);
    check('Yenile sonrası kapatılan dal kapalı', pOpen === false, String(pOpen));

    // ---- Aksiyondan sonra ağaç kendiliğinden yenilenir ----
    await page.bringToFront();
    await page.click('#show');
    check('tıklamadan sonra ağaç yenilendi: görünen mesaj ağaçta', await hasText('Kaydedildi'));
    const types = (await getState()).buffer.map((a) => a.type);
    check('bekleyen aksiyonlarda yalnızca kullanıcının tıklaması', JSON.stringify(types) === '["click"]', JSON.stringify(types));

    // ---- Node oluşturulurken çerçeve kalkar (ekran görüntüsüne girmez) ----
    await hover('button#buy');
    await frameLabel('button#buy');
    await createNode();
    check('node oluşturulurken çerçeve kalktı', !(await frame()), JSON.stringify(await frame()));

    // ---- Kaydırınca yalnızca ekrana gelenler ----
    await page.bringToFront();
    await page.mouse.move(600, 300);
    await page.mouse.wheel(0, 2500);
    check('kaydırınca ağaç yenilendi: aşağıdaki yazı var', await hasText('Aşağıdaki yazı'));
    check('yukarıda kalanlar ağaçta yok', !(await lines()).includes('Ürünler'), await lines());

    // ---- Okunamayan sayfa, sonra sayfa yüklenince ağaç geri gelir ----
    await page.goto('about:blank');
    check('okunamayan sayfada uyarı', await until(() => document.getElementById('dom-tree-status').textContent.includes('okunamadı')),
      await panel.textContent('#dom-tree-status'));
    check('okunamayan sayfada ağaç boş', (await rows()).length === 0 && await panel.textContent('#dom-tree-count') === '');
    await page.goto(base);
    check('sayfa yüklenince ağaç geri geldi', await hasText('Ürünler'));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
