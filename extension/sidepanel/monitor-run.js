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
//   - Ekrana bakmayan monitörler (monitor-types.js > side: 'replay') oynatmanın kendi verisinden
//     değerlendirilir (bkz. OYNATMANIN KENDİ VERİSİ): olay tabanlı JavaScript Error, oynatma sırasında
//     sayfada yakalanan hatalara; süre tabanlı Action Timeout, aksiyonların ölçülen süresine bakar. İkisi
//     de her aksiyondan sonra ve adımın sonunda değerlendirilir.
// Bir monitör bozulduğu AN ekran görüntüsü alınır ve uyarı olarak monitörün kendi yapısına yazılır
// (monitor-store.js > UYARILAR): aksiyon tabanlı monitörde alana yazıldıktan hemen sonra (bir sonraki
// aksiyon, ör. Login tıklaması, oynatılmadan önce), state tabanlı monitörde varılan ekranda. Adımın
// sonunu beklemek yanlış ekranı gösterirdi (Login'den sonra ürün sayfası). Küçük resim satırda,
// tıklayınca büyür. Sonuçlar oynatma bitince Monitörler listesine de yazılır ("Son kontrol").
// Bozulan sonuç bozulan elementi de taşır (targets: sayfada monitor-probe.js, görüntü monitöründe
// monitor-image.js ölçer; ekrana bakmayan monitörde ilgili aksiyonun elementi); uyarıyla saklanır ve
// görüntünün üstünde işaretlenir (monitor-locate.js).
//
// "Bu ekranda şimdi kontrol et": oynatmasız, açık sekmede, tüm model + seçili öğenin monitörleri
// anında kontrol edilir; sonuç Monitörler listesinde görünür.
//
// panel.js ve replay.js değiştirilmez; onların global fonksiyonları sarmalanır (monitor-export.js'teki
// graphWalkerModel gibi): startReplay (koşu başlıyor), verify (adımın sonu: varılan ekran doğrulandı),
// afterAction (bir aksiyon bitti), renderReplay (oynatma kartı yeniden çizildi); ekrana bakmayan
// monitörler için attach (oynatma bir sekmeye bağlandı), playAction (bir aksiyon oynatılıyor) ve inPage
// (sayfaya istek: yavaş oynatmanın vurgusu). Emir isterse bu sarmalamalar o fonksiyonların içine birer
// satırlık çağrı olarak da konabilir.
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
// monitör id -> { status, text, screenshot?, where?, alarmId?, targets?, more?, viewport? } (bozulduysa
// o anın görüntüsü, bozulan element ve uyarı kaydı). monitors: bu koşuda geçerli etkin monitörler (tüm model, koşudaki bir edge ya da
// koşunun vardığı bir node): genel kurallar + oynatılan senaryonun kendi monitörleri (monitor-store.js
// > SENARYOYA ÖZEL MONİTÖRLER). scenario: Emir'in startReplay'e verdiği { id, graph } (oynatılan
// kopya; adım etiketlerinde node adları ondan okunur).
// Oynatmanın kendi verisi (bkz. OYNATMANIN KENDİ VERİSİ): adımın errors'ı o adım oynatılırken sayfada
// yakalanan hatalar (heard: bir önceki aksiyonun kontrolüne kadar gelenlerin sayısı), timing'i ölçülen
// süreler { actions: [{ type, play, settle, apart }], arrival }, kept'i elementi sayfada akılda tutulan
// aksiyonların sırası. Koşuda: startedAt başlangıç anı, entered ilk adıma girildi mi, playing şu an
// oynatılan aksiyonun süre kaydı, listening hataları dinlenen sekmeler, foreign sayfanın kendi dünyası
// olmayan çalışma ortamları (eklentilerin content script'leri; "sekme:ortam").
function beginMonitorRun(edges, scenarioInfo = null) {
  const applies = (m) => m.enabled && edges.some((e) => m.scope === 'global' || m.scope === e.id || m.scope === e.target);
  const run = {
    edges, replay: null, finished: false,
    scenario: scenarioInfo?.id ? { id: scenarioInfo.id, graph: scenarioInfo.graph ?? null } : null,
    steps: edges.map((edge, index) => ({
      index, edgeId: edge.id, target: edge.target, verdicts: new Map(),
      errors: [], heard: 0, timing: { actions: [], arrival: null }, kept: new Set(),
    })),
    monitors: [...monitors.items.filter(applies), ...scenarioMonitorItems(scenarioInfo?.id ?? null).filter(applies)],
    startedAt: Date.now(), entered: false, playing: null, listening: new Set(), foreign: new Set(),
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
  await fitLocations(failing.map((m) => step.verdicts.get(m.id)), screenshot);
  let url = '';
  try { url = (await chrome.tabs.get(replay.tabId)).url ?? ''; } catch { /* sekme kapandı */ }
  const where = stepLabel(run, step) + (action ? ` · aksiyon ${action.index + 1}/${action.count}: ${action.label}` : '');
  for (const m of failing) Object.assign(step.verdicts.get(m.id), { screenshot, where });
  try {
    const alarms = await addMonitorAlarms(failing.map((m) => ({ // tek yazım (monitor-store.js > UYARILAR)
      monitorId: m.id, source: 'replay', where, text: step.verdicts.get(m.id).text, url, screenshot,
      step: { index: step.index, edgeId: step.edgeId, target: step.target }, action, ...faultLocation(step.verdicts.get(m.id)),
    })));
    failing.forEach((m, i) => { Object.assign(step.verdicts.get(m.id), { alarmId: alarms[i].id }, faultLocation(alarms[i])); }); // saklanan (sadeleşmiş) hali
  } catch (error) {
    console.warn('Monitör uyarıları kaydedilemedi:', error);
  }
}

// Sonucun (ya da uyarının) hata yeri alanları: bozulan element(ler) ve ölçüldükleri alan (monitor-store.js > UYARILAR)
function faultLocation(from) {
  return { targets: from?.targets ?? null, more: from?.more ?? 0, viewport: from?.viewport ?? null };
}

// Bozulan sonuçların ölçüldüğü alan, alınan görüntüyle eşlenir (monitor-locate.js > shownViewport): kutular
// görüntünün gerçekten gösterdiği alana oranlanır (oynatmada görüntü, sayfanın ölçtüğü alanın tamamı
// olmayabilir). Görüntü alınamadıysa alan null olur, kutu çizilmez. Görüntü, aynı anda bozulanlar için bir
// kez okunur.
async function fitLocations(verdicts, screenshot) {
  const located = verdicts.filter((v) => v?.targets?.length && v.viewport);
  if (!located.length) return;
  const image = screenshot ? await imageSize(screenshot) : null;
  for (const v of located) v.viewport = shownViewport(v.viewport, image);
}

function stepMonitors(run, step) {
  return run.monitors.filter((m) => appliesTo(m, step));
}

function appliesTo(m, step) {
  return m.scope === 'global' || m.scope === step.edgeId || m.scope === step.target;
}

// startReplay sarmalanır: koşu başlarken monitörler seçilir (genel + options.scenario'nun kendi
// monitörleri); koşu bitince sonuçlar toplanır.
const startReplayWithoutMonitors = startReplay; // replay.js
startReplay = (options) => {
  const run = beginMonitorRun(options.edges, options.scenario ?? null);
  const started = startReplayWithoutMonitors(options);
  run.replay = started;
  started.done.then((result) => finishMonitorRun(run, result)).catch(() => finishMonitorRun(run, null));
  return started;
};

// verify sarmalanır: adımın aksiyonları bitti, varılan ekran beklenen node ile karşılaştırıldı.
// Monitörler burada, oynatma bir sonraki adıma geçmeden kontrol edilir (await). Beklenen ekranın
// gelmesinin süresi ölçülür (bkz. SÜRE); doğrulama yarıda kalırsa adım da yarıda kalır (stepBroke).
const verifyWithoutMonitors = verify; // replay.js
verify = async (replay, node) => {
  const run = activeRun;
  const step = run?.replay === replay ? run.steps[replay.step] : null;
  if (!step) return verifyWithoutMonitors(replay, node);
  run.entered = true;
  const started = Date.now();
  let result;
  try {
    result = await verifyWithoutMonitors(replay, node);
  } catch (error) {
    step.timing.arrival = Date.now() - started;
    await stepBroke(run, replay, step);
    throw error;
  }
  step.timing.arrival = Date.now() - started;
  if (!replay.stopped) {
    try {
      await checkStepMonitors(run, replay, step, result);
    } catch (error) {
      console.warn('Monitör kontrolü yapılamadı:', error);
    }
  }
  return result;
};

// Bu aksiyondan hemen sonra kontrol edilecek monitörler: edge'in bu aksiyonuna bağlı olanlar (her
// tür) + aksiyona bağlı olmayan, kontrol biçimi "aksiyon tabanlı" (monitor-types.js > when: 'action';
// Input Validation) ya da "olay tabanlı" ('event'; JavaScript Error) olan türler: her aksiyondan sonra.
// "Süre tabanlı" türe ('temporal'; Action Timeout) aksiyona bağlı olsa da her aksiyondan sonra bakılır:
// ölçülen süre, aksiyonun ardından gelen beklemeleri de kapsar (bkz. SÜRE).
function monitorsAfterAction(run, step, edge, actionIndex) {
  return stepMonitors(run, step).filter((m) => {
    const when = monitorType(m.type)?.when;
    if (when === 'temporal') return true;
    return m.action ? m.scope === step.edgeId && resolveMonitorAction(m.action, edge?.actions) === actionIndex : when === 'action' || when === 'event';
  });
}

// Az önce oynatılan aksiyon, uyarının yeri için: { index, count, label } ("aksiyon 2/4: Bekle 10 sn")
function playedAction(edge, replay) {
  const played = edge?.actions?.[replay.action];
  const label = played?.type === 'wait' && Number.isFinite(played.ms) ? `Bekle ${waitSeconds(played.ms)}` : replay.actionLabel;
  return { index: replay.action, count: edge?.actions?.length ?? 0, label };
}

// afterAction sarmalanır: bir aksiyon oynatıldı ve sayfa duruldu. Aksiyon tabanlı Input Validation
// alana şimdi bakar (yazılan değer alanda); edge'in bu aksiyonuna bağlı monitörler de şimdi kontrol
// edilir. Alan ekranda yoksa önceki sonuç korunur. Bozulduysa görüntü bu anda alınır: oynatma bir
// sonraki aksiyona (Login tıklaması gibi) bu kontrol bitmeden geçmez (await). Adımda ilk bozulma
// anı kalır; sonraki aksiyonlar sonucu değiştirmez. Sayfanın durulmasının süresi ölçülür (bkz. SÜRE);
// sayfa durulamazsa (yükleme bitmedi) adım yarıda kalır (stepBroke).
const afterActionWithoutMonitors = afterAction; // replay.js
afterAction = async (replay) => {
  const run = activeRun;
  const step = run?.replay === replay ? run.steps[replay.step] : null;
  if (!step) return afterActionWithoutMonitors(replay);
  const part = step.timing.actions[replay.action]; // bu aksiyonun süre kaydı (playAction sarmalayıcısı açtı)
  const started = Date.now();
  try {
    await afterActionWithoutMonitors(replay);
  } catch (error) {
    if (part) part.settle = Date.now() - started;
    await stepBroke(run, replay, step);
    throw error;
  }
  if (part) part.settle = Math.max(0, Date.now() - started - (replay.slow ? slowPauseMs() : 0)); // yavaş oynatmanın arası sayfanın süresi değil
  if (replay.stopped) return;
  const edge = run.edges[step.index];
  try {
    const fresh = await heardSince(run, step); // bu aksiyon oynatılırken sayfada yakalanan hatalar
    const list = monitorsAfterAction(run, step, edge, replay.action);
    if (!list.length) return;
    const results = await checkMonitors(run, replay, step, list, { at: 'action', index: replay.action, fresh });
    const failing = [];
    for (const m of list) {
      const now = results[m.id];
      if (!now) continue; // sonucu bu anda belli değil (hata yok, süre aşılmadı: temiz sonuç adımın sonunda yazılır)
      const before = step.verdicts.get(m.id);
      if (before?.status === 'fail') continue; // ilk bozulma anı (görüntüsüyle) korunur
      if (now.status === 'skip' && before && before.status !== 'skip') continue;
      step.verdicts.set(m.id, now);
      if (now.status === 'fail') failing.push(m);
    }
    await raiseAlarms(run, replay, step, failing, playedAction(edge, replay));
    renderMonitorRun();
  } catch (error) {
    console.warn('Monitör kontrolü yapılamadı:', error);
  }
};

// Bir kontrol turu: ekrana bakan monitörler sayfada / panelde (probeMonitors), ekrana bakmayanlar
// (side: 'replay') oynatmanın kendi verisinde değerlendirilir (replayVerdicts). moment: kontrol anı
// (bkz. replayVerdict). Sonucu bu anda belli olmayan monitör sonuçlarda yer almaz.
async function checkMonitors(run, replay, step, list, moment) {
  const own = list.filter(isReplaySide);
  const onScreen = list.filter((m) => !isReplaySide(m));
  recentCapture = null; // önceki turun çekimi bu turun uyarısına gitmesin (bkz. monitorScreenshot)
  const results = onScreen.length ? await probeMonitors(replay.tabId, onScreen, replay) : {};
  if (own.length && !replay.stopped) Object.assign(results, await replayVerdicts(run, replay, step, own, moment));
  return results;
}

// Adımın sonunda: adımda geçerli monitörler kontrol edilir. Ekran beklenen node değilse (adım
// kalacak) ekrana bakan node monitörleri kontrol edilmez; tüm model ve aksiyon monitörleri yine edilir.
async function checkStepMonitors(run, replay, step, verdict) {
  const arrived = Boolean(verdict?.ok);
  const toCheck = [];
  const edge = run.edges[step.index];
  for (const m of stepMonitors(run, step)) {
    if (step.verdicts.has(m.id)) continue; // aksiyon sırasında kontrol edildi (aksiyon tabanlı tür, aksiyona bağlı monitör) ya da bozuldu
    const type = monitorType(m.type);
    if (!type) { step.verdicts.set(m.id, verdictSkip('tür tanımlı değil')); continue; }
    if (m.action && type.when !== 'temporal') { // yalnızca kendi aksiyonundan sonra kontrol edilir; buraya geldiyse o aksiyon oynatılmadı
      step.verdicts.set(m.id, verdictSkip(resolveMonitorAction(m.action, edge?.actions) < 0 ? `aksiyon edge'de bulunamadı (${actionRefText(m.action)})` : 'aksiyonu bu adımda oynatılmadı'));
      continue;
    }
    if (m.scope === step.target && !arrived && type.side !== 'replay') { step.verdicts.set(m.id, verdictSkip('node\'a varılamadı: ekran beklenen node değil')); continue; }
    toCheck.push(m);
  }
  if (toCheck.length) {
    const fresh = await heardSince(run, step);
    const results = await checkMonitors(run, replay, step, toCheck, { at: 'end', arrived, fresh });
    for (const m of toCheck) if (results[m.id]) step.verdicts.set(m.id, results[m.id]);
    await raiseAlarms(run, replay, step, toCheck.filter((m) => results[m.id]?.status === 'fail')); // varılan ekranın görüntüsü, şimdi
  }
  renderMonitorRun();
}

// Adım yarıda kaldı (aksiyon oynatılamadı: element gelmedi; sayfa yüklenmedi): Emir'in oynatması adımı
// "kaldı" sayar ve verify'ı çağırmaz. Ekrana bakan monitörler kontrol edilemez (finishMonitorRun: "adım
// tamamlanamadı"); ekrana bakmayanlar o ana kadar toplanan veriyle değerlendirilir: yakalanan hatalar ve
// geçen süre (takılan sayfa tam da böyle biter). Oynatma durdurulduysa değerlendirilmez.
async function stepBroke(run, replay, step) {
  if (replay.stopped) return;
  try {
    const edge = run.edges[step.index];
    const list = stepMonitors(run, step).filter((m) => isReplaySide(m) && !step.verdicts.has(m.id)
      && (!m.action || monitorType(m.type).when === 'temporal' || resolveMonitorAction(m.action, edge?.actions) === replay.action)); // aksiyona bağlı olay monitörü: yalnızca yarıda kalan aksiyon onunkiyse
    if (!list.length) return;
    const fresh = await heardSince(run, step);
    recentCapture = null;
    const results = await replayVerdicts(run, replay, step, list, { at: 'broke', index: replay.action, fresh });
    for (const m of list) if (results[m.id]) step.verdicts.set(m.id, results[m.id]);
    await raiseAlarms(run, replay, step, list.filter((m) => results[m.id]?.status === 'fail'), replay.action >= 0 ? playedAction(edge, replay) : null);
    renderMonitorRun();
  } catch (error) {
    console.warn('Monitör kontrolü yapılamadı:', error);
  }
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
// OYNATMANIN KENDİ VERİSİ: ekrana bakmayan monitörler (monitor-types.js > side: 'replay')
// -----------------------------------------------------------------------------
// İki tür ekrana değil, oynatma sırasında olana bakar. Sayfaya "şu an kural sağlanıyor mu?" diye
// sorulamaz; veri oynatma boyunca burada toplanır ve kontrol anında ondan sonuç çıkarılır:
//   OLAYLAR (JavaScript Error): sayfada yakalanmayan JavaScript hataları (konsoldaki kırmızı "Uncaught …"
//     satırları). Ekranda hiçbir şey değişmese de (düğmeye basılır, hiçbir şey olmaz) hata buradan görülür.
//   SÜRE (Action Timeout): her aksiyonun ne kadar sürdüğü (aksiyon başladıktan sonra testin devam
//     edebilmesine kadar). Sayfa doğru ekrana varsa da geç vardıysa buradan görülür.
// Bu türler yalnızca oynatmada kontrol edilebilir ("Bu ekranda şimdi kontrol et" onları atlar). Yeni bir
// türün değerlendiricisi REPLAY_CHECKS'e aynı id ile eklenir (sayfadaki MONITOR_PROBES gibi).

const MONITOR_ERROR_LIMIT = 100;        // bir adımda saklanan en fazla hata (döngüye girmiş sayfa belleği doldurmasın)
const MONITOR_ERROR_TEXT = 200;         // hata satırının en fazla bu kadar karakteri
const MONITOR_KEEP_TIMEOUT_MS = 1000;   // aksiyondan önce elementin akılda tutulması oynatmayı en fazla bu kadar bekletir
const MONITOR_LOCATE_TIMEOUT_MS = 2000; // bozulunca elementin yerinin sorulması en fazla bu kadar bekler

function isReplaySide(m) {
  return monitorType(m.type)?.side === 'replay';
}

// ---- OLAYLAR: sayfada yakalanmayan JavaScript hataları -----------------------------------------
// Oynatma sekmeye DevTools protokolüyle bağlıdır (replay.js > attach). Koşuda JavaScript Error monitörü
// varsa sekmenin Runtime alanı açılır; tarayıcı o andan sonra yakalanmayan her hatayı (atılan hata,
// reddedilip yakalanmayan Promise) olduğu anda bildirir (Runtime.exceptionThrown). Hata, o an oynatılan
// adıma yazılır; sonuca her aksiyondan sonra ve adımın sonunda bakılır. Sayılmayanlar:
//   - Oynatmadan önce olmuş hatalar. Runtime alanı açılınca tarayıcı sayfanın eski hatalarını da yeniden
//     yollar (zaman damgalarıyla); koşu başlamadan önce olanlar bu koşunun değildir.
//   - Eklentilerin kendi dünyasındaki hatalar (content script'ler: bu eklenti ya da kullanıcının başka
//     eklentileri). Sayfanın kendi kodu değildir; çalışma ortamından ve dosya adresinden tanınır.
//   - Sonradan yakalanan Promise reddi (Runtime.exceptionRevoked): tarayıcı hatayı geri alır.
// Göremediği: başka siteden gelen iframe'lerin ve worker'ların hataları (ayrı hedeflerdir), console.error
// ile yazılan mesajlar ve yüklenemeyen kaynaklar (hata atılmaz), sayfanın kendi bastırdığı hatalar
// (window.onerror "hallettim" derse tarayıcı hatayı konsola da yazmaz).

// attach sarmalanır: oynatma bir sekmeye bağlandı (koşunun başında; sekme açan / sekmeye geçen aksiyonda).
// Koşuda JavaScript Error monitörü varsa o sekmenin hataları dinlenmeye başlar; yoksa hiçbir şey açılmaz.
const attachWithoutMonitors = attach; // replay.js
attach = async (replay, tabId) => {
  await attachWithoutMonitors(replay, tabId);
  const run = activeRun;
  if (run?.replay === replay) await listenToTab(run, tabId);
};

async function listenToTab(run, tabId) {
  if (run.listening.has(tabId) || !run.monitors.some((m) => m.type === 'jsError')) return;
  run.listening.add(tabId); // komuttan önce: ortam listesi ve eski hatalar, komutun cevabı gelmeden bildirilir
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
  } catch (error) {
    run.listening.delete(tabId); // dinlenemeyen sekmede sonuç "kontrol edilemedi" olur (REPLAY_CHECKS.jsError)
    console.warn('Sayfanın JavaScript hataları dinlenemiyor:', error);
  }
}

chrome.debugger?.onEvent.addListener((source, method, params) => {
  const run = activeRun;
  if (!run || run.finished || !run.listening.has(source.tabId)) return;
  const world = (id) => `${source.tabId}:${id}`; // çalışma ortamının anahtarı (run.foreign)
  switch (method) {
    case 'Runtime.exceptionThrown': noteError(run, source.tabId, params); break;
    case 'Runtime.exceptionRevoked': revokeError(run, source.tabId, params.exceptionId); break;
    case 'Runtime.executionContextCreated': // sayfanın kendi dünyası olmayan ortam: bir eklentinin content script'leri
      if (params.context?.auxData?.isDefault === false) run.foreign.add(world(params.context.id));
      break;
    case 'Runtime.executionContextDestroyed': run.foreign.delete(world(params.executionContextId)); break;
    case 'Runtime.executionContextsCleared': // sayfa değişti: ortamlar yeniden bildirilecek
      for (const key of [...run.foreign]) if (key.startsWith(world(''))) run.foreign.delete(key);
      break;
    default:
  }
});

// Yakalanan hata o an oynatılan adıma yazılır. Koşu başlarken (ilk adımdan önce, görünen alan kurulurken)
// olan hata ilk adıma yazılır; son adım bittikten sonra gelen sayılmaz.
function noteError(run, tabId, params) {
  const details = params?.exceptionDetails;
  if (!details || params.timestamp < run.startedAt) return; // oynatmadan önce olmuş (sayfanın eski hatası)
  if (run.foreign.has(`${tabId}:${details.executionContextId}`)) return; // bir eklentinin dünyası: sayfanın hatası değil
  const error = thrownError(details);
  if (!error) return;
  const replay = run.replay;
  const step = run.steps[replay.step >= 0 ? replay.step : run.entered ? -1 : 0];
  if (!step || step.errors.length >= MONITOR_ERROR_LIMIT) return;
  step.errors.push({ ...error, id: details.exceptionId, tabId, revoked: false });
}

// Sonradan yakalanan Promise reddi: en son yazılan o hata geri alınır (kimlikler sekmede artan sayıdır; sayfa
// başka siteye geçince yeniden başlayabilir, bu yüzden sondan aranır). Çoktan uyarı verdiyse uyarı kalır.
function revokeError(run, tabId, id) {
  for (const step of [...run.steps].reverse()) {
    const error = [...step.errors].reverse().find((e) => e.tabId === tabId && e.id === id && !e.revoked);
    if (!error) continue;
    error.revoked = true;
    return;
  }
}

// Kontrolden önce: sayfadan yola çıkmış hata olayları panele ulaşsın. Olaylar ve komut cevapları aynı sırayla
// gelir; zaten açık olan Runtime.enable'ın cevabı geldiğinde ondan önceki bütün olaylar işlenmiştir (ek etkisi
// yoktur). Tıklamanın attığı hata, tıklama komutunun cevabından sonra gelebilir; bu bekleme onu kaçırmaz.
// Sonra: bir önceki aksiyonun kontrolünden bu yana yakalanan hatalar döner (aksiyona bağlı monitör için).
async function heardSince(run, step) {
  await Promise.all([...run.listening].map((tabId) => chrome.debugger.sendCommand({ tabId }, 'Runtime.enable').catch(() => { run.listening.delete(tabId); })));
  const fresh = step.errors.slice(step.heard);
  step.heard = step.errors.length;
  return fresh;
}

// Yakalanan hatanın (Runtime.exceptionThrown > exceptionDetails) okunur hali: tarayıcının konsolundaki satır
// ("Uncaught TypeError: …") ve atıldığı yer ("app.js:12:5"). Bir eklentinin dosyasından gelen hata sayfanın
// hatası değildir: null.
function thrownError(details) {
  const url = String(details?.url ?? details?.stackTrace?.callFrames?.[0]?.url ?? '');
  if (url.startsWith('chrome-extension://')) return null;
  const thrown = details?.exception ?? {};
  const what = thrown.description !== undefined ? String(thrown.description).split('\n')[0] // "TypeError: …" (devamı çağrı yığını)
    : thrown.value !== undefined ? String(thrown.value) : String(thrown.unserializableValue ?? thrown.type ?? '');
  const message = `${details?.text ?? 'Uncaught'} ${what}`.replace(/\s+/g, ' ').trim().slice(0, MONITOR_ERROR_TEXT);
  const line = Number.isInteger(details?.lineNumber) ? `:${details.lineNumber + 1}${Number.isInteger(details.columnNumber) ? `:${details.columnNumber + 1}` : ''}` : '';
  return { message, url, where: url ? shortAddress(url) + line : '' };
}

// Adresin kısa hali (hatanın yeri için): dosya adı ("app.js"; sayfanın kendi içindeki kodda sayfanın adı,
// "odeme"); adı olmayan ana sayfada "sayfa"
function shortAddress(url) {
  try {
    const file = new URL(url).pathname.split('/').filter(Boolean).pop();
    return file ? decodeURIComponent(file).slice(0, 60) : 'sayfa';
  } catch {
    return String(url).slice(0, 60);
  }
}

// JavaScript Error'ın sonucu. errors: kontrolün baktığı aralıkta yakalanan hatalar ({ message, where, url }).
// Yok sayılacaklar desenle ayıklanır: desen hata satırında ve dosya adresinde aranır, büyük/küçük harf fark
// etmez (ör. "ResizeObserver|analytics": zararsız bilinen bir hata ve üçüncü parti bir dosya).
function jsErrorVerdict(params, errors) {
  let ignore = null;
  if (params?.ignore) {
    try {
      ignore = new RegExp(params.ignore, 'i');
    } catch {
      return { status: 'skip', text: 'yok sayma deseni geçersiz' };
    }
  }
  const counted = ignore ? errors.filter((e) => !ignore.test(`${e.message} ${e.url}`)) : errors;
  const ignored = errors.length - counted.length;
  const note = ignored ? ` (${ignored} hata yok sayıldı: desene uyuyor)` : '';
  if (!counted.length) return { status: 'ok', text: `JavaScript hatası yok${note}` };
  const first = `"${counted[0].message}"${counted[0].where ? ` (${counted[0].where})` : ''}`;
  return { status: 'fail', text: (counted.length > 1 ? `${counted.length} JavaScript hatası; ilki: ${first}` : `JavaScript hatası: ${first}`) + note };
}

// ---- SÜRE: aksiyonların süresi ----------------------------------------------------------------
// Ölçülen, oynatmanın gördüğü süredir: aksiyon başladıktan sonra test ne kadar sürede devam edebildi? Üç
// parça, her biri Emir'in ilgili fonksiyonunun çevresinde ölçülür:
//   play    aksiyonun oynatılması (playAction): elementin ekrana gelmesini beklemek ve aksiyonu yapmak
//   settle  aksiyondan sonra sayfanın durulması (afterAction): yükleme ve DOM'un durması
//   arrival son aksiyondan sonra beklenen ekranın gelmesi (verify)
// Bir aksiyonun süresi (actionTimes): kendi play + settle'ı, ardından gelen beklemelerin settle'ı (kayıt her
// aksiyonun arkasına bir bekleme koyar; test ancak ondan sonra devam eder) ve son aksiyonda arrival. Kural
// aksiyon başınadır, adımın toplamına değil: toplam, edge'deki aksiyon sayısıyla büyür (10 alanlı form hızlı
// bir sayfada da uzun sürer); takılan sayfa ise tek bir aksiyonu uzatır.
// Sayılmayanlar (sayfanın değil, kaydın ya da oynatmanın süresi):
//   - Kayıttaki bekleme ('wait') aksiyonunun kendisi: süresi kayıttan gelir, her oynatmada aynıdır.
//   - Yavaş oynatmanın eklediği süreler: elementin çerçevelenmesi (inPage sarmalayıcısı, apart) ve
//     aksiyonlar arasındaki ara (slowPauseMs).
//   - Monitörlerin kendi kontrolleri: sarmalayıcılarda ölçülen kısmın dışında kalır.
// Bu aralarda sayfa çalışmaya devam eder; yavaş oynatmada ölçüm bu yüzden normal hıza göre biraz kısa
// çıkabilir. En hızlı sayfada bile bir aksiyon 0,7–1 sn sürer: oynatma her aksiyondan ve her beklemeden sonra
// sayfanın SETTLE_QUIET_MS (fingerprint.js) sessiz kalmasını bekler. Sınır kaba seçilmelidir (saniyeler).

// playAction sarmalanır: bir aksiyon oynatılıyor. Süresi ölçülür; ekrana bakmayan bir monitör varsa aksiyonun
// elementi önce sayfada akılda tutulur (bkz. AKSİYONUN ELEMENTİ). Aksiyon oynatılamazsa adım yarıda kalır.
const playActionWithoutMonitors = playAction; // replay.js
playAction = async (replay, action, replayStep) => {
  const run = activeRun;
  const step = run?.replay === replay ? run.steps[replay.step] : null;
  if (!step) return playActionWithoutMonitors(replay, action, replayStep);
  run.entered = true;
  const part = { type: action.type, play: 0, settle: 0, apart: 0 }; // apart: oynatılırken sayılmayan süre (yavaş oynatmanın vurgusu)
  step.timing.actions[replay.action] = part;
  if (stepMonitors(run, step).some(isReplaySide)) await keepElement(run, replay, step, replay.action, action);
  run.playing = part;
  const started = Date.now();
  const stop = () => {
    run.playing = null;
    part.play = Math.max(0, Date.now() - started - part.apart);
  };
  let result;
  try {
    result = await playActionWithoutMonitors(replay, action, replayStep);
  } catch (error) {
    stop();
    await stepBroke(run, replay, step);
    throw error;
  }
  stop();
  return result;
};

// Yavaş oynatmada aksiyonlar arasında beklenen süre (replay.js > REPLAY_PAUSE_MS; afterAction'ın sonunda). Sabit
// bulunamazsa 0: ölçüm o arayı da sayar, oynatma etkilenmez.
function slowPauseMs() {
  return typeof REPLAY_PAUSE_MS === 'number' ? REPLAY_PAUSE_MS : 0;
}

// inPage sarmalanır: yavaş oynatmada element aksiyondan önce kısa süre çerçevelenir (replay.js > locate,
// content.js > flash: istekteki highlight kadar). O süre sayfanın değil oynatmanın süresidir; aksiyonun
// ölçülen süresinden düşülür. Element bulunamadıysa çerçeve de çizilmemiştir: istek hemen döner, düşülecek
// bir şey olmaz.
const inPageWithoutMonitors = inPage; // replay.js
inPage = async (replay, request) => {
  const part = request?.highlight > 0 && activeRun?.replay === replay ? activeRun.playing : null;
  if (!part) return inPageWithoutMonitors(replay, request);
  const started = Date.now();
  try {
    return await inPageWithoutMonitors(replay, request);
  } finally {
    part.apart += Math.min(Date.now() - started, request.highlight);
  }
};

// Adımın aksiyon süreleri (ms). timing: { actions: [{ type, play, settle }], arrival }. Her gerçek (bekleme
// olmayan) aksiyon bir ölçümdür { index, ms, arrival }: oynatılması + sayfanın durulması + ardından gelen
// beklemelerin durulması; son aksiyonda beklenen ekranın gelmesi de (arrival: true). Kayıttaki beklemenin
// kendisi sayılmaz (waited'da toplanır); edge'in başındaki beklemenin durulması ilk aksiyona yazılır. Adımda
// gerçek aksiyon yoksa tek ölçüm vardır: beklenen ekranın gelmesi (index -1). total: ölçümlerin toplamı.
function actionTimes(timing) {
  const actions = [];
  let waited = 0;
  let lead = 0;
  (timing?.actions ?? []).forEach((part, index) => {
    if (!part) return;
    if (part.type !== 'wait') {
      actions.push({ index, ms: lead + (part.play ?? 0) + (part.settle ?? 0), arrival: false });
      lead = 0;
      return;
    }
    waited += part.play ?? 0;
    if (actions.length) actions.at(-1).ms += part.settle ?? 0;
    else lead += part.settle ?? 0;
  });
  if (Number.isFinite(timing?.arrival)) {
    if (!actions.length) actions.push({ index: -1, ms: lead, arrival: false });
    actions.at(-1).ms += timing.arrival;
    actions.at(-1).arrival = true;
  }
  return { actions, waited, total: actions.reduce((sum, a) => sum + a.ms, 0) };
}

// "1,8 sn": 0,1 sn duyarlıkla
function secondsText(ms) {
  return `${String(Math.round(ms / 100) / 10).replace('.', ',')} sn`;
}

// Ölçümün adı: 'aksiyon 5/6 "Login"' / 'beklenen ekranın gelmesi'
function timedName(actions, measured) {
  if (measured.index < 0) return 'beklenen ekranın gelmesi';
  return `aksiyon ${measured.index + 1}/${actions.length} "${actions[measured.index]?.label ?? ''}"`;
}

// Sınırı aşan ilk ölçüm (yoksa null). Karşılaştırma gösterilen sayıyla (0,1 sn) yapılır: "5 sn sürdü (sınır
// 5 sn)" kırmızı olmaz.
function overLimit(maxSeconds, measured) {
  return measured.find((a) => Math.round(a.ms / 100) / 10 > Number(maxSeconds)) ?? null;
}

// Action Timeout'un sonucu. times: actionTimes'ın döndürdüğü; actions: adımın aksiyonları (adlar için). only:
// yalnızca bu sıradaki aksiyona bakılır (aksiyona bağlı monitör); null ise hepsine. state: kontrol anı
//   'action' bir aksiyondan sonra (adım sürüyor)      'done'  adım bitti, beklenen ekrana varıldı
//   'missed' adım bitti, beklenen ekrana varılamadı   'broke' adım yarıda kaldı
// Sınır aşıldıysa her durumda kırmızı (aşan ilk aksiyonla). Aşılmadıysa: adım bitince yeşil (en uzun aksiyon
// ve adımın toplamıyla); adım sürüyorsa ya da yarıda kaldıysa null (sonuç henüz belli değil / adım
// "tamamlanamadı" kalır); beklenen ekran gelmediyse son aksiyonun süresi bitmemiştir: değerlendirilmez.
function timeoutVerdict(maxSeconds, times, actions, { only = null, state = 'done' } = {}) {
  const limit = Number(maxSeconds);
  if (!(limit > 0)) return { status: 'skip', text: 'süre sınırı geçersiz' };
  const bound = `sınır ${String(limit).replace('.', ',')} sn`;
  const looked = only === null ? times.actions : times.actions.filter((a) => a.index === only);
  const over = overLimit(limit, looked);
  if (over) {
    const name = timedName(actions, over);
    const took = secondsText(over.ms);
    const what = state === 'missed' && over.arrival ? `${over.index < 0 ? '' : `${name} sonrası `}${took} geçti ve beklenen ekrana varılamadı`
      : state === 'broke' ? `${name} ${took} sürdü ve adım tamamlanamadı`
        : `${name}${over.arrival && over.index >= 0 ? ' ve ardından beklenen ekranın gelmesi' : ''} ${took} sürdü`;
    return { status: 'fail', text: `süre aşıldı: ${what} (${bound})` };
  }
  if (state === 'action' || state === 'broke') return null;
  if (!looked.length) return { status: 'skip', text: 'aksiyonu bu adımda oynatılmadı' };
  const slowest = looked.reduce((a, b) => (b.ms > a.ms ? b : a));
  if (state === 'missed' && looked.some((a) => a.arrival)) return { status: 'skip', text: `beklenen ekrana varılamadı: süre değerlendirilmedi (${bound})` };
  if (only !== null) return { status: 'ok', text: `aksiyon ${secondsText(slowest.ms)} sürdü (${bound})` };
  const apart = times.waited >= 1000 ? `; kayıttaki ${secondsText(times.waited)} bekleme sayılmadı` : ''; // 10 ms'lik otomatik beklemeler anılmaz
  if (slowest.index < 0) return { status: 'ok', text: `beklenen ekranın gelmesi ${secondsText(slowest.ms)} sürdü (${bound}${apart})` };
  return { status: 'ok', text: `en uzun aksiyon ${secondsText(slowest.ms)} sürdü (${timedName(actions, slowest)}; ${bound}) · adım toplam ${secondsText(times.total)}${apart}` };
}

// ---- AKSİYONUN ELEMENTİ: bozulan sonucun işaretleyeceği yer --------------------------------------
// Ekrana bakmayan monitörde bozulan bir element yoktur; uyarı ilgili aksiyonun elementini gösterir: hatanın
// oluştuğu tıklamanın düğmesi, sınırı aşan aksiyonun alanı. Element aksiyon oynatılmadan önce sayfada akılda
// tutulur, monitör bozulunca yeri sorulur (monitor-probe.js > AKSİYONUN ELEMENTİ: neden önceden).

function keptId(run, step, index) {
  return `${run.startedAt}:${step.index}:${index}`;
}

// Sayfaya istek; cevap süresinde gelmezse ya da sayfaya ulaşılamazsa null (oynatma bunun için bekletilmez)
async function askPage(tabId, message, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Aksiyon oynatılmadan hemen önce: elementi varsa (tıklama, yazma…) sayfada akılda tutulur. Elementi olmayan
// aksiyon (bekleme, sayfaya gitme) ya da o an ekranda olmayan element tutulmaz; uyarıda element gösterilmez.
async function keepElement(run, replay, step, index, action) {
  if (!action?.target && !action?.selector) return;
  const response = await askPage(replay.tabId, { type: 'MONITOR_KEEP', id: keptId(run, step, index), ref: { target: action.target ?? null, selector: action.selector ?? null } }, MONITOR_KEEP_TIMEOUT_MS);
  if (response?.kept) step.kept.add(index);
}

// Bozulan sonucun hata yeri alanları ({ targets, more, viewport }): culprit { index, note } aksiyonunun elementi,
// şimdi ekrandaki yeriyle. Element tutulmadıysa ya da artık ekranda değilse targets []; sayfa cevap vermezse
// bilinmiyor (null).
async function actionLocation(run, replay, step, culprit) {
  if (!culprit || !step.kept.has(culprit.index)) return { targets: [], more: 0, viewport: null };
  const response = await askPage(replay.tabId, { type: 'MONITOR_LOCATE', id: keptId(run, step, culprit.index) }, MONITOR_LOCATE_TIMEOUT_MS);
  if (!Array.isArray(response?.targets)) return { targets: null, more: 0, viewport: null };
  return { targets: response.targets.map((target) => ({ ...target, note: culprit.note })), more: response.more ?? 0, viewport: response.viewport ?? null };
}

// ---- DEĞERLENDİRME ---------------------------------------------------------------------------------
// Tür -> değerlendirici. Anahtarlar monitor-types.js'teki tür id'leridir. Girdi: { run, replay, step, m, moment,
// actions, bound } (actions: adımın edge'inin aksiyonları; bound: monitörün bağlı olduğu aksiyonun sırası, yoksa
// -1). moment: kontrol anı
//   { at: 'action', index, fresh }  index'inci aksiyondan hemen sonra (fresh: o aksiyon oynatılırken gelen hatalar)
//   { at: 'end', arrived, fresh }   adımın sonunda (arrived: beklenen ekrana varıldı mı)
//   { at: 'broke', index, fresh }   adım yarıda kaldı (index: oynatılamayan aksiyon; doğrulamada kaldıysa -1)
// Döner: { verdict, culprit? } (culprit: bozulduysa elementi gösterilecek aksiyon { index, note }) ya da null:
// sonuç bu anda belli değil (sonraki kontrol anında yazılır ya da adım "tamamlanamadı" kalır).
const REPLAY_CHECKS = {
  // Aksiyona bağlıysa: o aksiyon oynatılırken hata yakalanmamış olmalı. Değilse adımın tamamında: her aksiyondan
  // sonra bakılır ve hata varsa o anda bozulur; temiz sonuç adımın sonunda yazılır (son aksiyondan sonra,
  // beklenen ekran beklenirken gelen hata da görülsün).
  // Uyarıda gösterilen element: kontrol anındaki aksiyonun, o bir beklemeyse ondan önceki aksiyonun elementi.
  jsError({ run, replay, step, m, moment, actions }) {
    if (!run.listening.has(replay.tabId)) return { verdict: verdictSkip('sayfanın JavaScript hataları dinlenemedi') };
    const verdict = jsErrorVerdict(m.params, (m.action ? moment.fresh : step.errors).filter((e) => !e.revoked));
    if (verdict.status !== 'fail') return m.action || moment.at !== 'action' ? { verdict } : null;
    const now = moment.at !== 'end' && moment.index >= 0 ? moment.index : actions.length - 1;
    const index = actionBefore(actions, now);
    return { verdict, culprit: { index, note: index === now && moment.at !== 'end' ? 'hata bu aksiyon oynatılırken oluştu' : 'hata bu aksiyondan sonra oluştu' } };
  },

  // Her aksiyonun süresi sınırın altında olmalı (aksiyona bağlıysa yalnızca o aksiyonun). Her aksiyondan sonra
  // bakılır: sınır aşıldıysa o anda bozulur (süre artık kısalmaz). Temiz sonuç adımın sonunda yazılır: son
  // aksiyonun süresine beklenen ekranın gelmesi de girer. Yarıda kalan adım sınırı çoktan aştıysa bozulur
  // (takılan sayfa: element 10 sn bekleyip gelmedi).
  actionTimeout({ step, m, moment, actions, bound }) {
    if (m.action && bound < 0) return { verdict: verdictSkip(`aksiyon edge'de bulunamadı (${actionRefText(m.action)})`) };
    if (m.action && actions[bound]?.type === 'wait') return { verdict: verdictSkip('bekleme aksiyonu: süresi kayıttan gelir, ölçülmez') };
    const times = actionTimes(step.timing);
    const only = m.action ? bound : null;
    const state = moment.at === 'action' ? 'action' : moment.at === 'broke' ? 'broke' : moment.arrived ? 'done' : 'missed';
    const verdict = timeoutVerdict(m.params?.maxSeconds, times, actions, { only, state });
    if (!verdict) return null;
    const over = verdict.status === 'fail' ? overLimit(m.params?.maxSeconds, only === null ? times.actions : times.actions.filter((a) => a.index === only)) : null;
    return { verdict, culprit: over && over.index >= 0 ? { index: over.index, note: 'süresi sınırı aşan aksiyon' } : null };
  },
};

function replayVerdict(run, replay, step, m, moment) {
  const check = REPLAY_CHECKS[m.type];
  if (!check) return { verdict: verdictSkip('bu tür oynatmada kontrol edilmiyor') };
  const actions = run.edges[step.index]?.actions ?? [];
  return check({ run, replay, step, m, moment, actions, bound: m.action ? resolveMonitorAction(m.action, actions) : -1 });
}

// index'teki ya da ondan önceki son gerçek (bekleme olmayan) aksiyonun sırası; yoksa -1. Kayıt her aksiyonun
// arkasına bir bekleme koyar: bekleme sırasında yakalanan hata, ondan önceki aksiyonun ardından oluşmuştur.
function actionBefore(actions, index) {
  for (let i = Math.min(index, actions.length - 1); i >= 0; i--) if (actions[i]?.type !== 'wait') return i;
  return -1;
}

// Listedeki (ekrana bakmayan) monitörlerin şimdiki sonuçları; bozulan sonuca ilgili aksiyonun elementi eklenir.
async function replayVerdicts(run, replay, step, list, moment) {
  const results = {};
  for (const m of list) {
    const found = replayVerdict(run, replay, step, m, moment);
    if (!found) continue;
    results[m.id] = found.verdict;
    if (found.verdict.status === 'fail') Object.assign(found.verdict, await actionLocation(run, replay, step, found.culprit));
  }
  return results;
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
    for (const result of Object.values(response.results ?? {})) if (result?.targets) result.viewport = response.viewport ?? null; // kutuların ölçüldüğü alan (uyarıda görüntüyle eşlenir: fitLocations)
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
  $('monitor-run-empty').textContent = run.monitors.length ? '' : 'Bu koşuda geçerli etkin monitör yok (ne genel kural ne bu senaryoya özel). Monitörler bölümünden ya da graph\'ta sağ tıkla ekleyin.';
  const own = run.monitors.filter((m) => m.scenarioId).length;
  const parts = [counts.fail ? `${counts.fail} kırmızı` : '', counts.ok ? `${counts.ok} yeşil` : ''].filter(Boolean);
  $('monitor-run-summary').textContent = run.monitors.length
    ? `${run.monitors.length} monitör${own ? ` (${run.monitors.length - own} genel, ${own} senaryo)` : ''} · ${running ? 'kontrol ediliyor · ' : ''}${parts.join(' · ')}`
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

// Oynatılan graph senaryonun kopyasıdır: varılan node'un adı kopyadan (panel.js > replayNode ile aynı kural)
function stepLabel(run, step) {
  const edge = run.edges[step.index];
  const target = run.scenario?.graph?.nodes.find((n) => n.id === step.target) ?? nodeById(step.target);
  return `Adım ${step.index + 1} (${edge?.name ?? step.edgeId} → ${target?.name ?? step.target})`;
}

// Bir monitörün satırı: LED · etiket (Genel / Senaryo) · ad / kapsam · adım izi (her adım bir kare) ·
// ayrıntı · ekran görüntüsü (bozulan element işaretli)
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
  if (run.scenario) li.querySelector('.led-title').prepend(monitorTag(m)); // monitor-list.js; adın önünde
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
  if (failed) li.append(shotThumb(failed.verdicts.get(m.id), () => openShot(run, m, failed), 'Bozulduğu andaki ekranı büyüt', undefined, m)); // monitor-locate.js
  return li;
}

// Adımdaki sonucun görüntüsü (monitor-list.js > openMonitorShot): bozulma anı, nedeni ve bozulan element
function openShot(run, m, step) {
  const v = step.verdicts.get(m.id);
  openMonitorShot(m, { where: v?.where ?? stepLabel(run, step), text: v?.text ?? '', screenshot: v?.screenshot ?? null, ...faultLocation(v) });
}


// -----------------------------------------------------------------------------
// "BU EKRANDA ŞİMDİ KONTROL ET" (Monitörler bölümü): oynatmasız, açık sekmede
// -----------------------------------------------------------------------------
// Tüm model monitörleri + graph'ta seçili node ya da edge'in monitörleri sayfada kontrol edilir;
// senaryo görünümünde o senaryonun monitörleri de (genel kurallarla birlikte). Sonuç yine ikili
// (yeşil / kırmızı); kontrol edilemeyen monitörün nedeni satırında yazar. Ekrana bakmayan monitörler
// (JavaScript Error, Action Timeout) burada kontrol edilemez: oynatma yoksa olay da süre de yoktur.
// Atlanırlar; son oynatmadaki sonuçları satırlarında kalır.

$('btn-monitor-check').onclick = async () => {
  if (liveChecking) return;
  if (replay) return showMessage({ notice: 'Oynatma sürüyor; monitörler oynatma kartında adım adım kontrol ediliyor.' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return showMessage({ error: 'Açık sekme bulunamadı.' });
  const selected = selectedItem(); // monitor-list.js
  const pool = [...monitors.items, ...scenarioMonitorItems(monitorScenarioView())]; // monitor-store.js
  const scoped = pool.filter((m) => m.enabled && (m.scope === 'global' || (selected && m.scope === selected.item.id)));
  const list = scoped.filter((m) => !isReplaySide(m));
  const replayOnly = scoped.length - list.length; // yalnızca oynatmada kontrol edilebilenler
  if (!list.length) {
    return showMessage({ notice: replayOnly
      ? `Bu ekranda kontrol edilebilecek monitör yok: ${replayOnly} etkin monitör (JavaScript Error, Action Timeout) yalnızca oynatmada kontrol edilir ("Koşuyu oynat").`
      : `Kontrol edilecek etkin monitör yok: ${monitorScenarioView() ? 'senaryonun tamamı, tüm model' : 'tüm model'} için ya da graph'ta seçili öğe için bir monitör ekleyin.` });
  }
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
      await fitLocations(failing.map((m) => verdicts.get(m.id)), screenshot);
      const where = `Şimdi kontrol${host ? ` (${host})` : ''}`;
      if (graphId === monitorsGraphId) {
        try {
          await addMonitorAlarms(failing.map((m) => ({ monitorId: m.id, source: 'live', where, text: verdicts.get(m.id).text, url: tab.url ?? '', screenshot, ...faultLocation(verdicts.get(m.id)) })));
        } catch (error) {
          console.warn('Monitör uyarıları kaydedilemedi:', error);
        }
      }
    }
    const summary = [counts.fail ? `${counts.fail} kırmızı` : '', counts.ok ? `${counts.ok} yeşil` : ''].filter(Boolean).join(', ')
      + (counts.skip ? ` (${counts.skip} tanesi bu ekranda kontrol edilemedi; nedeni satırında)` : '')
      + (replayOnly ? ` (${replayOnly} monitör yalnızca oynatmada kontrol edilir; atlandı)` : '');
    showMessage(counts.fail ? { error: `Şimdi kontrol edildi: ${summary}. Ayrıntı monitörün satırında.` } : { notice: `Şimdi kontrol edildi: ${summary}.` });
    $('monitors').open = true;
  } finally {
    liveChecking = false;
    $('btn-monitor-check').disabled = false;
    renderMonitors();
  }
};
