// Panelde oynatma testi: kayıt (gerçek kullanıcı olayları) -> panelde oynat.
// Kullanım: node tests/e2e/replay.test.js [--zoom=1.5]  (sekmenin tarayıcı yakınlaştırması; varsayılan 1)
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');

const ZOOM = Number(process.argv.find((a) => a.startsWith('--zoom='))?.slice(7) ?? 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let broken = false; // true: /app fazladan bir buton gösterir (edge set değişir)
const STYLE = '<style>.sub{display:none}.menu{display:inline-block;padding:4px;background:#eef}.menu:hover .sub{display:block}</style>';
const PAGES = {
  '/': () => `<!doctype html><title>Giris</title><input id="user" placeholder="Kullanici"> <input id="pass" type="password" placeholder="Sifre">
    <button id="login" type="button">Giris</button><p id="err"></p>
    <script>login.onclick = () => { if (pass.value === 'pw' && user.value === 'ali') location.href = '/app'; else err.textContent = 'Hatali'; };</script>`,
  '/app': () => `<!doctype html><title>Uygulama</title>${STYLE}
    <p><button id="show">Goster</button> <span id="slot"></span></p>
    <p><select id="size"><option value="s">S</option><option value="m">M</option></select> <span id="sizeSlot"></span></p>
    <p><label><input type="checkbox" id="agree"> Onay</label> <button id="go" disabled>Devam</button></p>
    <p><input id="search" placeholder="Ara"> <span id="escSlot"></span></p>
    <div class="menu"><a id="products" href="#p">Urunler</a><div class="sub"><a id="phones" href="#tel">Telefon</a></div></div>
    <p><a id="docs" href="/docs" target="_blank">Dokumanlar</a></p>
    ${broken ? '<button id="extra">Ekstra</button>' : ''}
    <script>
      show.onclick = () => { slot.innerHTML = '<button id="hide">Gizle</button>'; };
      size.onchange = () => { sizeSlot.innerHTML = size.value === 'm' ? '<button id="monly">M</button>' : ''; };
      agree.onchange = () => { go.disabled = !agree.checked; };
      search.onkeydown = (e) => { if (e.key === 'Escape') escSlot.innerHTML = '<button id="cleared">Temizlendi</button>'; };
    </script>`,
  '/docs': () => '<!doctype html><title>Dokumanlar</title><h1>Docs</h1><button id="read">Okudum</button>',
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = http.createServer((req, res) => {
    const render = PAGES[req.url.split('?')[0].split('#')[0]];
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(render ? render() : 'yok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-replay-')), {
    executablePath: CHROME, headless: true, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page0 = ctx.pages()[0] ?? await ctx.newPage();
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const tabIdOf = (url) => panel.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.filter((t) => (t.url ?? '').startsWith(u)).map((t) => t.id)), url);
    await send({ type: 'SET_SETTINGS', settings: { disabledActions: [], enabledActions: ['hover'], disabledInteractables: [], recordWaits: false, minWaitSeconds: 1 } });

    await page0.goto(BASE + '/');
    await page0.bringToFront();
    const [T0] = await tabIdOf(BASE + '/');
    if (ZOOM !== 1) {
      await panel.evaluate(([id, z]) => chrome.tabs.setZoom(id, z), [T0, ZOOM]);
      await sleep(500);
    }
    await sleep(500);
    const createNode = async (tabId) => {
      await sleep(700);
      await send({ type: 'CREATE_NODE', tabId });
      let s = await getState();
      if (s.pending) { await send({ type: 'RESOLVE', targetId: null }); s = await getState(); }
      return s;
    };

    // ---- KAYIT ----
    let s = await createNode(T0);
    await page0.fill('#user', 'ali');
    await page0.fill('#pass', 'pw');
    await page0.click('#login');
    await page0.waitForURL('**/app');
    s = await createNode(T0);
    await page0.click('#show');
    s = await createNode(T0);
    await page0.focus('#size');
    await page0.keyboard.press('ArrowDown'); // kapalı listede değer değişir, 'change' gerçek olay
    s = await createNode(T0);
    await page0.check('#agree');
    s = await createNode(T0);
    await page0.click('#search');
    await page0.keyboard.press('Escape');
    s = await createNode(T0);
    await page0.hover('#products');
    await sleep(1200);
    s = await createNode(T0);
    const popup = ctx.waitForEvent('page');
    await page0.click('#docs');
    const docs = await popup;
    await docs.waitForLoadState();
    await sleep(1200);
    await send({ type: 'RESOLVE_TAB', follow: true });
    const [T1] = await tabIdOf(BASE + '/docs');
    s = await createNode(T1);
    const kinds = s.edges.map((e) => e.actions.map((a) => a.type + (a.type === 'input' ? `=${a.value}` : '')).join('+'));
    check('kayıt: 8 node, 7 edge', s.nodes.length === 8 && s.edges.length === 7, `${s.nodes.length} node, ${s.edges.length} edge`);
    check('kayıt: aksiyonlar', JSON.stringify(kinds) === JSON.stringify(['input=ali+input=******+click', 'click', 'input=m', 'input=true', 'key', 'hover', 'click+tab']), JSON.stringify(kinds));
    const nodes = s.nodes.length;
    const edges = s.edges.length;
    const endNode = s.nodes.at(-1).id;

    // ---- SENARYO: tüm edge'ler tek koşu ----
    await docs.close();
    await sleep(500);
    await panel.evaluate(async (ids) => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Test', planner: { engine: 'manual' }, runs: [ids] });
      scenarioRun = 0;
      renderScenario();
    }, s.edges.map((e) => e.id));
    const secretInputs = await panel.$$eval('#replay-secrets input', (xs) => xs.length);
    check('şifre kutusu çıktı', secretInputs === 1);

    // ---- Maskeli değer girilmeden ----
    await page0.goto(BASE + '/');
    await page0.bringToFront();
    await sleep(800);
    await panel.evaluate(() => document.getElementById('btn-replay').click());
    await sleep(300);
    const msg0 = await panel.textContent('#message');
    check('şifre girilmeden: hata', msg0.includes('maskeli'), msg0);
    await panel.evaluate(() => {
      const input = document.querySelector('#replay-secrets input');
      input.value = 'pw';
      input.dispatchEvent(new Event('input'));
      document.getElementById('replay-slow').checked = false;
    });

    // ---- Yanlış başlangıç: uyarı ----
    await page0.goto(BASE + '/app');
    await page0.bringToFront();
    await sleep(800);
    await panel.evaluate(() => document.getElementById('btn-replay').click());
    await sleep(800);
    const warn = await panel.evaluate(() => ({ hidden: document.getElementById('replay-check').hidden, text: document.getElementById('replay-check-text').textContent }));
    check('yanlış başlangıç: uyarı kartı', !warn.hidden && warn.text.includes("Başlangıç node'ları aynı değil") && warn.text.includes('doğru sonuç vermeyecektir'), warn.text);
    await panel.evaluate(() => document.getElementById('btn-replay-cancel').click());

    // ---- Geçen oynatma ----
    await page0.goto(BASE + '/');
    await page0.bringToFront();
    await sleep(800);
    const started = Date.now();
    await panel.evaluate(() => document.getElementById('btn-replay').click());
    await sleep(500);
    const card = await panel.evaluate(() => (document.getElementById('replay-check').hidden ? null : document.getElementById('replay-check-reasons').textContent));
    check('başlangıç doğru: yalnızca bekleyen aksiyon uyarısı', card === null || (card.includes('silinecek') && !card.includes('beklenen')), String(card));
    if (card !== null) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await sleep(1000);
    const during = await panel.evaluate(() => ({ status: document.getElementById('replay-status').textContent, stop: !document.getElementById('btn-replay-stop').hidden, node: document.getElementById('btn-node').disabled }));
    check('oynatma sürerken: durum, Durdur, Node oluştur kilitli', during.stop && during.node && during.status.startsWith('Oynatılıyor'), during.status);
    const flag = await panel.evaluate(() => chrome.storage.session.get('replay').then((r) => r.replay));
    check('oynatma sürerken: kayıt bayrağı', flag === true);
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 90000 });
    const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}${x.mismatch ? ' ' + JSON.stringify(x.mismatch.diff) : ''}`), text: document.getElementById('replay-status').textContent, message: document.getElementById('message').textContent }));
    check('oynatma geçti', result.status === 'passed', JSON.stringify(result.steps));
    console.log('      ', result.text, `(${Date.now() - started} ms)`);
    check('panel mesajı', result.message.includes('Koşu geçti'), result.message);
    s = await getState();
    const [T2] = await tabIdOf(BASE + '/docs');
    check('kayıt durdu: yeni node/edge/aksiyon yok', s.nodes.length === nodes && s.edges.length === edges && s.buffer.length === 0, `${s.nodes.length}/${s.edges.length}/${s.buffer.length}`);
    check('sekme sorusu sorulmadı', s.tabPrompt === null);
    check('kayıt vardığı node ve sekmeden sürer', s.currentNodeId === endNode && s.tabId === T2, `${s.currentNodeId} ${s.tabId} ${T2}`);
    const graphMarks = await panel.evaluate(() => cy.edges('.replay-passed').length);
    check('graph: geçen edge\'ler yeşil', graphMarks === 7, String(graphMarks));
    const flagAfter = await panel.evaluate(() => chrome.storage.session.get('replay').then((r) => r.replay));
    check('bitince kayıt bayrağı kalktı', flagAfter === false);
    const stillAttached = await panel.evaluate((ids) => Promise.all(ids.map((tabId) => chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' }).then(() => tabId, () => null))), [T0, T2].filter(Boolean));
    check('debugger ayrıldı', stillAttached.every((x) => x === null), JSON.stringify(stillAttached));
    // Oynatmadan sonra kayıt sürer: docs sekmesinde aksiyon kaydedilir
    const docs2 = ctx.pages().find((p) => p.url().endsWith('/docs'));
    if (!docs2) throw new Error('docs sekmesi yok');
    await docs2.bringToFront();
    await docs2.click('#read');
    await sleep(800);
    s = await getState();
    check('oynatmadan sonra kayıt sürüyor', s.buffer.length === 1 && s.buffer[0].type === 'click', JSON.stringify(s.buffer.map((a) => a.type)));
    await docs2.close();

    // ---- Kalan oynatma: edge set farklı ----
    broken = true;
    await page0.goto(BASE + '/');
    await page0.bringToFront();
    await sleep(800);
    await panel.evaluate(() => document.getElementById('btn-replay').click());
    await sleep(500);
    // bekleyen 1 aksiyon var: uyarı kartı
    const warn2 = await panel.evaluate(() => ({ hidden: document.getElementById('replay-check').hidden, reasons: document.getElementById('replay-check-reasons').textContent }));
    check('bekleyen aksiyon: uyarı', !warn2.hidden && warn2.reasons.includes('silinecek'), warn2.reasons);
    await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await panel.waitForFunction(() => replayResult && !replay && replayResult.steps[0].status !== 'passed', null, { timeout: 60000 });
    const fail = await panel.evaluate(() => ({
      status: replayResult.status, step: replayResult.steps.findIndex((x) => x.status === 'failed'),
      diff: document.getElementById('replay-diff').textContent, shot: Boolean(replayResult.steps.find((x) => x.status === 'failed')?.screenshot),
      compare: !document.getElementById('replay-result-actions').hidden, skipped: replayResult.steps.filter((x) => x.status === 'skipped').length,
    }));
    check('kalan oynatma: ilk edge kaldı', fail.status === 'failed' && fail.step === 0, JSON.stringify(fail));
    check('fark: button:extra', fail.diff.includes('button:extra: beklenen 0, ekranda 1'), fail.diff);
    check('kalanlar atlandı', fail.skipped === 6);
    check('ekran görüntüsü ve karşılaştır butonu', fail.shot && fail.compare);
    await panel.evaluate(() => document.getElementById('btn-replay-compare').click());
    await panel.waitForFunction(() => document.querySelector('#replay-compare-view canvas') && document.getElementById('replay-compare-info').textContent.includes('Görsel fark'), null, { timeout: 10000 });
    const info = await panel.textContent('#replay-compare-info');
    check('karşılaştırma penceresi', /Görsel fark: <?%[\d,]+ · \d+ farklı bölge/.test(info), info);
    await panel.evaluate(() => document.getElementById('btn-replay-compare-close').click());
    s = await getState();
    check('kalınca şu anki node bilinmiyor', s.currentNodeId === null && s.buffer.length === 0);
    const failMsg = await panel.textContent('#message');
    check('kalınca panel mesajı', failMsg.includes('Buradan devam et'), failMsg);

    // ---- Durdurma ----
    broken = false;
    await page0.goto(BASE + '/');
    await page0.bringToFront();
    await sleep(800);
    await panel.evaluate(() => { document.getElementById('replay-slow').checked = true; document.getElementById('btn-replay').click(); });
    await sleep(500);
    if (await panel.evaluate(() => !document.getElementById('replay-check').hidden)) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    await sleep(1500);
    await panel.evaluate(() => document.getElementById('btn-replay-stop').click());
    await panel.waitForFunction(() => replayResult && !replay && replayResult.status === 'stopped', null, { timeout: 20000 });
    const stopped = await panel.evaluate(() => ({ text: document.getElementById('replay-status').textContent, steps: replayResult.steps.map((x) => x.status) }));
    check('durdurma', stopped.text.startsWith('Durduruldu'), JSON.stringify(stopped));
    const flagStop = await panel.evaluate(() => chrome.storage.session.get('replay').then((r) => r.replay));
    check('durdurunca bayrak kalktı', flagStop === false);
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
