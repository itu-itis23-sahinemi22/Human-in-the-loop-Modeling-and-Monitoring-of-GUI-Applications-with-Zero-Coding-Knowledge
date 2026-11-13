// =============================================================================
// monitor-probe.js — MONİTÖR KONTROLÜ, SAYFADA ÇALIŞAN KISIM (run-time monitoring, Ceren'in kısmı)
// -----------------------------------------------------------------------------
// Monitörler sayfanın kendisine bakar: bir alanın değeri, görünen metin, yazı boyutları… Bu dosya
// content script olarak her sayfaya yüklenir (manifest.json > content_scripts > js, content.js'ten
// sonra) ve panelden gelen kontrol listesini sayfada değerlendirir:
//   panel → { type: 'MONITOR_PROBE', checks: [{ id, type, params }] }
//   sayfa → { url, title, viewport: { width, height, ratio },
//             results: { [id]: { status: 'ok' | 'fail' | 'skip', text, targets?, more? } } }
// 'ok' kural sağlandı, 'fail' bozuldu, 'skip' bu sayfada kontrol edilemedi (alan yok, desen
// geçersiz…). text: kullanıcıya gösterilen kısa açıklama (bozulduysa neyin, nerede).
// Sayfaya bakmayan monitörler de vardır (JavaScript Error, Action Timeout: sonucu panel, oynatmanın kendi
// verisinden çıkarır). Bozulduklarında uyarıda ilgili aksiyonun elementi gösterilir; bunun için iki istek daha:
//   panel → { type: 'MONITOR_KEEP', id, ref: { target, selector } }   aksiyon oynatılmadan önce: elementi akılda tut
//   sayfa → { kept }                                                  (ref: kayıttaki aksiyonun hedefi)
//   panel → { type: 'MONITOR_LOCATE', id }                            monitör bozuldu: o element şimdi nerede?
//   sayfa → { viewport, targets, more }                               (element artık ekranda yoksa targets [])
// Bozulan sonuç, bozulan elementi de taşır (targets; bkz. HATA YERİ): panel onu uyarının ekran
// görüntüsünde işaretler. viewport: ekran görüntüsünün (chrome.tabs.captureVisibleTab) gösterdiği
// alan, CSS pikseli; ratio: bir CSS pikselinin görüntüde kaç piksel ettiği. Kutular bu alana göre
// ölçülür; panel alanı görüntüyle eşler ve kutuları ona oranlayarak çizer.
//
// fingerprint.js ile aynı dünyada çalışır; onun tanımlarını kullanır (interactableElements,
// elementKey, INTERACTIVE, isFormField, visibleText): "input:phone" gibi anahtarlar kayıttakiyle
// aynı anlama gelir. Element seçimi (resolveElements): önce parmak izi anahtarı ("input:phone",
// kayıttaki elementlerden seçilen), uymazsa CSS selector ("#phone").
// Aynı dünyada content.js de olduğu için bu dosyanın tamamı bir kapanış (IIFE) içindedir: buradaki
// yardımcı adlar (ör. fieldValue) content.js'in aynı adlı fonksiyonlarını ezmesin. Dışarıya yalnızca
// globalThis.monitorProbe verilir (runner da aynı dosyayı sayfaya verip çağırabilir).
//
// Türlerin tanımı: sidepanel/monitor-types.js; yeni bir türün kontrolü MONITOR_PROBES'a aynı id ile
// eklenir. Detay: docs/07-monitorler.md
// =============================================================================

