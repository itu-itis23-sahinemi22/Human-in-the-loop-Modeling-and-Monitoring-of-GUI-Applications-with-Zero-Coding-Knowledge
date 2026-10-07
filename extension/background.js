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

// ACTION_TYPES, INTERACTABLE_TYPES, DEFAULT_SETTINGS
importScripts('settings.js');

// Eklenti ikonuna tıklanınca yan panel açılsın.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);


// -----------------------------------------------------------------------------
// STATE
// -----------------------------------------------------------------------------
// Veri modelinin tamamı: docs/04-veri-modeli.md

function emptyState() {
  return {
    tabId: null,          // Kaydın yapıldığı sekme. İlk "Node oluştur"da belirlenir.
    nextId: 1,            // n1, e2, n3... şeklinde id üretmek için sayaç
    startNodeId: null,    // İlk oluşturulan node (graph'ın başlangıcı)
    currentNodeId: null,  // Kullanıcının şu an bulunduğu node. Yeni edge buradan çıkar.
    nodes: [],
    edges: [],
    buffer: [],           // Son node'dan beri yapılan, henüz edge'e dönüşmemiş aksiyonlar
    pending: null,        // Aynı element kümeli node bulunduğunda kullanıcının onayını bekleyen karar
  };
}

// MV3 service worker boşta kalınca Chrome onu kapatır; RAM'deki her şey silinir.
// Bu yüzden state'in asıl yeri chrome.storage.local. Worker her uyandığında state
// bir kez okunur ve sonraki tüm mesajlar AYNI nesne üzerinde çalışır.
let statePromise = null;

function getState() {
  statePromise ??= chrome.storage.local.get('state').then((r) => r.state ?? emptyState());
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

function setSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  settingsPromise = Promise.resolve(merged);
  return chrome.storage.local.set({ settings: merged });
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
  switch (message.type) {
    // content.js -> background
    case 'ACTION':      return addAction(state, sender.tab?.id, message.action);
    // panel -> background
    case 'CREATE_NODE': return createNode(state, message.tabId, message.windowId);
    case 'RESOLVE':     return resolvePending(state, message.targetId);
    case 'CANCEL_PENDING': return cancelPending(state);
    case 'RENAME':      return rename(state, message.id, message.name);
    case 'DELETE':      return remove(state, message.id);
    case 'SET_CURRENT': return setCurrent(state, message.id, message.tabId);
    case 'RESET':       return reset(state);
    case 'SET_SETTINGS': return setSettings(message.settings);
  }
}


// -----------------------------------------------------------------------------
// AKSİYONLAR
// -----------------------------------------------------------------------------

async function addAction(state, tabId, action) {
  const settings = await getSettings();
  // Kayıt başlamadıysa ya da aksiyon başka bir sekmeden geldiyse yok say.
  if (state.tabId === null || tabId !== state.tabId) return;
  // Ayarlarda işaretli olmayan tipteki aksiyon "Bekleyen aksiyonlar"a eklenmez.
  if (settings.disabledActions.includes(action.type)) return;
  state.buffer.push(action);
  return save(state);
}

// Adres çubuğuna yazma, geri/ileri ve yenileme sayfanın İÇİNDE olmadığı için
// content.js bunları göremez. Tarayıcı seviyesindeki bu gezinmeleri buradan yakalıyoruz.
//   onCommitted           : klasik sayfa geçişleri (yeni HTML yüklenir)
//   onHistoryStateUpdated : SPA geçişleri (React/Vue router; sayfa yeniden yüklenmez)
chrome.webNavigation.onCommitted.addListener(onNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigation);

