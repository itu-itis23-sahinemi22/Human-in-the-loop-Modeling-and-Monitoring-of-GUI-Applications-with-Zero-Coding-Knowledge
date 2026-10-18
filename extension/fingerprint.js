// =============================================================================
// fingerprint.js — PARMAK İZİ (kayıt ve test ortak kullanır)
// -----------------------------------------------------------------------------
// Bir ekranın state'ini tanımlayan kod: ekranda kaydırmadan tıklanabilen etkileşimli
// elementlerin türleri ve sayıları, aksiyon hedefinin "bu türün ekrandaki n'incisi" olarak
// tutulması ve sayfanın görünen alanı. Kayıt ile test AYNI tanımı kullansın diye ayrı
// dosyadadır ve iki yerde yüklenir:
//   eklenti : manifest.json > content_scripts > js (settings.js'ten sonra, content.js'ten önce)
//   runner  : test edilen her sayfaya (runner/lib/page.js > INIT_SCRIPT)
// Panelde oynatma da sayfayı content.js üzerinden aynı fonksiyonlarla okur.
// settings.js'teki INTERACTABLE_TYPES'a dayanır. Bu dosya olay dinlemez, mesaj göndermez;
// yalnızca tanımlar. Algoritmanın detayı: docs/03-state-eslestirme.md
// =============================================================================

// Etkileşimli (tıklanabilir / doldurulabilir) olabilecek elementler: settings.js'teki TÜM
// türler. Bir elementin o an gerçekten etkileşimli sayılması için ayrıca devre dışı
// olmaması ve ekranda, kaydırmadan tıklanabilmesi gerekir: bkz. isInteractable().
// Hangi türlerin state'e gireceğini panelin Ayarlar bölümü belirler; o filtreyi
// background.js uygular (bkz. fingerprint).
const INTERACTIVE = INTERACTABLE_TYPES.map((t) => t.selector).join(', ');

// Sayfanın durulması: SETTLE_QUIET_MS boyunca DOM'un değişmemesi ve animasyonların bitmesi;
// sürekli değişen sayfada en fazla SETTLE_MAX_MS beklenir. Kayıt aksiyonun sonrasını
// (content.js > reportScreenWhenSettled), tekrar oynatma (runner ve panel) varılan ekranı bu
// sürelerle bekler (settled).
const SETTLE_QUIET_MS = 300;
const SETTLE_MAX_MS = 3000;

// Sayfa durulunca çözülen Promise (tekrar oynatırken her aksiyondan sonra beklenir).
function settled() {
  return new Promise((resolve) => {
    const observer = new MutationObserver(restart);
    const max = setTimeout(done, SETTLE_MAX_MS);
    let quiet = null;
    function restart() {
      clearTimeout(quiet);
      quiet = setTimeout(done, SETTLE_QUIET_MS);
    }
    function done() {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(max);
      document.removeEventListener('transitionend', restart, true);
      document.removeEventListener('animationend', restart, true);
      resolve();
    }
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    document.addEventListener('transitionend', restart, true);
    document.addEventListener('animationend', restart, true);
    restart();
  });
}

// Ekranda tıklanabilen elementlerin SAYILI kümesi (multiset): her anahtar, uyduğu
// etkileşimli türler ve ekranda kaç tane olduğu:
//   [{ key: "button:Sil", types: ["button"], count: 5 }, { key: "input:user-name", types: ["input"], count: 1 }]
// Küme değil sayılı küme: her element olası bir edge'dir; aynı butondan 5 tane olan ekran
// ile 4 tane olan ekranın edge set'i farklıdır. Türler, Ayarlar filtresi için saklanır;
// hangilerinin state'e gireceğine background karar verir (ayar sonradan değişse de eski
// node'lar yeni seçimle karşılaştırılabilir).
// viewport: kümenin alındığı görünen alan (CSS piksel) ve piksel oranı. Küme bu alana bağlıdır;
// test aynı boyutta çalıştırılır (docs/03 > Pencere boyutu ve state).
function fingerprint() {
  return { url: location.href, title: document.title, elements: countElements(interactableElements()), viewport: currentViewport() };
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

// targetOf'un tersi: hedefin şu anki ekrandaki elementi, yoksa null. Runner aksiyonu
// tekrar oynatırken elementi bununla bulur.
function targetElement({ key, index }) {
  if (!index) return null;
  return interactableElements().filter((el) => elementKey(el) === key)[index - 1] ?? null;
}

// Sayfanın görünen alanı: CSS piksel boyutu ve piksel oranı (yakınlaştırmayı da içerir).
function currentViewport() {
  return { width: innerWidth, height: innerHeight, devicePixelRatio };
}

// Metin girilen / seçim yapılan alanlar. Butonlar (submit, button...) bu gruba girmez.
function isFormField(el) {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !['button', 'submit', 'reset', 'image'].includes(el.type);
  return false;
}

// Kullanıcının gördüğü isim: "Login", "Add to cart" gibi. Hem kimliksiz elementin türüne
// (functionText) hem de aksiyon ve edge isimlerine (content.js) girer.
function visibleText(el) {
  const text = el.getAttribute('aria-label') || el.innerText || el.value
    || el.getAttribute('title') || el.querySelector?.('img[alt]')?.alt || '';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 40);
}