(() => {
const MONITOR_PROBE_TEXT_NODES = 5000;   // yazı boyutu kontrolünde en fazla bu kadar metin parçasına bakılır (çizilen)
const MONITOR_PROBE_WALK_NODES = 20000;  // … ve en fazla bu kadar metin düğümü gezilir (gizli metni çok olan sayfa)
const MONITOR_PROBE_TEXT_CHARS = 200000; // hata metni aramasında sayfanın görünen metninin en fazla bu kadar karakteri
const MONITOR_PROBE_VALUE_CHARS = 10000; // alan değeri kontrolünde değerin en fazla bu kadar karakteri
const MONITOR_PROBE_TARGETS = 10;        // bir sonuçta en fazla bu kadar bozulan element bildirilir (kalanı sayılır: more)
const MONITOR_PROBE_LOCATE_SCAN = 200;   // … bunlar bozulan ilk bu kadar parça arasından seçilir (önce ekranda görünenler)
const MONITOR_PROBE_DESCEND = 400;       // metni içeren en içteki element aranırken en fazla bu kadar elemente bakılır
const MONITOR_PROBE_TARGET_TEXT = 60;    // element satırındaki metnin en fazla bu kadar karakteri (dom-tree.js ile aynı)
const MONITOR_PROBE_PATH = 6;            // DOM yolunda en fazla bu kadar üst element
const MONITOR_PROBE_KEPT = 100;         // akılda tutulan aksiyon elementi sayısı (eskisi düşer; bkz. AKSİYONUN ELEMENTİ)

// Kontrol listesini değerlendirir; her kontrolün sonucu id'siyle döner. Bir kontrolün hatası
// diğerlerini etkilemez (sonucu 'skip' olur).
async function monitorProbe(checks) {
  const results = Object.create(null); // id'ler kullanıcı verisi ("__proto__" bile olsa zararsız)
  for (const check of Array.isArray(checks) ? checks : []) {
    try {
      const evaluate = MONITOR_PROBES[check.type];
      results[check.id] = evaluate ? await evaluate(check.params ?? {}) : probeSkip('bu tür sayfada kontrol edilmiyor');
    } catch (error) {
      results[check.id] = probeSkip(`kontrol edilemedi: ${error.message}`);
    }
  }
  const view = shownView();
  return { url: location.href, title: document.title, viewport: { width: view.width, height: view.height, ratio: view.ratio }, results };
}

const probeOk = (text) => ({ status: 'ok', text });
const probeFail = (text, where = null) => ({ status: 'fail', text, ...where }); // where: { targets, more } (bkz. HATA YERİ)
const probeSkip = (text) => ({ status: 'skip', text });

// Tür -> değerlendirici (params) => sonuç. Anahtarlar monitor-types.js'teki tür id'leridir.
const MONITOR_PROBES = {
  // Alanın değeri desene uymalı (aksiyon tabanlı: yazmadan hemen sonra kontrol edilir)
  inputValidation({ selector, pattern, mode, whenEmpty }) {
    const re = probeRegex(pattern);
    if (!re) return probeSkip('desen geçersiz');
    const el = resolveElements(selector).find((e) => isFieldLike(e)) ?? null;
    if (!el) return probeSkip(`alan ekranda yok (${selector})`);
    const value = fieldValue(el).slice(0, MONITOR_PROBE_VALUE_CHARS);
    if (value === '' && whenEmpty !== 'check') return probeSkip('alan boş, kontrol edilmedi');
    const matched = re.test(value);
    const shown = el.type === 'password' ? '******' : JSON.stringify(value.length > 40 ? value.slice(0, 40) + '…' : value);
    const ok = mode === 'notMatch' ? !matched : matched;
    if (ok) return probeOk(`değer ${shown} kurala uyuyor`);
    return probeFail(`değer ${shown} ${mode === 'notMatch' ? 'desene uyuyor (uymamalıydı)' : 'desene uymuyor'}`, locate(() => [elementPart(el)]));
  },

  // Beklenen metin ekranda olmalı: görünen yazılardan birinin (satırının) içinde geçmeli. Satır: innerText'in
  // blok sınırlarında böldüğü parça (bir etiket, bir paragraf, bir düğme yazısı), ayrıca düğme değerleri ve boş
  // alanların yer tutucuları. Varsayılan büyük/küçük harfe duyarsız (foldText). Parça birden çok satıra
  // yayılmışsa (başlık + paragraf) bütün metinde de aranır; bulunursa yine geçer, notuyla.
  // mode 'absent' (olmamalı): metin ekrandan gitmiş olmalı (ör. bekleme bitince "Bekleyiniz" yok); bulunursa kırmızı.
  expectedText({ text, mode, caseSensitive }) {
    const needle = squeeze(String(text ?? ''));
    if (!needle) return probeSkip('beklenen metin boş');
    const lines = visibleTextLines();
    const absent = mode === 'absent';
    if (!lines.length) return absent ? probeOk('sayfada görünen metin yok') : probeSkip('sayfada görünen metin yok');
    const fold = caseSensitive ? (s) => s : foldText;
    const wanted = fold(needle);
    const shortNeedle = `"${needle.length > 60 ? needle.slice(0, 60) + '…' : needle}"`;
    const line = lines.find((l) => fold(l).includes(wanted));
    const found = line ? `metin bulundu: ${quoteAround(line, fold(line).indexOf(wanted), needle.length)}` : (() => {
      const whole = lines.join(' ');
      const at = fold(whole).indexOf(wanted);
      return at >= 0 ? `metin bulundu (birden çok satıra yayılmış): ${quoteAround(whole, at, needle.length)}` : null;
    })();
    if (absent) {
      if (!found) return probeOk(`metin ekranda yok: ${shortNeedle} (beklendiği gibi)`);
      return probeFail(`${found.replace(/^metin bulundu/, 'metin hâlâ ekranda')} (olmamalıydı)`, locate(() => shownTextParts(textSearch(needle, !caseSensitive)))); // bozulan: ekrandaki metnin kendisi
    }
    if (found) return probeOk(found);
    const onlyCase = caseSensitive && lines.find((l) => foldText(l).includes(foldText(needle)));
    return probeFail(`beklenen metin ekranda yok: ${shortNeedle}${onlyCase ? ` (yalnızca büyük/küçük harf farkıyla var: ${quoteAround(onlyCase, foldText(onlyCase).indexOf(foldText(needle)), needle.length)})` : ''}`,
      { targets: [], more: 0 }); // olmayan metnin yeri de yok
  },

  // Ekranda hata metni geçmemeli (görünen metin: document.body.innerText)
  errorText({ pattern }) {
    const re = probeRegex(pattern, 'i');
    if (!re) return probeSkip('desen geçersiz');
    const body = (document.body?.innerText ?? '').slice(0, MONITOR_PROBE_TEXT_CHARS); // ağır desen × uzun metin sınırı
    const match = re.exec(body);
    if (!match) return probeOk('hata metni yok');
    const from = Math.max(0, match.index - 25);
    const context = body.slice(from, match.index + match[0].length + 25).replace(/\s+/g, ' ').trim();
    return probeFail(`hata metni bulundu: "${match[0]}" (…${context}…)`, locate(() => shownTextParts(regexSearch(re)))); // bozulan: desenin tuttuğu her yer
  },

  // Görünen hiçbir metin alt sınırdan küçük olmamalı (1 pt = 4/3 px). Çizilmeyen metin sayılmaz:
  // simge düğmelerinde yazı boyutu 0 yapılıp yerine simge gösterilen yazılar ("Open Menu") ekranda
  // yok, dolayısıyla "küçük" de değil; bunların kutusu 0×0 çıkar.
  fontSize({ min, unit }) {
    const limitPx = unit === 'pt' ? Number(min) / 0.75 : Number(min);
    const format = (px) => (unit === 'pt' ? `${trimNumber(px * 0.75)} pt` : `${trimNumber(px)} px`);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.nodeValue.trim() && node.parentElement && !node.parentElement.closest('script, style, noscript, template') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const small = [];
    let seen = 0;
    let walked = 0;
    let smallest = Infinity;
    const range = document.createRange();
    for (let node = walker.nextNode(); node && seen < MONITOR_PROBE_TEXT_NODES && walked < MONITOR_PROBE_WALK_NODES; node = walker.nextNode()) {
      walked++;
      const el = node.parentElement;
      if (!isRendered(el)) continue;
      range.selectNodeContents(node);
      if (![...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0)) continue; // çizilmeyen metin
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(px) || px <= 0) continue;
      seen++;
      smallest = Math.min(smallest, px);
      if (px < limitPx - 0.01) small.push({ node, size: format(px) });
    }
    if (!seen) return probeSkip('sayfada görünen metin yok');
    if (small.length) {
      return probeFail(`${small.length} metin ${min} ${unit}'den küçük: ${listOf(small.map(({ node, size }) => `"${node.nodeValue.trim().slice(0, 25)}" ${size}`))}`,
        locate(() => small.slice(0, MONITOR_PROBE_LOCATE_SCAN).map(({ node, size }) => textPart(node, 0, node.nodeValue.length, size)), small.length));
    }
    return probeOk(`${seen} metin ölçüldü, en küçüğü ${format(smallest)}`);
  },
};


// -----------------------------------------------------------------------------
// Yardımcılar
// -----------------------------------------------------------------------------

function probeRegex(pattern, flags = '') {
  try {
    return new RegExp(String(pattern ?? ''), flags);
  } catch {
    return null;
  }
}

// Seçiciden elementlere: önce parmak izi anahtarı (ekrandaki etkileşimli elementler arasında,
// fingerprint.js > elementKey), uymazsa CSS selector. Geçersiz CSS: hiç element.
function resolveElements(selector) {
  const key = String(selector ?? '').trim();
  if (!key) return [];
  const byKey = interactableElements().filter((el) => elementKey(el) === key);
  if (byKey.length) return byKey;
  try {
    return [...document.querySelectorAll(key)];
  } catch {
    return [];
  }
}

function isFieldLike(el) {
  return el.matches('input, textarea, select') || el.isContentEditable;
}

function fieldValue(el) {
  if (el.isContentEditable && !el.matches('input, textarea, select')) return (el.innerText ?? '').trim();
  return String(el.value ?? '');
}

// Element çiziliyor mu (display:none, visibility:hidden, opacity:0 ve boş kutular değil)
function isRendered(el) {
  if (!el || !el.getClientRects().length) return false;
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return false;
  return true;
}

function listOf(items, limit = 3) {
  return items.slice(0, limit).join(', ') + (items.length > limit ? ` (+${items.length - limit})` : '');
}

// Boşlukları tekler (satır sonu, sekme, bölünmez boşluk dahil) ve kırpar
function squeeze(text) {
  return text.replace(/[\s ]+/g, ' ').trim();
}

// Büyük/küçük harfe duyarsız karşılaştırma için katlama. toLowerCase() 'İ'yi "i + birleşik nokta" yapar,
// nokta atılır; 'ı' da 'i' sayılır (Türkçe "GİRİŞ" ~ "giriş", İngilizce "Is" ~ "is"; yerel ayardan bağımsız).
function foldText(text) {
  return text.toLowerCase().replace(/̇/g, '').replace(/ı/g, 'i');
}

// Sayfada görünen yazılar, satır satır: innerText (gizli metin yok, blok sınırlarında satır), düğme değerleri
// (<input type="submit"> gibi; innerText'te yoktur) ve boş alanların yer tutucuları (kullanıcı onları görür).
function visibleTextLines() {
  const body = (document.body?.innerText ?? '').slice(0, MONITOR_PROBE_TEXT_CHARS);
  const lines = body.split('\n').map(squeeze).filter(Boolean);
  for (const el of document.querySelectorAll(SHOWN_VALUE_FIELDS)) {
    if (isRendered(el) && shownValue(el)) lines.push(shownValue(el));
  }
  return lines;
}

// innerText'te olmayan ama kullanıcının gördüğü yazılar: düğme değeri, boş alanın yer tutucusu
const SHOWN_VALUE_FIELDS = 'input[type="button"], input[type="submit"], input[type="reset"], input[placeholder], textarea[placeholder]';

function shownValue(el) {
  return squeeze((/^(button|submit|reset)$/.test(el.type) ? el.value : (el.value === '' ? el.placeholder : '')) ?? '');
}

// Metnin içinden, bulunan parçanın etrafı: "…önce PARÇA sonra…" (uzunsa kırpılır)
function quoteAround(text, at, length) {
  const from = Math.max(0, at - 25);
  const to = Math.min(text.length, at + length + 25);
  return `"${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}"`;
}

function trimNumber(n) {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}


// -----------------------------------------------------------------------------
// HATA YERİ: bozulan elementin bulunması ve ölçülmesi
// -----------------------------------------------------------------------------
// Kural bozulduğunda sonuç yalnızca "ne oldu"yu (text) değil "nerede"yi de taşır:
//   targets: [{ tag, text, key, path, rect, visible, hidden, note }], more: yazılmayan parça sayısı
//   tag / text / key: element, Emir'in "Ekrandaki elementler" ağacındaki satırla aynı biçimde (dom-tree.js >
//     treeNode): "input#user-name" · alanın adı (değeri asla) · parmak izi anahtarı ("input:user-name")
//   path: DOM'daki yeri, dıştan içe adı olan üst elementler (["div#root", "form"])
//   rect: bozulan parçanın kutusu (element; metinse yalnızca o metin), ekran görüntüsünün gösterdiği alana göre
//     CSS pikseli { x, y, w, h } (bkz. shownView)
//   visible: kutunun ekran görüntüsünde görünen kısmı; yoksa null ve hidden nedenini söyler:
//     'above' | 'below' | 'left' | 'right' (görünen alanın dışında), 'clipped' (taşanı gizleyen bir kutunun
//     dışında), 'unrendered' (çizilmiyor)
//   note: parçaya özgü kısa bilgi (ör. ölçülen yazı boyutu "3 pt")
// Panel kutuyu viewport'a oranlayarak görüntüye çizer (sidepanel/monitor-locate.js). Sayfaya dokunulmaz: yalnızca
// ölçülür (çerçeve sayfaya çizilmez, görüntüye girmez).
// targets []: bozulan yer bir element değil (beklenen metin ekranda yok). targets null: yer bulunamadı.

// Yer bulma kararı etkilemez: hata verirse sonuç yine 'fail' kalır, yalnızca element bilgisi eksik olur.
function locate(find, total = undefined) {
  try {
    const found = find();
    return Array.isArray(found) ? located(found, total) : located(found.parts, found.total);
  } catch {
    return { targets: null, more: 0 };
  }
}

// Bozulan parçalar ({ el, edges, inner, note }) → sonuca yazılan hedefler. Önce ekran görüntüsünde görünenler
// (işaretlenebilenler), kendi içlerinde belge sırasıyla; en fazla MONITOR_PROBE_TARGETS tanesi yazılır.
function located(parts, total = parts.length) {
  const view = shownView();
  const placed = parts.map((part) => ({ ...part, ...visiblePart(part, view) }));
  const listed = [...placed.filter((p) => p.seen), ...placed.filter((p) => !p.seen)].slice(0, MONITOR_PROBE_TARGETS);
  return {
    targets: listed.map((p) => ({ ...describeElement(p.el), rect: viewBox(p.edges, view), visible: viewBox(p.seen, view), hidden: p.hidden, note: p.note })),
    more: Math.max(0, total - listed.length),
  };
}

// Ekran görüntüsünün gösterdiği alan, sayfanın koordinatlarında (getBoundingClientRect ile aynı). Normalde görünen
// alanın tamamıdır (kaydırma çubuğuyla: innerWidth × innerHeight); dokunmatik yakınlaştırmada (pinch) yalnızca
// yakınlaşılan kısmı. ratio: bir CSS pikselinin görüntüde kaç piksel ettiği (ekran ölçeği × tarayıcı yakınlaştırması
// × dokunmatik yakınlaştırma); panel görüntünün bu alanı gösterdiğini bununla doğrular.
function shownView() {
  const vv = globalThis.visualViewport;
  const scale = vv?.scale > 0 ? vv.scale : 1;
  const left = vv?.offsetLeft ?? 0;
  const top = vv?.offsetTop ?? 0;
  const width = innerWidth / scale;
  const height = innerHeight / scale;
  return { left, top, right: left + width, bottom: top + height, width, height, ratio: (devicePixelRatio || 1) * scale };
}

// Parça: elementin kendisi
function elementPart(el, note = '') {
  return { el, edges: edgesOf([el.getBoundingClientRect()]), inner: false, note };
}

// Parça: bir metin düğümünün [start, end) aralığı (elementin içindeki o metin; satır kırılmışsa kutuların birleşimi)
function textPart(node, start, end, note = '') {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return { el: node.parentElement, edges: edgesOf(range.getClientRects()), inner: true, note };
}

// Kutuların birleşimi { left, top, right, bottom }; çizilen kutu yoksa null
function edgesOf(rects) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const r of rects) {
    if (!(r.width > 0 && r.height > 0)) continue;
    left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
  }
  return left === Infinity ? null : { left, top, right, bottom };
}

