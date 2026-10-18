// =============================================================================
// background.js — BEYİN (Manifest V3 service worker)
// -----------------------------------------------------------------------------
// - Graph'ın tek sahibi ve TEK YAZARIDIR. State'i sadece bu dosya değiştirir.
// - content.js'ten gelen aksiyonları bir "buffer"da biriktirir.
// - Panel "Node oluştur" dediğinde: sayfanın parmak izini ve ekran görüntüsünü alır,
//   etkileşimli element kümesi birebir aynı olan bir node arar, node/edge ekler.
// - State'i chrome.storage.local'a yazar. Panel oradan okur ve çizer.
// - Panelin Ayarlar bölümündeki seçimleri de saklar ve uygular.
//
// Mimari ve mesajların tamamı: docs/01-mimari.md
// =============================================================================

// ACTION_TYPES, INTERACTABLE_TYPES, DEFAULT_SETTINGS, urlKey(), stateCounts(), sameCounts()
importScripts('settings.js');

// Eklenti ikonuna tıklanınca yan panel açılsın.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);


// -----------------------------------------------------------------------------
// STATE
// -----------------------------------------------------------------------------
// Veri modelinin tamamı: docs/04-veri-modeli.md

function emptyState() {
  return {
    tabId: null,          // Kaydın sürdüğü (aktif) sekme. İlk "Node oluştur"da belirlenir.
    tabs: [],             // Kayda katılan sekmeler { id, url } (bkz. SEKMELER)
    declinedTabs: [],     // "Bu sekmede devam edilsin mi?" sorusuna "Hayır" denen sekmeler
    pageOpenedTabs: [],   // Kayıt sekmelerinin açtığı sekmeler (link, popup)
    tabPrompt: null,      // Bekleyen soru: kayda katılmamış bir sekme aktif oldu
    nextId: 1,            // n1, e2, n3... şeklinde id üretmek için sayaç
    startNodeId: null,    // İlk oluşturulan node (graph'ın başlangıcı)
    currentNodeId: null,  // Kullanıcının şu an bulunduğu node. Yeni edge buradan çıkar.
    nodes: [],
    edges: [],
    buffer: [],           // Son node'dan beri yapılan, henüz edge'e dönüşmemiş aksiyonlar
    screen: null,         // Hemen önceki state: en son görülen ekranın edge set'i (bkz. observeScreen)
    idleSince: null,      // Ekranın son aksiyondan sonra durulduğu an; o andan beri aksiyon yok (bkz. BEKLEMELER)
    viewport: null,       // Kayıt sekmesinin son bilinen görünen alanı (bkz. enterTab)
    pending: null,        // Aynı element kümeli node bulunduğunda kullanıcının onayını bekleyen karar
    undo: [],             // Edge'lerden silinen aksiyonlar ("Geri al" için; en yenisi sonda)
  };
}

// MV3 service worker boşta kalınca Chrome onu kapatır; RAM'deki her şey silinir.
// Bu yüzden state'in asıl yeri chrome.storage.local. Worker her uyandığında state
// bir kez okunur ve sonraki tüm mesajlar AYNI nesne üzerinde çalışır.
let statePromise = null;

function getState() {
  statePromise ??= chrome.storage.local.get('state').then((r) => (r.state ? normalizeState(r.state) : emptyState()));
  return statePromise;
}

function save(state) {
  return chrome.storage.local.set({ state });
}

// Ayarlar state'ten ayrı bir anahtarda durur; "Sıfırla" onlara dokunmaz.
// Şekli: settings.js > DEFAULT_SETTINGS. State gibi bir kez okunur ve bellekte tutulur.
let settingsPromise = null;

function getSettings() {
  settingsPromise ??= chrome.storage.local.get('settings').then((r) => ({ ...DEFAULT_SETTINGS, ...r.settings }));
  return settingsPromise;
}

async function setSettings(state, settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  if (!(merged.minWaitSeconds >= 0)) merged.minWaitSeconds = DEFAULT_SETTINGS.minWaitSeconds;
  settingsPromise = Promise.resolve(merged);
  await chrome.storage.local.set({ settings: merged });
  notifyMonitor(state, merged);
}


// -----------------------------------------------------------------------------
// MESAJLAR
// -----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(
    (result) => sendResponse(result ?? { ok: true }),
    (error) => sendResponse({ error: error.message }),
  );
  return true; // Chrome'a "cevabı asenkron göndereceğim" demek
});

async function handle(message, sender) {
  const state = await getState();
  if (await isReplaying()) {
    if (message.type === 'ACTION' || message.type === 'SCREEN') return watchOf(await getSettings(), false);
    if (message.type === 'CREATE_NODE') throw new Error('Panelde oynatma sürüyor. Bitince ya da durdurunca node oluşturabilirsiniz.');
  }
  switch (message.type) {
    // content.js -> background
    case 'ACTION':      return addAction(state, sender.tab?.id, message.action, message).then(() => monitorFor(state, sender.tab?.id));
    case 'SCREEN':      return onScreen(state, sender.tab?.id, message.screen, message.viewport, sender.tab?.url).then(() => monitorFor(state, sender.tab?.id));
    // panel -> background
    case 'CREATE_NODE': return createNode(state, message.tabId, message.windowId);
    case 'RESOLVE':     return resolvePending(state, message.targetId);
    case 'CANCEL_PENDING': return cancelPending(state);
    case 'RESOLVE_TAB': return inTabQueue(() => resolveTab(state, message.follow));
    case 'RENAME':      return rename(state, message.id, message.name);
    case 'DELETE':      return remove(state, message.id);
    case 'SET_CURRENT': return setCurrent(state, message.id, message.tabId);
    case 'RESET':       return reset(state);
    case 'SET_SETTINGS': return setSettings(state, message.settings);
    case 'REMOVE_ACTION': return removeAction(state, message.edgeId, message.index);
    case 'MERGE_NODES': return mergeNodes(state, message.keepId, message.removeId);
    case 'UNDO':        return undo(state);
    case 'REPLAY':      return setReplay(state, message);
  }
}


// -----------------------------------------------------------------------------
// PANELDE OYNATMA: oynatma sürerken kayıt durur
// -----------------------------------------------------------------------------
// Panel bir koşuyu kullanıcının kendi tarayıcısında oynatırken (sidepanel/replay.js) fare ve
// klavye olayları gerçek kullanıcı olayı gibi gelir (isTrusted); kaydedilmemelidir. Oynatma
// sürerken kayda giden her yol (aksiyon, ekran, gezinme, yakınlaştırma, sekme olayları) yok
// sayılır. Bayrak chrome.storage.session'dadır: service worker uyuyup uyansa da kalır,
// tarayıcı kapanınca silinir. Oynatmadan önce bekleyen aksiyonlar atılır (panel önce sorar).
// Oynatma bitince tarayıcı başka bir ekrandadır: koşu geçtiyse kayıt vardığı node'dan ve
// oynatmanın bittiği sekmede sürer ("Buradan devam et" gibi); geçmediyse ya da durdurulduysa
// şu anki node bilinmez, kullanıcı bir node seçip "Buradan devam et"e basar.
let replayPromise = null;

