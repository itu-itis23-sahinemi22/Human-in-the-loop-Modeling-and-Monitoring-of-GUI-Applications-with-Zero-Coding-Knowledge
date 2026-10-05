// =============================================================================
// content.js — SENSÖR
// -----------------------------------------------------------------------------
// Chrome bu dosyayı ziyaret edilen her web sayfasının içine otomatik enjekte eder
// (bkz. manifest.json > content_scripts).
//
// İki görevi var:
//   1) Kullanıcının sayfada yaptığı aksiyonları (tıklama, yazma, Enter) yakalayıp
//      background.js'e göndermek.
//   2) background.js istediğinde sayfanın "parmak izini" (fingerprint) çıkarmak.
//
// Bu dosya hiçbir şey SAKLAMAZ. Sayfa değiştiğinde script de yok olur; bu yüzden
// her aksiyon yakalandığı anda background'a gönderilir.
// =============================================================================

// Etkileşimli (tıklanabilir / doldurulabilir) kabul edilen elementler.
// buradaki etkileşimli element listesi ayarlar panelinden istenen elementler seçilecek şekilde güncellenebilir
const INTERACTIVE = [
  'a', 'button', 'input', 'select', 'textarea', 'label', 'summary',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[onclick]',
].join(', ');

// true ise şifre alanlarının değeri kayda "******" olarak geçer.
const MASK_PASSWORDS = true;

// true ise her aksiyonda sayfanın state'i ve görünür etkileşimli elementlerin
// locator'ları sayfanın konsoluna (F12 > Console) yazılır. Hata ayıklama içindir.
const LOG_STATE = true;

// Aynı alanın aynı değerini iki kez kaydetmemek için: element -> son kaydedilen değer.
const lastRecordedValue = new WeakMap();


// -----------------------------------------------------------------------------
// 1) AKSİYON KAYDI
// -----------------------------------------------------------------------------

// Üçüncü parametre `true` = "capture phase": olayı sayfanın kendi kodundan ÖNCE
// görürüz. Sayfa olayı durdursa (stopPropagation) bile kaydımız kaçmaz.
// buradaki aksiyon listesi ayarlar panelinden istenen aksiyonlar seçilecek şekilde güncellenebilir
document.addEventListener('click', onClick, true);
document.addEventListener('change', onChange, true);
document.addEventListener('keydown', onKeyDown, true);

function onClick(event) {
  // isTrusted=false olan olayları sayfanın kendi kodu üretmiştir (ör. el.click()); kullanıcı değil.
  if (!event.isTrusted) return;

  // Kullanıcı bir butonun içindeki <span>'e tıklamış olabilir; asıl butonu bul.
  const el = event.target.closest(INTERACTIVE) || event.target;

  // Bir form alanına tıklamak sadece "odaklanmak"tır. Değeri 'change' olayıyla kaydedilecek.
  if (isFormField(el)) return;

  send({ type: 'click', selector: cssSelector(el), label: visibleText(el) || el.tagName.toLowerCase() });
}

function onChange(event) {
  if (!event.isTrusted || !isFormField(event.target)) return;
  recordValue(event.target);
}

function onKeyDown(event) {
  if (!event.isTrusted || event.key !== 'Enter') return;
  const el = event.target;
  if (el.tagName !== 'INPUT' || !isFormField(el)) return;

  // Enter'a basıldığında tarayıcı önce 'keydown', sonra 'change' üretir.
  // Kayıttaki sıra "önce yaz, sonra Enter" olsun diye değeri burada kaydediyoruz.
  recordValue(el);
  send({ type: 'enter', selector: cssSelector(el), label: 'Submit ' + fieldName(el) });
}

function recordValue(el) {
  const realValue = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
  if (lastRecordedValue.get(el) === realValue) return;
  lastRecordedValue.set(el, realValue);

  const value = el.type === 'password' && MASK_PASSWORDS ? '******' : realValue;
  const verb = el.tagName === 'SELECT' ? 'Select' : el.type === 'checkbox' || el.type === 'radio' ? 'Check' : 'Fill';
  send({ type: 'input', selector: cssSelector(el), value, label: verb + ' ' + fieldName(el) });
}

// Metin girilen / seçim yapılan alanlar. Butonlar (submit, button...) bu gruba girmez.
function isFormField(el) {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !['button', 'submit', 'reset', 'image'].includes(el.type);
  return false;
}