// Sonuca yazılan kutu: ekran görüntüsünün gösterdiği alana göre { x, y, w, h } (0,1 px duyarlık)
function viewBox(edges, view) {
  if (!edges) return null;
  const round = (n) => Math.round(n * 10) / 10;
  return { x: round(edges.left - view.left), y: round(edges.top - view.top), w: round(edges.right - edges.left), h: round(edges.bottom - edges.top) };
}

// Kutunun ekran görüntüsünde görünen kısmı (seen): görüntünün gösterdiği alan ve taşanı gizleyen (ya da kaydırılan)
// üst kutularla kesişim. Kapalı bir menünün, carousel'in öbür slaytının ya da sayfanın aşağısındaki bir yazının kutusu
// görüntüde başka bir şeyin üstüne düşerdi; onlar işaretlenmez, nedeni yazılır.
// Sabit (fixed) kutu üst kutuların, mutlak (absolute) kutu konumlandırılmamış üst kutuların taşmasından
// kurtulur (dönüştürülmüş bir üst kutu ikisini de tutar). Üstü başka bir katmanla kapalı element ayırt edilmez.
function visiblePart({ el, edges, inner }, view) {
  if (!edges) return { seen: null, hidden: 'unrendered' };
  if (!inner && el.checkVisibility?.({ checkVisibilityCSS: true }) === false) return { seen: null, hidden: 'unrendered' }; // visibility: hidden: yeri var, kendisi yok
  const outside = edges.top >= view.bottom ? 'below' : edges.bottom <= view.top ? 'above' : edges.left >= view.right ? 'right' : edges.right <= view.left ? 'left' : null;
  if (outside) return { seen: null, hidden: outside };
  const part = { ...edges };
  let position = inner ? 'static' : getComputedStyle(el).position; // metin, elementinin kendi taşmasına da tabidir
  for (let p = inner ? el : el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const style = getComputedStyle(p);
    const holds = style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' || /paint|layout|strict|content/.test(style.contain ?? '');
    if (!holds && (position === 'fixed' || (position === 'absolute' && style.position === 'static'))) continue; // bu kutu onu kesmez
    const r = p.getBoundingClientRect();
    if (style.overflowX !== 'visible') { part.left = Math.max(part.left, r.left); part.right = Math.min(part.right, r.right); }
    if (style.overflowY !== 'visible') { part.top = Math.max(part.top, r.top); part.bottom = Math.min(part.bottom, r.bottom); }
    if (part.right <= part.left || part.bottom <= part.top) return { seen: null, hidden: 'clipped' };
    position = style.position;
  }
  const seen = { left: Math.max(part.left, view.left), top: Math.max(part.top, view.top), right: Math.min(part.right, view.right), bottom: Math.min(part.bottom, view.bottom) };
  if (seen.right <= seen.left || seen.bottom <= seen.top) return { seen: null, hidden: 'clipped' };
  return { seen, hidden: null };
}

