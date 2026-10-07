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
10. [Hangi izin neden gerekli?](#hangi-izin-neden-gerekli)

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
| **Playwright/Puppeteer ile kontrol edilen tarayıcı** (ör. `playwright codegen`) | Ayrı bir tarayıcı açar, kullanıcının oturumu yoktur. Node.js kurulumu gerekir. *Ama kaydı tekrar oynatmak (replay) için ileride çok uygun bir hedef.* |
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

## Hangi izin neden gerekli?

`manifest.json`'daki her iznin gerekçesi:

| İzin | Neden gerekli |
|---|---|
| `sidePanel` | Yan paneli açmak (`chrome.sidePanel`) |
| `storage` | Graph state'ini saklamak (`chrome.storage.local`) |
| `unlimitedStorage` | Ekran görüntüleri 10 MB varsayılan kotayı aşabilir. |
| `webNavigation` | Adres çubuğu, geri/ileri ve yenileme gibi sayfa dışı gezinmeleri yakalamak |
| `host_permissions: <all_urls>` | (1) `content.js`'i her siteye eklemek. (2) `captureVisibleTab` ile ekran görüntüsü almak. Hangi sitenin modelleneceğini önceden bilemeyiz. |

**Neden `activeTab` yetmedi?** `activeTab` izni yalnızca belirli kullanıcı hareketlerinde (ikon tıklaması, klavye kısayolu) o sekme için geçici yetki verir. Bizim ise content script'in kayıt boyunca, sayfalar arası geçişlerde bile her sayfada hazır olması gerekiyor.

**Gizlilik notu:** Eklenti hiçbir ağ isteği yapmaz. Kaydedilen her şey (aksiyonlar, form değerleri, ekran görüntüleri) yalnızca kullanıcının bilgisayarında, `chrome.storage.local` içinde durur. Şifre alanlarının değeri kaydedilmez, yerine `******` yazılır (`content.js > MASK_PASSWORDS`). Yalnızca kaydın başlatıldığı sekmedeki aksiyonlar kaydedilir.
