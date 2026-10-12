// =============================================================================
// content.js — SENSÖR
// -----------------------------------------------------------------------------
// Chrome bu dosyayı ziyaret edilen her web sayfasının içine otomatik enjekte eder
// (bkz. manifest.json > content_scripts).
//
// Üç görevi var:
//   1) Kullanıcının sayfada yaptığı aksiyonları (tıklama, yazma, Enter, kaydırma)
//      yakalayıp background.js'e göndermek.
//   2) background.js istediğinde sayfanın "parmak izini" (fingerprint) çıkarmak.
//   3) Aksiyondan sonra sayfa durulunca ekranı background.js'e bildirmek; aksiyonun
//      state'i değiştirip değiştirmediği bununla bulunur.
//
// Bu dosya hiçbir şey SAKLAMAZ. Sayfa değiştiğinde script de yok olur; bu yüzden
// her aksiyon yakalandığı anda background'a gönderilir.
// =============================================================================

// Etkileşimli (tıklanabilir / doldurulabilir) olabilecek elementler: settings.js'teki TÜM
// türler. Bir elementin o an gerçekten etkileşimli sayılması için ayrıca devre dışı
// olmaması ve ekranda, kaydırmadan tıklanabilmesi gerekir: bkz. isInteractable().
// Hangi türlerin state'e gireceğini panelin Ayarlar bölümü belirler; o filtreyi
// background.js uygular (bkz. fingerprint).
const INTERACTIVE = INTERACTABLE_TYPES.map((t) => t.selector).join(', ');

// true ise şifre alanlarının değeri kayda "******" olarak geçer.
const MASK_PASSWORDS = true;

// true ise her aksiyonda sayfanın state'i ve ekrandaki etkileşimli elementlerin
// locator'ları sayfanın konsoluna (F12 > Console) yazılır. Hata ayıklama içindir.
const LOG_STATE = true;

// Aynı alanın aynı değerini iki kez kaydetmemek için: element -> son kaydedilen değer.
const lastRecordedValue = new WeakMap();

// Kaydırma yönünü bulmak için: kaydırılan kutu -> son kaydedilen konum.
// Sayfanın kendisi `document` ile temsil edilir.
const lastScrollPosition = new WeakMap([[document, { x: Math.round(scrollX), y: Math.round(scrollY) }]]);

// Kaydırma başladığındaki ekran: kaydırılan kutu -> edge set (bkz. onScroll).
const scrollStartScreen = new WeakMap();


// -----------------------------------------------------------------------------
// 1) AKSİYON KAYDI
// -----------------------------------------------------------------------------

// Üçüncü parametre `true` = "capture phase": olayı sayfanın kendi kodundan ÖNCE
// görürüz. Sayfa olayı durdursa (stopPropagation) bile kaydımız kaçmaz.
// Burada tüm aksiyonlar yakalanır; panelin Ayarlar bölümünde işaretli olmayan tipleri
// background.js > addAction() listeye eklemez.
document.addEventListener('click', onClick, true);
document.addEventListener('change', onChange, true);
document.addEventListener('keydown', onKeyDown, true);
document.addEventListener('scroll', onScroll, true);
document.addEventListener('scrollend', onScrollEnd, true);

// Her aksiyon, yapıldığı andaki ekranın edge set'iyle gönderilir (send'in ikinci parametresi).
// Background bunu yalnızca bir önceki aksiyonun sonrası henüz bildirilmemişse kullanır
// (bkz. background.js > addAction). Tıklama capture phase'de yakalandığı için o anki ekran,
// aksiyonun ÖNCESİDİR.

function onClick(event) {
  // isTrusted=false olan olayları sayfanın kendi kodu üretmiştir (ör. el.click()); kullanıcı değil.
  if (!event.isTrusted) return;

  // Kullanıcı bir butonun içindeki <span>'e tıklamış olabilir; asıl butonu bul.
  const el = event.target.closest(INTERACTIVE) || event.target;

  // Bir form alanına tıklamak sadece "odaklanmak"tır. Değeri 'change' olayıyla kaydedilecek.
  if (isFormField(el)) return;

  const visible = interactableElements();
  send({ type: 'click', target: targetOf(el, visible), selector: cssSelector(el), label: visibleText(el) || el.tagName.toLowerCase() }, countElements(visible));
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
  const visible = interactableElements();
  send({ type: 'enter', target: targetOf(el, visible), selector: cssSelector(el), label: 'Submit ' + fieldName(el) }, countElements(visible));
}