// Elementin tanımı, "Ekrandaki elementler" ağacının satırıyla aynı biçimde (dom-tree.js > treeNode, tagText,
// rowText): kullanıcı aynı elementi iki yerde aynı adla görür.
function describeElement(el) {
  const typed = el.matches(INTERACTIVE); // fingerprint.js
  return { tag: tagLabel(el), text: rowLabel(el, typed), key: typed ? elementKey(el) : null, path: domPath(el) };
}

// "button#login-button", "div[role=dialog]", "h1"
function tagLabel(el) {
  const role = el.getAttribute('role');
  return (el.localName + (el.id ? '#' + el.id : '') + (role ? `[role=${role}]` : '')).slice(0, MONITOR_PROBE_TARGET_TEXT);
}

// Satırın metni: alanda alanın adı (değeri asla: şifre olabilir; contenteditable'ın içeriği de değerdir), görselde
// alt metni, etkileşimli elementte kullanıcının gördüğü ad, diğerlerinde elementin kendi metni.
function rowLabel(el, typed) {
  if (isFormField(el) || (el.isContentEditable && !el.matches('input, textarea, select'))) return fieldLabel(el);
  if (el.localName === 'img') return (el.alt ?? '').slice(0, MONITOR_PROBE_TARGET_TEXT);
  return typed ? visibleText(el) : ownText(el);
}

