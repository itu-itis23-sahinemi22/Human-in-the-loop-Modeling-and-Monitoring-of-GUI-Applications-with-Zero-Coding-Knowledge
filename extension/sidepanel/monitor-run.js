// =============================================================================
// monitor-run.js — MONİTÖRLERİN KONTROLÜ: OYNATMADA IŞIK LİSTESİ ve "ŞİMDİ KONTROL ET"
// -----------------------------------------------------------------------------
// Run-time monitoring'in çalışan kısmı (Ceren'in kısmı). Kullanıcı "Koşuyu oynat" deyince
// (panel.js > PANELDE OYNATMA, replay.js) tanımlı monitörler oynatma kartının altında alt alta
// listelenir ve her adımda kontrol edilip yeşil ya da kırmızı yanar. Işık ikilidir: bir adımda
// kural bozulduysa kırmızı, aksi halde yeşil. Kontrol edilemeyen durumlar (alan ekranda yok,
// sayfaya ulaşılamadı, adım oynatılmadı) ışığı kırmızı yapmaz; nedeni satırın ayrıntısında yazar.
//   - State tabanlı monitörler (hata metni, yazı boyutu…) her adımın sonunda, varılan ekran
//     doğrulandıktan sonra sayfada kontrol edilir (monitor-probe.js, MONITOR_PROBE).
//   - Aksiyon tabanlı Input Validation her aksiyondan sonra alana bakar (yazılan değer o anda
//     alandadır).
//   - Edge'in belirli bir aksiyonuna bağlı monitör (m.action, monitor-store.js) hangi türden olursa
//     olsun yalnızca o aksiyondan hemen sonra kontrol edilir (bir sonraki aksiyon oynatılmadan);
//     adımın sonunda yeniden kontrol edilmez. Aksiyon edge'de artık yoksa "kontrol edilemedi".
// Bir monitör bozulduğu AN ekran görüntüsü alınır ve uyarı olarak monitörün kendi yapısına yazılır
// (monitor-store.js > UYARILAR): aksiyon tabanlı monitörde alana yazıldıktan hemen sonra (bir sonraki
// aksiyon, ör. Login tıklaması, oynatılmadan önce), state tabanlı monitörde varılan ekranda. Adımın
// sonunu beklemek yanlış ekranı gösterirdi (Login'den sonra ürün sayfası). Küçük resim satırda,
// tıklayınca büyür. Sonuçlar oynatma bitince Monitörler listesine de yazılır ("Son kontrol").
//
// "Bu ekranda şimdi kontrol et": oynatmasız, açık sekmede, tüm model + seçili öğenin monitörleri
// anında kontrol edilir; sonuç Monitörler listesinde görünür.
//
// panel.js ve replay.js değiştirilmez; onların global fonksiyonları sarmalanır (monitor-export.js'teki
// graphWalkerModel gibi): startReplay (koşu başlıyor), verify (adımın sonu: varılan ekran doğrulandı),
// afterAction (bir aksiyon bitti), renderReplay (oynatma kartı yeniden çizildi). Emir isterse bu
// sarmalamalar o fonksiyonların içine birer satırlık çağrı olarak da konabilir.
// Detay: docs/07-monitorler.md
// =============================================================================

let activeRun = null;    // süren ya da en son biten oynatmanın monitör kontrolü (bkz. beginMonitorRun)
let liveChecking = false; // "şimdi kontrol et" sürüyor

const LED_TEXT = { ok: 'Yeşil: kural bozulmadı', fail: 'Kırmızı: kural bozuldu', pending: 'Henüz oynatılmadı' };

const verdictSkip = (text) => ({ status: 'skip', text });

// Sonucun ışığı: yalnızca yeşil ya da kırmızı. Kontrol edilemeyen (skip) ya da henüz kontrol
// edilmemiş sonuç kırmızı değildir.
function ledStatus(verdict) {
  return verdict?.status === 'fail' ? 'fail' : 'ok';
}


// -----------------------------------------------------------------------------
// OYNATMA: koşu başlarken monitörler seçilir, her adımda kontrol edilir
// -----------------------------------------------------------------------------

