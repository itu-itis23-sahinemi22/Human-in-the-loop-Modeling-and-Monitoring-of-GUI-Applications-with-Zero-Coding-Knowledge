// =============================================================================
// settings.js — AYARLAR (ortak tanımlar)
// -----------------------------------------------------------------------------
// Panelin "Ayarlar" bölümündeki iki listenin TEK tanımı ve ayarlara bağlı state
// karşılaştırması. Build adımı olmadığı için her parça bu dosyayı ayrıca yükler ve
// buradaki global sabit ve fonksiyonları kullanır:
//   content.js    : manifest.json > content_scripts > js (content.js'ten önce)
//   background.js : importScripts('settings.js')
//   panel.js      : panel.html'de <script> (panel.js'ten önce)
//   runner        : test edilen sayfaya ve Node tarafına (runner/lib/state.js)
//
// Kullanıcının seçimi chrome.storage.local'da 'settings' anahtarında durur (bkz.
// background.js > getSettings). Şekli DEFAULT_SETTINGS ile aynıdır.
// =============================================================================

// Kaydedilebilen aksiyon tipleri. Ayarlarda işaretli olmayan tipteki aksiyonlar
// "Bekleyen aksiyonlar" listesine eklenmez. `text`, panelde görünen addır.
const ACTION_TYPES = [
  { type: 'click', text: 'Tıkla' },
  { type: 'input', text: 'Yaz' },
  { type: 'enter', text: 'Enter' },
  { type: 'key', text: 'Tuş' },
  { type: 'select', text: 'Metin seç' },
  { type: 'clipboard', text: 'Kopyala/Kes/Yapıştır' },
  { type: 'contextmenu', text: 'Sağ tık menüsü' },
  { type: 'focus', text: 'Odak (Tab)' },
  { type: 'scroll', text: 'Kaydır' },
  { type: 'zoom', text: 'Yakınlaştır/Uzaklaştır' },
  { type: 'resize', text: 'Pencere boyutu' },
  { type: 'navigate', text: 'Git' },
  { type: 'history', text: 'Geri/İleri' },
  { type: 'reload', text: 'Yenile' },
];

// Etkileşimli (tıklanabilir / doldurulabilir) sayılabilecek element türleri. Ayarlarda
// işaretli olmayan türdeki elementler state'e (edge set'e) dahil edilmez. Bir element
// birden fazla türe uyabilir (ör. <a role="button">); işaretli türlerden birine uyması yeter.
const INTERACTABLE_TYPES = [
  { selector: 'a', text: 'Link' },
  { selector: 'button', text: 'Buton' },
  { selector: 'input', text: 'Input' },
  { selector: 'select', text: 'Açılır liste' },
  { selector: 'textarea', text: 'Çok satırlı metin' },
  { selector: 'label', text: 'Etiket' },
  { selector: 'summary', text: 'Açılır bölüm başlığı' },
  { selector: '[role="button"]', text: 'ARIA buton' },
  { selector: '[role="link"]', text: 'ARIA link' },
  { selector: '[role="tab"]', text: 'Sekme' },
  { selector: '[role="menuitem"]', text: 'Menü öğesi' },
  { selector: '[onclick]', text: 'onclick niteliği olan' },
];

// Varsayılan: her şey işaretli. İşareti KALDIRILANLAR listelenir; böylece listelere
// ileride eklenen yeni bir tip kendiliğinden işaretli gelir.
// Beklemeler (docs/01 > Beklemeler): recordWaits açıkken aksiyonlar arasındaki en az
// minWaitSeconds saniyelik boşluklar 'wait' aksiyonu olarak kaydedilir ve kayıt sekmesinin
// ekranı sürekli izlenir. Varsayılan kapalı: izleme her sayfada maliyetlidir.
const DEFAULT_SETTINGS = { disabledActions: [], disabledInteractables: [], recordWaits: false, minWaitSeconds: 1 };


// -----------------------------------------------------------------------------
// STATE KARŞILAŞTIRMASI (background, panel ve runner ortak kullanır)
// -----------------------------------------------------------------------------
// İki ekran ancak URL şablonu ve edge set'i birebir aynıysa aynı state olabilir
// (docs/03-state-eslestirme.md). Edge set Ayarlar'daki element türü seçimine bağlı olduğu
// için burada durur. Background node eşleştirmede ve "bu aksiyon state'i değiştirdi mi?"
// işaretinde, panel node birleştirmede, runner varılan ekranı doğrularken kullanır.

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

// Ekranın edge set'i, SAYILI küme olarak: anahtar -> ekranda kaç tane. Yalnızca Ayarlar'da
// işaretli türlerden en az birine uyan elementler sayılır (content.js > fingerprint).
// Önceki sürümlerin biçimiyle (sayısız küme) kaydedilmiş veri karşılaştırılamaz: null döner.
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

// İki sayılı kümenin farkı: sayısı farklı her anahtar için { key, a, b } (bir kümede yoksa 0).
// Örnek: [{ key: "button:Sil", a: 5, b: 4 }]. Kümeler aynıysa boş dizi.
function diffCounts(a, b) {
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((key) => (a.get(key) ?? 0) !== (b.get(key) ?? 0))
    .map((key) => ({ key, a: a.get(key) ?? 0, b: b.get(key) ?? 0 }));
}


// -----------------------------------------------------------------------------
// ESKİ SÜRÜMLERDEN KALAN STATE (background ve panel ortak kullanır)
// -----------------------------------------------------------------------------
// Eklenti güncellenince storage'daki state silinmez; önceki sürümün şekliyle okunur.
// Eksik alanlar tamamlanır, ilk sürümün tek adaylı onay sorusu ({ candidateId })
// aday listesine ({ candidateIds }) çevrilir. Aynı nesne döner.
function normalizeState(state) {
  state.nodes ??= [];
  state.edges ??= [];
  state.buffer ??= [];
  state.undo ??= [];
  state.pending ??= null;
  state.screen ??= null;
  state.idleSince ??= null;
  const pending = state.pending;
  if (pending && !Array.isArray(pending.candidateIds)) {
    pending.candidateIds = pending.candidateId ? [pending.candidateId] : [];
    delete pending.candidateId;
    delete pending.similarity;
  }
  if (pending) pending.actions ??= [];
  return state;
}
