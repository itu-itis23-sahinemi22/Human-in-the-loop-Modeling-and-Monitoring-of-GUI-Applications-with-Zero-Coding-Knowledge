// saucedemo: çıkış yapılmışken inventory.html başlangıçlı senaryoda "Başlangıç node'una dön"
// istemci tarafındaki yönlendirmeyi söylemeli. Graph panele yedek olarak yüklenir (kayıt yok).
// İnternet ister (www.saucedemo.com).
// Kullanım: node tests/e2e/saucedemo-return.test.js
const path = require('path'); const fs = require('fs'); const os = require('os');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-sauce-')), {
    executablePath: CHROME, headless: true, viewport: null, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900'],
  });
  try {
    let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent('serviceworker');
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto('https://example.com/');
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    const inv = 'https://www.saucedemo.com/inventory.html';
    await panel.evaluate(async (inv) => chrome.runtime.sendMessage({ type: 'IMPORT_GRAPH', graph: {
      format: GRAPH_BACKUP_FORMAT, name: 'Sauce', nextId: 4, startNodeId: 'n1',
      nodes: [
        { id: 'n1', name: 'v_Login', url: 'https://www.saucedemo.com/', urlKey: urlKey('https://www.saucedemo.com/'), elements: [{ key: 'input:user-name', types: ['input'], count: 1 }] },
        { id: 'n2', name: 'v_Inventory', url: inv, urlKey: urlKey(inv), elements: [{ key: 'button:add', types: ['button'], count: 6 }] },
      ],
      edges: [{ id: 'e3', name: 'e_Menu', source: 'n2', target: 'n2', actions: [{ type: 'click', label: 'Menu', selector: '#m', url: inv, time: 1 }] }],
    } }), inv);
    await sleep(500);
    await panel.evaluate(async () => {
      document.getElementById('scenario').open = true;
      await createScenario({ name: 'Test', planner: { engine: 'manual' }, start: 'n2', runs: [['e3']] });
      scenarioRun = 0; renderScenario();
    });
    await page.bringToFront();
    await panel.evaluate(() => document.getElementById('btn-replay').click());
    await sleep(1000);
    let c = await panel.evaluate(() => ({ hidden: document.getElementById('replay-check').hidden, fit: document.getElementById('btn-replay-fit').textContent }));
    check('kart ve buton', !c.hidden && c.fit.includes('adres'), JSON.stringify(c));
    await panel.evaluate(() => document.getElementById('btn-replay-fit').click());
    await sleep(500);
    await panel.waitForFunction(() => !document.getElementById('btn-replay-fit').disabled, null, { timeout: 30000 });
    const message = await panel.textContent('#message');
    check('yönlendirme söylendi', message.includes('başka bir adrese yönlendirdi') && message.includes('https://www.saucedemo.com/'), message);
    check('kart kaldı', !(await panel.evaluate(() => document.getElementById('replay-check').hidden)));
    console.log('sekme:', page.url());
  } finally { await ctx.close(); }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
