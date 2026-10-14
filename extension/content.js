// =============================================================================
// content.js — SENSÖR
// -----------------------------------------------------------------------------
// Chrome bu dosyayı ziyaret edilen her web sayfasının içine otomatik enjekte eder
// (bkz. manifest.json > content_scripts).
//
// Üç görevi var:
//   1) Kullanıcının sayfada yaptığı aksiyonları (tıklama, yazma, Enter, tuş, kaydırma)
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
document.addEventListener('mousedown', onMouseDown, true);
document.addEventListener('mouseup', onMouseUp, true);
document.addEventListener('click', onClick, true);
document.addEventListener('change', onChange, true);
document.addEventListener('copy', onClipboard, true);
document.addEventListener('cut', onClipboard, true);
document.addEventListener('paste', onClipboard, true);
document.addEventListener('contextmenu', onContextMenu, true);
document.addEventListener('focusin', onFocusIn, true);
document.addEventListener('focusout', onFocusOut, true);
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
  if (selectionGesture) return void (selectionGesture = false); // seçim hareketinin 'click'i

  // Kullanıcı bir butonun içindeki <span>'e tıklamış olabilir; asıl butonu bul.
  const el = event.target.closest(INTERACTIVE) || event.target;

  // Bir form alanına ya da düzenlenebilir alana (contenteditable) tıklamak sadece
  // "odaklanmak"tır. Değeri 'change' / 'focusout' olayıyla kaydedilecek.
  if (isFormField(el) || el.isContentEditable) return;

  const visible = interactableElements();
  send({ type: 'click', target: targetOf(el, visible), selector: cssSelector(el), label: visibleText(el) || el.tagName.toLowerCase() }, countElements(visible));
}

function onChange(event) {
  if (!event.isTrusted || !isFormField(event.target)) return;
  recordValue(event.target);
}

// METİN SEÇME: fareyle sürükleyerek ya da çift/üçlü tıklayarak metin seçmek tıklama değildir;
// tarayıcı fare bırakılınca yine 'click' üretir ama tekrar oynatılan tıklama seçimi geri
// getirmez. Fare basıldığı yerden kaydıysa ya da çift/üçlü tıklandıysa ve seçili metin varsa
// 'select' aksiyonu kaydedilir, bu hareketin 'click'i yok sayılır. Çift/üçlü tıklamada
// hareketin önceki tıklaması (ya da kelime seçimi) zaten gönderilmiştir; background onu bu
// seçimle değiştirir (replaces: o aksiyonun zamanı). Shift+tıklama ve klavyeyle (Shift+oklar)
// var olan seçimi genişletmek de son seçimin yerini alır. Buton, link gibi elementlere çift
// tıklamak ya da Shift ile tıklamak seçim sayılmaz.
let pointerDown = null;        // { x, y }: farenin basıldığı yer
let gestureStart = 0;          // çoklu tıklama hareketinin ilk basışının zamanı
let lastSentTime = 0;          // en son gönderilen aksiyonun zamanı (bkz. send)
let lastSelectTime = -1;       // en son gönderilen seçimin zamanı
let selectionGesture = false;  // bu hareket seçim olarak kaydedildi: ardından gelen 'click'i yok say

function onMouseDown(event) {
  if (!event.isTrusted || event.button !== 0) return;
  pointerDown = { x: event.clientX, y: event.clientY };
  if (event.detail <= 1) gestureStart = Date.now();
  selectionGesture = false;
}