// Koşunun monitör kontrolü. steps oynatmanın adımlarıyla aynı sırada; her adımın verdicts'i
// monitör id -> { status, text, screenshot?, where?, alarmId? } (bozulduysa o anın görüntüsü ve
// uyarı kaydı). monitors: bu koşuda geçerli etkin monitörler (tüm model, koşudaki bir edge ya da
// koşunun vardığı bir node).
function beginMonitorRun(edges) {
  const run = {
    edges, replay: null, finished: false,
    steps: edges.map((edge, index) => ({ index, edgeId: edge.id, target: edge.target, verdicts: new Map() })),
    monitors: monitors.items.filter((m) => m.enabled && edges.some((e) => m.scope === 'global' || m.scope === e.id || m.scope === e.target)),
  };
  activeRun = run;
  return run;
}

// Açık sekmenin görünen kısmı (Emir'in node görüntüleriyle aynı biçim: jpeg, kalite 40); alınamazsa null.
// Chrome görüntü almayı saniyede 2 ile sınırlar (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND); art arda
// bozulmalarda (Emir'in kendi görüntüsü de dahil) sınır aşılırsa kısa bekleyip bir kez daha denenir.
// Görüntü monitörü (monitor-image.js) bu kontrol turunda çekim yaptıysa o kullanılır: uyarı zaten o
// anın görüntüsüdür, ikinci çekim gerekmez (sınır da zorlanmaz). Çekim bir kez kullanılır ve her kontrol
// turunun başında atılır (probeMonitors): bir sonraki adımın uyarısına eski ekran gitmesin.
let recentCapture = null; // { tabId, screenshot }

async function monitorScreenshot(tabId) {
  const recent = recentCapture;
  recentCapture = null;
  if (recent && recent.tabId === tabId) return recent.screenshot;
  const options = { format: 'jpeg', quality: 40 };
  try {
    const { windowId } = await chrome.tabs.get(tabId);
    try {
      return await chrome.tabs.captureVisibleTab(windowId, options);
    } catch (error) {
      if (!/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota|exceed/i.test(error?.message ?? '')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600));
      return await chrome.tabs.captureVisibleTab(windowId, options);
    }
  } catch {
    return null;
  }
}

// Bozulan monitörler için uyarı: görüntü ŞİMDİ, bir kez alınır (aynı anda bozulanlar paylaşır),
// her monitörün sonucuna iliştirilir ve uyarı olarak kaydedilir (monitor-store.js > addMonitorAlarms).
// action: aksiyon tabanlı kontrolde { index, count, label } (hangi aksiyondan hemen sonra), yoksa null.
async function raiseAlarms(run, replay, step, failing, action = null) {
  if (!failing.length) return;
  const screenshot = await monitorScreenshot(replay.tabId);
  let url = '';
  try { url = (await chrome.tabs.get(replay.tabId)).url ?? ''; } catch { /* sekme kapandı */ }
  const where = stepLabel(run, step) + (action ? ` · aksiyon ${action.index + 1}/${action.count}: ${action.label}` : '');
  for (const m of failing) Object.assign(step.verdicts.get(m.id), { screenshot, where });
  try {
    const alarms = await addMonitorAlarms(failing.map((m) => ({ // tek yazım (monitor-store.js > UYARILAR)
      monitorId: m.id, source: 'replay', where, text: step.verdicts.get(m.id).text, url, screenshot,
      step: { index: step.index, edgeId: step.edgeId, target: step.target }, action,
    })));
    failing.forEach((m, i) => { step.verdicts.get(m.id).alarmId = alarms[i].id; });
  } catch (error) {
    console.warn('Monitör uyarıları kaydedilemedi:', error);
  }
}

function stepMonitors(run, step) {
  return run.monitors.filter((m) => appliesTo(m, step));
}

function appliesTo(m, step) {
  return m.scope === 'global' || m.scope === step.edgeId || m.scope === step.target;
}

// startReplay sarmalanır: koşu başlarken monitörler seçilir; koşu bitince sonuçlar toplanır.
const startReplayWithoutMonitors = startReplay; // replay.js
startReplay = (options) => {
  const run = beginMonitorRun(options.edges);
  const started = startReplayWithoutMonitors(options);
  run.replay = started;
  started.done.then((result) => finishMonitorRun(run, result)).catch(() => finishMonitorRun(run, null));
  return started;
};

