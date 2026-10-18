// =============================================================================
// actions.js — AKSİYONLARI TEKRAR OYNATMAK
// -----------------------------------------------------------------------------
// Edge'in kaydedilen tarayıcı aksiyonları (properties.uiActions) Playwright ile tekrar
// oynatılır. Her tipin karşılığı: docs/04-veri-modeli.md > Aksiyon.
// Element önce kayıttaki düzeyde aranır: "bu türün ekrandaki n'incisi" (target,
// fingerprint.js > targetElement). Bulunamazsa kayıttaki CSS selector kullanılır.
// =============================================================================

import { urlKey } from './state.js';

// run: { timeout, secrets, viewport, setViewport(viewport), warn(text), context, pages, page,
//        track(page), activate(page), forget(page) } (bkz. run.js > createRun)
export async function playAction(page, action, run) {
  switch (action.type) {
    case 'click': return (await elementOf(page, action, run)).click({ timeout: run.timeout });
    case 'contextmenu': return (await elementOf(page, action, run)).click({ button: 'right', timeout: run.timeout });
    case 'hover': return (await elementOf(page, action, run)).hover({ timeout: run.timeout });
    case 'focus': return (await elementOf(page, action, run)).focus();
    case 'input': return fill(await elementOf(page, action, run), valueOf(action, run.secrets), run);
    case 'enter': return (await elementOf(page, action, run)).press('Enter', { timeout: run.timeout });
    case 'key': return pressKey(page, action, run);
    case 'scroll': return scroll(page, action);
    case 'navigate': return page.goto(action.url);
    case 'history': return history(page, action);
    case 'reload': return page.reload();
    case 'resize': return run.setViewport({ ...run.viewport, ...action.viewport });
    case 'zoom': return run.setViewport(action.viewport ?? zoomed(run.viewport, action));
    // Kayıttaki bekleme. Ekranı değiştiren bekleme (oturum zaman aşımı) biraz geç sonuçlansa
    // da doğrulamadaki tekrar deneme onu yakalar.
    case 'wait': return page.waitForTimeout(action.ms);
    case 'tab': return tab(action, run);
    default: throw new Error(`"${action.type}" aksiyonu runner'da henüz desteklenmiyor.`);
  }
}

// Aksiyonun elementi. Element sayfa durulduktan sonra da gelebilir: hedef ve selector
// timeout boyunca tekrar denenir. Hedef bulunamayıp selector'la bulunursa uyarı verilir:
// kayıttaki düzeyde aynı element olmayabilir.
async function elementOf(page, action, { timeout, warn }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (action.target?.index) {
      const element = await targetElement(page, action.target);
      if (element) return element;
    }
    if (action.selector) {
      const locator = page.locator(action.selector).first();
      if (await locator.isVisible().catch(() => false)) {
        if (action.target?.index) warn(`"${action.label}": hedef (${action.target.key} #${action.target.index}) ekranda yok, selector kullanıldı (${action.selector}).`);
        return locator;
      }
    }
    if (Date.now() > deadline) {
      const target = action.target ? `${action.target.key} #${action.target.index}` : 'hedef yok';
      throw new Error(`"${action.label}" elementi bulunamadı (${target}, selector: ${action.selector ?? 'yok'}).`);
    }
    await page.waitForTimeout(200);
  }
}

async function targetElement(page, target) {
  try {
    const handle = await page.evaluateHandle((target) => window.__graphRecorder?.targetElement(target) ?? null, target);
    const element = handle.asElement();
    if (!element) await handle.dispose();
    return element;
  } catch (error) {
    if (/Execution context was destroyed|Cannot find context/.test(error.message)) return null; // sayfa değişiyor
    throw error;
  }
}

// Şifre alanları kayıtta "******" olarak saklanır (content.js > MASK_PASSWORDS). Gerçek değer
// secrets dosyasından gelir: { "input:password": "..." }; anahtar hedefin türü ya da selector.
function valueOf(action, secrets) {
  if (action.value !== '******') return action.value;
  const secret = secrets[action.target?.key] ?? secrets[action.selector];
  if (secret === undefined) {
    throw new Error(`"${action.label}" değeri maskeli (******). Gerçek değeri --secrets dosyasında "${action.target?.key ?? action.selector}" anahtarıyla verin.`);
  }
  return secret;
}

// Kayıttaki değer alanın türüne göre: metin (fill), açılır liste (seçenek değeri), checkbox /
// radio (işaretli mi). Zengin metin editörüne (contenteditable) de fill yazar.
async function fill(element, value, { timeout }) {
  const kind = await element.evaluate((el) => (el.tagName === 'SELECT' ? 'select' : el.type === 'checkbox' || el.type === 'radio' ? 'check' : 'fill'));
  if (kind === 'select') return element.selectOption(String(value), { timeout });
  if (kind === 'check') return element.setChecked(Boolean(value), { timeout });
  return element.fill(String(value), { timeout });
}

