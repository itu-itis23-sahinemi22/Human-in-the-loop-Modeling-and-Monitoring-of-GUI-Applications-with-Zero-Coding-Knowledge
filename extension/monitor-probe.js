// =============================================================================
// monitor-probe.js — MONİTÖR KONTROLÜ, SAYFADA ÇALIŞAN KISIM (run-time monitoring, Ceren'in kısmı)
// -----------------------------------------------------------------------------
// Monitörler sayfanın kendisine bakar: bir alanın değeri, görünen metin, yazı boyutları… Bu dosya
// content script olarak her sayfaya yüklenir (manifest.json > content_scripts > js, content.js'ten
// sonra) ve panelden gelen kontrol listesini sayfada değerlendirir:
//   panel → { type: 'MONITOR_PROBE', checks: [{ id, type, params }] }
//   sayfa → { url, title, results: { [id]: { status: 'ok' | 'fail' | 'skip', text } } }
// 'ok' kural sağlandı, 'fail' bozuldu, 'skip' bu sayfada kontrol edilemedi (alan yok, desen
// geçersiz…). text: kullanıcıya gösterilen kısa açıklama (bozulduysa neyin, nerede).
//
// fingerprint.js ile aynı dünyada çalışır; onun tanımlarını kullanır (interactableElements,
// elementKey): "input:phone" gibi anahtarlar kayıttakiyle aynı anlama gelir. Element seçimi
// (resolveElements): önce parmak izi anahtarı ("input:phone", kayıttaki elementlerden seçilen),
// uymazsa CSS selector ("#phone").
// Aynı dünyada content.js de olduğu için bu dosyanın tamamı bir kapanış (IIFE) içindedir: buradaki
// yardımcı adlar (ör. fieldValue) content.js'in aynı adlı fonksiyonlarını ezmesin. Dışarıya yalnızca
// globalThis.monitorProbe verilir (runner da aynı dosyayı sayfaya verip çağırabilir).
//
// Türlerin tanımı: sidepanel/monitor-types.js; yeni bir türün kontrolü MONITOR_PROBES'a aynı id ile
// eklenir. Detay: docs/07-monitorler.md
// =============================================================================

(() => {
const MONITOR_PROBE_TEXT_NODES = 5000; // yazı boyutu kontrolünde en fazla bu kadar metin parçasına bakılır

// Kontrol listesini değerlendirir; her kontrolün sonucu id'siyle döner. Bir kontrolün hatası
// diğerlerini etkilemez (sonucu 'skip' olur).
async function monitorProbe(checks) {
  const results = {};
  for (const check of Array.isArray(checks) ? checks : []) {
    try {
      const evaluate = MONITOR_PROBES[check.type];
      results[check.id] = evaluate ? await evaluate(check.params ?? {}) : probeSkip('bu tür sayfada kontrol edilmiyor');
    } catch (error) {
      results[check.id] = probeSkip(`kontrol edilemedi: ${error.message}`);
    }
  }
  return { url: location.href, title: document.title, results };
}

const probeOk = (text) => ({ status: 'ok', text });
const probeFail = (text) => ({ status: 'fail', text });
const probeSkip = (text) => ({ status: 'skip', text });

// Tür -> değerlendirici (params) => sonuç. Anahtarlar monitor-types.js'teki tür id'leridir.
const MONITOR_PROBES = {
  // Alanın değeri desene uymalı (aksiyon tabanlı: yazmadan hemen sonra kontrol edilir)
  inputValidation({ selector, pattern, mode, whenEmpty }) {
    const re = probeRegex(pattern);
    if (!re) return probeSkip('desen geçersiz');
    const el = resolveElements(selector).find((e) => isFieldLike(e)) ?? null;
    if (!el) return probeSkip(`alan ekranda yok (${selector})`);
    const value = fieldValue(el);
    if (value === '' && whenEmpty !== 'check') return probeSkip('alan boş, kontrol edilmedi');
    const matched = re.test(value);
    const shown = el.type === 'password' ? '******' : JSON.stringify(value.length > 40 ? value.slice(0, 40) + '…' : value);
    const ok = mode === 'notMatch' ? !matched : matched;
    return ok ? probeOk(`değer ${shown} kurala uyuyor`) : probeFail(`değer ${shown} ${mode === 'notMatch' ? 'desene uyuyor (uymamalıydı)' : 'desene uymuyor'}`);
  },

  // Ekranda hata metni geçmemeli (görünen metin: document.body.innerText)
  errorText({ pattern }) {
    const re = probeRegex(pattern, 'i');
    if (!re) return probeSkip('desen geçersiz');
    const body = document.body?.innerText ?? '';
    const match = re.exec(body);
    if (!match) return probeOk('hata metni yok');
    const from = Math.max(0, match.index - 25);
    const context = body.slice(from, match.index + match[0].length + 25).replace(/\s+/g, ' ').trim();
    return probeFail(`hata metni bulundu: "${match[0]}" (…${context}…)`);
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
    let smallest = Infinity;
    const range = document.createRange();
    for (let node = walker.nextNode(); node && seen < MONITOR_PROBE_TEXT_NODES; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!isRendered(el)) continue;
      range.selectNodeContents(node);
      if (![...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0)) continue; // çizilmeyen metin
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(px) || px <= 0) continue;
      seen++;
      smallest = Math.min(smallest, px);
      if (px < limitPx - 0.01) small.push(`"${node.nodeValue.trim().slice(0, 25)}" ${format(px)}`);
    }
    if (!seen) return probeSkip('sayfada görünen metin yok');
    if (small.length) return probeFail(`${small.length} metin ${min} ${unit}'den küçük: ${listOf(small)}`);
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

function trimNumber(n) {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

globalThis.monitorProbe = monitorProbe;

// Panelden gelen istek (content script olarak yüklendiğinde). content.js'in dinleyicisi bu türü
// tanımaz; başka türlere burada cevap verilmez.
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'MONITOR_PROBE') return undefined;
    monitorProbe(message.checks).then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true; // cevap asenkron
  });
}
})();