// Aksiyonun hedefi, state ile AYNI düzeyde: anahtar (tür) + ekranda görünen aynı anahtarlı
// elementler arasındaki sırası (1'den, DOM sırası). State de tür sayılarıyla tanımlı olduğu
// için (bkz. fingerprint) aynı state sayılan her ekranda "bu türün n'incisi" de bulunur.
// Tekrar oynatırken önce bu hedef, bulunamazsa selector kullanılır. Element o an ekranda
// tıklanabilir değilse index null'dır.
function targetOf(el, visible = interactableElements()) {
  const key = elementKey(el);
  const index = visible.filter((x) => elementKey(x) === key).indexOf(el);
  return { key, index: index >= 0 ? index + 1 : null };
}

// State yalnızca ekranda görünen elementlerden oluştuğu için kaydırma da bir aksiyondur.
// 'scroll' olayı kaydırma boyunca onlarca kez gelir; 'scrollend' ise hareket bitince bir
// kez gelir. Kaydırmanın vardığı konum kaydedilir: tekrar oynatırken scrollTo(x, y).
// Not: Kaydırma olaylarını tarayıcı ürettiği için sayfanın kendi kaydırmaları da (ör. bir
// link sayfayı başa kaydırdığında) isTrusted=true gelir ve kaydedilir. Konum mutlak
// olduğu için bu, tekrar oynatmada zararsızdır.
// Kaydırma hareketinin ilk 'scroll' olayında ekranın edge set'i alınır (kaydırmanın öncesi).
// İlk olay konum biraz değiştikten sonra gelir; bu yüzden "öncesi" yaklaşıktır.
function onScroll(event) {
  if (!event.isTrusted || scrollStartScreen.has(event.target)) return;
  scrollStartScreen.set(event.target, countElements(interactableElements()));
}

function onScrollEnd(event) {
  if (!event.isTrusted) return;
  const box = event.target; // sayfanın kendisi kaydırıldıysa document, değilse kaydırılan kutu
  const screenBefore = scrollStartScreen.get(box);
  scrollStartScreen.delete(box);
  const page = box === document;
  const x = Math.round(page ? scrollX : box.scrollLeft);
  const y = Math.round(page ? scrollY : box.scrollTop);

  const previous = lastScrollPosition.get(box) ?? { x: 0, y: 0 };
  if (x === previous.x && y === previous.y) return; // net bir kaydırma yok
  lastScrollPosition.set(box, { x, y });

  const direction = y !== previous.y ? (y > previous.y ? 'down' : 'up') : (x > previous.x ? 'right' : 'left');
  // selector null = sayfanın kendisi kaydırıldı (window.scrollTo); değilse kaydırılan kutu.
  send({ type: 'scroll', selector: page ? null : cssSelector(box), x, y, label: 'Scroll ' + direction }, screenBefore);
}

function recordValue(el) {
  const realValue = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
  if (lastRecordedValue.get(el) === realValue) return;
  lastRecordedValue.set(el, realValue);

  const value = el.type === 'password' && MASK_PASSWORDS ? '******' : realValue;
  const verb = el.tagName === 'SELECT' ? 'Select' : el.type === 'checkbox' || el.type === 'radio' ? 'Check' : 'Fill';
  const visible = interactableElements();
  send({ type: 'input', target: targetOf(el, visible), selector: cssSelector(el), value, label: verb + ' ' + fieldName(el) }, countElements(visible));
}

// Metin girilen / seçim yapılan alanlar. Butonlar (submit, button...) bu gruba girmez.
function isFormField(el) {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !['button', 'submit', 'reset', 'image'].includes(el.type);
  return false;
}

function send(action, screen) {
  action.url = location.href;
  action.time = Date.now();
  if (LOG_STATE) logState(action);
  message({ type: 'ACTION', action, screen });
  reportScreenWhenSettled();
}

function message(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => { });
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