function isReplaying() {
  replayPromise ??= chrome.storage.session.get('replay').then((r) => Boolean(r.replay));
  return replayPromise;
}

async function setReplay(state, { active, endNodeId = null, tabId = null }) {
  replayPromise = Promise.resolve(Boolean(active));
  await chrome.storage.session.set({ replay: Boolean(active) });
  const settings = await getSettings();
  if (active) {
    state.buffer = [];
    notifyMonitor({ tabId: null }, settings, state.tabId); // kayıt sekmesi izlemeyi bıraksın
    return save(state);
  }
  // Oynatma sekme kapatmış olabilir: kapananlar kayıttan düşer.
  const open = await Promise.all(state.tabs.map((t) => chrome.tabs.get(t.id).then(() => t, () => null)));
  state.tabs = open.filter(Boolean);
  if (!state.tabs.some((t) => t.id === state.tabId)) state.tabId = null;
  const previous = state.tabId;
  const node = state.nodes.find((n) => n.id === endNodeId);
  const tab = node && tabId !== null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  Object.assign(state, { buffer: [], idleSince: Date.now() });
  if (node) {
    Object.assign(state, { currentNodeId: node.id, screen: node.elements });
    if (tab) Object.assign(state, { tabId: tab.id, tabs: [{ id: tab.id, url: tab.url, title: tab.title }], viewport: node.viewport ?? null });
  } else {
    Object.assign(state, { currentNodeId: null, screen: null });
  }
  notifyMonitor(state, settings, previous);
  return save(state);
}


// -----------------------------------------------------------------------------
// AKSİYONLAR
// -----------------------------------------------------------------------------

// screen: aksiyonun yapıldığı andaki ekran (content.js gönderir; background'ın yakaladığı
// aksiyonlarda yok). Yalnızca önceki aksiyon hâlâ açıksa, onun sonrası olarak kullanılır.
// Önceki aksiyon kapandıysa kullanılmaz: yazmada bu ekran yazılanın sonrasıdır; aksiyonun
// öncesi, son görülen state'tir.
// replaces: bu aksiyonun yerini aldığı, aynı hareketten önceki aksiyonun zamanı. Çift/üçlü
// tıklamayla metin seçilince hareketin ilk tıklaması ya da kelime seçimi düşer (content.js > onMouseUp).
// viewport: aksiyonun gönderildiği andaki sayfa boyutu (content.js gönderir; bkz. observeScreen).
// typingSince: yazma aksiyonunda yazmaya başlanan an (bkz. waitBefore).
async function addAction(state, tabId, action, options = {}) {
  const settings = await getSettings();
  // Kayıt başlamadıysa ya da aksiyon başka bir sekmeden geldiyse yok say.
  if (state.tabId === null || tabId !== state.tabId) return;
  return pushAction(state, settings, action, options);
}

// Aksiyonu buffer'a ekler (sekme kontrolünden sonra; sekme aksiyonlarını background kendisi ekler).
function pushAction(state, settings, action, { screen = null, replaces = null, viewport = null, typingSince = null } = {}) {
  if (viewport) state.viewport = viewport;
  noteTabUrl(state, action.url);
  if (replaces && state.buffer.at(-1)?.time === replaces) state.buffer.pop();
  // Aynı tuşa sayfa durulmadan yeniden basıldıysa (basılı tutma dahil) tek aksiyondur.
  const open = openAction(state);
  if (action.type === 'key' && open?.type === 'key' && open.key === action.key && open.selector === action.selector) {
    open.count++;
    open.label = `Press ${open.key} ×${open.count}`;
    return save(state);
  }
  // Pencere boyutu sayfa durulmadan yine değiştiyse (sürükleme sürüyor) tek aksiyondur:
  // varılan boyut güncellenir.
  if (action.type === 'resize' && open?.type === 'resize') {
    open.viewport = action.viewport;
    return save(state);
  }
  if (open) observeScreen(state, screen, settings, viewport);
  else waitBefore(state, settings, action, screen, typingSince);
  // Ayarlarda işaretli olmayan tipteki aksiyon "Bekleyen aksiyonlar"a eklenmez.
  if (isActionEnabled(settings, action.type)) state.buffer.push(action);
  state.idleSince = null; // aksiyon yapıldı: boşluk, etkisi durulunca yeniden başlar
  return save(state);
}

// Sayfa durulunca gelen ekran: açık aksiyonu kapatır; açık aksiyon yoksa ekran aksiyonsuz
// değişmiş olabilir (bkz. observeIdle).
async function onScreen(state, tabId, screen, viewport, url) {
  if (state.tabId === null || tabId !== state.tabId) return;
  const settings = await getSettings();
  if (viewport) state.viewport = viewport;
  noteTabUrl(state, url);
  if (openAction(state)) observeScreen(state, screen, settings, viewport);
  else observeIdle(state, settings, screen, Date.now(), url);
  return save(state);
}

// ACTION ve SCREEN'in cevabı: bu sekme ekranı aksiyonsuz da izlesin mi (monitor), fareyle
// üzerine gelmeyi kaydetsin mi (hover)? Yalnızca kayıt sekmesi. İzleme "Beklemeleri kaydet"
// ya da "Üzerine gelme" açıkken gerekir: JS ile açılan menü DOM'u fare hareketinden sonra
// değiştirir (bkz. content.js > setWatch). Yeni yüklenen sayfa bunu ilk bildiriminin cevabından öğrenir.
async function monitorFor(state, tabId) {
  return watchOf(await getSettings(), state.tabId !== null && tabId === state.tabId);
}

function watchOf(settings, recording) {
  const hover = recording && isActionEnabled(settings, 'hover');
  return { monitor: recording && (settings.recordWaits || hover), hover };
}

// Ayar değişince ya da kayıt bir sekmeye bağlanınca o sekmeye hemen bildirilir; kayıt başka
// sekmeye geçtiyse önceki sekme izlemeyi bırakır.
function notifyMonitor(state, settings, previousTabId = null) {
  if (previousTabId !== null && previousTabId !== state.tabId) {
    chrome.tabs.sendMessage(previousTabId, { type: 'MONITOR', ...watchOf(settings, false) }).catch(() => { });
  }
  if (state.tabId === null) return;
  chrome.tabs.sendMessage(state.tabId, { type: 'MONITOR', ...watchOf(settings, true) }).catch(() => { });
}