// verify sarmalanır: adımın aksiyonları bitti, varılan ekran beklenen node ile karşılaştırıldı.
// Monitörler burada, oynatma bir sonraki adıma geçmeden kontrol edilir (await).
const verifyWithoutMonitors = verify; // replay.js
verify = async (replay, node) => {
  const result = await verifyWithoutMonitors(replay, node);
  const run = activeRun;
  if (run && run.replay === replay && !replay.stopped) {
    try {
      await checkStepMonitors(run, replay, result);
    } catch (error) {
      console.warn('Monitör kontrolü yapılamadı:', error);
    }
  }
  return result;
};

// Bu aksiyondan hemen sonra kontrol edilecek monitörler: edge'in bu aksiyonuna bağlı olanlar (her
// tür) + aksiyona bağlı olmayan, kontrol biçimi "aksiyon tabanlı" olan türler (monitor-types.js >
// when: 'action'; bugün Input Validation): her aksiyondan sonra.
function monitorsAfterAction(run, step, edge, actionIndex) {
  return stepMonitors(run, step).filter((m) => (m.action
    ? m.scope === step.edgeId && resolveMonitorAction(m.action, edge?.actions) === actionIndex
    : monitorType(m.type)?.when === 'action'));
}

// afterAction sarmalanır: bir aksiyon oynatıldı ve sayfa duruldu. Aksiyon tabanlı Input Validation
// alana şimdi bakar (yazılan değer alanda); edge'in bu aksiyonuna bağlı monitörler de şimdi kontrol
// edilir. Alan ekranda yoksa önceki sonuç korunur. Bozulduysa görüntü bu anda alınır: oynatma bir
// sonraki aksiyona (Login tıklaması gibi) bu kontrol bitmeden geçmez (await). Adımda ilk bozulma
// anı kalır; sonraki aksiyonlar sonucu değiştirmez.
const afterActionWithoutMonitors = afterAction; // replay.js
afterAction = async (replay) => {
  await afterActionWithoutMonitors(replay);
  const run = activeRun;
  if (!run || run.replay !== replay || replay.stopped) return;
  const step = run.steps[replay.step];
  if (!step) return;
  const edge = run.edges[step.index];
  const list = monitorsAfterAction(run, step, edge, replay.action);
  if (!list.length) return;
  try {
    const results = await probeMonitors(replay.tabId, list, replay);
    const failing = [];
    for (const m of list) {
      const now = results[m.id];
      const before = step.verdicts.get(m.id);
      if (before?.status === 'fail') continue; // ilk bozulma anı (görüntüsüyle) korunur
      if (now.status === 'skip' && before && before.status !== 'skip') continue;
      step.verdicts.set(m.id, now);
      if (now.status === 'fail') failing.push(m);
    }
    const played = edge?.actions?.[replay.action];
    const label = played?.type === 'wait' && Number.isFinite(played.ms) ? `Bekle ${waitSeconds(played.ms)}` : replay.actionLabel; // "aksiyon 2/4: Bekle 10 sn"
    await raiseAlarms(run, replay, step, failing, { index: replay.action, count: edge?.actions?.length ?? 0, label });
    renderMonitorRun();
  } catch (error) {
    console.warn('Monitör kontrolü yapılamadı:', error);
  }
};