function onMouseUp(event) {
  if (!event.isTrusted || event.button !== 0 || !pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4;
  const onControl = event.target.closest(INTERACTIVE) && !isFormField(event.target);
  const multiClick = event.detail >= 2 && !onControl;
  const extend = event.shiftKey && !onControl;
  if (!moved && !multiClick && !extend) return; // sıradan tıklama
  const selection = selectionOf(event.target);
  if (!selection) return;

  selectionGesture = true;
  const replaces = multiClick && lastSentTime >= gestureStart ? lastSentTime
    : extend && lastSentTime === lastSelectTime ? lastSentTime : null;
  sendSelection(selection, countElements(interactableElements()), replaces);
}

function sendSelection({ el, text, start, end }, screen, replaces) {
  send({
    type: 'select', text, selector: cssSelector(el), label: `Select "${shortText(text)}"`,
    ...(isFormField(el) && { target: targetOf(el) }),
    ...(start !== undefined && { start, end }),
  }, screen, replaces ? { replaces } : {});
  lastSelectTime = lastSentTime;
}

// Seçili metin ve bulunduğu yer. Metin alanında alanın kendisi ve aralık (start, end);
// sayfada seçimi içeren en küçük element. Seçim yoksa null.
function selectionOf(el) {
  if (isTextField(el)) {
    let start = null;
    let end = null;
    try {
      ({ selectionStart: start, selectionEnd: end } = el);
    } catch { /* bazı alan türleri (email, number) seçim aralığı vermez */ }
    if (start !== null && start !== end) return { el, text: maskedText(el, el.value.slice(start, end)), start, end };
    const text = getSelection().toString(); // aralık vermeyen alanlarda Chrome seçili metni yine verir
    return text ? { el, text: maskedText(el, text) } : null;
  }
  const selection = getSelection();
  const text = selection.toString();
  if (selection.isCollapsed || !text.trim()) return null;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  return { el: node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement, text };
}

// PANO: kopyala, kes, yapıştır. Klavyeden, sağ tık menüsünden ya da Chrome menüsünden
// yapılsa da aynı olay gelir; bu yüzden Ctrl+C/X/V tuş olarak kaydedilmez (bkz. commandKey).
// Kopyalanan / yapıştırılan metin ve sayfanın işlemi engelleyip engellemediği (blocked)
// kaydedilir: sitenin kopyalama ya da yapıştırma iznini test etmek için. Sayfa olayı bizden
// SONRA işler (capture phase); engelleyip engellemediği olay bitince (setTimeout) okunur.
// Engellemek, preventDefault() demektir: sayfa kopyalamayı tamamen durdurmuş ya da panoya
// kendi içeriğini koymuş olabilir. Yapıştırmada alanın yeni değeri ayrıca 'input' ile gelir.
function onClipboard(event) {
  if (!event.isTrusted) return;
  const operation = event.type; // copy | cut | paste
  const focused = document.activeElement;
  const field = isTextField(focused) || focused?.isContentEditable ? focused : null;
  const selection = selectionOf(field && isTextField(field) ? field : document.body);
  const text = operation === 'paste' ? maskedText(field, event.clipboardData?.getData('text/plain') ?? '') : selection?.text ?? '';
  const el = field ?? selection?.el ?? null;
  const visible = interactableElements();
  const screen = countElements(visible);
  const verb = { copy: 'Copy', cut: 'Cut', paste: 'Paste' }[operation];
  setTimeout(() => send({
    type: 'clipboard', operation, text, blocked: event.defaultPrevented,
    selector: el && el !== document.body ? cssSelector(el) : null,
    ...(field && isFormField(field) && { target: targetOf(field, visible) }),
    label: text ? `${verb} "${shortText(text)}"` : `${verb} (boş)`,
  }, screen));
}

// SAĞ TIK MENÜSÜ: farenin sağ tuşu 'click' üretmez; klavyedeki menü tuşu ve Shift+F10 da
// aynı 'contextmenu' olayını tetikler (bu yüzden tuş olarak kaydedilmezler, bkz. commandKey).
// Sayfa olayı engellediyse (blocked) tarayıcının menüsü yerine kendi menüsünü açmıştır;
// engelleyip engellemediği olay bitince okunur (bkz. onClipboard).
function onContextMenu(event) {
  if (!event.isTrusted) return;
  const el = event.target.closest(INTERACTIVE) || event.target;
  const visible = interactableElements();
  const screen = countElements(visible);
  const action = {
    type: 'contextmenu', selector: cssSelector(el),
    label: 'Right click ' + ((isFormField(el) ? fieldName(el) : visibleText(el)) || el.tagName.toLowerCase()),
    ...(el.matches(INTERACTIVE) && { target: targetOf(el, visible) }),
  };
  setTimeout(() => send({ ...action, blocked: event.defaultPrevented }, screen));
}

function isTextField(el) {
  return el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(el.type));
}

function maskedText(el, text) {
  return text && el?.type === 'password' && MASK_PASSWORDS ? '******' : text;
}

function shortText(text) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > 30 ? oneLine.slice(0, 30) + '…' : oneLine;
}

// ODAK (Tab): Tab tuşu kaydedilmez (tekrar oynatırken sayfadaki sıraya bağlı kalırdı); odağın
// Tab ile gittiği element 'focus' aksiyonu olarak kaydedilir. Odak çoğu zaman ekranı
// değiştirmez (formda alandan alana geçmek); background yalnızca state'i değiştiren odak
// aksiyonlarını tutar (bkz. background.js > observeScreen). Bazı sayfalarda ise odak element
// gösterir: "içeriğe atla" linki, odaklanınca açılan menü. Aksiyon anının ekranı Tab'a
// basıldığı andır: odak taşındıktan sonra ekran zaten değişmiş olabilir.
let tabPress = null; // { time, screen }: Tab'a basıldığı an ve o anki ekran