// Ekranda tıklanabilen elementlerin SAYILI kümesi (multiset): her anahtar, uyduğu
// etkileşimli türler ve ekranda kaç tane olduğu:
//   [{ key: "button:Sil", types: ["button"], count: 5 }, { key: "input:user-name", types: ["input"], count: 1 }]
// Küme değil sayılı küme: her element olası bir edge'dir; aynı butondan 5 tane olan ekran
// ile 4 tane olan ekranın edge set'i farklıdır. Türler, Ayarlar filtresi için saklanır;
// hangilerinin state'e gireceğine background karar verir (ayar sonradan değişse de eski
// node'lar yeni seçimle karşılaştırılabilir).
function fingerprint() {
  return { url: location.href, title: document.title, elements: countElements(interactableElements()) };
}

// Elementleri anahtar + tür grubuna göre sayar (yukarıdaki biçim).
function countElements(visible) {
  const groups = new Map(); // "anahtar|türler" -> { key, types, count }
  for (const el of visible) {
    const key = elementKey(el);
    const types = INTERACTABLE_TYPES.filter((t) => el.matches(t.selector)).map((t) => t.selector);
    const id = key + '|' + types.join(' ');
    if (groups.has(id)) groups.get(id).count++;
    else groups.set(id, { key, types, count: 1 });
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key) || a.types.join().localeCompare(b.types.join()));
}

// Kullanıcının ŞU AN etkileşime girebileceği elementler, yani node'un edge set'i.
// Parmak izi ve konsol logu aynı listeyi kullanır.
function interactableElements() {
  return [...document.querySelectorAll(INTERACTIVE)].filter(isInteractable);
}

// Kullanıcı (ya da model üzerinden arayüzü test eden otomasyon aracı) bu elemente ŞU AN,
// sayfayı kaydırmadan tıklayabilir mi? Tıklanamayan element edge üretemez.
// Örnek: login butonu disabled olursa ya da sayfa kaydırılınca ekran dışında kalırsa
// kümeden çıkar ve sayfa yeni bir state olur.
function isInteractable(el) {
  if (el.matches(':disabled')) return false; // disabled form elemanı ya da disabled <fieldset> içinde
  if (el.closest('[aria-disabled="true"]')) return false; // özel kontroller (role="button"...)
  return isClickableOnScreen(el);
}

// Elementin ekranda kalan kısmının ortasına tıklanırsa tıklama bu elemente ulaşır mı?
// (hit test; otomasyon araçları da elementin ortasına tıklar). Tek kontrolle elenenler:
//   - ekran dışında kalanlar: kaydırınca görünecek olanlar, dışarı itilmiş kapalı menüler
//   - kaydırılabilir bir kutunun görünen alanı dışında kalanlar
//   - üstü başka bir katmanla (modal, sabit header, cookie banner) kapalı olanlar
//   - display:none, visibility:hidden, pointer-events:none ve inert olanlar
// opacity:0 elenmez: element görünmese de tıklamayı alır (ör. özel checkbox'ların altındaki input).
function isClickableOnScreen(el) {
  for (const rect of el.getClientRects()) { // birden fazla satıra bölünmüş linkte her satır ayrı parça
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const right = Math.min(rect.right, innerWidth);
    const bottom = Math.min(rect.bottom, innerHeight);
    if (left >= right || top >= bottom) continue; // bu parça ekranın dışında
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    if (hit && el.contains(hit)) return true;
  }
  return false;
}

// Bir elementin TÜRÜ (anahtarı): etiket + kimlik. Kimlik, şu sırayla ilk dolu olan:
// id > data-testid > data-test > name > aria-label > işlev metni > type.
// Örnek: "button:login-button", "input:user-name", "button:Paylaş", "a"
// Aynı anahtarlı birden fazla element olabilir (ör. her satırdaki "Sil" butonu); state
// bunları sayar, aksiyon hedefi de "bu anahtarın ekrandaki n'incisi" diye tutulur.
function elementKey(el) {
  const tag = el.tagName.toLowerCase();
  const name = el.id || el.getAttribute('data-testid') || el.getAttribute('data-test')
    || el.getAttribute('name') || el.getAttribute('aria-label') || functionText(el) || el.getAttribute('type') || '';
  return name ? `${tag}:${name}` : tag;
}

