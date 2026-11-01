// =============================================================================
// dom-tree.js — EKRANDAKİ ELEMENTLER (panelin DOM ağacı kartı)
// -----------------------------------------------------------------------------
// Panel isteyince sayfanın ŞU AN ekranda görünen kısmını sade bir ağaç olarak döndürür; panelde
// üzerine gelinen satırın elementini sayfada çerçeveler. Kayda dokunmaz: olay dinlemez, sayfayı
// kaydırmaz, tıklamaz.
//   panel → { type: 'DOM_TREE' }                sayfa → { url, title, count, truncated, tree }
//   panel → { type: 'DOM_TREE_HIGHLIGHT', id }  sayfa → { ok: true } | { gone: true }
// tree: [{ id, tag, text, key, interactive, children }]. id, elementin son ağaçtaki sırasıdır;
// çerçeve isteği bununla gelir (ağaç yeniden alınınca id'ler de yenilenir). id null: çerçeve kalkar.
//
// Sadeleştirme: React gibi sitelerde DOM'un çoğu ekranda karşılığı olmayan sarmalayıcıdır.
//   1) Ekranda görünmeyen element ağaca girmez: hiç çizilmeyenler (script, style…), display:none,
//      visibility:hidden, opacity:0, 1 px'lik ekran okuyucu metinleri, görünen alanın dışında
//      kalanlar ve taşanı gizleyen ya da kaydırılan bir kutunun dışında kalanlar (kayan menü,
//      carousel'in diğer slaytları).
//   2) Anlamlı element gösterilir (bkz. isMeaningful). Anlamsız sarmalayıcı (div, span…) yalnızca
//      altındaki içeriği birden fazla dala ayırıyorsa gösterilir; tek çocuklu zincirler katlanır.
// iframe'lerin ve shadow DOM'un içi gösterilmez (content script yalnızca ana çerçevede çalışır).
// fingerprint.js ve content.js ile aynı dünyada çalışır, onların tanımlarını kullanır (INTERACTIVE,
// isInteractable, elementKey, visibleText, isFormField, fieldName); buradaki adlar onları ezmesin
// diye dosyanın tamamı bir kapanış içindedir (monitor-probe.js gibi).
// =============================================================================

(() => {
const DOM_TREE_MAX_WALK = 20000; // en fazla bu kadar element gezilir (çok büyük sayfa donmasın)
const DOM_TREE_TEXT_CHARS = 60;  // satırdaki metnin en fazla bu kadar karakteri

// Çizilmeyen ya da içi ağaç için yalnızca gürültü olan elementler: hiç gezilmez.
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'br', 'wbr']);
// Tek parça sayılan elementler: kendileri gösterilir, içleri gezilmez (svg'nin path'leri, butonun
// içindeki ikon ve yazı, select'in option'ları).
const LEAF_TAGS = new Set(['svg', 'img', 'picture', 'canvas', 'video', 'audio', 'iframe', 'object', 'embed',
  'button', 'select', 'textarea', 'input']);
// Ekranda bir bölgeyi, başlığı ya da görseli anlatan elementler: sarmalayıcı sayılmaz.
const MEANINGFUL_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'dl', 'table', 'tr', 'th', 'td',
  'form', 'fieldset', 'legend', 'nav', 'main', 'header', 'footer', 'aside', 'section', 'article', 'dialog',
  'svg', 'img', 'picture', 'canvas', 'video', 'audio', 'iframe', 'object', 'embed']);
// role'ü bunlardan biri olan element yine sarmalayıcıdır.
const WRAPPER_ROLES = new Set(['presentation', 'none', 'generic']);

let elements = []; // son ağaçtaki elementler; ağaçtaki id = buradaki sıra

function domTree() {
  elements = [];
  const budget = { walked: 0, truncated: false };
  const tree = [...(document.body?.children ?? [])].flatMap((child) => walk(child, viewportRect(), budget));
  return { url: location.href, title: document.title, count: elements.length, truncated: budget.truncated, tree };
}

// Elementin ağaçtaki karşılığı (dizi): kendisi (çocuklarıyla) ya da gösterilmiyorsa yerine geçen
// çocukları. clip: elementin görünebileceği alan, yani görünen alan ile taşanı gizleyen üst
// kutuların kesişimi. Yaklaşıktır: position:absolute bir kutu, konumlandırılmamış bir üst kutunun
// taşmasından kurtulur; bu ayrım yapılmaz.
function walk(el, clip, budget) {
  if (SKIP_TAGS.has(el.localName)) return [];
  if (++budget.walked > DOM_TREE_MAX_WALK) {
    budget.truncated = true;
    return [];
  }
  const style = getComputedStyle(el);
  if (style.display === 'none') return []; // içindekiler de çizilmez
  if (style.position === 'fixed') clip = viewportRect(); // sabit kutu üst kutuların taşmasından kurtulur
  const shown = isShown(el, clip);
  const inner = clipsOverflow(style) ? intersect(clip, el.getBoundingClientRect()) : clip;
  const children = LEAF_TAGS.has(el.localName) ? [] : [...el.children].flatMap((child) => walk(child, inner, budget));
  if (shown && (isMeaningful(el) || children.length > 1)) return [treeNode(el, children)];
  return children; // görünmeyen ya da tek çocuklu sarmalayıcı: yerine çocukları geçer
}