// Alanın adı: content.js > fieldName (kayıttaki aksiyon adlarıyla aynı); content.js'siz yüklendiyse (runner) sade hali
function fieldLabel(el) {
  if (typeof fieldName === 'function') return fieldName(el);
  return squeeze(el.getAttribute('aria-label') || el.placeholder || el.name || el.id || el.type || 'field').slice(0, 30);
}

function ownText(el) {
  let text = '';
  for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue;
  return squeeze(text).slice(0, MONITOR_PROBE_TARGET_TEXT);
}

// DOM'daki yeri: dıştan içe üst elementler (kendisi hariç). Adı olmayan sarmalayıcılar (id'siz, role'süz div /
// span) atlanır: React gibi sitelerde zincirin çoğu onlardır. En yakın MONITOR_PROBE_PATH üst element kalır.
function domPath(el) {
  const path = [];
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const role = p.getAttribute('role');
    if (p.id || (role && !/^(presentation|none|generic)$/.test(role)) || !/^(div|span)$/.test(p.localName)) path.unshift(tagLabel(p));
  }
  return path.slice(-MONITOR_PROBE_PATH);
}

// Görünen metinde bir aramanın (textSearch / regexSearch) tuttuğu yerler. Kontrol görünen metne (innerText) bakar;
// yer ise DOM'da aranır:
//   1) Çizilen metin düğümlerinde: tutan parça düğümün içinde tam yeriyle işaretlenir (yalnızca o sözcükler).
//   2) Düğme değerleri ve yer tutucular (kontrol onlara da bakıyorsa: search.fields): o alan.
//   3) Parça birden çok düğüme yayılmışsa (ör. cümlenin ortası <b> içinde): metni içeren en içteki element.
// Hiçbiri tutmazsa (metin sayfanın ayrı bölümlerine yayılmış) boş: tek bir yer gösterilemez.
function shownTextParts(search) {
  const parts = [];
  let total = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let walked = 0;
  for (let node = walker.nextNode(); node && walked < MONITOR_PROBE_WALK_NODES; node = walker.nextNode()) {
    walked++;
    if (node.nodeValue.length < search.minLength) continue;
    const { text, map } = squeezedWithMap(node.nodeValue, search.fold);
    const ranges = text ? joinAdjacent(search.ranges(text), text) : [];
    if (!ranges.length || !isRendered(node.parentElement)) continue;
    for (const [start, end] of ranges) {
      const part = textPart(node, map[start], map[end - 1] + 1);
      if (!part.edges) continue; // çizilmeyen metin (yazı boyutu 0 gibi)
      total++;
      if (parts.length < MONITOR_PROBE_LOCATE_SCAN) parts.push(part);
    }
  }
  if (parts.length) return { parts, total };
  if (search.fields) {
    for (const el of document.querySelectorAll(SHOWN_VALUE_FIELDS)) {
      if (isRendered(el) && search.test(shownValue(el))) parts.push(elementPart(el));
    }
    if (parts.length) return { parts, total: parts.length };
  }
  const el = deepestElement((e) => search.test(e.innerText ?? ''));
  return el ? { parts: [elementPart(el)], total: 1 } : { parts: [], total: 0 };
}

