// Senaryoda başlangıç node'u seçmek ve oynatmadan önce görünen alanı kayıttakine getirmek.
// Kullanım: node tests/e2e/replay-start.test.js [--headed] [--small-screen]
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { chromium, REPO, EXT, CHROME, outDir } = require('./env');

const HEADED = process.argv.includes('--headed');
const SMALL = process.argv.includes('--small-screen'); // sanal ekran kayıttaki pencereden küçük: boyut tutturulamaz
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = {
  '/': () => `<!doctype html><title>Giris</title><input id="user" placeholder="Kullanici"> <button id="login" type="button">Giris</button>
    <script>login.onclick = () => { if (user.value === 'ali') location.href = '/app'; };</script>`,
  '/app': () => `<!doctype html><title>Uygulama</title>
    <p><button id="show">Goster</button> <span id="slot"></span></p>
    <p><label><input type="checkbox" id="agree"> Onay</label> <button id="go" disabled>Devam</button></p>
    <script>
      show.onclick = () => { slot.innerHTML = '<button id="hide">Gizle</button>'; };
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

    // ---- Görünen alan farklı: kayıttaki boyuta getir ----
    const { windowId } = await panel.evaluate((id) => chrome.tabs.get(id), T0);
    await panel.evaluate(([w, id]) => Promise.all([chrome.windows.update(w, { width: 1000, height: 720 }), chrome.tabs.setZoom(id, 1.25)]), [windowId, T0]);
    await page0.goto(BASE + '/app');
    await page0.bringToFront();
    await sleep(800);
    await panel.evaluate(() => document.getElementById('btn-replay').click());
    await sleep(800);
    const card = await panel.evaluate(() => ({ hidden: document.getElementById('replay-check').hidden, fit: !document.getElementById('btn-replay-fit').hidden, fitText: document.getElementById('btn-replay-fit').textContent, reasons: document.getElementById('replay-check-reasons').textContent }));
    check('görünen alan farklı: kart ve "Kayıttaki boyuta getir"', !card.hidden && card.fit && card.reasons.includes('Görünen alan'), JSON.stringify(card));
    await panel.evaluate(() => document.getElementById('btn-replay-fit').click());
    await panel.waitForFunction(() => !document.getElementById('btn-replay-fit').disabled, null, { timeout: 15000 });
    await sleep(300);
    const fitted = await page0.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
    if (SMALL) {
      const guide = await panel.evaluate(() => ({ hidden: document.getElementById('replay-fit-guide').hidden, text: document.getElementById('replay-fit-guide').textContent }));
      check('küçük ekran: pencereye dokunulmadı, yönlendirme, yakınlaştırma düzeldi', !guide.hidden && guide.text.includes('büyüyemiyor') && fitted.devicePixelRatio === 1 && fitted.width === 984, `${guide.text} ${JSON.stringify(fitted)}`);
      return;
    }
    check('görünen alan kayıttakine getirildi', fitted.width === recorded.width && fitted.height === recorded.height && Math.abs(fitted.devicePixelRatio - recorded.devicePixelRatio) < 0.001, `${JSON.stringify(fitted)} kayıtta ${JSON.stringify(recorded)}`);
    const after = await panel.evaluate(() => ({ hidden: document.getElementById('replay-check').hidden, fit: !document.getElementById('btn-replay-fit').hidden, reasons: document.getElementById('replay-check-reasons').textContent, message: document.getElementById('message').textContent }));
    check('kart güncellendi: görünen alan uyarısı kalktı', after.hidden ? after.message.includes('Koşuyu oynat') : !after.fit && !after.reasons.includes('Görünen alan'), JSON.stringify(after));
    if (!after.hidden) await panel.evaluate(() => document.getElementById('btn-replay-anyway').click());
    else await panel.evaluate(() => document.getElementById('btn-replay').click());

    // ---- Seçilen başlangıçtan oynatma ----
    await panel.waitForFunction(() => replayResult && !replay, null, { timeout: 60000 });
    const result = await panel.evaluate(() => ({ status: replayResult.status, steps: replayResult.steps.map((x) => `${x.name}:${x.status}${x.error ? ' ' + x.error : ''}${x.mismatch ? ' ' + JSON.stringify(x.mismatch.diff) : ''}`) }));
    check('başlangıçtan oynatma geçti', result.status === 'passed', JSON.stringify(result.steps));

    // ---- Pencere tam ekran, yan panel geniş (sekmenin genişliği taklitle daraltılır): pencereye dokunulmaz, yönlendirme ----
    await panel.evaluate((w) => chrome.windows.update(w, { state: 'maximized' }), windowId);
    await page0.goto(BASE + '/app');
    await page0.bringToFront();
    await sleep(800);
    const cdp = await ctx.newCDPSession(page0);
    const narrow = async (width) => { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: recorded.height, deviceScaleFactor: 0, mobile: false }); await sleep(300); };
    const guideText = () => panel.evaluate(() => (document.getElementById('replay-fit-guide').hidden ? null : document.getElementById('replay-fit-guide').textContent));
    await narrow(recorded.width - 287);
    await panel.evaluate(() => document.getElementById('btn-replay').click());
    await sleep(800);
    await panel.evaluate(() => document.getElementById('btn-replay-fit').click());
    await panel.waitForFunction(() => !document.getElementById('btn-replay-fit').disabled, null, { timeout: 15000 });
    await sleep(300);
    const winState = (await panel.evaluate((w) => chrome.windows.get(w), windowId)).state;
    let text = await guideText();
    check('tam ekran: pencere tam ekranda kaldı, "287 piksel daraltın"', winState === 'maximized' && text?.includes('287 piksel daraltın'), `${winState} ${text}`);
    check('yönlendirme sürerken buton gizli', await panel.evaluate(() => document.getElementById('btn-replay-fit').hidden));
    await narrow(recorded.width - 100);
    await panel.evaluate(() => dispatchEvent(new Event('resize')));
    await sleep(700);
    text = await guideText();
    check('panel daraldıkça kalan güncellendi: "100 piksel"', text?.includes('100 piksel daraltın'), String(text));
    await narrow(recorded.width + 10);
    await panel.evaluate(() => dispatchEvent(new Event('resize')));
    await sleep(700);
    text = await guideText();
    check('fazla daraltınca: "10 piksel fazla daralttınız"', text?.includes('10 piksel fazla daralttınız'), String(text));
    await narrow(recorded.width);
    await panel.evaluate(() => dispatchEvent(new Event('resize')));
    await sleep(900);
    const done = await panel.evaluate(() => ({ guide: document.getElementById('replay-fit-guide').hidden, reasons: document.getElementById('replay-check').hidden ? '' : document.getElementById('replay-check-reasons').textContent, message: document.getElementById('message').textContent }));
    check('tutunca yönlendirme bitti, görünen alan uyarısı kalktı', done.guide && !done.reasons.includes('Görünen alan'), JSON.stringify(done));
    await panel.evaluate(() => document.getElementById('btn-replay-cancel').click());
    await cdp.send('Emulation.clearDeviceMetricsOverride');

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