// Adımın sonunda: adımda geçerli monitörler sayfada kontrol edilir. Ekran beklenen node değilse
// (adım kalacak) node monitörleri kontrol edilmez; tüm model ve aksiyon monitörleri yine edilir.
async function checkStepMonitors(run, replay, verdict) {
  const step = run.steps[replay.step];
  if (!step) return;
  const arrived = Boolean(verdict?.ok);
  const toProbe = [];
  const edge = run.edges[step.index];
  for (const m of stepMonitors(run, step)) {
    if (step.verdicts.has(m.id)) continue; // aksiyon sırasında kontrol edildi (aksiyon tabanlı tür, aksiyona bağlı monitör)
    if (!monitorType(m.type)) { step.verdicts.set(m.id, verdictSkip('tür tanımlı değil')); continue; }
    if (m.action) { // yalnızca kendi aksiyonundan sonra kontrol edilir; buraya geldiyse o aksiyon oynatılmadı
      step.verdicts.set(m.id, verdictSkip(resolveMonitorAction(m.action, edge?.actions) < 0 ? `aksiyon edge'de bulunamadı (${m.action.index + 1}. ${m.action.label})` : 'aksiyonu bu adımda oynatılmadı'));
      continue;
    }
    if (m.scope === step.target && !arrived) { step.verdicts.set(m.id, verdictSkip('node\'a varılamadı: ekran beklenen node değil')); continue; }
    toProbe.push(m);
  }
  if (toProbe.length) {
    const results = await probeMonitors(replay.tabId, toProbe, replay);
    for (const m of toProbe) step.verdicts.set(m.id, results[m.id]);
    await raiseAlarms(run, replay, step, toProbe.filter((m) => results[m.id].status === 'fail')); // varılan ekranın görüntüsü, şimdi
  }
  renderMonitorRun();
}

// Koşu bitti: oynatılmayan adımların monitörleri "kontrol edilemedi" diye not edilir, sonuçlar
// Monitörler listesine yazılır.
function finishMonitorRun(run, result) {
  run.finished = true;
  for (const step of run.steps) {
    const status = result?.steps[step.index]?.status ?? 'skipped';
    for (const m of stepMonitors(run, step)) {
      if (step.verdicts.has(m.id)) continue;
      step.verdicts.set(m.id, verdictSkip(status === 'skipped' ? 'adım oynatılmadı (koşu önce kaldı)' : status === 'stopped' ? 'oynatma durduruldu' : 'adım tamamlanamadı'));
    }
  }
  for (const m of run.monitors) monitorVerdicts.set(m.id, { status: aggregateStatus(run, m), text: aggregateText(run, m) + ' (son oynatma)' });
  if (run.monitors.length) renderMonitors();
  renderMonitorRun();
}


// -----------------------------------------------------------------------------
// SAYFADA KONTROL (monitor-probe.js)
// -----------------------------------------------------------------------------

// Sayfaya ulaşılamazsa (eklenti yüklenmeden önce açılmış sayfa, tarayıcının kendi sayfası)
// hepsi 'skip'. Oynatma "Durdur" ile durdurulursa cevap beklenmez, kalanlar 'skip' olur.
// Cevap MONITOR_PROBE_TIMEOUT_MS içinde gelmezse (sayfa donmuş, ağır bir desen sayfayı
// kilitlemiş) beklemek bırakılır: ne "şimdi kontrol et" ne oynatma süresiz askıda kalır.
const MONITOR_PROBE_TIMEOUT_MS = 10000;

// Liste ikiye ayrılır: sayfada kontrol edilen türler tek mesajla sayfaya gider; panelde kontrol edilen
// türler (monitor-types.js > side: 'panel'; görüntü monitörü) sekmenin ekran görüntüsünde burada bakılır.
async function probeMonitors(tabId, list, replay = null) {
  const inPage = list.filter((m) => monitorType(m.type)?.side !== 'panel');
  const inPanel = list.filter((m) => monitorType(m.type)?.side === 'panel');
  const results = {};
  recentCapture = null;
  if (inPage.length) Object.assign(results, await probeInPage(tabId, inPage, replay));
  if (inPanel.length && !replay?.stopped) Object.assign(results, await probeInPanel(tabId, inPanel));
  for (const m of list) results[m.id] ??= verdictSkip('oynatma durduruldu');
  return results;
}