// Arama: görünen metinde neyin arandığı (kontrolün kendi karşılaştırmasıyla aynı).
//   ranges(text): bir düğümün boşlukları teklenmiş (fold ise harfleri katlanmış) metninde tutan aralıklar [[baş, son), …]
//   test(shown): bir elementin görünen metninde (innerText, düğme değeri) var mı
//   fields: düğme değerlerine ve yer tutuculara da bakılır mı; minLength: bundan kısa düğümde aranmaz

// Expected Text: aranan metin (boşlukları teklenmiş); fold: büyük/küçük harfe duyarsız
function textSearch(needle, fold) {
  const inNode = squeezedWithMap(needle, fold).text;   // düğümde harfler tek tek katlanır (yeri eşlemek için), aranan da öyle
  const inShown = fold ? foldText(needle) : needle;    // elementin metninde: kontroldeki karşılaştırmanın aynısı
  return {
    fold, fields: true, minLength: Math.max(1, inNode.length),
    ranges(text) {
      const found = [];
      for (let at = inNode ? text.indexOf(inNode) : -1; at >= 0 && found.length < MONITOR_PROBE_LOCATE_SCAN; at = text.indexOf(inNode, at + inNode.length)) found.push([at, at + inNode.length]);
      return found;
    },
    test: (shown) => Boolean(inShown) && (fold ? foldText(squeeze(shown)) : squeeze(shown)).includes(inShown),
  };
}

