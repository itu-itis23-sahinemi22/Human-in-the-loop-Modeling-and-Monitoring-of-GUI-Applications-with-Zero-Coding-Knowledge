# 02: Teknolojiler ve Gerekçeleri

Her teknoloji için üç soru cevaplanıyor: **Ne için kullanıldı?**, **Neden bu?**, **Hangi alternatifler neden elendi?**

Genel ilke: **demo, en az parçayla çalışan ve her satırı okunabilen bir prototip olmalı.** Bir seçim "daha güçlü" ama "daha karmaşık" ise, demo için karmaşık olan elendi. Hangi noktada güçlü olana geçilmesi gerektiği de ayrıca belirtildi.

## İçindekiler

1. [Chrome Extension](#1-chrome-extension)
2. [Manifest V3](#2-manifest-v3)
3. [Side Panel API](#3-side-panel-api)
4. [Vanilla JavaScript, build adımı yok](#4-vanilla-javascript-build-adımı-yok)
5. [Cytoscape.js](#5-cytoscapejs)
6. [chrome.storage.local](#6-chromestoragelocal)
7. [Ekran görüntüsü: captureVisibleTab](#7-ekran-görüntüsü-capturevisibletab)
8. [Kendi selector üreticimiz](#8-kendi-selector-üreticimiz)
9. [State eşleştirme: element kümesi birebir eşitliği](#9-state-eşleştirme-element-kümesi-birebir-eşitliği)
10. [Runner: Playwright (Node.js)](#10-runner-playwright-nodejs)
11. [Planlayıcı: GraphWalker ve Native Messaging](#11-planlayıcı-graphwalker-ve-native-messaging)
12. [Hangi izin neden gerekli?](#hangi-izin-neden-gerekli)

---

## 1. Chrome Extension

**Ne için:** Kullanıcı kendi tarayıcısında gezerken aksiyonlarını yakalamak.

**Neden:**

- Kullanıcı **kendi tarayıcısını, kendi oturumunu** kullanır. Login, 2FA ve çerezler olduğu gibi çalışır, test ortamına ayrıca giriş yapmak gerekmez.
- Sayfanın DOM'una (content script) ve tarayıcı API'lerine (ekran görüntüsü, gezinme olayları, sekmeler) **aynı anda** erişebilen tek yöntemdir.
- Kurulum "klasörü seç" kadar basittir.
- Endüstride kanıtlanmış bir yaklaşımdır: **Selenium IDE** ve **Chrome DevTools Recorder** da kaydı tarayıcının içinden yapar.

**Elenen alternatifler:**

| Alternatif | Neden elendi |
|---|---|
| **Playwright/Puppeteer ile kontrol edilen tarayıcı** (ör. `playwright codegen`) | Ayrı bir tarayıcı açar, kullanıcının oturumu yoktur. Node.js kurulumu gerekir. *Kaydı tekrar oynatmak (replay) için ise doğru araç: runner bunu kullanır (bkz. [10. Runner](#10-runner-playwright-nodejs)).* |
| **HTTP proxy** (mitmproxy vb.) | Sadece ağ isteklerini görür, kullanıcının neye tıkladığını göremez. SPA'larda çoğu tıklama hiç istek üretmez. |
| **Bookmarklet / sayfaya JS enjekte etmek** | Sayfa değişince kod ölür. Sitenin CSP kuralları engelleyebilir. Ekran görüntüsü alamaz. |
| **Electron masaüstü uygulaması** | Ağır, kurulum gerektirir ve kullanıcının asıl tarayıcısı değildir. |

---

## 2. Manifest V3

**Ne için:** Eklentinin formatı (`manifest.json` içindeki `"manifest_version": 3`).

**Neden:** Seçenek yok. Chrome, Manifest V2 eklentilerini 2024-2025 boyunca kademeli olarak devre dışı bıraktı. Yeni bir eklenti MV3 ile yazılmak zorunda.

**Tasarıma etkileri:**

- **Background artık bir service worker.** Kalıcı değildir, boşta kalınca kapanır. Bu yüzden state'i storage'da tutuyoruz (bkz. [01-mimari.md](01-mimari.md#service-workerın-ölümlülüğü)).
- **Uzaktan kod yüklemek yasak.** `<script src="https://cdn...">` çalışmaz. Cytoscape kütüphanesi bu yüzden `extension/lib/` içinde duruyor.
- **Satır içi `<script>` yasak (CSP).** Tüm JavaScript ayrı `.js` dosyalarında.

---

## 3. Side Panel API

**Ne için:** Kullanıcı arayüzü ("Node oluştur" butonu, graph çizimi).

**Neden:** Chrome 114 ile gelen yan panel, sayfanın yanında **sürekli açık kalan** ve sayfadan **tamamen ayrı** bir alan sunar.

**Elenen alternatifler:**

| Alternatif | Neden elendi |
|---|---|
| **Popup** (ikona tıklayınca açılan küçük pencere) | Kullanıcı sayfaya tıkladığı an kapanır. Bizim kullanım şeklimiz "sayfada gez, panele bas, sayfada gez" olduğu için kullanılamaz. |
| **Sayfaya gömülü panel** (overlay) | (1) Panelin kendi butonlarına tıklamak *aksiyon olarak kaydedilirdi*. (2) Panelin elementleri sayfanın *parmak izine karışırdı*. (3) Sitenin CSS'i arayüzümüzü bozabilirdi. (4) Her sayfa geçişinde yeniden oluşturulması gerekirdi. |
| **DevTools paneli** | DevTools'un açık olmasını gerektirir. Teknik olmayan bir test uzmanı için doğal değil. |

---

## 4. Vanilla JavaScript, build adımı yok

**Ne için:** Tüm kod.

**Neden:**

- **Okunabilirlik:** Kod yaklaşık 950 satır. Her dosya, tarayıcının çalıştırdığı dosyanın ta kendisi. Jüri ya da ekip arkadaşı bir dosyayı açtığında "bu derlenmiş hali mi, kaynağı nerede?" sorusu yok.
- **Sıfır kurulum:** `npm install`, `node_modules` ve sürüm çakışması yok. 6 ay sonra da aynen çalışır.
- **Hızlı döngü:** Dosyayı kaydet, `chrome://extensions`'ta yenile, dene.
- Modern JavaScript (`async/await`, `??=`, `Array.at()`, optional chaining) Chrome'da doğrudan çalışır. Transpile etmeye gerek yok.

**Elenen alternatifler:** TypeScript, React/Vue, Vite, WXT/Plasmo gibi eklenti framework'leri. Hepsi büyük projelerde değerli, ama bu boyutta getirdikleri karmaşıklık faydalarından fazla.

**Ne zaman geçilmeli?** Arayüz birden fazla ekrana çıkarsa (ör. ayarlar sayfası, export seçenekleri, replay ekranı) ya da kod 3.000 satırı aşarsa, **WXT + TypeScript**'e geçmek mantıklı. WXT, Manifest V3 eklentileri için hazırlanmış, Vite tabanlı bir framework'tür. Mevcut dosya yapısı (background / content / sidepanel) WXT'nin beklediği yapıyla bire bir örtüşür, geçiş kolay olur.

---

## 5. Cytoscape.js

**Ne için:** Graph'ı yan panelde çizmek ve node/edge seçimini yönetmek.

**Neden:**

- **Graph'a özel bir kütüphane:** Yönlü edge, **self-loop** (aynı node'a dönen edge) ve aynı iki node arasında **birden fazla edge** kutudan çıktığı gibi desteklenir. Bizim modelimizde üçü de sık görülür.
- **Hazır yerleşim algoritmaları:** `breadthfirst` yerleşimi başlangıç node'unu üste koyar, ondan ulaşılanları alt satırlara dizer. Bu, bir kullanıcı akışını okumanın doğal yoludur.
- **Node içinde resim:** Her node'un içinde o sayfanın küçük ekran görüntüsü gösterilir. Graph bir bakışta okunur.
- **Tek dosya, sıfır bağımlılık, MIT lisanslı.** `lib/cytoscape.min.js` dosyasını koymak yeterli.
- **Graph algoritmaları içerir:** BFS, Dijkstra, bağlı bileşenler gibi. İleride "tüm edge'leri kapsayan bir yol üret" gibi GraphWalker benzeri özellikler eklenirse aynı kütüphane kullanılabilir.

**Elenen alternatifler:**

| Alternatif | Neden elendi |
|---|---|
| **D3.js** | Çok güçlü ama düşük seviyeli. Ok uçları, self-loop'lar, yerleşim ve seçim gibi her şeyi elle yazmak gerekir. |
| **vis-network** | İyi bir alternatif. Cytoscape'in graph algoritmaları ve stil sistemi daha zengin olduğu için tercih edilmedi. |
| **Mermaid** | Metinden statik SVG üretir. Tıklama/seçim yok, her değişiklikte tamamı yeniden çizilir. |
| **React Flow** | React gerektirir (bkz. madde 4). |
| **Graphviz (viz.js)** | Statik çıktı, etkileşim yok, WASM dosyası büyük. |

---

## 6. chrome.storage.local

**Ne için:** Graph state'inin kalıcı olarak saklandığı yer.

**Neden:**

- Service worker her an kapanabilir. **Kalıcı** bir yere ihtiyaç var.
- Background **ve** panel aynı alana erişebilir.
- `chrome.storage.onChanged` olayı sayesinde panel, background'ın her yazışından otomatik haberdar olur. Ayrı bir "panele bildir" mesajı yazmaya gerek kalmaz (bkz. [tek yönlü veri akışı](01-mimari.md#temel-iki-kural)).
- Tarayıcı kapatılıp açılsa bile graph kaybolmaz.

**Elenen alternatifler:**

| Alternatif | Neden elendi |
|---|---|
| `localStorage` | Service worker içinde **kullanılamaz**. |
| IndexedDB | Daha güçlü ama API'si çok daha uzun ve karmaşık. Bu veri boyutunda gerekmez. |
| Sadece bellek (değişken) | Worker kapanınca her şey silinir. |

**Not:** Varsayılan kota 10 MB'dır. Ekran görüntüleri bu sınırı aşabileceği için `unlimitedStorage` izni alındı.

---

## 7. Ekran görüntüsü: captureVisibleTab

**Ne için:** Her node için sayfanın görüntüsünü saklamak. Görüntü graph'ta node'un içinde ve "aynı node mu?" sorusunda yan yana karşılaştırma için kullanılır.

**Neden:** `chrome.tabs.captureVisibleTab` tarayıcının gerçekten çizdiği pikselleri alır. JPEG, %40 kalite: node başına yaklaşık 50-150 KB.

**Elenen alternatif:** `html2canvas` gibi kütüphaneler sayfayı JavaScript ile *yeniden çizmeye* çalışır. Yavaştır, sonucu birebir değildir, başka domainlerden gelen resimleri çizemez.

**Sınırlama:** Chrome bu API'yi saniyede en fazla 2 çağrıyla sınırlar. Kullanıcı çok hızlı basarsa `background.js` 1 saniye bekleyip bir kez tekrar dener (`takeScreenshot()`).

---

## 8. Kendi selector üreticimiz

**Ne için:** Her aksiyonun hangi elemente yapıldığını, ileride tekrar bulunabilecek şekilde kaydetmek (`#login-button`, `button[data-test="checkout"]`...).

**Neden kendi fonksiyonumuz (`content.js > cssSelector()`, ~25 satır):**

- Build adımı olmadığı için npm paketi eklemek zahmetli.
- Öncelik sırasını **test otomasyonu bakış açısıyla** biz belirledik: `id` > `data-testid` > `data-test` > `name` > `aria-label` > DOM yolu. Bu, Playwright ve Testing Library'nin önerdiği "önce test için konmuş, kararlı nitelikleri kullan" ilkesiyle aynı.
- Her adayın sayfada **tekil** olup olmadığı kontrol edilir. Tekil değilse bir sonraki stratejiye geçilir.

**Elenen alternatif:** `@medv/finder` gibi kütüphaneler daha kısa ve akıllı selector'lar üretir. Ama ES module olarak dağıtıldıkları için build adımı ister. İleride WXT'ye geçilirse değerlendirilebilir.

---

## 9. State eşleştirme: element kümesi birebir eşitliği

**Ne için:** "Bu sayfa daha önce kaydedilmiş bir node mu?" sorusunu cevaplamak.

**Neden:** Bir node'dan çıkan edge'ler o node'daki etkileşimli elementlere dayanır. Element kümesi (edge set) farklı iki sayfayı tek node saymak edge'lerin çakışmasına yol açar. Bu yüzden küme farklıysa sistem soru sormadan yeni node oluşturur; yalnızca birebir aynıysa kullanıcıya "aynı state mi?" diye sorar. Ayarlanacak eşik yoktur, karar deterministiktir ve tek cümleyle açıklanabilir.

**Elenen alternatif:** Önceki sürümde Jaccard benzerliği (eşik 0.6) kullanılıyordu. "%92 benziyor" sorusuna "Evet" demek farklı edge set'leri birleştirip tam olarak bu çakışmayı üretiyordu.

Algoritmanın tam açıklaması, ölçümler ve diğer elenen alternatifler (DOM ağacı karşılaştırma, görsel karşılaştırma, makine öğrenmesi): [03-state-eslestirme.md](03-state-eslestirme.md)

---

## 10. Runner: Playwright (Node.js)

**Ne için:** Dışa aktarılan modeldeki bir yolu gerçek bir tarayıcıda tekrar oynatmak ve her adımda varılan ekranın beklenen node olduğunu doğrulamak (`runner/`, bkz. [runner/README.md](../runner/README.md)).

**Neden:**

- **Aynı dil, aynı parmak izi.** Runner, eklentinin `settings.js` ve `fingerprint.js` dosyalarını olduğu gibi kullanır: test edilen sayfaya `addInitScript` ile eklenir, Node tarafında `vm` ile yüklenir. Kayıt ve test aynı state tanımını kullanır; başka bir dile çevrilmiş ikinci bir kopya yoktur.
- **Görünen alan emülasyonu.** `viewport` ve `deviceScaleFactor` fiziksel ekrandan bağımsızdır ve DevTools protokolüyle (CDP) çalışırken de değiştirilebilir. Kayıttaki pencere boyutu ve yakınlaştırma bu sayede birebir kurulur ([03 > Pencere boyutu ve state](03-state-eslestirme.md#pencere-boyutu-ve-state)).
- **Hazır bekleme mekanizmaları.** Elementin görünür ve tıklanabilir olmasını, tıklamanın başlattığı gezinmeyi kendisi bekler.
- **Temiz başlangıç.** Her çalıştırma ayrı bir tarayıcı bağlamında (çerez ve depolama boş) başlar; kayıt yapan kullanıcının oturumu teste karışmaz.
- **Kayıttaki biçimle uyumlu.** Tuş adları (`Control+Enter`) ve tekrar oynatma karşılıkları ([04 > Aksiyon](04-veri-modeli.md#aksiyon)) zaten Playwright biçimindedir. Kurulu Chrome ile de çalışır (`--channel chrome`).

**Elenen alternatifler:**

| Alternatif | Neden elendi |
|---|---|
| **Selenium (Java)** | Parmak izi kodu Java'ya çevrilmek ya da `executeScript` ile metin olarak taşınmak zorunda kalırdı. Görünen alan emülasyonu yerleşik değildir: pencere, sayfanın iç boyutu kayıttakine eşit olacak şekilde ayarlanmalıdır; piksel oranı için Chrome'a özel CDP komutları gerekir. GraphWalker'ın Java test kütüphanesiyle doğal uyumu bir artıdır; test kodu üretimine geçilirse yeniden değerlendirilebilir. |
| **Puppeteer** | Playwright'a çok yakın bir API. Playwright'ı öne çıkaranlar: her çalıştırma için ayrı tarayıcı bağlamı, yeni sekme/popup olaylarını bekleme ve hazır bekleme mekanizmaları. |
| **Eklentinin kendisi** (kayıt yapılan tarayıcıda oynatmak) | Sayfaya gönderilen sahte olaylar `isTrusted=false` olur; bazı siteler bunları yok sayar (kayıt da bu yüzden onları kaydetmez). Kullanıcının oturumu test ortamını kirletir, temiz başlangıç yoktur. |
| **Cypress** | Tek sekmede çalışır; yeni sekme açan akışları test edemez. |

**Bilinçli tercih:** Runner eklentiden ayrı bir klasördür; npm bağımlılığı yalnızca oradadır. Eklentinin "build adımı yok, bağımlılık yok" ilkesi ([4. bölüm](#4-vanilla-javascript-build-adımı-yok)) korunur.

---

## 11. Planlayıcı: GraphWalker ve Native Messaging

**Ne için:** Graph'tan test senaryosu (koşular) üretmek: tüm edge'leri ya da tüm node'ları kapsayan yollar, ya da bir node'a en kısa yol. Panelde tek tıkla, kullanıcının bilgisayarında (bkz. [runner/README.md > Planlayıcı](../runner/README.md#planlayıcı-graphwalker-ile-senaryo)).

**Neden GraphWalker:** Model tabanlı testin yerleşik aracıdır; generator ve durma koşulu dili (`random(edge_coverage(100))`, `a_star(reached_vertex(v))`) tezde açıklanabilir ve başka çalışmalarla karşılaştırılabilir. Eklentinin dışa aktardığı model zaten GraphWalker biçimindedir ([04 > Dışa aktarılan JSON](04-veri-modeli.md#dışa-aktarılan-json)). Tohumla aynı yol tekrar üretilir. Eksiği: çıkış edge'i olmayan node'da durur; planlayıcı yolu orada böler ve kalan edge'ler için yeni koşular açar.

**İki sürüm: Java ve Rust.** GraphWalker'ın asıl sürümü Java'dır (graphwalker-cli 4.3.3 jar'ı, Java 17 / 21 ister). Rust sürümü ([graphwalker-rs](https://github.com/GraphWalker/graphwalker-rs) 1.0.4) aynı komut kalıbını, generator dilini, model JSON'unu ve çıktıyı kullanır. Java gerektirmez ve her çağrıda JVM açılmadığı için hızlıdır. İkisi de desteklenir; hangisinin kullanılacağı kurulumda seçilir. Planlayıcı aradaki farkları kendisi karşılar: çağrı, `--version` çıktısı, çıkmaz node mesajı, tohum 0'ın anlamı (`runner/planner/graphwalker.js`). Aynı tohum iki sürümde farklı yol verir, bu yüzden senaryoya sürüm de yazılır (`planner.cli`).

**Neden Native Messaging:** Eklenti bilgisayarda program çalıştıramaz (tarayıcının güvenlik sınırı); GraphWalker ise bilgisayardaki bir programdır (Java jar'ı ya da Rust sürümünün `graphwalker.exe`'si). Chrome'un resmi yolu native messaging'dir: önceden kayıtlı bir programı (host) Chrome kendisi başlatır, standart giriş / çıkışla JSON mesajlaşır. Kullanıcı terminal açmaz, sunucu başlatmaz; her istekte host açılır, cevap verir, kapanır. Host'a yalnızca manifestinde adı geçen eklenti kimliği ulaşabilir.

- Kimliğin sabit olması için `manifest.json`'da bir `key` vardır: paketlenmemiş eklentinin kimliği normalde klasör yolundan gelir, makineden makineye değişir. Chrome Web Store'a geçilirse kimliği mağaza verir; o zaman `key` yerine mağazanın public key'i konur (geliştirme sürümü de aynı kimliği alır), pakete `key` konmaz.
- Host Node.js ile yazıldı (`runner/planner/host.js`): runner zaten Node ister, planlayıcının kodu (`graphwalker.js`) komut satırıyla (`plan.js`) ortaktır.

**Elenen alternatifler:**

| Alternatif | Neden elendi |
|---|---|
| **Yerel sunucu** (`node serve.js`, panel `fetch('http://localhost')`) | Kullanıcı her seferinde sunucuyu başlatır; port kullanılır; başka sitelerin de o porta istek atabilmesine karşı Origin kontrolü gerekir. Native messaging'de bunların hiçbiri yok. |
| **Komut + Yükle** (panel komutu gösterir, kullanıcı terminalde çalıştırıp dosyayı yükler) | Her senaryo için elle adım; "minimum efor" hedefine aykırı. Yedek yol olarak duruyor (`plan.js`). |
| **Planlayıcıyı JavaScript'le yazıp panelde çalıştırmak** | Kurulum gerektirmez, anında önizler; ama GraphWalker'ın generator dili ve tez açısından standart araçla uyum kaybolur. Önceki hafta denendi, GraphWalker'da karar kılındı. |
| **GraphWalker'ın WebSocket / REST sunucusu** (`online`) | Yine elle başlatılan bir süreç; panelden bağlanmak için yerel sunucuyla aynı sorunlar. |

**Bilinçli tercihler:** GraphWalker depoya ve kuruluma gömülmez. Java sürümünde kullanıcı Java 17 / 21 kurar ve jar'ın yolunu verir (47 MB + JRE). Rust sürümünde derlenmiş `graphwalker.exe`'nin yolunu verir; graphwalker-rs hazır CLI sürümü yayımlamadığı için kullanıcı onu kaynaktan derler (`cargo build --release -p graphwalker`). Aynı anda tek sürüm kuruludur. Kurulum yalnızca Windows içindir (kayıt anahtarı); planlayıcının kendisi ve `plan.js` her yerde çalışır.

---

## Hangi izin neden gerekli?

`manifest.json`'daki her iznin gerekçesi:

| İzin | Neden gerekli |
|---|---|
| `sidePanel` | Yan paneli açmak (`chrome.sidePanel`) |
| `storage` | Graph state'ini saklamak (`chrome.storage.local`) |
| `unlimitedStorage` | Ekran görüntüleri 10 MB varsayılan kotayı aşabilir. |
| `webNavigation` | Adres çubuğu, geri/ileri ve yenileme gibi sayfa dışı gezinmeleri yakalamak |
| `debugger` | Panelde oynatma: fare ve klavye olaylarını gerçek kullanıcı olayı olarak göndermek, pencere boyutu aksiyonunu kurmak (DevTools protokolü, `chrome.debugger`). Yalnızca oynatma sürerken bağlanır; Chrome bu sırada üstte bir uyarı çubuğu gösterir. |
| `nativeMessaging` | Planlayıcı: kullanıcının bilgisayarındaki GraphWalker'ı kayıtlı host üzerinden çalıştırmak (`chrome.runtime.sendNativeMessage`). Host kurulu değilse izin bir şey yapmaz; panel kurulumu söyler. |
| `host_permissions: <all_urls>` | (1) `content.js`'i her siteye eklemek. (2) `captureVisibleTab` ile ekran görüntüsü almak. Hangi sitenin modelleneceğini önceden bilemeyiz. |

**Neden `activeTab` yetmedi?** `activeTab` izni yalnızca belirli kullanıcı hareketlerinde (ikon tıklaması, klavye kısayolu) o sekme için geçici yetki verir. Bizim ise content script'in kayıt boyunca, sayfalar arası geçişlerde bile her sayfada hazır olması gerekiyor.

**Gizlilik notu:** Eklenti hiçbir ağ isteği yapmaz. Kaydedilen her şey (aksiyonlar, form değerleri, ekran görüntüleri) yalnızca kullanıcının bilgisayarında, `chrome.storage.local` içinde durur. Şifre alanlarının değeri kaydedilmez, yerine `******` yazılır (`content.js > MASK_PASSWORDS`). Yalnızca kaydın başlatıldığı sekmedeki aksiyonlar kaydedilir.
