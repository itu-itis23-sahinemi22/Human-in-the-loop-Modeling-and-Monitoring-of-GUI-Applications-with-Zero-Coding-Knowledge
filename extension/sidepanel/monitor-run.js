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
// Bir adımda bir monitör bozulursa o anın ekran görüntüsü alınır (küçük resim; tıklayınca büyür).
// Sonuçlar oynatma bitince Monitörler listesine de yazılır ("Son kontrol").
//
// "Bu ekranda şimdi kontrol et": oynatmasız, açık sekmede, tüm model + seçili öğenin monitörleri
// anında kontrol edilir; sonuç Monitörler listesinde görünür.
//
// panel.js ve replay.js değiştirilmez; onların global fonksiyonları sarmalanır (monitors.js'teki
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
// monitör id -> { status, text }. monitors: bu koşuda geçerli etkin monitörler (tüm model,
// koşudaki bir edge ya da koşunun vardığı bir node).
function beginMonitorRun(edges) {
  const run = {
    edges, replay: null, finished: false, result: null,
    steps: edges.map((edge, index) => ({ index, edgeId: edge.id, target: edge.target, verdicts: new Map(), screenshot: null })),
    monitors: monitors.items.filter((m) => m.enabled && edges.some((e) => m.scope === 'global' || m.scope === e.id || m.scope === e.target)),
  };
  activeRun = run;
  return run;
}

