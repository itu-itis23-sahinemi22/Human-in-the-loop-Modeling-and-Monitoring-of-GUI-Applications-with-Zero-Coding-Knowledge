# 08 — Site verileri: oynatmadan önce temizlik

Panelde **Koşuyu oynat**'a basınca önce bir temizlik penceresi açılır. Pencere, senaryonun ziyaret ettiği her siteyi ve o sitenin tarayıcıda bıraktığı, silinebilecek verileri listeler. Bu doküman şu soruların rehberidir:
- Bu veriler nedir?
- Siteler bunları ne için kullanır?
- Silinince ne olur?
- Hangi test için hangisi seçilmelidir?
- Arka planda nasıl siliniyor?
- Başka araçlar aynı işi nasıl yapıyor?

## İçindekiler

- [Neden temizlik?](#neden-temizlik)
- [Pencere nasıl kullanılır?](#pencere-nasıl-kullanılır)
- [Silinebilecek veriler](#silinebilecek-veriler)
- [Ne zaman neyi seçmeli?](#ne-zaman-neyi-seçmeli)
- [Nasıl çalışıyor?](#nasıl-çalışıyor)
- [Silinmeyenler ve sınırlar](#silinmeyenler-ve-sınırlar)
- [Başka araçlar nasıl yapıyor?](#başka-araçlar-nasıl-yapıyor)
- [Kaynaklar](#kaynaklar)

---

## Neden temizlik?

Panelde oynatma senaryoyu **kullanıcının kendi tarayıcısında** oynatır ([01 > Panelde oynatma](01-mimari.md#panelde-oynatma)). Siteler ise ziyaretçiyi tarayıcıda bıraktıkları verilerle hatırlar: giriş yapılmış oturum, dolu sepet, kapatılmış çerez uyarısı, yarım kalmış form. Kayıttan ya da önceki oynatmadan kalan bu veriler, bir sonraki oynatmanın başlangıcını değiştirir.

Örnek: saucedemo'da giriş akışını kaydettiniz. Tarayıcı artık oturum çerezini taşıyor. Senaryoyu yeniden oynatmak istediğinizde site sizi giriş sayfası yerine doğrudan ürün listesine götürür. Başlangıç ekranı tutmaz ve panel *"Başlangıç node'ları aynı değil"* der.

**Runner'da bu sorun yoktur.** Runner her koşuyu yeni ve boş bir tarayıcı bağlamında başlatır: çerez, önbellek ve depolama sıfırdır ([runner/README.md](../runner/README.md)). Temizlik penceresi aynı temiz başlangıcı panelde, kullanıcının seçtiği kadarıyla kurar.

## Pencere nasıl kullanılır?

```
Oynatmadan önce temizlik · "Giriş akışı"
▣ https://www.saucedemo.com  (başlangıç)
    ☑ Çerezler                        ☑ localStorage ve sessionStorage
    ☐ Önbellek (HTTP)                 ☐ IndexedDB
    ☐ Cache Storage                   ☐ Service worker'lar
    ☐ Dosya sistemi
☐ https://docs.example.com
    ☐ Çerezler …                      (aynı liste)
[Temizle ve oynat]  [Temizlemeden oynat]  [Vazgeç]
```

- **Siteler:** Senaryonun graph'ındaki node'ların adreslerinden gelir. Her biri bir **origin**dir, yani şema + alan adı + port: `https://www.saucedemo.com`, `http://127.0.0.1:8765`. Başlangıç node'unun sitesi en üsttedir. Koşu birden fazla siteye gidiyorsa hepsi listelenir. Her sitede aynı yedi tür vardır.
- **Site kutusu:** Altındaki türlerin hepsini birlikte işaretler ya da kaldırır. Bazıları seçiliyse yarım görünür (yukarıda ▣).
- **Açıklamalar:** Bir türün üzerine gelince ne olduğu kısaca yazar.
- **Kaydetme:** Seçim **senaryoya kaydedilir** (`scenario.cleanup`). Pencere bir dahaki sefere aynı seçimle açılır. İlk açılışta hiçbir şey seçili değildir, çünkü silmek geri alınamaz. Seçim senaryo dosyasına ve graph yedeğine de girer ([04 > Senaryo dosyası](04-veri-modeli.md#senaryo-dosyası)).
- **Temizle ve oynat:**
  1. Seçili veriler yalnızca o siteler için silinir.
  2. Sekme başlangıç node'unun adresine gider. Silinen veri ancak sayfa yeniden yüklenince etkisini gösterir: açık sayfa eski verileri bellekte tutuyordur.
  3. Her zamanki başlangıç kontrolü yapılır.
  - Site başka bir adrese yönlendirirse (ör. başlangıç node'u giriş isterken çerezler silindiyse) başlangıç kontrolü bunu söyler.
  - Başlangıç adresine gidiş, kayıt sekmesindeyse "Git" aksiyonu olarak kaydedilir; "Başlangıç node'una dön"de de böyledir. Oynatma başlayınca bekleyen aksiyonlar zaten silinir.
- **Temizlemeden oynat:** Hiçbir şey silinmez, doğrudan başlangıç kontrolüne geçilir. Bu da seçimi kaydeder.
- **Vazgeç** (ya da ✕, Esc): Oynatma başlamaz, seçimdeki değişiklikler kaydedilmez.

## Silinebilecek veriler

| Veri | Ne? | Siteler ne için kullanır? | Silinince | Kapsam |
|---|---|---|---|---|
| **Çerezler** | Her istekte siteye geri gönderilen küçük anahtar-değer kayıtları | Oturum (giriş), sepet, dil / tema tercihi, çerez onayı | O sitedeki oturumunuz **kapanır** (bu tarayıcının tüm sekmelerinde); çerez uyarıları geri gelir | Sitenin **alan adının tamamı**: `*.saucedemo.com`, tüm alt alan adları ve portlar |
| **Önbellek (HTTP)** | Tarayıcının indirip sakladığı dosyalar: HTML, CSS, JavaScript, resim | Hız: aynı dosya yeniden indirilmez | İlk açılış yavaşlar; sitenin davranışı değişmez | Origin |
| **Cache Storage** | Sitenin kendi kodunun yönettiği yanıt önbellekleri (Cache API) | Çevrimdışı çalışan uygulamalar (PWA), service worker önbelleği | Site içeriği yeniden indirir; çevrimdışı çalışma bir süre olmaz | Origin |
| **localStorage ve sessionStorage** | Sitenin anahtar-değer depoları (genelde birkaç MB). localStorage kalıcıdır; sessionStorage o sekmeye aittir, sekme kapanınca silinir. Chrome ikisini **birlikte** siler | localStorage: tema, dil, sepet, "tanıtım turu gösterildi" bayrağı, bazı tek sayfalı uygulamalarda oturum anahtarı (token). sessionStorage: çok adımlı form ilerlemesi, sihirbaz adımı, bazı giriş akışları | Site sizi "ilk kez gelen" gibi görür; token buradaysa oturum kapanır; yarım formlar sıfırlanır | Origin; sessionStorage sitenin **açık bütün sekmelerinde** silinir |
| **IndexedDB** | Tarayıcıdaki veritabanı: büyük, yapılı veri | Çevrimdışı uygulamalar, API verisi önbelleği; bazı kimlik doğrulama kütüphaneleri oturumu burada tutar (ör. Firebase Authentication) | Uygulamanın yerel verisi gider; oturum buradaysa kapanır | Origin |
| **Service worker'lar** | Sitenin arka planda çalışan betiği: istekleri araya girip yanıtlayabilir, bildirim gönderebilir | Çevrimdışı çalışma, önbellekten hızlı açılış, anlık bildirimler | Kaydı silinir; site bir sonraki açılışta yeniden kurar. Eski sürümü sunan worker gider | Origin |
| **Dosya sistemi** | Sitenin tarayıcıdaki özel dosya alanı (File System API) | Nadir: tarayıcıda çalışan editörler, büyük dosya işleyen uygulamalar | Sitenin bu alandaki dosyaları gider | Origin |

### Çerezler

- Sunucu `Set-Cookie` başlığıyla ya da sayfanın kodu `document.cookie` ile yazar. Tarayıcı, siteye giden her istekte çerezi geri gönderir. Sunucu sizi böyle tanır.
- `HttpOnly` çerezler sayfanın kodundan görünmez ama silinir; oturum çerezleri genelde böyledir.
- **Alan adının tamamı:** Chrome çerezleri site değil, kayıtlı alan adı bazında siler. `www.saucedemo.com` için çerez silmek `*.saucedemo.com` altındaki bütün çerezleri siler. Yerel adreste (`127.0.0.1`) aynı adresin bütün portlarını kapsar.
- **Dikkat (çerez onayı):** Birçok site "çerezleri kabul et" bandını kapattığınızı çerezde tutar. Kayıt bandı kapalıyken yapıldıysa ve çerezler silinirse, band geri gelir. Ekranın etkileşimli elementleri değişir, başlangıç tutmaz. Ya kaydı temiz bir başlangıçtan yapın (band açıkken), ya da çerezleri silmeyin.

### Önbellek (HTTP)

- Tarayıcının indirdiği dosyaların kopyalarıdır. Sitenin "aklında tuttuğu" bir şey değildir, yalnızca hız içindir.
- Sitenin davranışını nadiren değiştirir. Silmek iki durumda anlamlıdır:
  - Site yeni bir sürüme geçtiği halde eski JavaScript ya da CSS önbellekten geliyorsa.
  - Sayfanın ilk ziyaretteki halini görmek istiyorsanız.

### Cache Storage

- HTTP önbelleğinden ayrı, sitenin kendi kodunun açıp yönettiği önbellektir (Cache API). Genelde bir service worker'la birlikte kullanılır.
- PWA'larda eski içerik görünüyorsa **Service worker'lar** ile birlikte silinmelidir.

### localStorage ve sessionStorage

- **localStorage** tarayıcı kapansa da kalır, siteden siteye ayrıdır. Siteye gönderilmez; yalnızca sayfanın kodu okur. Tek sayfalı uygulamalar (React, Vue, Angular) oturum anahtarını sıkça burada tutar. Böyle bir sitede yalnızca çerezleri silmek oturumu kapatmaz.
- **sessionStorage** sekmeye bağlıdır: sayfayı yenilemek ve aynı sekmede gezinmek onu silmez, sekmeyi kapatmak siler. Başka sekmeler onu görmez.
- **Neden tek seçenek?** Chrome bir sitenin localStorage'ını silerken o sitenin sessionStorage'ını da siler, hem de açık bütün sekmelerinde. Chromium'un kaynak kodunda localStorage'ı silen kısım sessionStorage'ı silen işlevi de çağırır (`StoragePartitionImpl::DataDeletionHelper::ClearData` > `ClearSessionStorage`); `site-data` testi de bunu doğruladı. İkisi ayrı seçenek olsaydı, yalnızca localStorage seçildiğinde de sessionStorage silinirdi. DevTools'ta da ikisi tek seçenektir: "Local and session storage".
- **Dikkat:** Aynı sitenin başka bir sekmede açık sayfası varsa, oradaki yarım işler de (form, sihirbaz adımı) sıfırlanır.

### IndexedDB

- Tarayıcıdaki gerçek bir veritabanıdır; büyük ve yapılı veri tutar.
- Çevrimdışı çalışan uygulamalar ve bazı kimlik doğrulama kütüphaneleri kullanır. Firebase Authentication oturumu varsayılan olarak burada saklar. Böyle bir sitede oturum çerezlerde değil IndexedDB'dedir.

### Service worker'lar

- Site tarafından kaydedilen ve sayfa kapalıyken de çalışabilen betiktir. Sitenin isteklerini araya girip önbellekten yanıtlayabilir.
- Eski bir worker sitenin eski sürümünü sunmaya devam edebilir. Silindiğinde kaydı kaldırılır, site bir sonraki ziyarette yeniden kurar.

### Dosya sistemi

- Sitenin tarayıcının içinde, dışarıdan görünmeyen dosya alanıdır.
- Çoğu sitede boştur. Chrome'un dokümanı bunu "sitelerin dosya sistemi verisi" diye tanımlar. Yeni "origin private file system"in (OPFS) bu seçenekle silindiği dokümanda açıkça yazmıyor; OPFS'in tüm site verisi silinince gittiği biliniyor.

## Ne zaman neyi seçmeli?

| Test ne istiyor? | Seçilecekler (başlangıç sitesinde) |
|---|---|
| **Girişten başlayan senaryo** (başlangıç: çıkış yapılmış giriş sayfası) | Çerezler + localStorage ve sessionStorage; site oturumu orada tutuyorsa IndexedDB |
| **İlk ziyaret** (çerez bandı, tanıtım turu, "hoş geldiniz" ekranı görünsün) | Çerezler + localStorage ve sessionStorage + IndexedDB |
| **Sepet / form sıfırlansın** | Çerezler + localStorage ve sessionStorage |
| **Site yeni sürüme geçti, eski dosyalar gelmesin** | Önbellek (HTTP) + Cache Storage + Service worker'lar |
| **Runner gibi tam temiz başlangıç** | Site kutusu (hepsi); koşu başka sitelere de gidiyorsa onlarda da |
| **Başlangıç girişten sonraki bir ekran** (ör. `v_Inventory`) | Hiçbiri, ya da yalnızca Önbellek. Çerezler silinirse oturum kapanır ve başlangıca ulaşılamaz |

Altın kural: **kaydı, temizlediğiniz durumdan yapın.** Başlangıç node'u temiz bir tarayıcıda kaydedildiyse (çerez bandı açık, giriş yapılmamış), temizlik sonrası ekran onunla tutar. Kayıt dolu bir tarayıcıda yapıldıysa (band kapalı), çerezleri silmek başlangıcı bozar.

## Nasıl çalışıyor?

```
panel.js ▸ Koşuyu oynat
   │ maskeli değerler girilmiş mi? (değilse hata, hiçbir şey silinmez)
   ▼
temizlik penceresi (cleanup-dialog) ── seçim ──▶ scenario.cleanup (SAVE_SCENARIO)
   │ Temizle ve oynat
   ▼
chrome.browsingData.remove({ origins: [site] }, { cookies, cache, localStorage, … })   her site için
   │                                    (localStorage, sitenin sessionStorage'ını da siler)
   ▼
goToAddress(başlangıç node'unun adresi)          sayfa temiz verilerle yeniden açılır
   │
   ▼
checkReplay: başlangıç kontrolü ▸ oynatma (01 > Panelde oynatma)
```

- **Türler ve açıklamalar:** `extension/scenario.js > CLEANUP_TYPES`. Panel, background ve runner bu dosyayı ortak kullanır. Türlerin adları `chrome.browsingData`'nın veri türü adlarıdır (`cookies`, `cache`, `cacheStorage`, `localStorage`, `indexedDB`, `serviceWorkers`, `fileSystems`). `localStorage` panelde "localStorage ve sessionStorage" diye görünür ([neden](#localstorage-ve-sessionstorage)).
- **Siteler:** `scenario.js > cleanupSites` (node adreslerinin origin'leri, `siteOrigin`). Seçim `normalizeCleanup` ile doğrulanır: bozuk origin, bilinmeyen tür ve boş liste atılır.
- **Pencere ve silme:** `extension/sidepanel/panel.js > TEMİZLİK` (`openCleanup`, `cleanSites`).
- **İzin:** `manifest.json > permissions > browsingData` ([02 > İzinler](02-teknolojiler.md)).
- **Saklama:** `state.scenarios[].cleanup` ve senaryo dosyasındaki `cleanup` ([04 > Senaryo dosyası](04-veri-modeli.md#senaryo-dosyası)). Biçim: `{ "https://www.saucedemo.com": ["cookies", "localStorage"] }`.
- **Test:** `tests/e2e/site-data.test.js` ([tests/README.md](../tests/README.md)).

## Silinmeyenler ve sınırlar

- **Yalnızca listedeki siteler silinir.** Koşunun node'u olmayan siteler listede yoktur: "Google ile giriş" gibi kimlik sağlayıcılar (`accounts.google.com`), ödeme sayfaları, CDN'ler. Bunların çerezleri kalır. Bir site girişi başka bir alan adındaki kimlik sağlayıcıyla yapıyorsa, oradaki oturum sizi yeniden otomatik giriş yaptırabilir.
- **Gömülü üçüncü taraf çerezleri** (sayfadaki başka sitelerin iframe'leri, reklamlar) silinmez; DevTools'un "üçüncü taraf çerezleri" seçeneğinin karşılığı yoktur.
- **Diğer sekmeler:** Aynı sitenin başka sekmede açık sayfası, eski verileri bellekte tutar. O sayfa verileri yeniden yazabilir (ör. açık bir uygulama localStorage'a yazmaya devam eder). Temizlikten önce sitenin diğer sekmelerini kapatın. **localStorage ve sessionStorage** seçiliyse o sekmelerin sessionStorage'ı da silinir; oradaki yarım işler sıfırlanır.
- **Tarayıcı genelindeki veriler silinmez:**
  - geçmiş, indirmeler, kayıtlı şifreler, form otomatik doldurma;
  - site izinleri (konum, bildirim, kamera);
  - HTTP kimlik doğrulama (Basic auth) bilgileri. `Clear-Site-Data` başlığı bunları da siler, ama Chrome'un site bazında silme arayüzü bunları kapsamaz.
- **Kapsamlar farklı:** Çerezler alan adının tamamı için, depolama türleri tam origin için (şema + alan adı + port) silinir. `https://app.site.com` için localStorage silmek `https://www.site.com`'unkine dokunmaz; çerez silmek ikisini de etkiler.
- **Geri alınamaz** ve testin değil **sizin tarayıcınızın** verisidir: o sitede gerçekten oturumunuz kapanır.
- **Eskiyen türler sunulmaz:** WebSQL ve AppCache Chrome'da kaldırıldı; `chrome.browsingData` bunları artık yok sayıyor.

## Başka araçlar nasıl yapıyor?

| Araç | Neyi siler | Nasıl |
|---|---|---|
| **Chrome DevTools** (Application > Storage > Clear site data) | Service worker kayıtları, local ve session storage (tek seçenek), IndexedDB, çerezler (isteğe bağlı üçüncü taraf çerezleri), Cache Storage, dosya sistemi. HTTP önbelleği bu listede yok | Açık sayfanın sitesi için, türler tek tek seçilir |
| **`Clear-Site-Data` HTTP başlığı** | `"cache"` (önbellek), `"cookies"` (alan adının tamamı, HTTP kimlik bilgileri dahil), `"storage"` (localStorage, sessionStorage, IndexedDB, …), `"executionContexts"` (sitenin açık sayfalarını yeniden yükler), `"*"` (hepsi) | Sunucu yanıtla gönderir, örneğin çıkış yaparken |
| **Cypress** (`testIsolation`, varsayılan açık) | Her testten önce tüm alan adlarında çerezler, localStorage ve sessionStorage; sayfa `about:blank`'e gider. IndexedDB'yi silmez | Test çalıştırıcı kendisi yapar |
| **Playwright** (runner'ımızın kullandığı) | Her test yeni bir tarayıcı bağlamında başlar: çerez, depolama ve önbellek boştur. `context.clearCookies()` yalnızca çerezleri siler | Silmek yerine sıfırdan başlamak |
| **Cookie AutoDelete** (tarayıcı eklentisi) | Alan adı bazında çerezler; IndexedDB, localStorage ve service worker ayrı seçenekler ve varsayılan kapalı | Sekme kapanınca ya da alan adı değişince, beyaz listedekiler hariç |
| **DevTools protokolü** (`Storage.clearDataForOrigin`) | `storageTypes` virgülle verilir: `cookies`, `local_storage`, `indexeddb`, `cache_storage`, `service_workers`, `file_systems`, … ya da `all` | Otomasyon araçları (Puppeteer, chromedp) kullanır |

**Bizim seçimimiz bunlardan nasıl çıktı:**
- **Türler:** DevTools'un "Clear site data" listesiyle aynı; local ve session storage orada da tek seçenektir. Buna `Clear-Site-Data`'daki gibi **HTTP önbelleği** eklendi.
- **Site ve tür bazında seçim:** Cookie AutoDelete'teki gibi.
- **Varsayılan:** Cookie AutoDelete'te depolama türleri varsayılan kapalıdır; bizde de hiçbir şey seçili değildir, çünkü silinen veri kullanıcının gerçek tarayıcısındandır.
- **Runner:** Playwright'ın yolunu izler: silmeye gerek kalmadan her koşu sıfırdan başlar.

## Kaynaklar

- [chrome.browsingData (Chrome for Developers)](https://developer.chrome.com/docs/extensions/reference/api/browsingData): `origins` ile site bazında silme; desteklenen türler (çerezler, önbellek, depolama); çerezlerin alan adının tamamı için silinmesi; `browsingData` izni.
- [Clear-Site-Data (MDN)](https://developer.mozilla.org/docs/Web/HTTP/Headers/Clear-Site-Data): `cache`, `cookies`, `storage`, `executionContexts`, `*`.
- [storage_partition_impl.cc (Chromium kaynak kodu)](https://github.com/chromium/chromium/blob/main/content/browser/storage_partition_impl.cc): site bazında localStorage silinirken sessionStorage'ın da silinmesi (`DataDeletionHelper::ClearData`, `ClearSessionStorage`).
- [DevTools: Application paneli](https://developer.chrome.com/docs/devtools/application) ve [StorageView.ts (DevTools kaynak kodu)](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/panels/application/StorageView.ts): "Clear site data" seçenekleri, "Local and session storage" tek seçenek.
- [Cypress: Test Isolation](https://docs.cypress.io/app/core-concepts/test-isolation): testler arasında silinenler.
- [Playwright: Browser contexts](https://playwright.dev/docs/browser-contexts): her testin temiz bağlamı.
- [Cookie AutoDelete (V3) dokümanı](https://github.com/vasilisplavos/Cookie-AutoDeleteV3/wiki/Documentation): alan adı bazında temizlik ve site verisi seçenekleri.
- [DevTools protokolü Storage alanı (Go bağlaması)](https://pkg.go.dev/github.com/goconnectx/cdproto/storage): `clearDataForOrigin` ve depolama türleri.
- [The origin private file system (web.dev)](https://web.dev/opfs): OPFS'in site verisiyle birlikte silinmesi.
