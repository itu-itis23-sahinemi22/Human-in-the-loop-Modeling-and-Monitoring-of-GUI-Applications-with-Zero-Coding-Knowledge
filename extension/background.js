// =============================================================================
// background.js — BEYİN (Manifest V3 service worker)
// -----------------------------------------------------------------------------
// - Graph'ın tek sahibi ve TEK YAZARIDIR. State'i sadece bu dosya değiştirir.
// - content.js'ten gelen aksiyonları bir "buffer"da biriktirir.
// - Panel "Node oluştur" dediğinde: sayfanın parmak izini ve ekran görüntüsünü alır,
//   benzer bir node arar, node/edge ekler.
// - State'i chrome.storage.local'a yazar. Panel oradan okur ve çizer.
//
// Mimari ve mesajların tamamı: docs/01-mimari.md
// =============================================================================

// İki sayfanın "aynı state" ÖNERİSİ için gereken en düşük benzerlik (0..1).
// Son kararı kullanıcı verdiği için eşik bilerek düşük: yanlış öneri bir tıkla
// reddedilir, ama kaçırılan eşleşme sessizce kopya node üretir.
// Detay: docs/03-state-eslestirme.md
const SIMILARITY_THRESHOLD = 0.6;

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
    pending: null,        // Benzer node bulunduğunda kullanıcının onayını bekleyen karar
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
    case 'RESOLVE':     return resolvePending(state, message.useExisting);
    case 'RENAME':      return rename(state, message.id, message.name);
    case 'DELETE':      return remove(state, message.id);
    case 'SET_CURRENT': return setCurrent(state, message.id);
    case 'RESET':       return reset(state);
  }
}


// -----------------------------------------------------------------------------
// AKSİYONLAR
// -----------------------------------------------------------------------------

function addAction(state, tabId, action) {
  // Kayıt başlamadıysa ya da aksiyon başka bir sekmeden geldiyse yok say.
  if (state.tabId === null || tabId !== state.tabId) return;
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

// Kayıt sekmesi kapatılırsa kayıt bir sonraki "Node oluştur"un yapıldığı sekmede sürer.
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
//   1) Sayfanın parmak izini al, benzer node ara
//   2) Aksiyon yok ve sayfa hâlâ mevcut node ise: yapılacak bir şey yok, sadece bildir
//   3) Ekran görüntüsünü al, buffer'daki aksiyonları al (yeni edge'in aksiyonları)
//   4) Benzer node var mı?
//        evet  -> kararı kullanıcıya bırak (pending), panel onay kartı gösterir
//        hayır -> yeni node oluştur
//   5) Mevcut node'dan hedef node'a edge çiz

async function createNode(state, tabId, windowId) {
  if (state.pending) throw new Error('Önce bekleyen "aynı node mu?" sorusunu cevaplayın.');
  if (state.tabId !== null && state.tabId !== tabId) {
    throw new Error('Kayıt başka bir sekmede sürüyor. O sekmeye dönün ya da "Sıfırla"ya basın.');
  }

  let page;
  try {
    page = await chrome.tabs.sendMessage(tabId, { type: 'GET_FINGERPRINT' });
  } catch {
    throw new Error('Bu sayfaya erişilemedi. Sayfayı yenileyip (F5) tekrar deneyin. (chrome:// sayfaları desteklenmez.)');
  }

  const capture = { ...page, urlKey: urlKey(page.url) };
  const match = findSimilarNode(state, capture);

  // Hiç aksiyon yapılmadan aynı node'da tekrar basıldı: çizilecek bir edge yok.
  // "Aynı mı?" diye sormak anlamsız olurdu (cevap "evet" olsa da hiçbir şey değişmez).
  if (state.buffer.length === 0 && match && match.node.id === state.currentNodeId) {
    return { notice: `Son node'dan beri aksiyon kaydedilmedi. Hâlâ "${match.node.name}" node'undasınız.` };
  }

  capture.screenshot = await takeScreenshot(windowId);
  const actions = state.buffer;
  state.buffer = [];
  state.tabId = tabId;

  if (match) {
    state.pending = { capture, actions, candidateId: match.node.id, similarity: match.similarity };
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

// Kullanıcı onay kartında "Evet, aynı node" ya da "Hayır, yeni node" dedi.
function resolvePending(state, useExisting) {
  const pending = state.pending;
  if (!pending) return;
  state.pending = null;
  commit(state, pending.capture, pending.actions, useExisting ? pending.candidateId : null);
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
  // node'un kendisiyse bu bir self-loop'tur. ("Aksiyon yok + aynı node" durumu buraya
  // hiç gelmez; createNode() onu baştan eler.)
  const from = state.currentNodeId;
  if (from) {
    const lastLabel = actions.at(-1)?.label;
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

function findSimilarNode(state, capture) {
  let best = null;
  for (const node of state.nodes) {
    if (node.urlKey !== capture.urlKey) continue; // farklı sayfa şablonu -> aday bile değil
    const similarity = jaccard(node.elements, capture.elements);
    if (!best || similarity > best.similarity) best = { node, similarity };
  }
  return best && best.similarity >= SIMILARITY_THRESHOLD ? best : null;
}

// Jaccard benzerliği = |A ∩ B| / |A ∪ B|  (1 = birebir aynı, 0 = hiç ortak yok)
function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
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
  if (state.nodes.length === 0) return reset(state);
  if (state.currentNodeId === id) state.currentNodeId = null; // kullanıcı "Buradan devam et" ile seçer
  if (state.startNodeId === id) state.startNodeId = state.nodes[0].id;
  return save(state);
}

// "Buradan devam et": kullanıcı tarayıcıda zaten bilinen bir state'e döndüğünde,
// bir sonraki edge'in hangi node'dan çıkacağını elle seçer. Buffer temizlenir.
function setCurrent(state, id) {
  if (!state.nodes.some((n) => n.id === id)) return;
  state.currentNodeId = id;
  state.buffer = [];
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