// Error Text: desenin tuttuğu her yer (kontrol ilk tutanı bildirir; ekrandaki bütün hata metinleri işaretlenir).
// Kontrol yalnızca görünen metne bakar: düğme değerleri ve yer tutucular aranmaz.
function regexSearch(re) {
  const all = new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'g');
  return {
    fold: false, fields: false, minLength: 1,
    ranges(text) {
      const found = [];
      all.lastIndex = 0;
      for (let match = all.exec(text); match && found.length < MONITOR_PROBE_LOCATE_SCAN; match = all.exec(text)) {
        if (match[0]) found.push([match.index, match.index + match[0].length]);
        else all.lastIndex++; // boş eşleşme: ilerle
      }
      return found;
    },
    test: (shown) => re.test(shown),
  };
}

// Art arda tutan parçalar (aralarında yalnızca boşluk / noktalama) tek parçadır: /404|not found/ için ekrandaki
// "404 Not Found" iki ayrı kutu değil, tek kutudur.
function joinAdjacent(ranges, text) {
  const joined = [];
  for (const [start, end] of ranges) {
    const last = joined[joined.length - 1];
    if (last && /^[\s\p{P}]*$/u.test(text.slice(last[1], start))) last[1] = end;
    else joined.push([start, end]);
  }
  return joined;
}

// Metnin boşlukları teklenmiş (ve istenirse harfleri katlanmış) hali ile her karakterinin asıl metindeki yeri
// (map). Arama görünen metindeki gibi yapılır (innerText boşlukları tekler), bulunan parça asıl düğümde
// işaretlenir. Katlama karakter sayısını değiştirebildiği için ("İ" → "i") karakter karakter yapılır.
function squeezedWithMap(raw, fold = false) {
  let text = '';
  const map = [];
  let gap = -1; // bekleyen boşluğun yeri; baştaki ve sondaki boşluk yazılmaz
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (isSpace(ch)) {
      if (text && gap < 0) gap = i;
      continue;
    }
    const out = fold ? foldChar(ch) : ch;
    if (!out) continue; // katlamada silinen karakter (birleşik nokta)
    if (gap >= 0) { text += ' '; map.push(gap); gap = -1; }
    for (let k = 0; k < out.length; k++) { text += out[k]; map.push(i); }
  }
  return { text, map };
}

