// =============================================================================
// settings.js — AYARLAR (ortak tanımlar)
// -----------------------------------------------------------------------------
// Panelin "Ayarlar" bölümündeki iki listenin TEK tanımı ve ayarlara bağlı edge set
// karşılaştırması. Build adımı olmadığı için üç parça da bu dosyayı ayrıca yükler ve
// buradaki global sabit ve fonksiyonları kullanır:
//   content.js    : manifest.json > content_scripts > js (content.js'ten önce)
//   background.js : importScripts('settings.js')
//   panel.js      : panel.html'de <script> (panel.js'ten önce)
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
  { type: 'scroll', text: 'Kaydır' },
  { type: 'zoom', text: 'Yakınlaştır/Uzaklaştır' },
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
const DEFAULT_SETTINGS = { disabledActions: [], disabledInteractables: [] };


// -----------------------------------------------------------------------------
// EDGE SET KARŞILAŞTIRMASI (background ve panel ortak kullanır)
// -----------------------------------------------------------------------------
// Ayarlar'daki element türü seçimine bağlı olduğu için burada durur. Background node
// eşleştirmede ve "bu aksiyon state'i değiştirdi mi?" işaretinde, panel node birleştirmede kullanır.

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
  const pending = state.pending;
  if (pending && !Array.isArray(pending.candidateIds)) {
    pending.candidateIds = pending.candidateId ? [pending.candidateId] : [];
    delete pending.candidateId;
    delete pending.similarity;
  }
  if (pending) pending.actions ??= [];
  return state;
}