function stepMonitors(run, step) {
  return run.monitors.filter((m) => m.scope === 'global' || m.scope === step.edgeId || m.scope === step.target);
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

// afterAction sarmalanır: bir aksiyon oynatıldı ve sayfa duruldu. Aksiyon tabanlı Input Validation
// alana şimdi bakar (yazılan değer alanda). Alan ekranda yoksa önceki sonuç korunur.
const afterActionWithoutMonitors = afterAction; // replay.js
afterAction = async (replay) => {
  await afterActionWithoutMonitors(replay);
  const run = activeRun;
  if (!run || run.replay !== replay || replay.stopped) return;
  const step = run.steps[replay.step];
  if (!step) return;
  const list = stepMonitors(run, step).filter((m) => m.type === 'inputValidation');
  if (!list.length) return;
  try {
    const results = await probeMonitors(replay.tabId, list, replay);
    for (const m of list) {
      const now = results[m.id];
      const before = step.verdicts.get(m.id);
      if (now.status === 'skip' && before && before.status !== 'skip') continue;
      step.verdicts.set(m.id, now);
    }
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
  for (const m of stepMonitors(run, step)) {
    if (step.verdicts.has(m.id)) continue; // aksiyon sırasında kontrol edildi (Input Validation)
    if (!monitorType(m.type)) { step.verdicts.set(m.id, verdictSkip('tür tanımlı değil')); continue; }
    if (m.scope === step.target && !arrived) { step.verdicts.set(m.id, verdictSkip('node\'a varılamadı: ekran beklenen node değil')); continue; }
    toProbe.push(m);
  }
  if (toProbe.length) {
    const results = await probeMonitors(replay.tabId, toProbe, replay);
    for (const m of toProbe) step.verdicts.set(m.id, results[m.id]);
  }
  if ([...step.verdicts.values()].some((v) => v.status === 'fail')) step.screenshot = await capture(replay); // replay.js
  renderMonitorRun();
}

// Koşu bitti: oynatılmayan adımların monitörleri "kontrol edilemedi" diye not edilir, sonuçlar
// Monitörler listesine yazılır.
function finishMonitorRun(run, result) {
  run.finished = true;
  run.result = result;
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
async function probeMonitors(tabId, list, replay = null) {
  const checks = list.map((m) => ({ id: m.id, type: m.type, params: m.params }));
  const skipAll = (text) => Object.fromEntries(list.map((m) => [m.id, verdictSkip(text)]));
  let timer = null;
  const stopped = new Promise((resolve) => {
    if (replay) timer = setInterval(() => { if (replay.stopped) resolve(null); }, 200);
  });
  try {
    const response = await Promise.race([chrome.tabs.sendMessage(tabId, { type: 'MONITOR_PROBE', checks }, { frameId: 0 }), stopped]);
    if (response === null) return skipAll('oynatma durduruldu');
    if (!response) throw new Error('sayfa cevap vermedi');
    if (response.error) throw new Error(response.error);
    return Object.fromEntries(list.map((m) => [m.id, response.results[m.id] ?? verdictSkip('sonuç gelmedi')]));
  } catch (error) {
    return skipAll(`sayfaya ulaşılamadı (${error.message}). Sayfa eklenti yüklenmeden önce açıldıysa yenileyin.`);
  } finally {
    clearInterval(timer);
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

  const shot = document.createElement('dialog');
  shot.id = 'monitor-shot-dialog';
  shot.className = 'compare monitor-shot';
  shot.setAttribute('aria-labelledby', 'monitor-shot-title');
  shot.innerHTML = `
    <div class="dialog-body">
      <div class="title-row">
        <h2 id="monitor-shot-title">Bozulduğu andaki ekran</h2>
        <button id="btn-monitor-shot-close" class="icon" title="Kapat" aria-label="Kapat">✕</button>
      </div>
      <p id="monitor-shot-text" class="small"></p>
      <img id="monitor-shot-image" alt="Monitörün bozulduğu andaki ekran görüntüsü">
    </div>`;
  document.body.append(shot);
  $('btn-monitor-shot-close').onclick = () => shot.close();
  shot.onclick = (event) => { if (event.target === shot) shot.close(); };
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
  if (failed) return `${stepLabel(run, failed)}: ${failed.verdicts.get(m.id).text}`;
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
    square.title = `${stepLabel(run, s)}: ${v ? v.text : LED_TEXT.pending}`;
    if (v && s.screenshot && v.status === 'fail') square.onclick = () => openShot(run, m, s);
    return square;
  }));

  li.querySelector('.detail').textContent = aggregateText(run, m);
  const failed = steps.find((s) => s.verdicts.get(m.id)?.status === 'fail' && s.screenshot);
  if (failed) {
    const img = document.createElement('img');
    img.className = 'shot';
    img.src = failed.screenshot;
    img.alt = 'Bozulduğu andaki ekran';
    img.title = 'Bozulduğu andaki ekran: büyütmek için tıklayın';
    img.onclick = () => openShot(run, m, failed);
    li.append(img);
  }
  return li;
}

function openShot(run, m, step) {
  $('monitor-shot-text').textContent = `${monitorName(m)} · ${stepLabel(run, step)}: ${step.verdicts.get(m.id)?.text ?? ''}`;
  $('monitor-shot-image').src = step.screenshot;
  $('monitor-shot-dialog').showModal();
}


// -----------------------------------------------------------------------------
// "BU EKRANDA ŞİMDİ KONTROL ET" (Monitörler bölümü): oynatmasız, açık sekmede
// -----------------------------------------------------------------------------
// Tüm model monitörleri + graph'ta seçili node ya da edge'in monitörleri sayfada kontrol edilir.
// Olay tabanlılar ve adım süresi yalnızca oynatmada anlamlıdır; gri kalır.

$('btn-monitor-check').onclick = async () => {
  if (liveChecking) return;
  if (replay) return showMessage({ notice: 'Oynatma sürüyor; monitörler oynatma kartında adım adım kontrol ediliyor.' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return showMessage({ error: 'Açık sekme bulunamadı.' });
  const selected = selectedItem(); // monitors.js
  const list = monitors.items.filter((m) => m.enabled && (m.scope === 'global' || (selected && m.scope === selected.item.id)));
  if (!list.length) return showMessage({ notice: 'Kontrol edilecek etkin monitör yok: tüm model için ya da graph\'ta seçili öğe için bir monitör ekleyin.' });
  liveChecking = true;
  $('btn-monitor-check').disabled = true;
  try {
    const verdicts = new Map();
    const toProbe = [];
    for (const m of list) {
      if (monitorType(m.type)) toProbe.push(m);
      else verdicts.set(m.id, verdictSkip('tür tanımlı değil'));
    }
    if (toProbe.length) for (const [id, v] of Object.entries(await probeMonitors(tab.id, toProbe))) verdicts.set(id, v);
    let host = '';
    try { host = new URL(tab.url).host; } catch { /* chrome:// vb. */ }
    const counts = { ok: 0, fail: 0, skip: 0 };
    for (const [id, v] of verdicts) {
      counts[ledStatus(v)]++;
      if (v.status === 'skip') counts.skip++;
      monitorVerdicts.set(id, { status: ledStatus(v), text: `${v.text} (şimdi${host ? `, ${host}` : ''})` });
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