function onFocusIn(event) {
  if (!event.isTrusted) return;
  const el = event.target;
  // Alana odaklanıldığı andaki değer "son kaydedilen" sayılır: alan değişmeden bir tuşa
  // basılır ya da odak çıkarsa (aşağıda) boş bir "Fill" kaydedilmez.
  if (isFormField(el) || el.isContentEditable) lastRecordedValue.set(el, fieldValue(el));
  if (!tabPress || Date.now() - tabPress.time > 500) return;
  const { screen } = tabPress;
  tabPress = null;
  const visible = interactableElements();
  send({
    type: 'focus', selector: cssSelector(el),
    label: 'Focus ' + ((isFormField(el) ? fieldName(el) : visibleText(el)) || el.tagName.toLowerCase()),
    ...(el.matches(INTERACTIVE) && { target: targetOf(el, visible) }),
  }, screen);
}

// Düzenlenebilir alanlarda (contenteditable: zengin metin editörleri) 'change' olayı yoktur;
// değer, odak alandan çıkınca değiştiyse kaydedilir. Odak yalnızca alanın kendisine gelir,
// içindeki paragraflara değil; event.target her zaman alanın kendisidir.
function onFocusOut(event) {
  if (event.isTrusted && event.target.isContentEditable) recordValue(event.target);
}

function onKeyDown(event) {
  if (!event.isTrusted || event.isComposing) return;
  const el = event.target;
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
    tabPress = { time: Date.now(), screen: countElements(interactableElements()) };
    return;
  }
  if (event.key === 'Enter' && el.tagName === 'INPUT' && isFormField(el)) return recordEnter(el);

  const key = commandKey(event, el);
  const inField = isFormField(el) || el.isContentEditable;
  const selecting = isSelectionKey(event);
  const scrolling = !inField && isScrollKey(event);
  if (!key && !selecting) return;
  // Alana yazılmış ama 'change'i henüz gelmemiş değer önce kaydedilir. Ör. arama kutusuna
  // yazıp ok tuşuyla öneri seçmek: "Fill Search → Press ArrowDown".
  if (inField) recordValue(el);
  const visible = interactableElements();
  const page = el === document.body || el === document.documentElement; // odakta bir element yok
  const action = key && {
    type: 'key', key, count: 1, label: 'Press ' + key,
    ...(page ? { selector: null } : { target: targetOf(el, visible), selector: cssSelector(el) }),
  };
  if (selecting || scrolling) return deferKey(event, action, countElements(visible), el);
  send(action, countElements(visible));
}

// TUŞUN ETKİSİNE GÖRE KARAR: bazı tuşların tarayıcıda varsayılan bir işi vardır: Shift+oklar
// ve Ctrl+A metin seçer; Space, PageDown, oklar sayfayı kaydırır. Tuşun ne yaptığı ancak olay
// bittikten sonra bilinir; karar KEY_DECISION_MS sonra verilir:
//   - sayfa olayı engellediyse (preventDefault) tuşu sayfa kullanmıştır -> 'key'
//   - seçili metin değiştiyse -> 'select' (alan dışında Ctrl+A: tüm sayfa metni saklanmasın
//     diye 'key'); art arda genişletilen seçim tek aksiyondur
//   - sayfa kaydıysa -> hiçbiri: kaydırma zaten 'scroll' olarak kaydedilir
//   - hiçbiri olmadıysa -> 'key' (sayfa tuşu engellemeden kullanmış olabilir)
// O arada başka bir aksiyon gönderilirse ya da parmak izi istenirse önce bu tuşun kararı
// verilir ki sıra bozulmasın (bkz. send).
const KEY_DECISION_MS = 100;
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
let pendingKey = null; // { event, action, screen, el, selection, scrolled, timer }

function deferKey(event, action, screen, el) {
  finishPendingKey();
  pendingKey = { event, action, screen, el, selection: selectionOf(el)?.text ?? '', scrolled: false,
    timer: setTimeout(finishPendingKey, KEY_DECISION_MS) };
}

