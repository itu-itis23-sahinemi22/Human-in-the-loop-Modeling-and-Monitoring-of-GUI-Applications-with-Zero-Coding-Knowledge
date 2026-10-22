// Yeni sekmede / başka sitede devam testi.
// Kullanım: node tests/e2e/tabs.test.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');
const OUT = outDir('tabs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const SITE_A = {
  '/': html('Magaza', `<a id="docs" href="/docs" target="_blank">Dokumanlar</a> <button id="a">A</button>`),
  '/docs': html('Dokumanlar', `<h1>Docs</h1><button id="d">D</button>`),
};
const SITE_B = {
  '/': html('Posta', `<button id="verify">Dogrula</button><script>verify.onclick = () => { const a = document.createElement('a'); a.id = 'done'; a.href = '#ok'; a.textContent = 'Tamam'; document.body.append(a); };</script>`),
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const types = (actions) => actions.map((a) => a.type + (a.type === 'tab' ? `(${a.operation}${a.by ? ',' + a.by : ''}${a.active !== undefined ? ',active=' + a.active : ''})` : '')).join(', ');
const serve = (pages) => new Promise((resolve) => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(pages[req.url.split('?')[0]] ?? 'yok'); });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

(async () => {
  const serverA = await serve(SITE_A);
  const serverB = await serve(SITE_B);
  const A = `http://127.0.0.1:${serverA.address().port}/`;
  const B = `http://localhost:${serverB.address().port}/`; // başka origin: başka site
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-tabs-')), {
    executablePath: CHROME, headless: true, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  let model;
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page0 = ctx.pages()[0] ?? await ctx.newPage();
    await page0.goto(A);
    await sleep(800);
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    await page0.bringToFront();
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    const tabOf = (page) => panel.evaluate((url) => chrome.tabs.query({}).then((ts) => ts.filter((t) => t.url === url).map((t) => t.id)), page.url());
    const createNode = async (tabId, resolveTo) => {
      const r = await send({ type: 'CREATE_NODE', tabId, windowId: undefined });
      let s = await getState();
      if (s.pending) { await send({ type: 'RESOLVE', targetId: resolveTo ?? null }); s = await getState(); }
      return { r, s };
    };
    const [T0] = await tabOf(page0);

    // 1) İlk node
    let { s } = await createNode(T0);
    check('ilk node, kayıt sekmesi', s.nodes.length === 1 && s.tabId === T0 && s.tabs.length === 1);

    // 2) Sitenin açtığı sekme: soru
    const popup = ctx.waitForEvent('page');
    await page0.click('#docs');
    const page1 = await popup;
    await page1.waitForLoadState();
    await sleep(1500);
    s = await getState();
    check('sitenin açtığı sekme: soru soruldu', s.tabPrompt?.openedByPage === true && s.tabPrompt.url.endsWith('/docs'), JSON.stringify(s.tabPrompt));
    check('panelde kart', await panel.isVisible('#tab-prompt') && (await panel.textContent('#tab-prompt-text')).includes('Kayıt sekmesinin açtığı'));

    // 3) Evet: kayıt yeni sekmede sürer
    await panel.click('#btn-tab-follow');
    await sleep(1000);
    s = await getState();
    const [T1] = await tabOf(page1);
    check('Evet: kayıt yeni sekmede', s.tabId === T1 && s.tabs.length === 2 && s.tabPrompt === null, `tabId=${s.tabId} T1=${T1}`);
    check('aksiyonlar: click, tab(open, page)', types(s.buffer) === 'click, tab(open,page)', types(s.buffer));
    check('sekme aksiyonu ekranı değiştirdi', s.buffer.at(-1)?.changed === true, String(s.buffer.at(-1)?.changed));
    ({ s } = await createNode(T1));
    let edge = s.edges.at(-1);
    check('node ve edge e_OpenTabDocs', edge?.name === 'e_OpenTabDocs' && s.nodes.length === 2, edge?.name);

    // 4) Yeni sekmede aksiyon, sekmeyi kapatıp eski sekmeye dönüş
    await page1.click('#d');
    await sleep(800);
    await page1.close();
    await sleep(1500);
    s = await getState();
    const tail = types(s.buffer);
    check('kapat ve dön: click, tab(close), tab(switch)', ['click, tab(close,active=true), tab(switch)', 'click, tab(switch), tab(close,active=false)'].includes(tail), tail);
    check('kayıt eski sekmede', s.tabId === T0 && s.tabs.length === 1, `tabId=${s.tabId}`);
    ({ s } = await createNode(T0, s.nodes[0].id));
    check('eski sekmede node: ilk node ile aynı state', s.currentNodeId === s.nodes[0].id && s.edges.length === 2);

    // 5) Kullanıcının açtığı başka site: Hayır
    let next = ctx.waitForEvent('page');
    await panel.evaluate((url) => chrome.tabs.create({ url, active: true }), B);
    const page2 = await next;
    await page2.waitForLoadState();
    await sleep(1500);
    s = await getState();
    check('kullanıcının açtığı sekme: soru (sayfa açmadı)', s.tabPrompt?.openedByPage === false && s.tabPrompt.url.startsWith(B), JSON.stringify(s.tabPrompt));
    await panel.click('#btn-tab-decline');
    await sleep(500);
    await page2.click('#verify');
    await sleep(800);
    s = await getState();
    const [T2] = await tabOf(page2);
    check('Hayır: sekme hatırlandı, aksiyonu kaydedilmedi', s.declinedTabs.includes(T2) && s.buffer.length === 0 && s.tabId === T0, types(s.buffer));
    await page0.bringToFront();
    await sleep(500);
    await page2.bringToFront();
    await sleep(800);
    s = await getState();
    check('Hayır denen sekmeye dönünce soru yok', s.tabPrompt === null);

    // 6) Hayır denen sekmede "Node oluştur": soru yeniden
    let r;
    ({ r, s } = await createNode(T2));
    check('Node oluştur: soru yeniden', r.notice?.includes('Farklı bir sekmedesiniz') && s.tabPrompt?.tabId === T2 && !s.declinedTabs.includes(T2), JSON.stringify(r));
    await panel.click('#btn-tab-decline');
    await sleep(300);

    // 7) Kullanıcının açtığı başka site: Evet
    next = ctx.waitForEvent('page');
    await panel.evaluate((url) => chrome.tabs.create({ url, active: true }), B);
    const page3 = await next;
    await page3.waitForLoadState();
    await sleep(1500);
    await panel.click('#btn-tab-follow');
    await sleep(1000);
    await page3.click('#verify');
    await sleep(800);
    s = await getState();
    const [T3] = (await tabOf(page3)).filter((id) => id !== T2);
    check('Evet: tab(open, user), click', types(s.buffer) === 'tab(open,user), click' && s.tabId === T3, types(s.buffer));
    ({ s } = await createNode(T3));
    edge = s.edges.at(-1);
    check('başka sitede node', s.nodes.length === 3 && edge.source === s.nodes[0].id, `${edge.name}: ${types(edge.actions)}`);
    model = await panel.evaluate(() => graphWalkerModel());

    // 8) Kayıt sekmelerinin hepsi kapanınca: ancak aynı ekrandaki sekmede devam
    await page2.close();
    await page3.close();
    await page0.close();
    await sleep(1000);
    s = await getState();
    check('kayıt sekmesi kalmadı', s.tabId === null && s.tabs.length === 0, `tabId=${s.tabId}`);
    next = ctx.waitForEvent('page');
    await panel.evaluate((url) => chrome.tabs.create({ url, active: true }), B);
    const page4 = await next;
    await page4.waitForLoadState();
    await sleep(1500);
    s = await getState();
    check('kapandıktan sonra soru', s.tabPrompt?.url.startsWith(B), JSON.stringify(s.tabPrompt));
    r = await send({ type: 'RESOLVE_TAB', follow: true });
    s = await getState();
    check('farklı ekranda devam edilmez', r.notice?.includes('ekranında değil') && s.tabId === null, JSON.stringify(r));
    await page4.click('#verify'); // şimdi şu anki node'un ekranında
    await sleep(800);
    const [T4] = await tabOf(page4);
    ({ r, s } = await createNode(T4));
    r = await send({ type: 'RESOLVE_TAB', follow: true });
    s = await getState();
    check('aynı ekranda devam edilir', s.tabId === T4 && s.tabs.length === 1 && r.notice?.includes('Kayıt bu sekmede sürüyor'), JSON.stringify(r));
  } finally {
    await ctx.close();
  }

  const file = path.join(OUT, 'tabs.json');
  fs.writeFileSync(file, JSON.stringify(model, null, 2));
  const edges = model.models[0].edges.map((e) => e.id).join(',');
  console.log(`\n=== runner (${edges})`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, 'runner', 'run.js'), file, '--path', edges, '--out', path.join(OUT, 'run')], { stdio: 'inherit' });
    child.on('exit', resolve);
  });
  check('runner geçti', code === 0, `çıkış kodu ${code}`);
  serverA.close();
  serverB.close();
  console.log(failures ? `\n${failures} kontrol başarısız` : '\nTüm kontroller geçti');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