// squeeze'in boşluk saydığı karakter mi (sık geçenler düzenli ifadeye sorulmaz)
function isSpace(ch) {
  return ch === ' ' || ch === '\n' || ch === '\t' || (ch > '~' ? /\s/.test(ch) : ch === '\r' || ch === '\f' || ch === '\v');
}

// foldText'in tek karakterlik hali; sonuçlar saklanır (uzun sayfada aynı harfler tekrar tekrar katlanmasın)
const FOLDED_CHARS = new Map();
function foldChar(ch) {
  let out = FOLDED_CHARS.get(ch);
  if (out === undefined) {
    out = foldText(ch);
    if (FOLDED_CHARS.size < 4096) FOLDED_CHARS.set(ch, out);
  }
  return out;
}

// test'i sağlayan en içteki çizilen element: body'den aşağı, test'i sağlayan ilk çocuğa inilir. body'nin
// kendisinde kalınırsa (parça ayrı bölümlere yayılmış) null. innerText pahalıdır: bakılan element sayısı sınırlı.
function deepestElement(test) {
  let el = document.body;
  if (!el || !test(el)) return null;
  let budget = MONITOR_PROBE_DESCEND;
  for (let next = el; next;) {
    el = next;
    next = null;
    for (const child of el.children) {
      if (--budget < 0) break;
      if (isRendered(child) && test(child)) { next = child; break; }
    }
  }
  return el === document.body ? null : el;
}


// -----------------------------------------------------------------------------
// AKSİYONUN ELEMENTİ (MONITOR_KEEP / MONITOR_LOCATE)
// -----------------------------------------------------------------------------
// Ekrana bakmayan monitörlerde (JavaScript Error, Action Timeout) bozulan bir element yoktur; uyarıda ilgili
// aksiyonun elementi gösterilir (hatanın oluştuğu tıklamanın düğmesi, uzun süren aksiyonun alanı). Element,
// aksiyon oynatılmadan ÖNCE bulunup akılda tutulur ve monitör bozulunca yeri o elementten ölçülür. Aksiyondan
// sonra kayıttaki hedefle yeniden aramak yanlış elementi bulabilirdi: hedef "bu türün ekrandaki n'incisi"dir;
// tıklanan "Sepete ekle" düğmesi "Çıkar" olunca "1. Sepete ekle" artık bir sonraki ürünün düğmesidir.
// Element oynatmanın bulduğu kuralla aranır (content.js > replayElement: önce kayıttaki hedef, yoksa CSS
// selector); content.js'siz yüklendiyse (runner) aynı sıra burada. Sayfa değişirse bu liste de (sayfayla
// birlikte) gider: eski sayfanın elementi yeni ekranda zaten yoktur.
const keptElements = new Map(); // id -> element (panelin verdiği id: koşu + adım + aksiyon)

function keepActionElement(id, ref) {
  const el = actionElement(ref?.target ?? null, ref?.selector ?? null);
  if (!el) return { kept: false };
  while (keptElements.size >= MONITOR_PROBE_KEPT) keptElements.delete(keptElements.keys().next().value);
  keptElements.set(String(id), el);
  return { kept: true };
}

function locateKeptElement(id) {
  const view = shownView();
  const viewport = { width: view.width, height: view.height, ratio: view.ratio };
  const el = keptElements.get(String(id));
  return { viewport, ...(el?.isConnected ? locate(() => [elementPart(el)]) : { targets: [], more: 0 }) };
}

function actionElement(target, selector) {
  if (typeof replayElement === 'function') return replayElement(target, selector)?.el ?? null;
  const el = target?.index ? targetElement(target) : null; // fingerprint.js
  if (el || !selector) return el;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

globalThis.monitorProbe = monitorProbe;

// Panelden gelen istek (content script olarak yüklendiğinde). content.js'in dinleyicisi bu türleri
// tanımaz; başka türlere burada cevap verilmez.
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return undefined; // yalnızca bu eklentinin paneli
    if (message?.type === 'MONITOR_KEEP' || message?.type === 'MONITOR_LOCATE') {
      try {
        sendResponse(message.type === 'MONITOR_KEEP' ? keepActionElement(message.id, message.ref) : locateKeptElement(message.id));
      } catch (error) {
        sendResponse({ error: error.message });
      }
      return undefined;
    }
    if (message?.type !== 'MONITOR_PROBE') return undefined;
    monitorProbe(message.checks).then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true; // cevap asenkron
  });
}
})();