// Element şu an ekranda görünüyor mu: çizilmiş (gizli, saydam değil) ve bir parçası clip içinde.
// 1 px'lik parçalar sayılmaz: ekran okuyucular için gizlenen metinler (sr-only) böyle saklanır.
function isShown(el, clip) {
  if (el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return false;
  for (const r of el.getClientRects()) {
    if (r.width > 1 && r.height > 1 && r.right > clip.left && r.left < clip.right && r.bottom > clip.top && r.top < clip.bottom) return true;
  }
  return false;
}

// Taşanı gizleyen ya da kaydırılan kutu: içindekiler yalnızca kutunun alanında görünür.
function clipsOverflow(style) {
  return style.overflowX !== 'visible' || style.overflowY !== 'visible';
}

function intersect(a, b) {
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
}

function viewportRect() {
  return { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
}

// Kullanıcının ekranda ayırt ettiği bir şey mi: etkileşimli element, görsel ya da yapısal element,
// sayfanın kendisinin ad verdiği element (id, role, aria-label, test kimliği) ya da kendi metni olan.
function isMeaningful(el) {
  if (el.matches(INTERACTIVE) || MEANINGFUL_TAGS.has(el.localName)) return true;
  const role = el.getAttribute('role');
  if (role && !WRAPPER_ROLES.has(role)) return true;
  if (el.id || el.hasAttribute('aria-label') || el.hasAttribute('data-testid') || el.hasAttribute('data-test')) return true;
  return ownText(el) !== '';
}

// interactive: element şu an etkileşimli, yani node'un edge set'inde (fingerprint.js > isInteractable).
// key: etkileşimli türdeki elementin parmak izi anahtarı ("button:login-button"); monitör formundaki
// Alan da bu biçimi kullanır.
function treeNode(el, children) {
  elements.push(el);
  const typed = el.matches(INTERACTIVE);
  return {
    id: elements.length - 1,
    tag: tagText(el),
    text: rowText(el, typed),
    key: typed ? elementKey(el) : null,
    interactive: typed && isInteractable(el),
    children,
  };
}

// "button#login-button", "div[role=dialog]", "h1"
function tagText(el) {
  const role = el.getAttribute('role');
  return el.localName + (el.id ? '#' + el.id : '') + (role ? `[role=${role}]` : '');
}

// Satırın metni: form alanında alanın adı (değeri asla: şifre olabilir), görselde alt metni,
// etkileşimli elementte kullanıcının gördüğü ad, diğerlerinde elementin KENDİ metni (çocuklarının
// metni kendi satırlarındadır).
function rowText(el, typed) {
  if (isFormField(el)) return fieldName(el);
  if (el.localName === 'img') return el.alt;
  return typed ? visibleText(el) : ownText(el);
}

function ownText(el) {
  let text = '';
  for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue;
  return text.replace(/\s+/g, ' ').trim().slice(0, DOM_TREE_TEXT_CHARS);
}


// -----------------------------------------------------------------------------
// ÇERÇEVE: panelde üzerine gelinen satırın elementi
// -----------------------------------------------------------------------------
// Sayfanın DOM'una bir kez eklenen sabit, boyutsuz bir kap ve onun shadow root'u. Çerçeve her
// taşındığında yalnızca shadow root'un içi değişir: kaydın "sayfa duruldu mu?" izleyicisi (content.js)
// ve sayfanın kendi izleyicileri shadow root'un içini görmez. Çerçeve tıklamayı almaz. Kap <body>'nin
// dışında durduğu için ağaca, parmak izine ve sayfanın görünen metnine girmez.
let frame = null; // { host, box, label }

function highlight(id) {
  if (id === null || id === undefined) {
    hideFrame();
    return { ok: true };
  }
  const el = elements[id];
  if (!el?.isConnected) { // sayfa değişti, element artık yok
    hideFrame();
    return { gone: true };
  }
  const r = el.getBoundingClientRect();
  const { box, label } = ensureFrame();
  box.style.cssText = `position:fixed;left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;`
    + 'box-sizing:border-box;border:2px solid #2563eb;border-radius:3px;background:rgba(37,99,235,.15);pointer-events:none;';
  // Etiket çerçevenin üstünde; sayfanın en üstündeki elementte altında
  label.style.cssText = `position:absolute;left:-2px;${r.top < 22 ? 'top:100%;margin-top:2px' : 'bottom:100%;margin-bottom:2px'};`
    + 'padding:1px 5px;border-radius:3px;background:#1e293b;color:#fff;font:11px/1.4 system-ui,sans-serif;white-space:nowrap;';
  label.textContent = `${tagText(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  return { ok: true };
}

function hideFrame() {
  if (frame) frame.box.style.display = 'none';
}

function ensureFrame() {
  if (frame?.host.isConnected) return frame;
  const host = document.createElement('graph-recorder-frame'); // sayfanın "div" kuralları dokunmasın
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  const box = document.createElement('div');
  const label = document.createElement('div');
  box.append(label);
  host.attachShadow({ mode: 'open' }).append(box);
  document.documentElement.append(host);
  frame = { host, box, label };
  return frame;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return undefined; // yalnızca bu eklenti
  // Eklentinin başka bir isteği (node oluşturma, oynatma, monitör kontrolü) ekran görüntüsü
  // alabilir: çerçeve önce kalkar, görüntüye girmesin.
  if (message?.type !== 'DOM_TREE_HIGHLIGHT') hideFrame();
  try {
    if (message?.type === 'DOM_TREE') sendResponse(domTree());
    if (message?.type === 'DOM_TREE_HIGHLIGHT') sendResponse(highlight(message.id));
  } catch (error) {
    sendResponse({ error: error.message });
  }
  return undefined; // cevap hemen verildi (ya da bu mesaj başkasının)
});
})();
