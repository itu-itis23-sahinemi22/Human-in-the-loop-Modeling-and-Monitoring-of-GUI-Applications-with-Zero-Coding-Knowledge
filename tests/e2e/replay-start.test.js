// Senaryoda başlangıç node'u seçmek ve oynatmanın görünen alanı kayıttakine getirmesi.
// Kullanım: node tests/e2e/replay-start.test.js [--headed] [--small-screen]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir, skipCleanup } = require('./env');

const HEADED = process.argv.includes('--headed');
const SMALL = process.argv.includes('--small-screen'); // sanal ekran kayıttaki pencereden küçük: pencereyle boyut tutturulamaz
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let broken = false; // true: 'Goster' bir şey göstermez, koşu kalır

const PAGES = {
  '/': () => `<!doctype html><title>Giris</title><input id="user" placeholder="Kullanici"> <button id="login" type="button">Giris</button>
    <script>login.onclick = () => { if (user.value === 'ali') location.href = '/app'; };</script>`,
  '/app': () => `<!doctype html><title>Uygulama</title>
    <p><button id="show">Goster</button> <span id="slot"></span></p>
    <p><label><input type="checkbox" id="agree"> Onay</label> <button id="go" disabled>Devam</button></p>
    <script>
      show.onclick = () => { ${broken ? '' : "slot.innerHTML = '<button id=\"hide\">Gizle</button>';"} };
      agree.onchange = () => { go.disabled = !agree.checked; };
    </script>`,
};

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = http.createServer((req, res) => {
    const render = PAGES[req.url.split('?')[0]];
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(render ? render() : 'yok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-start-'));
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    executablePath: CHROME, headless: !HEADED, viewport: null, ignoreDefaultArgs: ['--hide-scrollbars'], acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1200,900', ...(SMALL ? [] : ['--screen-info={0,0 1920x1080}']), ...(HEADED ? ['--window-position=-2400,0'] : [])],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const page0 = ctx.pages()[0] ?? await ctx.newPage();
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel/panel.html`);
    const send = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
    const getState = () => panel.evaluate(() => chrome.storage.local.get('activeGraph').then(({ activeGraph }) => chrome.storage.local.get('graph:' + activeGraph)).then((r) => Object.values(r)[0]));
    await page0.goto(BASE + '/');
    await page0.bringToFront();
    const T0 = await panel.evaluate((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url ?? '').startsWith(u)).id), BASE + '/');
    const createNode = async () => {
      await sleep(700);
      await send({ type: 'CREATE_NODE', tabId: T0 });
      if ((await getState()).pending) await send({ type: 'RESOLVE', targetId: null });
      return getState();
    };

    // ---- Kayıt: giriş -> uygulama -> göster -> onay ----
    await sleep(500);
    await createNode();
    await page0.fill('#user', 'ali');
    await page0.click('#login');
    await page0.waitForURL('**/app');
    await createNode();
    await page0.click('#show');
    await createNode();
    await page0.check('#agree');
    let s = await createNode();
    check('kayıt: 4 node, 3 edge', s.nodes.length === 4 && s.edges.length === 3);
    const [n1, n2] = s.nodes.map((n) => n.id);
    const [eLogin, eShow, eCheck] = s.edges.map((e) => e.id);
    const recorded = s.nodes[1].viewport;

    // ---- Başlangıç node'u seç ----
    const startOptions = await panel.evaluate(async () => { document.getElementById('scenario').open = true; await createScenario({ name: 'Test', start: null, planner: { engine: 'manual' }, runs: [[]] }); return [...document.querySelectorAll('#scenario-start option')].map((o) => o.textContent); });
    check('başlangıç listesi: graph başlangıcı önce', startOptions.length === 4 && startOptions[0].includes("graph'ın başlangıcı"), JSON.stringify(startOptions));
    check('varsayılan başlangıçta ipucu yok', await panel.evaluate(() => document.getElementById('scenario-start-hint').hidden));
    await panel.evaluate((id) => { const select = document.getElementById('scenario-start'); select.value = id; select.dispatchEvent(new Event('change')); }, n2);
    const afterSelect = await panel.evaluate(() => ({ hint: !document.getElementById('scenario-start-hint').hidden, start: cy.nodes('.run-start').map((n) => n.id()), next: cy.edges('.run-next').map((e) => e.id()) }));
    check('başka başlangıç: ipucu, graph işareti, gidilebilecek edge', afterSelect.hint && afterSelect.start[0] === n2 && afterSelect.next.join() === eShow, JSON.stringify(afterSelect));
    await panel.evaluate((id) => addScenarioEdge(id), eLogin);
    const rejected = await panel.textContent('#message');
    check('başlangıçtan çıkmayan edge reddedildi', rejected.includes('çıkmıyor'), rejected);
    await panel.evaluate(([a, b]) => { addScenarioEdge(a); addScenarioEdge(b); }, [eShow, eCheck]);
    const summary = await panel.textContent('#scenario-summary');
    check('kapsama yeni başlangıçla', summary.includes('2/3 edge') && summary.includes('3/4 node'), summary);

    // ---- İndir: start alanı; runner reddeder ----
    const [download] = await Promise.all([panel.waitForEvent('download'), panel.evaluate(() => document.getElementById('btn-scenario-download').click())]);
    const scenarioFile = path.join(tmp, download.suggestedFilename());
    await download.saveAs(scenarioFile);
    const scenarioJson = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
    check('senaryo dosyasında start', scenarioJson.start === n2 && JSON.stringify(scenarioJson.runs) === JSON.stringify([[eShow, eCheck]]), JSON.stringify(scenarioJson));
    const model = await panel.evaluate(() => graphWalkerModel());
    fs.writeFileSync(path.join(tmp, scenarioJson.model), JSON.stringify(model));
    const runner = spawnSync(process.execPath, [path.join(REPO, 'runner', 'run.js'), scenarioFile], { encoding: 'utf8' });
    check('runner başlangıcı farklı senaryoyu reddetti', runner.status === 2 && runner.stdout.concat(runner.stderr).includes("node'undan başlıyor"), `${runner.status} ${runner.stderr.trim()}`);
    // Yükle: start geri gelir
    await panel.evaluate(() => { scenario = emptyScenario(); renderScenario(); });
    await panel.setInputFiles('#scenario-file', scenarioFile);
    await sleep(300);
    const loaded = await panel.evaluate(() => ({ start: scenarioGraph().start, runs: scenario.runs }));
    check('yüklenen senaryo başlangıcıyla geldi', loaded.start === n2 && loaded.runs[0].length === 2, JSON.stringify(loaded));

    // ---- Görünen alan farklı: oynatma başlangıç node'unun boyutunu kendisi kurar ----
    // Sekme hem küçük hem yakınlaştırılmış; sonra pencere tam ekran. Pencereyle boyut tutturulamaz
    // (--small-screen ile ekran kayıttaki pencereden de küçüktür); taklit panelden bağımsız tutar.
    const replayAtApp = async () => {
      await page0.goto(BASE + '/app');
      await page0.bringToFront();
      await sleep(800);
      await panel.evaluate(() => { replayResult = null; document.getElementById('btn-replay').click(); });
      await skipCleanup(panel); // temizlik penceresi: Temizlemeden oynat
      await sleep(800);
      const card = await panel.evaluate(() => ({ hidden: document.getElementById('replay-check').hidden, fit: !document.getElementById('btn-replay-fit').hidden, reasons: document.getElementById('replay-check-reasons').textContent }));
      if (!card.hidden) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
      let reached = null; // oynatma sürerken sekmenin görünen alanı kayıttakine geldi mi
      for (const end = Date.now() + 30000; !reached && Date.now() < end;) {
        const now = await page0.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })).catch(() => null);
        if (now && now.width === recorded.width && now.height === recorded.height && Math.abs(now.devicePixelRatio - recorded.devicePixelRatio) < 0.001) reached = now;
        else if (await panel.evaluate(() => Boolean(replayResult))) break;
        else await sleep(50);
      }
      await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 60000 });
      const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}${x.warnings.length ? ' ' + x.warnings.join(' ') : ''}${x.mismatch ? ' ' + JSON.stringify(x.mismatch.diff) : ''}`), warnings: replayResult.steps.flatMap((x) => x.warnings) }));
      return { card, reached, result };
    };
    const { windowId } = await panel.evaluate((id) => chrome.tabs.get(id), T0);
    await panel.evaluate(([w, id]) => Promise.all([chrome.windows.update(w, { width: 1000, height: 720 }), chrome.tabs.setZoom(id, 1.25)]), [windowId, T0]);
    let run = await replayAtApp();
    check('görünen alan farklı: kartta boyut uyarısı ve "Başlangıç node\'una dön" yok', run.card.hidden || (!run.card.fit && !run.card.reasons.includes('Görünen alan')), JSON.stringify(run.card));
    check('oynatma görünen alanı kayıttakine getirdi', Boolean(run.reached), `kayıtta ${JSON.stringify(recorded)}`);
    check('başlangıçtan oynatma geçti, uyarı yok', run.result.status === 'passed' && !run.result.warnings.length, JSON.stringify(run.result.steps));

    await panel.evaluate((w) => chrome.windows.update(w, { state: 'maximized' }), windowId);
    run = await replayAtApp();
    check('tam ekran pencerede de görünen alan kayıttakine geldi', Boolean(run.reached), `kayıtta ${JSON.stringify(recorded)}`);
    check('tam ekranda oynatma geçti, uyarı yok', run.result.status === 'passed' && !run.result.warnings.length, JSON.stringify(run.result.steps));
    // ---- Kalan koşunun ekran görüntüsü: sekme kayıttakinden küçükken de taklidin tamamı ----
    await panel.evaluate((w) => chrome.windows.update(w, { state: 'normal' }).then(() => chrome.windows.update(w, { width: 900, height: 600 })), windowId);
    broken = true;
    run = await replayAtApp();
    broken = false;
    const shot = await panel.evaluate(async () => {
      const step = replayResult.steps.find((x) => x.status === 'failed');
      if (!step?.screenshot) return null;
      const image = new Image();
      image.src = step.screenshot;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    });
    const expected = { width: Math.round(recorded.width * recorded.devicePixelRatio), height: Math.round(recorded.height * recorded.devicePixelRatio) };
    check('kalan koşu: ekran görüntüsü kayıttaki boyutun tamamı', run.result.status === 'failed' && shot?.width === expected.width && shot?.height === expected.height, `${JSON.stringify(shot)} beklenen ${JSON.stringify(expected)} ${run.result.status}`);
    const released = await page0.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    check('oynatma bitince taklit kalktı', released.width !== recorded.width || released.height !== recorded.height, JSON.stringify(released));

    // ---- Başlangıcı geri al: koşular yürünemez, temizlenir ----
    await panel.evaluate((id) => { const select = document.getElementById('scenario-start'); select.value = id; select.dispatchEvent(new Event('change')); }, n1);
    const reset = await panel.evaluate(() => ({ runs: scenario.runs, start: scenarioGraph().start, message: document.getElementById('message').textContent, hint: document.getElementById('scenario-start-hint').hidden }));
    check('başlangıç değişince yürünemeyen koşular temizlendi', reset.runs.length === 1 && reset.runs[0].length === 0 && reset.start === n1 && reset.message.includes('temizlendi') && reset.hint, JSON.stringify(reset));
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
