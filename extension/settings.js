// =============================================================================
// settings.js — AYARLAR (ortak tanımlar)
// -----------------------------------------------------------------------------
// Panelin "Ayarlar" bölümündeki iki listenin TEK tanımı. Build adımı olmadığı için
// üç parça da bu dosyayı ayrıca yükler ve buradaki global sabitleri kullanır:
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
  { type: 'scroll', text: 'Kaydır' },
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