async function probeInPage(tabId, list, replay) {
  const checks = list.map((m) => ({ id: m.id, type: m.type, params: m.params }));
  const skipAll = (text) => Object.fromEntries(list.map((m) => [m.id, verdictSkip(text)]));
  let stopTimer = null;
  let timeout = null;
  const stopped = new Promise((resolve) => {
    if (replay) stopTimer = setInterval(() => { if (replay.stopped) resolve(null); }, 200);
  });
  const timedOut = new Promise((resolve) => { timeout = setTimeout(() => resolve('timeout'), MONITOR_PROBE_TIMEOUT_MS); });
  try {
    const response = await Promise.race([chrome.tabs.sendMessage(tabId, { type: 'MONITOR_PROBE', checks }, { frameId: 0 }), stopped, timedOut]);
    if (response === null) return skipAll('oynatma durduruldu');
    if (response === 'timeout') return skipAll(`sayfa ${MONITOR_PROBE_TIMEOUT_MS / 1000} sn içinde cevap vermedi (sayfa donmuş ya da desen çok ağır olabilir)`);
    if (!response) throw new Error('sayfa cevap vermedi');
    if (response.error) throw new Error(response.error);
    return Object.fromEntries(list.map((m) => [m.id, response.results[m.id] ?? verdictSkip('sonuç gelmedi')]));
  } catch (error) {
    return skipAll(`sayfaya ulaşılamadı (${error.message}). Sayfa eklenti yüklenmeden önce açıldıysa yenileyin.`);
  } finally {
    clearInterval(stopTimer);
    clearTimeout(timeout);
  }
}

// Görüntü monitörleri (monitor-image.js): hepsi için tek ekran görüntüsü; o görüntü uyarı için de saklanır.
async function probeInPanel(tabId, list) {
  try {
    const { results, screenshot } = await checkImageMonitors(tabId, list);
    if (screenshot) recentCapture = { tabId, screenshot };
    return Object.fromEntries(list.map((m) => [m.id, results[m.id] ?? verdictSkip('sonuç gelmedi')]));
  } catch (error) {
    return Object.fromEntries(list.map((m) => [m.id, verdictSkip(`görüntü kontrol edilemedi (${error.message})`)]));
  }
}


// -----------------------------------------------------------------------------
// LED LİSTESİ (oynatma kartının içinde, adım listesinin altında)
// -----------------------------------------------------------------------------

(function mountMonitorRunUi() {
  const block = document.createElement('div');
  block.id = 'monitor-run';
  block.className = 'monitor-run';
  block.hidden = true;
  block.innerHTML = `
    <div class="monitor-run-head"><b>Monitörler</b> <span id="monitor-run-summary"></span></div>
    <ul id="monitor-run-list" class="led-list"></ul>
    <p id="monitor-run-empty" class="hint" hidden></p>`;
  $('replay-steps').after(block);
})();

// Panelde gösterilen oynatma (süren ya da seçili koşunun son sonucu; panel.js > shownReplay) bu
// kontrolün oynatması mı? Başka bir senaryoya / koşuya geçilince panel sonucu gizler, liste de gizlenir.
function shownRun() {
  const run = activeRun;
  const shown = shownReplay(); // panel.js
  if (!run?.replay || !shown) return null;
  return shown === run.replay || shown.steps === run.replay.steps ? run : null;
}

// renderReplay sarmalanır: oynatma kartı her çizildiğinde LED listesi de çizilir / gizlenir.
const renderReplayWithoutMonitors = renderReplay; // panel.js
renderReplay = () => {
  renderReplayWithoutMonitors();
  renderMonitorRun();
};

function renderMonitorRun() {
  const run = shownRun();
  const block = $('monitor-run');
  block.hidden = !run;
  if (!run) return;
  const running = !run.finished;
  const counts = { ok: 0, fail: 0 };
  const rows = run.monitors.map((m) => {
    const status = aggregateStatus(run, m);
    counts[status]++;
    return monitorLedRow(run, m, status);
  });
  $('monitor-run-list').replaceChildren(...rows);
  $('monitor-run-empty').hidden = run.monitors.length > 0;
  $('monitor-run-empty').textContent = run.monitors.length ? '' : 'Bu koşuda geçerli etkin monitör yok. Monitörler bölümünden ya da graph\'ta sağ tıkla ekleyin.';
  const parts = [counts.fail ? `${counts.fail} kırmızı` : '', counts.ok ? `${counts.ok} yeşil` : ''].filter(Boolean);
  $('monitor-run-summary').textContent = run.monitors.length
    ? `${run.monitors.length} monitör · ${running ? 'kontrol ediliyor · ' : ''}${parts.join(' · ')}`
    : '';
  $('monitor-run-summary').classList.toggle('running', running);
}