// -----------------------------------------------------------------------------
// AKSİYONUN ETKİSİ: "state'i değiştirdi mi?"
// -----------------------------------------------------------------------------
// Hafızada tek bir state tutulur: hemen önceki (state.screen). Node oluşturulunca ya da
// "Buradan devam et" denince o node'un state'i olur. Aksiyondan sonra sayfa durulunca content.js
// yeni ekranı bildirir (SCREEN); aksiyon, önceki state ile bu ekran karşılaştırılarak
// işaretlenir (changed) ve ekran yeni "hemen önceki state" olur. Ekranın kendisi aksiyonda
// saklanmaz. İşaret yalnızca edge düzenlemedeki silme uyarısı içindir (docs/01 > Edge
// düzenleme) ve işaretlendiği andaki Ayarlar'la hesaplanır.
//
// Sonrası bildirilmeden yeni aksiyon gelirse (ör. yazıp hemen Enter) açık aksiyon, yeni
// aksiyonun yapıldığı andaki ekranla kapatılır. Ekransız gelen aksiyonda (background'ın
// yakaladıkları ve pencere boyutu) iki aksiyonun etkisi ayrılamaz; ikisi de "bilinmiyor" (null) olur.

// Sonrası henüz görülmemiş aksiyon: buffer'ın sonundaki işaretsiz aksiyon.
function openAction(state) {
  const last = state.buffer.at(-1);
  return last && last.changed === undefined ? last : null;
}

// viewport: ekranın görüldüğü andaki sayfa boyutu. Yakınlaştırma sayfanın CSS piksel boyutunu
// ve piksel oranını da değiştirir; kapanan yakınlaştırma aksiyonu varılan boyutu saklar.
// Tekrar oynatırken tarayıcı yakınlaştırması olmayan araçlar (Playwright) aynı ekranı bu
// boyutla kurar.
function observeScreen(state, screen, settings, viewport = null) {
  const open = openAction(state);
  if (open) {
    const before = stateCounts(state.screen, settings);
    const after = stateCounts(screen, settings);
    open.changed = before && after ? !sameCounts(before, after) : null;
    if (open.type === 'zoom' && viewport) open.viewport = viewport;
    // Tab ile odak ve fareyle üzerine gelme yalnızca state'i değiştirdiyse aksiyondur; formda
    // alandan alana geçmek, fareyi bir butonun üzerinden geçirmek gürültüdür.
    if ((open.type === 'focus' || open.type === 'hover') && open.changed === false) state.buffer.pop();
    state.idleSince = Date.now(); // aksiyonun etkisi duruldu: boşluk başlar
  }
  state.screen = screen;
}


// -----------------------------------------------------------------------------
// BEKLEMELER (Ayarlar > Beklemeleri kaydet)
// -----------------------------------------------------------------------------
// Bazı durumlara hiçbir tıklamayla ulaşılmaz, yalnızca beklenerek ulaşılır: internet
// bankacılığında oturum zaman aşımı kullanıcıyı çıkışa atar. Anahtar açıkken aksiyonlar
// arasındaki süre 'wait' aksiyonu olarak kaydedilir. Bekleme sayfaya dokunmaz ama ekranı
// değiştirebilir; bunu görmek için kayıt sekmesinin ekranı aksiyonsuz da izlenir
// (content.js > setWatch). Bekleme elle eklenmez, kaydedilir: gözlenmiş bir aksiyondur.
//
// state.idleSince: ekranın son aksiyondan (ya da node'dan) sonra durulduğu an. Aksiyon
// yapılınca null olur, etkisi durulunca (observeScreen) yeniden başlar.
//   - Ekran bu sırada kendiliğinden değişirse bekleme o anda kapanır ve "ekranı değiştirdi"
//     işaretini alır; süresi değişime kadar geçen süredir, ne kadar kısa olursa olsun
//     kaydedilir. Sonraki boşluk yeni bir beklemedir.
//   - Ekran değişmediyse iki aksiyon arasındaki boşluk en az minWaitSeconds sürdüyse
//     "ekranı değiştirmedi" bekleme olarak ikinci aksiyondan önce eklenir.
//   - Node oluşturduktan sonra ilk aksiyona ve son aksiyondan "Node oluştur"a kadar geçen
//     süre aksiyonlar arasında değildir; ekran değişmediyse kaydedilmez.

// Açık aksiyon yokken görülen ekran: önceki ekrandan farklıysa aradaki bekleme ekranı
// değiştirmiştir. Ayar kapalıyken yalnızca ekranı "hemen önceki state" yapar.
function observeIdle(state, settings, screen, now, url) {
  const before = stateCounts(state.screen, settings);
  const after = stateCounts(screen, settings);
  if (settings.recordWaits && state.idleSince !== null && before && after && !sameCounts(before, after)) {
    state.buffer.push(waitAction(state.idleSince, now, url, true));
    state.idleSince = now;
  }
  state.idleSince ??= now; // önceki aksiyon kaydedilmeyen bir tipteydi: boşluk şimdi başlar
  state.screen = screen;
}

// Aksiyondan önceki boşluk. Aksiyonun ekranı (yapıldığı an) öncekinden farklıysa izlemenin
// henüz bildirmediği bir değişim vardır. Boşluk alt sınırdan uzunsa bu, ekranı değiştiren bir
// beklemedir; kısaysa değişim aksiyona yaklaşırken olmuştur (ör. fare tıklanacak butona
// giderken bir menüden çıktı) ve aksiyonun öncesine katılır. Yazmada aksiyonun ekranı
// yazılanın sonrasıdır, karşılaştırılmaz; bekleme yazmaya başlanan anda biter.
function waitBefore(state, settings, action, screen, typingSince) {
  const end = typingSince ?? action.time;
  const long = state.idleSince !== null && end - state.idleSince >= settings.minWaitSeconds * 1000;
  if (screen && action.type !== 'input' && !typingSince) {
    if (long) observeIdle(state, settings, screen, end, action.url);
    else state.screen = screen;
  }
  const previous = state.buffer.at(-1);
  const between = previous && previous.type !== 'wait'; // iki aksiyonun arası
  if (settings.recordWaits && between && long) {
    state.buffer.push(waitAction(state.idleSince, end, action.url, false));
  }
}

function waitAction(from, to, url, changed) {
  return { type: 'wait', ms: Math.round(to - from), label: 'Wait', selector: null, url, time: Math.round(from), changed };
}

// Adres çubuğuna yazma, geri/ileri ve yenileme sayfanın İÇİNDE olmadığı için
// content.js bunları göremez. Tarayıcı seviyesindeki bu gezinmeleri buradan yakalıyoruz.
//   onCommitted           : klasik sayfa geçişleri (yeni HTML yüklenir)
//   onHistoryStateUpdated : SPA geçişleri (React/Vue router; sayfa yeniden yüklenmez)
chrome.webNavigation.onCommitted.addListener(onNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigation);

async function onNavigation(details) {
  if (details.frameId !== 0) return; // sadece ana sayfa, iframe'ler değil
  if (await isReplaying()) return;
  const action = navigationAction(details);
  if (action) addAction(await getState(), details.tabId, action);
}