async function onNavigation(details) {
  if (details.frameId !== 0) return; // sadece ana sayfa, iframe'ler değil
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

// Kayıt sekmesi kapatılırsa aksiyon kaydı durur. Kayıt, bir node seçilip "Buradan devam
// et"e basılan sekmede sürer (bkz. setCurrent).
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.tabId !== tabId) return;
  state.tabId = null;
  save(state);
});


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
  if (state.tabId !== null && state.tabId !== tabId) {
    throw new Error('Kayıt başka bir sekmede sürüyor. O sekmeye dönün ya da "Sıfırla"ya basın.');
  }
  // Aksiyonsuz bir edge tekrar oynatılamaz. Bu yüzden ilk node dışında, son node'dan beri
  // hiç aksiyon kaydedilmediyse node oluşturulmaz. (Panel bu durumda butonu zaten kilitler.)
  if (state.nodes.length > 0 && state.buffer.length === 0) {
    return { notice: 'Bekleyen aksiyon yok. Node oluşturmak için önce sayfada bir aksiyon yapın.' };
  }

  let page;
  try {
    page = await chrome.tabs.sendMessage(tabId, { type: 'GET_FINGERPRINT' });
  } catch {
    throw new Error('Bu sayfaya erişilemedi. Sayfayı yenileyip (F5) tekrar deneyin. (chrome:// sayfaları desteklenmez.)');
  }

  const capture = { ...page, urlKey: urlKey(page.url) };
  const matches = findSameStateNodes(state, capture, await getSettings());

  capture.screenshot = await takeScreenshot(windowId);
  const actions = state.buffer;
  state.buffer = [];
  state.tabId = tabId;

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
    // Edge'e adını son aksiyon verir. Kaydırma çoğu zaman asıl aksiyonun yan ürünü olduğu
    // için (sayfa tıklamadan sonra kendisi de kaydırabilir) atlanır; edge sadece
    // kaydırmalardan oluşuyorsa adı kaydırmadan gelir: e_ScrollDown.
    const lastLabel = (actions.findLast((a) => a.type !== 'scroll') ?? actions.at(-1))?.label;
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

// State'in edge set'i, SAYILI küme olarak: anahtar -> ekranda kaç tane. Yalnızca Ayarlar'da
// işaretli türlerden en az birine uyan elementler sayılır (content.js > fingerprint).
// Önceki sürümlerin biçimiyle (sayısız küme) kaydedilmiş node karşılaştırılamaz: null döner.
function stateCounts(elements, settings) {
  if (!Array.isArray(elements) || elements.some((e) => typeof e !== 'object')) return null;
  const counts = new Map();
  for (const { key, types, count } of elements) {
    if (types.some((t) => !settings.disabledInteractables.includes(t))) counts.set(key, (counts.get(key) ?? 0) + count);
  }
  return counts;
}

// İki sayılı küme birebir aynı mı? (aynı anahtarlar, aynı sayılar)
function sameCounts(a, b) {
  return a !== null && b !== null && a.size === b.size && [...a].every(([key, n]) => b.get(key) === n);
}

// URL'yi "sayfa şablonu"na indirger. Sorgu (?..) ve hash (#..) atılır,
// sayısal ve uzun hex/UUID path parçaları ":id" olur.
//   https://site.com/product/42?ref=x  ->  https://site.com/product/:id
function urlKey(url) {
  const { origin, pathname } = new URL(url);
  const path = pathname
    .split('/')
    .map((segment) => (/^\d+$/.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment) ? ':id' : segment))
    .join('/')
    .replace(/\/+$/, '');
  return origin + (path || '/');
}


// -----------------------------------------------------------------------------
// PANELDEN GELEN DÜZENLEME İSTEKLERİ
// -----------------------------------------------------------------------------

function rename(state, id, name) {
  const item = [...state.nodes, ...state.edges].find((x) => x.id === id);
  if (!item || !name.trim()) return;
  item.name = name.trim();
  return save(state);
}

// Node silinirse ona bağlı edge'ler de silinir.
function remove(state, id) {
  state.nodes = state.nodes.filter((n) => n.id !== id);
  state.edges = state.edges.filter((e) => e.id !== id && e.source !== id && e.target !== id);
  if (state.pending) state.pending.candidateIds = state.pending.candidateIds.filter((c) => c !== id); // silinen aday seçilemez
  if (state.nodes.length === 0) return reset(state);
  if (state.currentNodeId === id) state.currentNodeId = null; // kullanıcı "Buradan devam et" ile seçer
  if (state.startNodeId === id) state.startNodeId = state.nodes[0].id;
  return save(state);
}

// "Buradan devam et": kullanıcı tarayıcıda zaten bilinen bir state'e döndüğünde,
// bir sonraki edge'in hangi node'dan çıkacağını elle seçer. Buffer temizlenir.
// Kayıt sekmesi kapatılmışsa kayıt, butona basılan sekmede sürer: aksi halde hiçbir
// aksiyon kaydedilemez ve bekleyen aksiyon olmadan node da oluşturulamaz.
function setCurrent(state, id, tabId) {
  if (!state.nodes.some((n) => n.id === id)) return;
  state.currentNodeId = id;
  state.buffer = [];
  state.tabId ??= tabId ?? null;
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