// Monitörün koşudaki ışığı: herhangi bir adımda bozuldu -> kırmızı, yoksa yeşil.
function aggregateStatus(run, m) {
  const steps = run.steps.filter((s) => appliesTo(m, s));
  return steps.some((s) => s.verdicts.get(m.id)?.status === 'fail') ? 'fail' : 'ok';
}

// Satırın ayrıntısı: bozulduysa ilk bozulan adım ve nedeni; geçtiyse kaç adımda kontrol edildiği
// ve son adımın özeti; kontrol edilemediyse nedeni; henüz adım oynatılmadıysa "bekliyor".
function aggregateText(run, m) {
  const steps = run.steps.filter((s) => appliesTo(m, s));
  const failed = steps.find((s) => s.verdicts.get(m.id)?.status === 'fail');
  if (failed) return `${failed.verdicts.get(m.id).where ?? stepLabel(run, failed)}: ${failed.verdicts.get(m.id).text}`; // where: bozulma anı (adım + varsa aksiyon)
  const checked = steps.filter((s) => s.verdicts.get(m.id)?.status === 'ok');
  if (checked.length) {
    const last = checked.at(-1);
    return `${checked.length} adımda kontrol edildi, bozulma yok · ${stepLabel(run, last)}: ${last.verdicts.get(m.id).text}`;
  }
  const skipped = steps.find((s) => s.verdicts.get(m.id)?.status === 'skip');
  if (skipped) return `Kontrol edilemedi · ${stepLabel(run, skipped)}: ${skipped.verdicts.get(m.id).text}`;
  return run.finished ? 'Kontrol edilemedi' : 'Bekliyor: adımı henüz oynatılmadı…';
}

function stepLabel(run, step) {
  const edge = run.edges[step.index];
  return `Adım ${step.index + 1} (${edge?.name ?? step.edgeId} → ${nodeById(step.target)?.name ?? step.target})`;
}

// Bir monitörün satırı: LED · ad / kapsam · adım izi (her adım bir kare) · ayrıntı · ekran görüntüsü
function monitorLedRow(run, m, status) {
  const li = document.createElement('li');
  li.className = `led-row ${status}`;
  li.innerHTML = '<span class="led"></span><div class="led-body"><div class="led-title"><b></b><small class="scope"></small></div><span class="trail"></span><small class="detail"></small></div>';
  const led = li.querySelector('.led');
  led.classList.add(status);
  led.title = LED_TEXT[status];
  led.setAttribute('role', 'img'); // aria-label düz bir span'da okunmaz
  led.setAttribute('aria-label', LED_TEXT[status]);
  const type = monitorType(m.type);
  if (type) li.querySelector('b').append(iconElement(monitorGroup(type), true));
  li.querySelector('b').append(monitorName(m));
  li.querySelector('.scope').textContent = scopeText(m);

  // Adım izi: her adım bir kare; yeşil / kırmızı, henüz oynatılmamış adım boş
  const steps = run.steps.filter((s) => appliesTo(m, s));
  const trail = li.querySelector('.trail');
  trail.title = `${steps.length} adımda kontrol edilir`;
  trail.append(...steps.map((s) => {
    const square = document.createElement('i');
    const v = s.verdicts.get(m.id);
    square.className = v ? ledStatus(v) : 'pending';
    square.title = `${v?.where ?? stepLabel(run, s)}: ${v ? v.text : LED_TEXT.pending}`;
    if (v?.status === 'fail' && v.screenshot) activatable(square, () => openShot(run, m, s), `${square.title}: ekranı büyüt`); // monitor-list.js
    return square;
  }));

  li.querySelector('.detail').textContent = aggregateText(run, m);
  const failed = steps.find((s) => s.verdicts.get(m.id)?.status === 'fail' && s.verdicts.get(m.id).screenshot);
  if (failed) {
    const img = document.createElement('img');
    img.className = 'shot';
    img.src = failed.verdicts.get(m.id).screenshot;
    img.alt = 'Bozulduğu andaki ekran';
    img.title = 'Bozulduğu andaki ekran: büyütmek için tıklayın';
    activatable(img, () => openShot(run, m, failed), 'Bozulduğu andaki ekranı büyüt');
    li.append(img);
  }
  return li;
}