function navigationAction({ url, transitionType, transitionQualifiers, timeStamp }) {
  const base = { url, selector: null, time: Math.round(timeStamp) };
  if (transitionQualifiers.includes('forward_back')) return { ...base, type: 'history', label: 'Back' };
  if (transitionType === 'reload') return { ...base, type: 'reload', label: 'Reload' };
  if (['typed', 'auto_bookmark', 'generated'].includes(transitionType)) {
    return { ...base, type: 'navigate', label: 'GoTo ' + lastPathSegment(url) };
  }
  return null; // Link tıklaması / form gönderimi: content.js zaten 'click' / 'enter' olarak kaydetti.
}

// Tarayıcı yakınlaştırması (Ctrl + / Ctrl -, Ctrl + tekerlek, menü) da sayfanın içinde
// olmadığı için buradan yakalanır. State yalnızca ekrana sığan elementlerden oluştuğu için
// yakınlaştırma da kaydırma gibi state'i değiştirebilir. Varılan oran ve sayfa boyutu
// (bkz. observeScreen) kaydedilir: tekrar oynatırken sekme aynı orana ayarlanır ya da
// otomasyon aracında aynı boyut kurulur. Chrome oranı site başına sakladığı için başka bir
// siteye geçince oran kendiliğinden de değişebilir; oran mutlak olduğu için bu zararsızdır.
// Art arda gelen yakınlaştırmalar (tekerleğin her çentiği) sayfa durulmadan geldiği için tek
// aksiyondur: açık bir yakınlaştırma aksiyonu varsa oranı güncellenir, başlangıç oranına
// (fromZoom) dönüldüyse aksiyon düşer. Olaylar sırayla işlenir; yoksa iki çentik aynı anda
// "açık aksiyon yok" görüp iki ayrı aksiyon eklerdi.
let zoomQueue = Promise.resolve();
chrome.tabs.onZoomChange.addListener((change) => {
  zoomQueue = zoomQueue.then(() => onZoom(change)).catch(console.error);
});

async function onZoom({ tabId, oldZoomFactor, newZoomFactor }) {
  if (newZoomFactor === oldZoomFactor || await isReplaying()) return;
  const state = await getState();
  if (state.tabId !== tabId) return;
  const open = openAction(state);
  if (open?.type === 'zoom') {
    if (newZoomFactor === open.fromZoom) state.buffer.pop();
    else Object.assign(open, { zoom: newZoomFactor, label: zoomLabel(open.fromZoom, newZoomFactor) });
    return save(state);
  }
  const { url } = await chrome.tabs.get(tabId);
  return addAction(state, tabId, {
    type: 'zoom', zoom: newZoomFactor, fromZoom: oldZoomFactor, label: zoomLabel(oldZoomFactor, newZoomFactor),
    selector: null, url, time: Date.now(),
  });
}

function zoomLabel(from, to) {
  return to > from ? 'Zoom in' : 'Zoom out';
}


// -----------------------------------------------------------------------------
// SEKMELER: kayıt birden fazla sekmeye yayılabilir
// -----------------------------------------------------------------------------
// Akış bir sekmede başlar ama başka sekmede sürebilir: site yeni sekme ya da pencere açar
// (target=_blank, ödeme / OAuth penceresi) ya da kullanıcı başka bir sitenin sekmesine geçer
// (e-postadaki doğrulama linki). Kayda katılmamış bir sekme aktif olunca panel sorar
// (state.tabPrompt): "Evet" -> kayıt o sekmede sürer; "Hayır" -> sekme hatırlanır, bir daha
// sorulmaz, kayıt eski sekmede kalır ve o sekmedeki aksiyonlar yok sayılır. Kullanıcı kayıt
// sekmesine dönünce kayıt kaldığı yerden sürer.
//   state.tabs           : kayda katılan sekmeler { id, url } (url: son bilinen adres)
//   state.tabId          : bunlardan aktif olanı; aksiyonlar yalnızca ondan kabul edilir
//   state.declinedTabs   : "Hayır" denen sekmeler
//   state.pageOpenedTabs : kayıt sekmelerinin açtığı sekmeler: açılış önceki aksiyonun sonucudur
// Sekme geçişleri 'tab' aksiyonudur: open (sayfa açtı / kullanıcı açtı), switch, close. Kayda
// katılmış sekmeler arası geçiş sorulmaz. Tekrar oynatırken sekme adresiyle (URL şablonu)
// bulunur: Chrome'un sekme id'si tekrar oynatmada aynı kalmaz, yol da kayıttaki sırayla
// yürümeyebilir (bkz. runner/lib/actions.js).
// Olaylar sırayla işlenir: kapanan sekmenin ve yerine aktif olan sekmenin olayları birlikte gelir.
let tabQueue = Promise.resolve();

function inTabQueue(fn) {
  const run = tabQueue.then(fn);
  tabQueue = run.catch(console.error);
  return run;
}

// Panelde oynatma sürerken sekme olayları kayda girmez (bkz. PANELDE OYNATMA).
const unlessReplaying = (fn) => async () => (await isReplaying() ? undefined : fn());

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => inTabQueue(unlessReplaying(() => onTabOpenedByPage(details))));
chrome.tabs.onActivated.addListener(({ tabId }) => inTabQueue(unlessReplaying(() => onTabActivated(tabId))));
chrome.tabs.onUpdated.addListener((tabId, change) => inTabQueue(unlessReplaying(() => onTabUpdated(tabId, change))));
chrome.tabs.onRemoved.addListener((tabId, info) => inTabQueue(unlessReplaying(() => onTabRemoved(tabId, info))));

// Sekmenin aktif olduğu olay bundan önce gelebilir; bekleyen soru varsa o da güncellenir.
async function onTabOpenedByPage({ sourceTabId, tabId }) {
  const state = await getState();
  if (!state.tabs.some((t) => t.id === sourceTabId)) return;
  state.pageOpenedTabs.push(tabId);
  if (state.tabPrompt?.tabId === tabId) state.tabPrompt.openedByPage = true;
  return save(state);
}

async function onTabActivated(tabId) {
  const state = await getState();
  if (state.nodes.length === 0) return;
  if (tabId === state.tabId) return clearTabPrompt(state); // kayıt sekmesine dönüldü
  if (state.tabs.some((t) => t.id === tabId)) return enterTab(state, tabId, 'switch');
  if (state.declinedTabs.includes(tabId)) return clearTabPrompt(state);
  return askForTab(state, tabId);
}

// Soru: kayda katılmamış sekme. Eklentinin kendi sayfaları (panel bir sekmede açıldıysa) sorulmaz.
async function askForTab(state, tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.url?.startsWith(chrome.runtime.getURL(''))) return;
  state.tabPrompt = { tabId, url: tab.url ?? '', title: tab.title ?? '', openedByPage: state.pageOpenedTabs.includes(tabId) };
  return save(state);
}

function clearTabPrompt(state) {
  if (!state.tabPrompt) return;
  state.tabPrompt = null;
  return save(state);
}