// Kimliği olmayan elementin ne işe yaradığını söyleyen metin: buton yazısı ("Paylaş",
// "Kopyala"), alan etiketi ya da placeholder ("Kullanıcı adı"). Bu olmasa kimliksiz iki
// farklı buton aynı türe düşerdi. İki bilinçli istisna:
//   - Link metni kullanılmaz: çoğu zaman veridir (ürün adı, başlık); her farklı veri ayrı
//     state olurdu. Kimliksiz linkler "a" türünde toplanır, sayıları ve sıraları ayırır.
//   - Form alanının değeri asla kullanılmaz (kullanıcının yazdığı veri, şifre olabilir).
function functionText(el) {
  if (el.matches('a, [role="link"]')) return '';
  if (isFormField(el)) {
    const label = el.labels?.[0]?.innerText || el.getAttribute('placeholder') || '';
    return label.replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  return visibleText(el);
}


// -----------------------------------------------------------------------------
// 3) AKSİYONUN SONRASI
// -----------------------------------------------------------------------------
// Background her aksiyonu "state'i değiştirdi mi?" diye işaretler: hemen önceki state ile
// aksiyondan sonraki state karşılaştırılır (bkz. background.js > observeScreen). Sonraki
// state'i buradan, sayfa durulunca bildiririz (SCREEN). Durulmak: SETTLE_QUIET_MS boyunca DOM
// değişmemesi ve animasyon bitmemesi; sürekli değişen sayfada en fazla SETTLE_MAX_MS beklenir.
// Bildirim her aksiyondan sonra ve aksiyonu background'ın yakaladığı değişikliklerden sonra
// yapılır: sayfa yüklenmesi (adres çubuğu, yenile, link), geri/ileri ve yakınlaştırma
// (pencere boyutu değişir). Kayıt sekmesi olmayan sekmelerin bildirimini background yok sayar.
const SETTLE_QUIET_MS = 300;
const SETTLE_MAX_MS = 3000;

let settleTimers = null; // { quiet, max }: null değilse sayfanın durulması bekleniyor
const settleObserver = new MutationObserver(restartQuietTimer);

addEventListener('popstate', reportScreenWhenSettled);
addEventListener('resize', reportScreenWhenSettled);
addEventListener('pageshow', (event) => event.persisted && reportScreenWhenSettled()); // geri/ileri önbellekten dönüş
document.addEventListener('transitionend', restartQuietTimer, true);
document.addEventListener('animationend', restartQuietTimer, true);
reportScreenWhenSettled(); // sayfa yüklendi

function reportScreenWhenSettled() {
  stopSettle();
  settleTimers = { quiet: setTimeout(reportScreen, SETTLE_QUIET_MS), max: setTimeout(reportScreen, SETTLE_MAX_MS) };
  settleObserver.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

function restartQuietTimer() {
  if (!settleTimers) return;
  clearTimeout(settleTimers.quiet);
  settleTimers.quiet = setTimeout(reportScreen, SETTLE_QUIET_MS);
}

function stopSettle() {
  if (!settleTimers) return;
  clearTimeout(settleTimers.quiet);
  clearTimeout(settleTimers.max);
  settleTimers = null;
  settleObserver.disconnect();
}

function reportScreen() {
  stopSettle();
  message({ type: 'SCREEN', screen: countElements(interactableElements()) });
}


// -----------------------------------------------------------------------------
// 4) KONSOL LOGU (LOG_STATE)
// -----------------------------------------------------------------------------
// Aksiyonun yapıldığı ANDAKİ sayfa state'ini yazar. Tıklama capture phase'de
// yakalandığı için bu, aksiyonun etkisinden ÖNCEKİ state'tir. Kaydırmada ise
// kaydırma bittikten SONRAKİ state'tir. Ayarlarda kapatılan aksiyon ve türler de
// yazılır; filtreyi background uygular.

function logState(action) {
  const locators = [];
  for (const el of interactableElements()) {
    // Form alanlarında visibleText() alanın değerini (şifre dahil) döndürebilir; fieldName() döndürmez.
    const label = isFormField(el) ? fieldName(el) : visibleText(el);
    const types = INTERACTABLE_TYPES.filter((t) => el.matches(t.selector)).map((t) => t.selector).join(' ');
    locators.push({ key: elementKey(el), types, label, locator: cssSelector(el) });
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