// Adımdaki sonucun görüntüsü (monitor-list.js > openMonitorShot): bozulma anı ve nedeni
function openShot(run, m, step) {
  const v = step.verdicts.get(m.id);
  openMonitorShot(m, { where: v?.where ?? stepLabel(run, step), text: v?.text ?? '', screenshot: v?.screenshot ?? null });
}


// -----------------------------------------------------------------------------
// "BU EKRANDA ŞİMDİ KONTROL ET" (Monitörler bölümü): oynatmasız, açık sekmede
// -----------------------------------------------------------------------------
// Tüm model monitörleri + graph'ta seçili node ya da edge'in monitörleri sayfada kontrol edilir.
// Sonuç yine ikili (yeşil / kırmızı); kontrol edilemeyen monitörün nedeni satırında yazar.

$('btn-monitor-check').onclick = async () => {
  if (liveChecking) return;
  if (replay) return showMessage({ notice: 'Oynatma sürüyor; monitörler oynatma kartında adım adım kontrol ediliyor.' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return showMessage({ error: 'Açık sekme bulunamadı.' });
  const selected = selectedItem(); // monitor-list.js
  const list = monitors.items.filter((m) => m.enabled && (m.scope === 'global' || (selected && m.scope === selected.item.id)));
  if (!list.length) return showMessage({ notice: 'Kontrol edilecek etkin monitör yok: tüm model için ya da graph\'ta seçili öğe için bir monitör ekleyin.' });
  liveChecking = true;
  $('btn-monitor-check').disabled = true;
  const graphId = monitorsGraphId; // monitor-store.js; kontrol sürerken graph değişirse sonuç yazılmaz
  try {
    const verdicts = new Map();
    const toProbe = [];
    for (const m of list) {
      if (monitorType(m.type)) toProbe.push(m);
      else verdicts.set(m.id, verdictSkip('tür tanımlı değil'));
    }
    if (toProbe.length) for (const [id, v] of Object.entries(await probeMonitors(tab.id, toProbe))) verdicts.set(id, v);
    if (graphId !== monitorsGraphId) return showMessage({ notice: 'Kontrol sürerken graph değişti; sonuç yazılmadı.' });
    let host = '';
    try { host = new URL(tab.url).host; } catch { /* chrome:// vb. */ }
    const counts = { ok: 0, fail: 0, skip: 0 };
    for (const [id, v] of verdicts) {
      counts[ledStatus(v)]++;
      if (v.status === 'skip') counts.skip++;
      monitorVerdicts.set(id, { status: ledStatus(v), text: `${v.text} (şimdi${host ? `, ${host}` : ''})` });
    }
    // Bozulanlar için uyarı: ekranın görüntüsü şimdi (sekme açıkta), monitörün uyarı listesine
    const failing = toProbe.filter((m) => verdicts.get(m.id)?.status === 'fail');
    if (failing.length) {
      const screenshot = await monitorScreenshot(tab.id);
      const where = `Şimdi kontrol${host ? ` (${host})` : ''}`;
      if (graphId === monitorsGraphId) {
        try {
          await addMonitorAlarms(failing.map((m) => ({ monitorId: m.id, source: 'live', where, text: verdicts.get(m.id).text, url: tab.url ?? '', screenshot })));
        } catch (error) {
          console.warn('Monitör uyarıları kaydedilemedi:', error);
        }
      }
    }
    const summary = [counts.fail ? `${counts.fail} kırmızı` : '', counts.ok ? `${counts.ok} yeşil` : ''].filter(Boolean).join(', ')
      + (counts.skip ? ` (${counts.skip} tanesi bu ekranda kontrol edilemedi; nedeni satırında)` : '');
    showMessage(counts.fail ? { error: `Şimdi kontrol edildi: ${summary}. Ayrıntı monitörün satırında.` } : { notice: `Şimdi kontrol edildi: ${summary}.` });
    $('monitors').open = true;
  } finally {
    liveChecking = false;
    $('btn-monitor-check').disabled = false;
    renderMonitors();
  }
};