// Soru beklerken kullanıcı o sekmede adres yazabilir (Ctrl+T ile açılan boş sekme): kart güncellenir.
async function onTabUpdated(tabId, change) {
  const state = await getState();
  if (state.tabPrompt?.tabId !== tabId || !(change.url || change.title)) return;
  if (change.url) state.tabPrompt.url = change.url;
  if (change.title) state.tabPrompt.title = change.title;
  return save(state);
}

// Kayda katılmış bir sekme kapanırsa ve kayıtta başka sekme kaldıysa kapanış bir aksiyondur.
// Aktif sekme kapandıysa Chrome'un aktif yaptığı sekmeye geçilir (kayda katılmışsa). Kayıtta
// sekme kalmadıysa kayıt durur: başka bir sekmede "Evet" ya da "Buradan devam et" ile sürer.
async function onTabRemoved(tabId, { windowId }) {
  const state = await getState();
  if (state.tabPrompt?.tabId === tabId) state.tabPrompt = null;
  state.declinedTabs = state.declinedTabs.filter((t) => t !== tabId);
  state.pageOpenedTabs = state.pageOpenedTabs.filter((t) => t !== tabId);
  const closed = state.tabs.find((t) => t.id === tabId);
  if (!closed) return save(state);
  state.tabs = state.tabs.filter((t) => t.id !== tabId);
  const active = tabId === state.tabId;
  if (active) state.tabId = null;
  if (state.tabs.length) {
    pushAction(state, await getSettings(), tabAction('close', closed, { active }));
    const [now] = active ? await chrome.tabs.query({ active: true, windowId }) : [];
    if (now && state.tabs.some((t) => t.id === now.id)) return enterTab(state, now.id, 'switch');
  }
  return save(state);
}

// Panelin cevabı. "Evet": kayıt bu sekmede sürer. Kayıt sekmesi kapanmışsa sekme şu anki
// node'un ekranında olmalıdır (bkz. resumeInTab).
async function resolveTab(state, follow) {
  const prompt = state.tabPrompt;
  if (!prompt) return;
  state.tabPrompt = null;
  if (!follow) {
    state.declinedTabs.push(prompt.tabId);
    return save(state);
  }
  if (state.tabId === null) return resumeInTab(state, prompt.tabId);
  return enterTab(state, prompt.tabId, 'open', { by: prompt.openedByPage ? 'page' : 'user' });
}

// Kayıt bu sekmede sürer: sekme geçişi aksiyon olarak eklenir; sekmenin ekranı geçişin sonrası
// olur. Sekmenin görünen alanı öncekinden farklıysa (başka pencere) ardından bir 'resize'
// eklenir: tekrar oynatırken o sekme de aynı boyutta olsun.
async function enterTab(state, tabId, operation, extra = {}) {
  const settings = await getSettings();
  const tab = await chrome.tabs.get(tabId);
  const previous = state.tabId;
  pushAction(state, settings, tabAction(operation, tab, extra));
  state.tabId = tabId;
  if (!state.tabs.some((t) => t.id === tabId)) state.tabs.push({ id: tabId, url: tab.url, title: tab.title });
  const page = await chrome.tabs.sendMessage(tabId, { type: 'GET_FINGERPRINT' }).catch(() => null);
  if (page) {
    const resized = state.viewport && !sameViewport(state.viewport, page.viewport);
    observeScreen(state, page.elements, settings, page.viewport);
    if (resized) {
      pushAction(state, settings, { type: 'resize', selector: null, viewport: page.viewport, label: 'Resize', url: page.url, time: Date.now() });
      observeScreen(state, page.elements, settings);
    }
    state.viewport = page.viewport;
  }
  notifyMonitor(state, settings, previous);
  return save(state);
}

// Kayıt sekmesi kapanmıştı: kayıt yalnızca bu sekme şu anki node'un ekranındaysa sürer (URL
// şablonu ve edge set'i aynı); değilse sonraki edge'ler kayıttaki ekranlarla tutmazdı.
async function resumeInTab(state, tabId) {
  const settings = await getSettings();
  const node = state.nodes.find((n) => n.id === state.currentNodeId);
  const page = await chrome.tabs.sendMessage(tabId, { type: 'GET_FINGERPRINT' }).catch(() => null);
  const same = node && page && urlKey(page.url) === node.urlKey
    && sameCounts(stateCounts(node.elements, settings), stateCounts(page.elements, settings));
  if (!same) {
    await save(state);
    return { notice: `Bu sekme şu anki node'un${node ? ` (${node.name})` : ''} ekranında değil. O ekrana gidip tekrar deneyin ya da graph'ta bir node seçip "Buradan devam et"e basın.` };
  }
  Object.assign(state, { tabId, tabs: [{ id: tabId, url: page.url, title: page.title }], buffer: [], screen: page.elements, viewport: page.viewport, idleSince: Date.now() });
  notifyMonitor(state, settings);
  await save(state);
  return { notice: `Kayıt bu sekmede sürüyor (${node.name}).` };
}

// tab: { url, title } (Chrome sekmesi ya da state.tabs girdisi)
function tabAction(operation, tab, extra = {}) {
  const verb = { open: 'Open tab', switch: 'Switch to tab', close: 'Close tab' }[operation];
  return { type: 'tab', operation, url: tab.url, ...extra, selector: null, label: `${verb} ${pageName(tab)}`.trim(), time: Date.now() };
}

// Sekmenin kısa adı: adresin son anlamlı parçası, yoksa sayfa başlığı, o da yoksa alan adı.
function pageName({ url, title }) {
  try {
    return lastPathSegment(url) || title || new URL(url).hostname;
  } catch {
    return title ?? '';
  }
}

function sameViewport(a, b) {
  return a.width === b.width && a.height === b.height && a.devicePixelRatio === b.devicePixelRatio;
}

// Aktif kayıt sekmesinin son bilinen adresi (kapanırken ya da geçişte bilinsin).
function noteTabUrl(state, url) {
  const tab = state.tabs.find((t) => t.id === state.tabId);
  if (tab && url) tab.url = url;
}


// -----------------------------------------------------------------------------
// NODE OLUŞTURMA — projenin çekirdeği
// -----------------------------------------------------------------------------
// Akış (docs/01-mimari.md > "Node oluştur akışı"):
//   1) İlk node değilse ve bekleyen aksiyon yoksa: node oluşturma, sadece bildir
//   2) Sayfanın parmak izini al, aynı state'teki node'ları ara (URL şablonu + element kümesi birebir aynı)
//   3) Ekran görüntüsünü al, buffer'daki aksiyonları al (yeni edge'in aksiyonları)
//   4) Element kümesi birebir aynı node var mı?
//        evet  -> kararı kullanıcıya bırak (pending); panel onay kartı TÜM eşleşenleri
//                 seçenek olarak gösterir, kullanıcı birini seçer ya da yeni node der
//        hayır -> yeni node oluştur, SORU SORULMAZ (küme tek elementle bile farklıysa)
//   5) Mevcut node'dan hedef node'a edge çiz