function finishPendingKey() {
  const pending = pendingKey;
  if (!pending) return;
  pendingKey = null;
  clearTimeout(pending.timer);
  const { event, action, screen, el } = pending;
  if (event.defaultPrevented) return action && send(action, screen);
  const selection = selectionOf(el);
  if (selection && selection.text !== pending.selection) {
    const selectAll = event.key.toLowerCase() === 'a' && !(isFormField(el) || el.isContentEditable);
    if (selectAll) return action && send(action, screen);
    return sendSelection(selection, screen, lastSentTime === lastSelectTime ? lastSentTime : null);
  }
  if (!pending.scrolled && action) send(action, screen);
}

// Shift + yön tuşu (seçimi genişletir) ya da Ctrl/Cmd+A (tümünü seçer).
function isSelectionKey(event) {
  if (event.altKey) return false;
  return (event.shiftKey && NAV_KEYS.has(event.key)) || ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'a');
}

// Sayfayı kaydırabilen tuşlar (Ctrl/Alt/Cmd olmadan).
function isScrollKey(event) {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  return event.key === ' ' || (!event.shiftKey && NAV_KEYS.has(event.key));
}

function recordEnter(el) {
  // Enter'a basıldığında tarayıcı önce 'keydown', sonra 'change' üretir.
  // Kayıttaki sıra "önce yaz, sonra Enter" olsun diye değeri burada kaydediyoruz.
  recordValue(el);
  const visible = interactableElements();
  send({ type: 'enter', target: targetOf(el, visible), selector: cssSelector(el), label: 'Submit ' + fieldName(el) }, countElements(visible));
}

// TUŞ AKSİYONU: metin değil, komut olan tuşlar kaydedilir. Bir alana yazılan metin harf harf
// kaydedilmez; alanın değeri 'input' aksiyonuyla kaydedilir (tekrar oynatırken gerekirse harf
// harf yazılır). Kaydedilenin adı Playwright'ın press() biçimindedir: "Escape", "Control+S".
//   - Form alanı ya da düzenlenebilir alan dışında: her tuş (Escape, oklar, Delete, "/", "c"...).
//     Yalnızca butonda/linkte Enter ve Space hariç: tarayıcı onları 'click' olarak üretir.
//   - Alanın içinde: Escape, tek satırlı metin alanında ArrowUp/ArrowDown (öneri seçmek) ve
//     Ctrl/Alt/Cmd kısayolları (Ctrl+Enter...). İmleç ve düzenleme tuşları (oklar, Home,
//     Backspace, Ctrl+Z...) hariç: alanın değerini değiştirirler, o da 'input' ile kaydedilir.
//   - Hiçbir yerde: Tab (yalnızca odağı taşır), tek başına Ctrl/Shift..., kopyala/kes/yapıştır
//     ve menü tuşu (kendi olayları kaydeder) ve tarayıcının kendi kısayolları (aşağıda).
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'OS', 'Dead', 'Unidentified', 'Process']);
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete']);
const FIELD_EDITING = new Set(['ctrl+a', 'ctrl+z', 'ctrl+y', 'ctrl+shift+z']);
// Kendi olayı olan kısayollar: kopyala / kes / yapıştır 'clipboard' (bkz. onClipboard), menü
// tuşu ve Shift+F10 'contextmenu' (bkz. onContextMenu) aksiyonu kaydeder.
const EVENT_SHORTCUTS = new Set(['ctrl+c', 'ctrl+x', 'ctrl+v', 'ctrl+shift+v', 'ctrl+insert', 'shift+insert', 'shift+delete', 'contextmenu', 'shift+f10']);
const ACTIVATABLE = 'button, a[href], summary, input[type="button"], input[type="submit"], input[type="reset"], input[type="image"]';

// Tarayıcının kendi kısayolları: sayfada bir şey yapmazlar ya da etkilerini başka bir aksiyon
// kaydeder (yakınlaştırma -> zoom, yenileme -> reload, geri/ileri -> history). Ctrl ile Cmd
// (Mac) aynı sayılır. Yazım: küçük harf, "ctrl+shift+i" gibi (bkz. commandKey).
const BROWSER_SHORTCUTS = new Set([
  'ctrl++', 'ctrl+=', 'ctrl+-', 'ctrl+0', 'ctrl+shift++', 'ctrl+shift+_',                  // yakınlaştırma
  'f5', 'ctrl+r', 'ctrl+f5', 'shift+f5', 'ctrl+shift+r', 'browserrefresh',                // yenileme
  'alt+arrowleft', 'alt+arrowright', 'ctrl+[', 'ctrl+]', 'browserback', 'browserforward', // geri / ileri
  'ctrl+f', 'ctrl+g', 'ctrl+shift+g', 'f3',                                               // sayfada bul
  'ctrl+l', 'alt+d', 'f6', 'alt+f', 'alt+e', 'alt+home', 'ctrl+t', 'ctrl+n', 'ctrl+w',    // adres çubuğu, menü, sekme
  'ctrl+tab', 'ctrl+shift+tab', 'ctrl+p', 'ctrl+d', 'ctrl+h', 'ctrl+j', 'ctrl+u',
  'f11', 'f12', 'ctrl+shift+i', 'ctrl+shift+j', 'ctrl+shift+c',                           // tam ekran, DevTools
]);