// Tuş, kayıttaki gibi Playwright biçimindedir ("Escape", "Control+Enter"); count kez basılır.
// Hedef yoksa (odakta bir element yoktu) sayfaya basılır.
async function pressKey(page, action, run) {
  const element = action.target || action.selector ? await elementOf(page, action, run) : null;
  for (let i = 0; i < (action.count ?? 1); i++) {
    if (element) await element.press(action.key, { timeout: run.timeout });
    else await page.keyboard.press(action.key);
  }
}

// Kayıt kaydırmanın vardığı konumu saklar; konum mutlak olduğu için doğrudan oraya gidilir.
// 'instant': sayfa yumuşak kaydırma kullansa da konum hemen varılır.
async function scroll(page, { selector, x, y }) {
  const to = { left: x, top: y, behavior: 'instant' };
  if (selector) await page.locator(selector).first().evaluate((box, to) => box.scrollTo(to), to);
  else await page.evaluate((to) => window.scrollTo(to), to);
}

// Geri/İleri: kayıt yönü bilmez (ikisi de "Back" etiketlidir), varılan adresi bilir. Önce
// geri gidilir; adres tutmazsa ileri denenir, o da tutmazsa adrese doğrudan gidilir.
async function history(page, { url }) {
  await page.goBack();
  if (page.url() === url) return;
  await page.goForward(); // geri gidilen adım
  await page.goForward();
  if (page.url() !== url) await page.goto(url);
}

// Eski kayıtlarda yakınlaştırmanın vardığı boyut yoktur: oranlardan hesaplanır. Yakınlaştırma
// CSS piksel boyutunu oranla küçültür, piksel oranını aynı oranla büyütür.
function zoomed({ width, height, devicePixelRatio }, { zoom, fromZoom }) {
  const scale = zoom / fromZoom;
  return { width: Math.floor(width / scale), height: Math.floor(height / scale), devicePixelRatio: devicePixelRatio * scale };
}


// -----------------------------------------------------------------------------
// SEKMELER: kayıttaki sekme geçişleri (open / switch / close)
// -----------------------------------------------------------------------------
// Sekme sıra numarasıyla değil adresiyle (URL şablonu) bulunur: GraphWalker'ın yolu edge'leri
// kayıttaki sırayla yürümeyebilir; aynı sekmeyi açan edge iki kez geçilirse sıra numaraları
// kayardı. Aynı adreste birden fazla sekme varsa en son kullanılan seçilir.
async function tab(action, run) {
  if (action.operation === 'open') return openTab(action, run);
  if (action.operation === 'switch') {
    if (sameAddress(run.page.url(), action.url)) return; // aktif sekme kapanınca zaten buraya gelindi
    return run.activate(otherTab(action, run));
  }
  // Kapanış: aktif sekme kapandıysa Chrome'daki gibi en son kullanılan sekme öne gelir; kayıtta
  // ardından gelen 'switch' gerekirse düzeltir.
  const page = action.active ? run.page : otherTab(action, run);
  await page.close();
  run.forget(page);
  if (action.active) await run.activate(run.pages.at(-1));
}

// Sayfanın açtığı sekme (link, popup) önceki aksiyonla açılmıştır: henüz izlenmeyen sayfa ya da
// gelecek ilk sayfa. Kullanıcının açtığı sekme yeni bir sayfadır; kayıttaki adrese gidilir
// (boş sekmeyse adresi sonraki 'navigate' aksiyonu getirir).
async function openTab({ by, url }, run) {
  let page;
  if (by === 'page') {
    page = run.context.pages().find((p) => !run.pages.includes(p)) ?? await run.context.waitForEvent('page', { timeout: run.timeout });
  } else {
    page = await run.context.newPage();
    if (/^https?:/.test(url)) await page.goto(url);
  }
  await run.track(page);
  await run.activate(page);
}

// Aktif olmayan sekmelerden adresi tutan, en son kullanılan. Adres tutmuyor ama tek bir başka
// sekme varsa o (sayfa kendi içinde gezinmiş olabilir).
function otherTab(action, run) {
  const others = run.pages.filter((p) => p !== run.page);
  const page = others.filter((p) => sameAddress(p.url(), action.url)).at(-1) ?? (others.length === 1 ? others[0] : null);
  if (!page) throw new Error(`"${action.label}": ${action.url} adresinde açık bir sekme yok.`);
  return page;
}

function sameAddress(a, b) {
  try {
    return urlKey(a) === urlKey(b);
  } catch {
    return a === b;
  }
}