async function createNode(state, tabId, windowId) {
  if (state.pending) throw new Error('Önce bekleyen "aynı node mu?" sorusunu cevaplayın.');
  // Kayda katılmamış bir sekme: "bu sekmede devam edilsin mi?" sorusu (yeniden) sorulur. Daha
  // önce "Hayır" denmiş olabilir; "Node oluştur"a basan kullanıcı fikrini değiştirmiştir.
  if (state.nodes.length > 0 && tabId !== state.tabId) {
    if (state.tabs.some((t) => t.id === tabId)) throw new Error('Kayıt başka bir sekmede sürüyor. O sekmeye dönün.');
    state.declinedTabs = state.declinedTabs.filter((t) => t !== tabId);
    await askForTab(state, tabId);
    return { notice: 'Farklı bir sekmedesiniz. Grafa bu sekmede devam etmek için paneldeki soruyu cevaplayın.' };
  }
  // Aksiyonsuz bir edge tekrar oynatılamaz. Bu yüzden ilk node dışında, son node'dan beri
  // hiç aksiyon kaydedilmediyse node oluşturulmaz. (Panel bu durumda butonu zaten kilitler.)
  // Beklemeler kaydediliyorsa ekran beklerken değişmiş olabilir; önce ekrana bakılır.
  const settings = await getSettings();
  if (state.nodes.length > 0 && state.buffer.length === 0 && !settings.recordWaits) {
    return { notice: 'Bekleyen aksiyon yok. Node oluşturmak için önce sayfada bir aksiyon yapın.' };
  }

  let page;
  try {
    page = await chrome.tabs.sendMessage(tabId, { type: 'GET_FINGERPRINT' });
  } catch {
    throw new Error('Bu sayfaya erişilemedi. Sayfayı yenileyip (F5) tekrar deneyin. (chrome:// sayfaları desteklenmez.)');
  }

  const capture = { ...page, urlKey: urlKey(page.url) };
  const matches = findSameStateNodes(state, capture, settings);
  // Bu ekran açık aksiyonun sonrasıdır; sıradaki aksiyonun öncesi de node'un state'i. Açık
  // aksiyon yoksa ekran beklerken değişmiş olabilir (bkz. observeIdle).
  if (openAction(state)) observeScreen(state, page.elements, settings, page.viewport);
  else if (state.nodes.length > 0) observeIdle(state, settings, page.elements, Date.now(), page.url);
  // Bekleyen tek aksiyon state'i değiştirmeyen bir odaktıysa düşmüştür (bkz. observeScreen).
  if (state.nodes.length > 0 && state.buffer.length === 0) {
    await save(state);
    return { notice: 'Bekleyen aksiyon yok. Node oluşturmak için önce sayfada bir aksiyon yapın.' };
  }

  capture.screenshot = await takeScreenshot(windowId);
  const actions = state.buffer;
  state.buffer = [];
  state.screen = page.elements;
  state.idleSince = Date.now(); // node'un ekranında boşluk başlar
  state.viewport = page.viewport;
  state.tabId = tabId;
  if (!state.tabs.length) state.tabs = [{ id: tabId, url: page.url, title: page.title }];
  notifyMonitor(state, settings);

  if (matches.length) {
    state.pending = { capture, actions, candidateIds: matches.map((n) => n.id) };
  } else {
    commit(state, capture, actions, null);
  }
  await save(state);
}

// Chrome ekran görüntüsünü saniyede en fazla 2 kez izin verir. Hızlı art arda
// basılırsa sınır aşılır; bu durumda 1 sn bekleyip bir kez daha deniyoruz.
async function takeScreenshot(windowId) {
  const options = { format: 'jpeg', quality: 40 };
  try {
    return await chrome.tabs.captureVisibleTab(windowId, options);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return chrome.tabs.captureVisibleTab(windowId, options);
  }
}

// Kullanıcı şu anki node'u seçip "node oluşturma, aksiyonlara devam et" dedi: yakalama
// atılır, kesilen aksiyonlar buffer'a geri döner. Karar beklerken yapılan aksiyonlar zaten
// buffer'daydı; zaman sırası korunsun diye geri dönenler onların önüne eklenir.
function cancelPending(state) {
  const pending = state.pending;
  if (!pending) return;
  state.pending = null;
  state.buffer = [...pending.actions, ...state.buffer];
  return save(state);
}

// Kullanıcı onay kartında aday node'lardan birini seçti (targetId) ya da "yeni node" dedi (null).
function resolvePending(state, targetId) {
  const pending = state.pending;
  if (!pending) return;
  if (targetId && !pending.candidateIds.includes(targetId)) return; // aday olmayan node'a bağlanmaz
  state.pending = null;
  commit(state, pending.capture, pending.actions, targetId ?? null);
  return save(state);
}

// targetId verilmişse o node'a bağlan, verilmemişse yeni node oluştur.
function commit(state, capture, actions, targetId) {
  if (!state.nodes.some((n) => n.id === targetId)) {
    const node = {
      id: 'n' + state.nextId++,
      name: uniqueNodeName(state, 'v_' + (toPascalCase(lastPathSegment(capture.url)) || toPascalCase(capture.title) || 'Page')),
      url: capture.url,
      urlKey: capture.urlKey,
      title: capture.title,
      elements: capture.elements,
      viewport: capture.viewport, // kümenin alındığı sayfa boyutu: test aynı boyutta çalıştırılır
      screenshot: capture.screenshot,
    };
    state.nodes.push(node);
    state.startNodeId ??= node.id;
    targetId = node.id;
  }

  // Edge kuralı: mevcut node varsa ondan hedefe HER ZAMAN edge çizilir. Hedef mevcut
  // node'un kendisiyse bu bir self-loop'tur. (Aksiyonsuz edge buraya hiç gelmez;
  // createNode() bekleyen aksiyon yoksa baştan durur.)
  const from = state.currentNodeId;
  if (from) {
    // Edge'e adını son aksiyon verir. Kaydırma, pencere boyutu ve bekleme çoğu zaman asıl
    // aksiyonun yan ürünü olduğu için (sayfa tıklamadan sonra kendisi de kaydırabilir, arada
    // DevTools açılabilir) atlanır; edge sadece bunlardan oluşuyorsa adı onlardan gelir:
    // e_ScrollDown, e_Resize, e_Wait (ör. oturum zaman aşımı).
    const lastLabel = (actions.findLast((a) => !['scroll', 'resize', 'wait'].includes(a.type)) ?? actions.at(-1))?.label;
    state.edges.push({
      id: 'e' + state.nextId++,
      name: 'e_' + (toPascalCase(lastLabel ?? '') || 'Transition'),
      source: from,
      target: targetId,
      actions,
    });
  }

  state.currentNodeId = targetId;
}