function send(action) {
  action.url = location.href;
  action.time = Date.now();
  if (LOG_STATE) logState(action);
  try {
    chrome.runtime.sendMessage({ type: 'ACTION', action }).catch(() => { });
  } catch {
    // Eklenti yeniden yüklendiyse bu eski script'in bağlantısı kopar. Sayfa yenilenince düzelir.
  }
}


// -----------------------------------------------------------------------------
// 2) PARMAK İZİ (FINGERPRINT)
// -----------------------------------------------------------------------------
// "Bu sayfa daha önce kaydettiğimiz bir state mi?" sorusunu cevaplamak için
// background.js bu bilgiyi ister. Algoritmanın detayı: docs/03-state-eslestirme.md

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_FINGERPRINT') sendResponse(fingerprint());
});

function fingerprint() {
  const keys = new Set();
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (el.checkVisibility && !el.checkVisibility()) continue; // görünmeyenleri sayma
    keys.add(elementKey(el));
  }
  return { url: location.href, title: document.title, elements: [...keys].sort() };
}

// Bir elementin YAPISAL kimliği. Metni bilerek dahil etmiyoruz: "10 ürünlü liste" ile
// "3 ürünlü liste" aynı state sayılsın diye. Örnek: "button:login-button", "input:user-name", "a"
function elementKey(el) {
  const tag = el.tagName.toLowerCase();
  const name = el.id || el.getAttribute('data-testid') || el.getAttribute('data-test')
    || el.getAttribute('name') || el.getAttribute('aria-label') || el.getAttribute('type') || '';
  return name ? `${tag}:${name}` : tag;
}


// -----------------------------------------------------------------------------
// 3) KONSOL LOGU (LOG_STATE)
// -----------------------------------------------------------------------------
// Aksiyonun yapıldığı ANDAKİ sayfa state'ini yazar. Tıklama capture phase'de
// yakalandığı için bu, aksiyonun etkisinden ÖNCEKİ state'tir.

function logState(action) {
  const locators = [];
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (el.checkVisibility && !el.checkVisibility()) continue;
    // Form alanlarında visibleText() alanın değerini (şifre dahil) döndürebilir; fieldName() döndürmez.
    const label = isFormField(el) ? fieldName(el) : visibleText(el);
    locators.push({ key: elementKey(el), label, locator: cssSelector(el) });
  }

  console.group(`[Graph Recorder] ${action.type}: ${action.label}`);
  console.log('Aksiyon:', action);
  console.log('State:', fingerprint());
  console.table(locators);
  console.groupEnd();
}


// -----------------------------------------------------------------------------
// YARDIMCILAR
// -----------------------------------------------------------------------------

// Elementi sayfada TEKİL olarak bulan bir CSS selector üretir.
// Öncelik: #id > [data-testid] > [data-test] > [name] > [aria-label] > body'den yol
// Sıralamanın sebebi: ilk sıradakiler sayfa tasarımı değişse de genelde sabit kalır.
function cssSelector(el) {
  if (!document.body.contains(el)) return el.tagName.toLowerCase();

  if (el.id && isUnique('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);

  for (const attr of ['data-testid', 'data-test', 'name', 'aria-label']) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const selector = `${el.tagName.toLowerCase()}[${attr}="${value.replace(/"/g, '\\"')}"]`;
    if (isUnique(selector)) return selector;
  }

  // Yedek plan: body'den elemana uzanan yol. Ör: "body > div:nth-of-type(2) > button"
  const parts = [];
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    let part = node.tagName.toLowerCase();
    const sameTagSiblings = [...node.parentElement.children].filter((c) => c.tagName === node.tagName);
    if (sameTagSiblings.length > 1) part += `:nth-of-type(${sameTagSiblings.indexOf(node) + 1})`;
    parts.unshift(part);
  }
  return ['body', ...parts].join(' > ');
}

function isUnique(selector) {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

// Kullanıcının gördüğü isim: "Login", "Add to cart" gibi. Edge isimleri buradan türetilir.
function visibleText(el) {
  const text = el.getAttribute('aria-label') || el.innerText || el.value
    || el.getAttribute('title') || el.querySelector?.('img[alt]')?.alt || '';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 40);
}

// Form alanının insan tarafından okunabilir adı: "Username", "Password"...
function fieldName(el) {
  const name = el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.placeholder
    || el.name || el.id || el.type || 'field';
  return name.replace(/\s+/g, ' ').trim().slice(0, 30);
}