// Kaydedilecek tuşun adı ya da kaydedilmeyecekse null.
function commandKey(event, el) {
  if (MODIFIER_KEYS.has(event.key) || event.key === 'Tab') return null;
  // AltGr (Türkçe klavyede @, €, {) Windows'ta Ctrl+Alt gibi görünür ama yazıdır, kısayol değil.
  const altGraph = event.getModifierState('AltGraph');
  const ctrl = event.ctrlKey && !altGraph;
  const alt = event.altKey && !altGraph;
  const meta = event.metaKey;
  const name = event.key === ' ' ? 'Space' : event.key;
  const shortcut = [(ctrl || meta) && 'ctrl', alt && 'alt', event.shiftKey && 'shift', name.toLowerCase()].filter(Boolean).join('+');
  if (BROWSER_SHORTCUTS.has(shortcut) || EVENT_SHORTCUTS.has(shortcut)) return null;

  const modified = ctrl || alt || meta;
  if (isFormField(el) || el.isContentEditable) {
    const suggestion = (name === 'ArrowUp' || name === 'ArrowDown') && !modified && isSingleLineText(el);
    if (name !== 'Escape' && !suggestion && (!modified || CARET_KEYS.has(name) || FIELD_EDITING.has(shortcut))) return null;
  } else if ((name === 'Enter' || name === 'Space') && !modified && el.matches(ACTIVATABLE)) {
    return null;
  }
  // Shift tek karakterde zaten karakterin içindedir ("?", "A"); diğerlerinde yazılır ("Shift+ArrowDown").
  const shift = event.shiftKey && (modified || name.length > 1);
  return [ctrl && 'Control', meta && 'Meta', alt && 'Alt', shift && 'Shift', name].filter(Boolean).join('+');
}

function isSingleLineText(el) {
  return el.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'tel'].includes(el.type);
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
  if (!event.isTrusted) return;
  if (pendingKey) pendingKey.scrolled = true; // tuş sayfayı kaydırdı (bkz. finishPendingKey)
  if (scrollStartScreen.has(event.target)) return;
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
  const realValue = fieldValue(el);
  if (lastRecordedValue.get(el) === realValue) return;
  lastRecordedValue.set(el, realValue);

  const value = el.type === 'password' && MASK_PASSWORDS ? '******' : realValue;
  const verb = el.tagName === 'SELECT' ? 'Select' : el.type === 'checkbox' || el.type === 'radio' ? 'Check' : 'Fill';
  const visible = interactableElements();
  send({ type: 'input', target: targetOf(el, visible), selector: cssSelector(el), value, label: verb + ' ' + fieldName(el) }, countElements(visible));
}

function fieldValue(el) {
  if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
  return el.isContentEditable ? el.innerText : el.value;
}

// Metin girilen / seçim yapılan alanlar. Butonlar (submit, button...) bu gruba girmez.
function isFormField(el) {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !['button', 'submit', 'reset', 'image'].includes(el.type);
  return false;
}

// extra: mesaja eklenen, aksiyonda saklanmayan bilgi (ör. select > replaces).
function send(action, screen, extra = {}) {
  finishPendingKey(); // kararı bekleyen tuş önce gitsin (sıra)
  action.url = location.href;
  action.time = lastSentTime = Date.now();
  if (LOG_STATE) logState(action);
  message({ type: 'ACTION', action, screen, ...extra });
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
  if (message.type === 'GET_FINGERPRINT') {
    finishPendingKey(); // kararı bekleyen tuş bu edge'e girsin
    sendResponse(fingerprint());
  }
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
// Yazmaya başlanınca sayfa durulmuş sayılır: yazının etkisi önceki aksiyona (ör. Tab ile odak)
// karışmasın, yazmanın öncesi bu an olsun. Capture phase: sayfa henüz tepki vermemiştir.
document.addEventListener('beforeinput', (event) => event.isTrusted && settleTimers && reportScreen(), true);
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