// -----------------------------------------------------------------------------
// STATE EŞLEŞTİRME — "Bu sayfa zaten bir node mu?"
// -----------------------------------------------------------------------------
// Algoritmanın açıklaması ve örnekler: docs/03-state-eslestirme.md
//
// KURAL: Bir node'un etkileşimli elementleri (edge set) o node'dan çıkabilecek edge'leri
// belirler. Bu yüzden iki sayfa ancak URL şablonu VE edge set'i BİREBİR aynıysa aynı state
// olabilir. Edge set bir SAYILI kümedir: her element türü (anahtar) ve ekranda kaç tane
// olduğu. Tek bir tür ya da sayı bile farklıysa (5 "Sil" butonu yerine 4), ne kadar benzer
// olursa olsun yeni node oluşur ve kullanıcıya sorulmaz. Farklı edge set'leri tek node
// saymak, o node'dan çıkan edge'lerin bir kısmının sayfada olmayan elementlere
// dayanmasına (çakışmaya) yol açar.
//
// Edge'lerin hedefi de aynı düzeyde tutulur: "anahtar + ekrandaki sırası" (content.js >
// targetOf). Sayılar eşitse her "bu türün n'incisi" iki ekranda da vardır; çakışma olmaz.
//
// Element kümesine yalnızca Ayarlar'da işaretli etkileşimli türler girer. Seçim, yeni
// sayfaya ve TÜM mevcut node'lara karşılaştırma anında uygulanır: ayar kayıt ortasında
// değişse de her iki taraf aynı tanımla karşılaştırılır.

// Birebir eşleşen TÜM node'lar (yoksa boş dizi). Birden fazla olabilir: kullanıcı daha
// önce aynı küme için "yeni node" demiş ya da Ayarlar'da bir türün işaretini kaldırmış
// olabilir. Hepsi onay kartında seçenek olur; sıra: şu anki node önce, sonra oluşturulma sırası.
function findSameStateNodes(state, capture, settings) {
  const counts = stateCounts(capture.elements, settings);
  return state.nodes
    .filter((node) => node.urlKey === capture.urlKey && sameCounts(stateCounts(node.elements, settings), counts))
    .sort((a, b) => (b.id === state.currentNodeId) - (a.id === state.currentNodeId));
}
// urlKey(), stateCounts() ve sameCounts(): settings.js (panel ve runner da kullanır)


// -----------------------------------------------------------------------------
// PANELDEN GELEN DÜZENLEME İSTEKLERİ
// -----------------------------------------------------------------------------

function rename(state, id, name) {
  const item = [...state.nodes, ...state.edges].find((x) => x.id === id);
  if (!item || !name.trim()) return;
  item.name = name.trim();
  return save(state);
}

// Node silinirse ona bağlı edge'ler de silinir. Silinenler eski yerleriyle geri al
// yığınına yazılır (bkz. undo). Son node silinse de graph sıfırlanmaz: geri alınabilsin.
async function remove(state, id) {
  const nodeIndex = state.nodes.findIndex((n) => n.id === id);
  const edgeIndex = state.edges.findIndex((e) => e.id === id);
  if (nodeIndex < 0 && edgeIndex < 0) return;
  const name = (state.nodes[nodeIndex] ?? state.edges[edgeIndex]).name;
  if (nodeIndex >= 0) {
    const edges = state.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.source === id || edge.target === id);
    pushUndo(state, { kind: 'node', node: state.nodes[nodeIndex], index: nodeIndex, edges, startNodeId: state.startNodeId, currentNodeId: state.currentNodeId });
  } else {
    pushUndo(state, { kind: 'edge', edge: state.edges[edgeIndex], index: edgeIndex });
  }

  state.nodes = state.nodes.filter((n) => n.id !== id);
  state.edges = state.edges.filter((e) => e.id !== id && e.source !== id && e.target !== id);
  if (state.pending) state.pending.candidateIds = state.pending.candidateIds.filter((c) => c !== id); // silinen aday seçilemez
  if (state.currentNodeId === id) state.currentNodeId = null; // kullanıcı "Buradan devam et" ile seçer
  if (state.startNodeId === id) state.startNodeId = state.nodes[0]?.id ?? null;
  await save(state);
  return { notice: `"${name}" silindi. Geri almak için "Geri al" ya da Ctrl+Z.` };
}

// EDGE DÜZENLEME: Kullanıcı bir edge'den gereksiz aksiyonları silebilir; en az bir aksiyon
// kalır (aksiyonsuz edge tekrar oynatılamaz). Aksiyon EKLENEMEZ: eklenen aksiyon hiç
// gözlemlenmemiş olurdu; eksik aksiyon için edge yeniden kaydedilir. Hangi silmenin riskli
// olduğunu panel, aksiyonların kayıtta aldığı "state'i değiştirdi mi?" işaretinden gösterir.
// İlk silmede kayıttaki orijinal liste recordedActions'ta saklanır (izlenebilirlik).
function removeAction(state, edgeId, index) {
  const edge = state.edges.find((e) => e.id === edgeId);
  if (!edge || !(index >= 0 && index < edge.actions.length)) return;
  if (edge.actions.length === 1) throw new Error("Edge'de en az bir aksiyon kalmalı.");
  edge.recordedActions ??= [...edge.actions];
  const [action] = edge.actions.splice(index, 1);
  pushUndo(state, { kind: 'action', edgeId, index, action });
  return save(state);
}


// -----------------------------------------------------------------------------
// GERİ AL: node, edge ve edge'den aksiyon silmeleri ("Geri al" butonu / Ctrl+Z)
// -----------------------------------------------------------------------------
// Yanlışlıkla silinen bir node ya da edge graph'ı bozabilir. Her silme, silineni ve eski
// yerini bir yığına yazar; geri al son silmeyi tersine çevirir (en yenisi önce). Tüm
// graph'ın kopyası tutulmaz: kopyalar ekran görüntüleriyle depolamayı şişirirdi.
const UNDO_LIMIT = 20;

function pushUndo(state, entry) {
  state.undo = [...(state.undo ?? []), entry].slice(-UNDO_LIMIT);
}

async function undo(state) {
  const entry = state.undo?.pop();
  if (!entry) return { notice: 'Geri alınacak bir silme yok.' };
  const insert = (list, index, item) => list.splice(Math.min(index, list.length), 0, item);
  let notice;

  if (entry.kind === 'node') {
    // Node ve onunla birlikte silinen edge'ler eski sıralarına döner
    insert(state.nodes, entry.index, entry.node);
    for (const { edge, index } of entry.edges) insert(state.edges, index, edge);
    if (entry.startNodeId === entry.node.id || !state.startNodeId) state.startNodeId = entry.startNodeId ?? entry.node.id;
    if (entry.currentNodeId === entry.node.id && !state.currentNodeId) state.currentNodeId = entry.node.id;
    notice = `"${entry.node.name}" node'u` + (entry.edges.length ? ` ve ${entry.edges.length} edge'i` : '') + ' geri getirildi.';
  } else if (entry.kind === 'merge') {
    // Kaldırılan node eski yerine döner, taşınan edge'ler eski uçlarına bağlanır
    insert(state.nodes, entry.index, entry.node);
    for (const { id, source, target } of entry.edges) {
      const edge = state.edges.find((e) => e.id === id);
      if (edge) Object.assign(edge, { source, target });
    }
    if (entry.startNodeId === entry.node.id && state.startNodeId === entry.keepId) state.startNodeId = entry.node.id;
    if (entry.currentNodeId === entry.node.id && state.currentNodeId === entry.keepId) state.currentNodeId = entry.node.id;
    notice = `"${entry.node.name}" node'unun birleştirilmesi geri alındı.`;
  } else if (entry.kind === 'edge') {
    const ends = [entry.edge.source, entry.edge.target].every((id) => state.nodes.some((n) => n.id === id));
    if (!ends) return save(state).then(() => ({ notice: `"${entry.edge.name}" geri getirilemedi: uçlarındaki node artık yok.` }));
    insert(state.edges, entry.index, entry.edge);
    notice = `"${entry.edge.name}" edge'i geri getirildi.`;
  } else {
    // Edge'den silinen aksiyon. Tüm silmeler geri alınınca edge kayıttaki haline döner.
    const edge = state.edges.find((e) => e.id === entry.edgeId);
    if (!edge) return save(state).then(() => ({ notice: 'Aksiyon geri getirilemedi: edge artık yok.' }));
    insert(edge.actions, entry.index, entry.action);
    if (edge.recordedActions?.length === edge.actions.length) delete edge.recordedActions;
    notice = `"${entry.action.label}" aksiyonu "${edge.name}" edge'ine geri getirildi.`;
  }
  await save(state);
  return { notice };
}

// NODE BİRLEŞTİRME: removeId node'u keepId'ye katılır. Ona bağlı tüm edge'ler keepId'ye
// bağlanır (aradaki edge'ler kendine dönen edge olur), removeId silinir; kalan node kendi
// adını, ekran görüntüsünü ve parmak izini korur. YALNIZCA URL şablonu ve edge set'i
// (şu anki ayarlarla) birebir aynı node'lar birleştirilebilir: edge set'i farklı iki node'u
// birleştirmek, kaldırılan node'dan gelen edge'lerin hedefi kalan node'un ekranında
// olmayabileceği için çakışma yaratır. Birleştirme sonrası aynı uçlara ve aksiyonlara sahip
// (tekrar eden) edge'lere dokunulmaz; yönetimi kullanıcıya aittir, sadece sayısı bildirilir.
async function mergeNodes(state, keepId, removeId) {
  if (state.pending) throw new Error('Önce bekleyen "aynı node mu?" sorusunu cevaplayın.');
  const keep = state.nodes.find((n) => n.id === keepId);
  const index = state.nodes.findIndex((n) => n.id === removeId);
  const removed = state.nodes[index];
  if (!keep || !removed || keepId === removeId) return;
  const settings = await getSettings();
  if (keep.urlKey !== removed.urlKey || !sameCounts(stateCounts(keep.elements, settings), stateCounts(removed.elements, settings))) {
    throw new Error("URL şablonu ya da edge set'i farklı node'lar birleştirilemez.");
  }

  const moved = state.edges.filter((e) => e.source === removeId || e.target === removeId);
  pushUndo(state, {
    kind: 'merge', keepId, node: removed, index,
    edges: moved.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    startNodeId: state.startNodeId, currentNodeId: state.currentNodeId,
  });
  for (const e of moved) {
    if (e.source === removeId) e.source = keepId;
    if (e.target === removeId) e.target = keepId;
  }
  state.nodes.splice(index, 1);
  if (state.startNodeId === removeId) state.startNodeId = keepId;
  if (state.currentNodeId === removeId) state.currentNodeId = keepId;
  await save(state);

  const duplicates = countDuplicateEdges(state.edges);
  return {
    notice: `"${removed.name}", "${keep.name}" ile birleştirildi; ${moved.length} edge "${keep.name}"e bağlandı.`
      + (duplicates ? ` Aynı uçlara ve aksiyonlara sahip ${duplicates} tekrar eden edge var; istersen silebilirsin.` : '')
      + ' Geri almak için "Geri al" ya da Ctrl+Z.',
  };
}

// Aynı kaynak, hedef ve aksiyon dizisine sahip edge'lerden fazla olanların sayısı.
function countDuplicateEdges(edges) {
  const signature = (e) => JSON.stringify([e.source, e.target, e.actions.map((a) => [a.type, a.target ?? a.selector, a.value, a.x, a.y, a.zoom, a.viewport, a.ms, a.key, a.count, a.text, a.operation, a.type === 'tab' && a.url, a.by, a.active])]);
  const seen = new Set();
  let duplicates = 0;
  for (const e of edges) {
    const key = signature(e);
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return duplicates;
}

// "Buradan devam et": kullanıcı tarayıcıda zaten bilinen bir state'e döndüğünde,
// bir sonraki edge'in hangi node'dan çıkacağını elle seçer. Buffer temizlenir.
// Kayıt sekmesi kapatılmışsa kayıt, butona basılan sekmede sürer: aksi halde hiçbir
// aksiyon kaydedilemez ve bekleyen aksiyon olmadan node da oluşturulamaz.
async function setCurrent(state, id, tabId) {
  const node = state.nodes.find((n) => n.id === id);
  if (!node) return;
  state.currentNodeId = id;
  state.buffer = [];
  state.screen = node.elements; // kullanıcı bu node'un ekranında: sıradaki aksiyonun öncesi
  state.idleSince = Date.now();
  // Kayıt sekmesi kapanmışsa kayıt butona basılan sekmede sürer.
  if (state.tabId === null) {
    state.tabId = tabId ?? null;
    state.tabs = state.tabId === null ? [] : [{ id: state.tabId, url: '' }];
  }
  notifyMonitor(state, await getSettings());
  return save(state);
}

// Nesneyi yerinde sıfırlıyoruz ki elinde eski referansı tutan başka bir işlem kalmasın.
function reset(state) {
  Object.assign(state, emptyState());
  return save(state);
}


// -----------------------------------------------------------------------------
// İSİMLENDİRME YARDIMCILARI
// -----------------------------------------------------------------------------
// GraphWalker geleneği: node (vertex) isimleri "v_", edge isimleri "e_" ile başlar.
// İsimler ileride Java/JS metot adına dönüşeceği için sadece harf ve rakam içerir.

// "add to cart" -> "AddToCart",  "Giriş yap" -> "GirisYap"
function toPascalCase(text) {
  return text
    .replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // aksanları at: ş->s, ç->c, ğ->g...
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('')
    .slice(0, 40);
}

// "https://site.com/shop/inventory.html" -> "inventory"
function lastPathSegment(url) {
  const segments = new URL(url).pathname.split('/').filter((s) => s && !/^\d+$/.test(s));
  return (segments.at(-1) ?? '').replace(/\.\w+$/, '');
}

// Aynı isim varsa sonuna _2, _3... ekler.
function uniqueNodeName(state, name) {
  const taken = new Set(state.nodes.map((n) => n.name));
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name}_${i}`)) i++;
  return `${name}_${i}`;
}
