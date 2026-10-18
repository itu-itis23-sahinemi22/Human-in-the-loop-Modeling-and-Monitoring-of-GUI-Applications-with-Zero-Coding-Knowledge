# Graph Recorder: Gezerek Test Modeli Çıkarma (Demo)

Bir web sitesinde normal şekilde gezerken, o sitenin **durum grafiğini** (state graph) yarı otomatik olarak çıkaran bir Chrome eklentisi.

Kullanıcı yalnızca "şu an önemli bir durumdayım" demek için **Node oluştur** butonuna basar. İki basış arasında yaptığı tıklama, yazma, kaydırma ve gezinmeler otomatik olarak **edge** (geçiş) olarak kaydedilir. Ekranda tıklanabilen etkileşimli elementler (butonlar, linkler, alanlar) daha önce kaydedilmiş bir node'unkilerle birebir aynıysa sistem kullanıcıya "Bu aynı node mu?" diye sorar. Element kümesi tek bir elementle bile farklıysa, sayfa ne kadar benzer olursa olsun soru sorulmadan yeni node oluşur.

> Bu demo GraphWalker'dan **bağımsızdır**. Amaç, graph'ın tarayıcıda gezerken çıkarılabildiğini ve aynı graph'taki yolların tarayıcıda tekrar oynatılıp doğrulanabildiğini göstermektir. Veri modeli GraphWalker'a kolayca aktarılacak şekilde tasarlanmıştır (bkz. [docs/04-veri-modeli.md](docs/04-veri-modeli.md)); yolu GraphWalker'ın generator'ları üretebilir.

---

## İçindekiler

1. [Problem ve yaklaşımımız](#1-problem-ve-yaklaşımımız)
2. [Kurulum](#2-kurulum-2-dakika)
3. [Kullanım: örnek senaryo](#3-kullanım-örnek-senaryo)
4. [Klasör yapısı](#4-klasör-yapısı)
5. [Mimari (özet)](#5-mimari-özet)
6. [Kullanılan teknolojiler (özet)](#6-kullanılan-teknolojiler-özet)
7. [Demo neyi yapar, neyi yapmaz](#7-demo-neyi-yapar-neyi-yapmaz)
8. [Doküman haritası](#8-doküman-haritası)

---

## 1. Problem ve yaklaşımımız

**GraphWalker**, model tabanlı test (model-based testing) için yaygın kullanılan bir araçtır. Sistemi yönlü bir graph olarak modellersiniz:

- **Vertex (node):** sistemin bir durumu. Örnek: "Giriş sayfası", "Ürün listesi", "Sepet".
- **Edge:** bir durumdan diğerine geçiren aksiyon. Örnek: "Login'e tıkla", "Sepete git".

GraphWalker bu graph üzerinde yollar üreterek test senaryoları oluşturur. Ama önce graph'ın **çizilmesi** gerekir ve asıl zorluk buradadır:

| Yöntem | Sorun |
|---|---|
| **Tamamen manuel** (GraphWalker Studio'da elle çizmek) | Yavaş ve sıkıcı. Hangi butonun nereye gittiğini tek tek not almak gerekir, hata yapmak kolaydır. |
| **Tamamen otomatik** (crawler'ın siteyi kendi gezmesi) | Durum patlaması yaşanır: her küçük DOM değişikliği yeni bir state sayılır. Hangi durumun test açısından *anlamlı* olduğunu makine bilemez. |
| **Bizim önerimiz: hibrit** | İnsan "burası anlamlı bir durum" kararını verir, makine geri kalan her şeyi kaydeder. |

Hibrit yaklaşımda iş bölümü şöyledir:

- **İnsan:** "Node oluştur"a basar ("bu bir durum"). Element kümesi birebir aynı olan node önerisini onaylar ya da reddeder.
- **Makine:** İki basış arasındaki aksiyonları kaydeder. Sayfanın parmak izini ve ekran görüntüsünü alır. Element kümesi farklıysa kendisi yeni node oluşturur; aynıysa mevcut node'u önerir. Node ve edge'leri isimlendirip graph'ı çizer.

---

## 2. Kurulum (2 dakika)

Build adımı ve `npm install` gerekmez.

1. Chrome'da adres çubuğuna `chrome://extensions` yazın.
2. Sağ üstten **Geliştirici modu**nu (Developer mode) açın.
3. **Paketlenmemiş öğe yükle** (Load unpacked) butonuna basın ve bu projedeki **`extension/`** klasörünü seçin.
4. Araç çubuğundaki yapboz ikonundan **Graph Recorder**'ı sabitleyin (pin).
5. İkona tıklayın: sağda yan panel açılır.

> **Önemli:** Eklentiyi yüklemeden önce açık olan sekmeleri bir kez **yenileyin (F5)**. Chrome, eklentinin sayfa içi kodunu (content script) yalnızca yeni yüklenen sayfalara ekler.

---

## 3. Kullanım: örnek senaryo

Demo için [saucedemo.com](https://www.saucedemo.com) uygundur: test otomasyonu eğitimleri için yapılmış, durumları net ayrılan bir alışveriş sitesidir.

| # | Tarayıcıda yaptığınız | Panelde yaptığınız | Sonuç |
|---|---|---|---|
| 1 | saucedemo.com'u açın | **Node oluştur** | İlk node: `v_SwagLabs` (giriş sayfası). Kayıt bu sekmede başlar. |
| 2 | Kullanıcı adı ve şifre yazın, **Login**'e basın | *(Bekleyen aksiyonlar listesi canlı dolar)* | |
| 3 | | **Node oluştur** | Yeni node `v_Inventory`. `v_SwagLabs → v_Inventory` arasına 3 aksiyonlu `e_Login` edge'i çizilir. |
| 4 | Sayfayı kaydırmadan ilk ürünü **Add to cart** ile sepete ekleyin | **Node oluştur** | Soru sorulmaz: `Add to cart` butonu `Remove` oldu, element kümesi değişti. Yeni node `v_Inventory_2` ve `v_Inventory → v_Inventory_2` arasına `e_AddToCart` edge'i oluşur. |
| 5 | Sepet ikonuna tıklayın | **Node oluştur** | Yeni node `v_Cart` ve `e_Cart...` edge'i oluşur. |
| 6 | **Continue Shopping**'e basın | **Node oluştur** | Panel sorar: *"Bu sayfanın etkileşimli elementleri mevcut v_Inventory_2 node'u ile birebir aynı. Aynı state mi?"* |
| 7 | | `v_Inventory_2` altındaki **Evet, bu node** | `v_Cart → v_Inventory_2` edge'i oluşur. Graph'ta döngü kapanır. |
| 8 | | **GraphWalker JSON** | Graph, GraphWalker JSON modeli olarak `SwagLabs.json` dosyasına iner. GraphWalker Studio'da açılır, GraphWalker CLI ile çalıştırılabilir. |
| 9 | | **Senaryo** bölümünü açıp graph'ta edge'lere tıklayarak bir yol kurun, **Senaryo indir** | Seçili koşu graph'ta vurgulanır; yol çıkmaz bir node'da biterse "Yeni koşu" baştan başlar. Senaryo, modelin yanına `SwagLabs-senaryo.json` olarak iner. |
| 10 | Giriş sayfasına dönün (koşunun ilk node'u) | Senaryo bölümünde şifreyi girip **Koşuyu oynat** | Koşu bu tarayıcıda, açık sekmede oynatılır: element çerçevelenir, tıklanır; graph'ta geçen edge'ler yeşile döner. Ekran koşunun ilk node'u değilse önce uyarı çıkar. Kalınan adımda fark listesi ve beklenen ekranla görsel karşılaştırma. Bkz. [docs/01 > Panelde oynatma](docs/01-mimari.md#panelde-oynatma) |
| 11 | *(terminalde)* `node runner/run.js SwagLabs-senaryo.json --secrets secrets.json` | | Runner her koşuyu yeni bir tarayıcıda temiz oturumla oynatır, her edge'den sonra varılan ekranın beklenen node olduğunu doğrular ve `report.html`, `report.json`, `junit.xml` yazar. Bkz. [runner/README.md](runner/README.md) |

**Temel kurallar:**

- **Edge set farklıysa her zaman yeni node.** Edge set, ekranda tıklanabilen etkileşimli elementlerin **türleri ve sayılarıdır** (ör. `button:Sil ×5`). Bir tür eklenmiş, çıkmış, değişmiş, `disabled` olmuş, kaydırma ile ekran dışına çıkmış ya da bir türün sayısı değişmişse (5 Sil yerine 4) soru sorulmaz. Sebebi: bir node'dan çıkan edge'ler o node'daki elementlere dayanır; farklı edge set'leri tek node saymak edge'lerin çakışmasına yol açar. Edge'ler de hedeflerini aynı düzeyde kaydeder ("ekrandaki 2. `button:Sil`"), böylece aynı state sayılan ekranlarda her hedef bulunur. Detay: [docs/03-state-eslestirme.md](docs/03-state-eslestirme.md#neden-benzerlik-değil-birebir-eşitlik)
- **Kaydırma da bir aksiyondur.** State yalnızca ekranda görünen elementlerden oluşur; DOM'da olup ekran dışında kalanlar sayılmaz. Sayfayı kaydırıp "Node oluştur"a basarsanız: ekrandaki küme değiştiyse soru sorulmadan yeni node (`e_ScrollDown`), aynı kaldıysa "aynı state mi?" sorusu gelir. Detay: [docs/03 > Kaydırma ve state](docs/03-state-eslestirme.md#kaydırma-ve-state)
- **"Evet, bu node"** cevabı yeni node oluşturmaz, **şu anki node'dan seçilen node'a bir edge çizer.** Sayfa birden fazla node ile birebir aynıysa onay kartı hepsini ekran görüntüleriyle listeler; doğru olanı seçersiniz ya da "Hiçbiri, yeni node" dersiniz. Her adayın altında **görsel fark oranı** yazar; **Karşılaştır** şu anki sayfayla adayı geniş bir pencerede gösterir: farklı pikseller kırmızı, farklı bölgeler kutulu (Fark), sürgüyle üst üste (Perde) ya da yan yana. Detay: [docs/03 > Görsel karşılaştırma](docs/03-state-eslestirme.md#görsel-karşılaştırma)
- **Şu anki node seçilirse** (kartta "(şu anki node)" etiketli olan) iki seçenek sunulur: **Kendine dönen edge olarak kaydet** (self-loop; sayfanın durumunu değiştirmeyen bir işlem için) ya da **Node oluşturma, aksiyonlara devam et** (hiçbir şey kaydedilmez, aksiyonlar "Bekleyen aksiyonlar"da kalır ve birikmeye devam eder).
- **Bekleyen aksiyon yoksa node oluşturulmaz.** İlk node hariç, son node'dan beri hiç aksiyon kaydedilmediyse "Node oluştur" butonu kilitlidir, çünkü aksiyonsuz bir edge tekrar oynatılamaz. Ayarlar'da işareti kaldırılmış aksiyonlar sayılmaz.

Panelde diğer işlemler:

- **Graph'taki bir node veya edge'e tıklamak:** detay kartını açar. Node için ekran görüntüsünü, edge için kaydedilmiş aksiyon listesini gösterir.
- **İsmi kaydet:** otomatik verilen ismi (`e_Cart1Items` gibi) daha anlamlı bir isimle değiştirir.
- **Edge aksiyonlarını düzenlemek:** edge detayında her aksiyonun yanında "ekranı değiştirdi / değiştirmedi" işareti ve sil butonu (✕) vardır. Ekranı değiştirmeyen aksiyon (ör. iki kez tıklanmış aynı buton) doğrudan silinir; ekranı değiştiren aksiyon için gerekçeli uyarı çıkar. En az bir aksiyon kalır, aksiyon eklenemez (eksik aksiyon için edge yeniden kaydedilir). Silme **Geri al** ile geri alınır. Detay: [docs/01 > Edge düzenleme](docs/01-mimari.md#edge-düzenleme)
- **Aydınlık / karanlık tema:** sağ üstte çarkın solundaki ay/güneş simgesi. Seçim hatırlanır; seçim yapılmadıysa sistem teması kullanılır.
- **Buradan devam et:** bir sonraki edge'in hangi node'dan çıkacağını elle seçer. Kayda geçirmeden bilinen bir duruma döndüyseniz kullanın. Kayıt sekmesi kapandıysa kayıt, butona bastığınız sekmede sürer.
- **Birleştir…:** seçili node'u başka bir node ile birleştirir (ör. yanlışlıkla "Hayır, yeni node" denerek oluşmuş kopyalar). Sadece URL şablonu ve edge set'i birebir aynı node'lar seçilebilir; diğerleri sebebiyle pasif görünür. Kalacak node seçilir, diğerinin edge'leri ona bağlanır. Tekrar eden edge'lere dokunulmaz, sayısı bildirilir. Geri al ile geri alınır. Detay: [docs/01 > Node birleştirme](docs/01-mimari.md#node-birleştirme)
- **Sil:** seçili node'u (ve ona bağlı edge'leri) ya da seçili edge'i siler.
- **Geri al** (araç çubuğu) ya da **Ctrl+Z:** son silmeyi geri alır: node (bağlı edge'leriyle birlikte), edge ya da edge'den silinen aksiyon eski yerine döner. Son 20 silme saklanır. Butonun üzerine gelince neyin geri alınacağı yazar. Ctrl+Z için panele odaklanmış olmak gerekir; isim alanında yazarken Ctrl+Z metni geri alır.
- **Sıfırla:** graph'ı temizler (ayarlar kalır). Yanlışlıkla basılmasın diye iki kez tıklamak gerekir. Sıfırlama geri alınamaz.
- **Ayarlar** (sağ üstteki çark simgesi, panelin üstünde açılan pencere): iki checklist ve beklemeler. Değişiklikler **Kaydet**'e basınca uygulanır; Kaydet yalnızca bir değişiklik varken aktiftir. Kaydetmeden kapatmaya çalışırsanız (✕, Esc ya da pencere dışına tıklama) "Kaydet ve çık / Kaydetmeden çık / Geri dön" uyarısı çıkar.
  - *Kaydedilecek aksiyonlar:* işaretsiz tipteki aksiyonlar (ör. Kaydır) "Bekleyen aksiyonlar"a eklenmez. **Üzerine gelme (fare)** varsayılan kapalıdır: işaretlenirse fareyi üzerine getirince açılan menüler (ekranı değiştirdiyse) `hover` aksiyonu olarak kaydedilir. Detay: [docs/01 > Fareyle üzerine gelme](docs/01-mimari.md#fareyle-üzerine-gelme)
  - *Beklemeler:* **Beklemeleri kaydet** açıkken iki aksiyon arasındaki, **alt sınırdan** (varsayılan 1 sn) uzun boşluklar "Bekle" aksiyonu olarak kaydedilir. Kayıt sekmesinin ekranı sürekli izlenir: ekran beklerken kendiliğinden değişirse (ör. internet bankacılığında oturum zaman aşımı) bekleme "ekranı değiştirdi" işaretini alır; böylece hiçbir tıklamayla ulaşılamayan bu durum da graph'a girer (`e_Wait`). Varsayılan kapalı. Detay: [docs/01 > Beklemeler](docs/01-mimari.md#beklemeler)
  - *State'e dahil edilecek etkileşimli elementler:* işaretsiz türdeki elementler (ör. Link) state'e girmez. "Node oluştur"da yeni sayfa ve tüm mevcut node'lar o anki seçime göre karşılaştırılır. Detay: [docs/03 > Ayarlar](docs/03-state-eslestirme.md#ayarlar-hangi-türler-statee-girer)

> saucedemo'daki şifre herkese açık olduğu için Chrome bir "şifreniz bir veri ihlalinde bulundu" uyarısı gösterebilir. Uyarıyı kapatıp devam edin; eklentiyle ilgisi yoktur.

---

## 4. Klasör yapısı

```
bitirme_demo/
├── README.md                    ← bu dosya: genel bakış, kurulum, kullanım
├── docs/                        ← detaylı dokümantasyon (okuma sırasıyla numaralı)
│   ├── 01-mimari.md             ← bileşenler, mesajlaşma, "Node oluştur" akışı
│   ├── 02-teknolojiler.md       ← her teknoloji neden seçildi, alternatifleri neden değil
│   ├── 03-state-eslestirme.md   ← "bu sayfa zaten bir node mu?" algoritması
│   ├── 04-veri-modeli.md        ← state, node, edge, aksiyon şemaları + GraphWalker eşlemesi
│   └── 05-gelistirme.md         ← geliştirme döngüsü, hata ayıklama, genişletme
│
├── extension/                   ← Chrome'a yüklenen klasör (build yok, olduğu gibi çalışır)
│   ├── manifest.json            ← eklentinin kimlik kartı: izinler, hangi dosya nerede çalışır
│   ├── background.js            ← BEYİN: graph state'i, node/edge mantığı, state eşleştirme
│   ├── content.js               ← SENSÖR: her sayfaya enjekte edilir, aksiyonları yakalar
│   ├── fingerprint.js           ← PARMAK İZİ: ekranın state'inin tanımı (content.js ve runner ortak kullanır)
│   ├── settings.js              ← AYARLAR: aksiyon/element türü listeleri ve state karşılaştırması (her parça yükler)
│   ├── scenario.js              ← SENARYO: test yollarının biçimi ve kapsama (panel ve runner ortak kullanır)
│   ├── sidepanel/               ← ARAYÜZ: Chrome'un yan panelinde açılan sayfa
│   │   ├── panel.html           ←   iskelet (butonlar, kartlar, graph alanı)
│   │   ├── panel.css            ←   görünüm (aydınlık / karanlık tema renkleri)
│   │   ├── panel.js             ←   state'i okur, Cytoscape ile çizer, butonları bağlar
│   │   ├── compare.js           ←   onay kartındaki görsel karşılaştırma (piksel farkı, bölgeler)
│   │   ├── replay.js            ←   panelde oynatma: seçili koşu bu tarayıcıda (DevTools protokolü)
│   │   └── theme.js             ←   tema seçimi (sayfa çizilmeden önce uygulanır)
│   └── lib/
│       └── cytoscape.min.js     ← graph çizim kütüphanesi (v3.34.3, MIT lisanslı)
│
└── runner/                      ← kaydedilen yolu tarayıcıda tekrar oynatır ve doğrular (Node.js + Playwright)
    ├── README.md                ← kurulum, kullanım, nasıl çalışır
    ├── run.js                   ← komut satırı ve akış
    └── lib/                     ← model ve yol, sayfa, aksiyonlar, doğrulama
```

Eklenti yaklaşık **4750 satır** (yorumlar dahil): `panel.js` ~1320, `background.js` ~970, `content.js` ~850, `replay.js` ~470, `fingerprint.js` ~180, `compare.js` ~170, `settings.js` ~150; geri kalanı HTML/CSS/manifest. Kütüphane hariç tek bir dış bağımlılık yoktur. Runner yaklaşık 870 satırdır; tek bağımlılığı Playwright'tır ve yalnızca `runner/` klasöründedir.

---

## 5. Mimari (özet)

Eklenti, Chrome'un bize verdiği üç farklı çalışma ortamına bölünmüştür. Her parçanın tek bir işi vardır:

```
   ┌─────────────────────┐   ACTION (her tıklama/yazma)   ┌──────────────────────────┐
   │ content.js  SENSÖR  │ ─────────────────────────────▶ │                          │
   │ (her web sayfasında)│ ◀───────────────────────────── │  background.js   BEYİN   │
   └─────────────────────┘   GET_FINGERPRINT (parmak izi) │  (service worker)        │
                                                          │                          │
   ┌─────────────────────┐   CREATE_NODE, RESOLVE,        │  state'in TEK yazarı     │
   │ panel.js    ARAYÜZ  │   RENAME, DELETE ...           │                          │
   │ (yan panel)         │ ─────────────────────────────▶ └────────────┬─────────────┘
   └─────────▲───────────┘                                             │ yazar
             │ storage.onChanged ile otomatik yeniden çizim            ▼
             └──────────────────────────────────────────── chrome.storage.local
```

- **content.js** sayfanın içinde çalışır ve DOM'a erişebilir. Ama sayfa değişince yok olur, bu yüzden hiçbir şey saklamaz.
- **background.js** sayfalardan bağımsız yaşar. State'i ve ayarları yalnızca o değiştirir.
- **panel.js** state'i ve ayarları yalnızca okur ve çizer. Bir değişiklik istediğinde background'a mesaj gönderir.
- **settings.js** üçünün ortak kullandığı listeleri (aksiyon tipleri, etkileşimli element türleri) ve state karşılaştırmasını tanımlar.
- **fingerprint.js** ekranın state'inin (parmak izinin) tanımıdır. content.js ve runner aynı dosyayı kullanır: kayıt ile test aynı state tanımıyla çalışır.

Detaylar için: [docs/01-mimari.md](docs/01-mimari.md)

---

## 6. Kullanılan teknolojiler (özet)

| Teknoloji | Ne için | Neden bu |
|---|---|---|
| **Chrome Extension, Manifest V3** | Kullanıcının kendi tarayıcısında, kendi oturumuyla gezerken kayıt | Kurulum gerektirmeyen tek gerçekçi yol. MV2 artık Chrome'da çalışmıyor. |
| **Side Panel API** | Arayüz | Popup sayfaya tıklayınca kapanır. Sayfaya gömülü bir arayüz de kaydı ve parmak izini kirletir. Yan panel ise açık kalır ve sayfadan ayrıdır. |
| **Vanilla JavaScript** (build yok) | Tüm kod | Okuması ve sunması en kolay seçenek. Yükleme süresi sıfır, araç zinciri ve sürüm sorunu yok. |
| **Cytoscape.js** | Graph çizimi | Yönlü graph, self-loop ve paralel edge desteği hazır. Tek dosya, bağımlılığı yok. |
| **chrome.storage.local** | State'in kalıcı yeri | Service worker her an kapanabilir, RAM'e güvenilemez. Panel bu alanın değişikliklerini dinleyebilir. |
| **Edge set (sayılı küme) birebir eşitliği** | "Bu sayfa zaten bir node mu?" | Farklı edge set'leri asla birleştirmez; edge hedefleri de aynı düzeyde ("türün n'incisi") tutulduğu için çakışma olmaz. Eşik yok, deterministik. |

Her seçimin gerekçesi ve elenen alternatifler: [docs/02-teknolojiler.md](docs/02-teknolojiler.md)

---

## 7. Demo neyi yapar, neyi yapmaz

**Yapar:**

- Tıklama, form doldurma (text/select/checkbox ve zengin metin editörleri), Enter, komut tuşları (Escape, oklar, kısayollar; metin harf harf kaydedilmez), metin seçme (fare ve klavye), kopyala/kes/yapıştır (sayfa engellediyse o da kaydedilir), sağ tık menüsü, ekranı değiştiren Tab odağı, kaydırma (sayfa ve kaydırılabilir kutular), tarayıcı yakınlaştırma/uzaklaştırma, pencere boyutu değişimi, adres çubuğundan gezinme, geri/ileri ve yenileme aksiyonlarını kaydeder. İstenirse aksiyonlar arasındaki beklemeleri de kaydeder; yalnızca beklenerek ulaşılan durumlar (oturum zaman aşımı) da graph'a girer.
- Her node'un görünen alanını (viewport: sayfanın CSS piksel boyutu ve piksel oranı) kaydeder; test, testi çalıştıranın ekranından bağımsız olarak kayıttaki boyutta çalıştırılabilir. Bkz. [docs/03 > Pencere boyutu ve state](docs/03-state-eslestirme.md#pencere-boyutu-ve-state)
- Her aksiyon için tekrar oynatılabilir bir CSS selector üretir (`#login-button`, `[data-test=...]` gibi).
- Node'lar için ekran görüntüsü alır ve graph'ın içinde küçük resim olarak gösterir.
- Ekranda tıklanabilen etkileşimli element kümesi değişen her durumu (kaydırma dahil) ayrı sayar; birebir aynı kümeyi daha önce görülmüş durum olarak kullanıcıya önerir.
- Ayarlar'dan hangi aksiyon tiplerinin kaydedileceği ve hangi element türlerinin state'e gireceği seçilir.
- Node ve edge'leri GraphWalker geleneğine uygun isimlendirir (`v_Inventory`, `e_Login`).
- Şifre alanlarını maskeler (`******`).
- Graph'ı **GraphWalker JSON modeli** olarak dışa aktarır. URL, parmak izi, ekran görüntüsü ve kaydedilen tarayıcı aksiyonları GraphWalker'ın `properties` alanlarında taşınır. GraphWalker CLI 4.3.3 ile doğrulandı (`check`, `offline`). Bkz. [docs/04 > Dışa aktarılan JSON](docs/04-veri-modeli.md#dışa-aktarılan-json)
- Akış birden fazla sekmeye yayılabilir: site yeni sekme açtığında ya da kullanıcı başka bir sitenin sekmesine geçtiğinde panel "Bu sekmede devam edilsin mi?" diye sorar. "Evet" denirse kayıt orada sürer, "Hayır" denirse o sekme kaydı kirletmez. Bkz. [docs/01 > Kayıt hangi sekmede?](docs/01-mimari.md#kayıt-hangi-sekmede)
- Panelde test senaryosu kurulur ve graph üzerinde önizlenir (bir ya da birden fazla koşu); senaryo dosyaya indirilir.
- Seçili koşu **panelde, kullanıcının kendi tarayıcısında** oynatılır ve izlenir: gerçek fare ve klavye olaylarıyla (DevTools protokolü), her edge'den sonra aynı doğrulamayla. Başlangıç sayfası kullanıcının sorumluluğudur; ekran koşunun ilk node'u değilse uyarı çıkar, görünen alan farklıysa **Başlangıç node'unun boyutuna getir** pencereyi ve yakınlaştırmayı kayıttakine ayarlar. Koşuların başlangıç node'u Senaryo bölümünden seçilebilir (graph'ın başlangıcı dışındaki başlangıç yalnızca panelde oynatılır). Bkz. [docs/01 > Panelde oynatma](docs/01-mimari.md#panelde-oynatma)
- Senaryoyu (ya da GraphWalker'ın ürettiği bir yolu) **runner** ile gerçek bir tarayıcıda tekrar oynatır ve her edge'den sonra varılan ekranı, kayıttaki state tanımıyla doğrular. Her koşu temiz oturumla başlar; kayıttaki görünen alan ve yakınlaştırma aynen kurulur. Sonuç HTML (fark ve görsel fark dahil), JSON ve JUnit XML raporu olarak yazılır. Bkz. [runner/README.md](runner/README.md)

**Yapmaz (bilinçli olarak kapsam dışı):**

- iframe içi ve Shadow DOM içi aksiyonlar
- Sürükle-bırak. (Fareyle üzerine gelince açılan menüler Ayarlar'dan isteğe bağlı olarak kaydedilir.)
- GraphWalker için test kodu (Java) üretmek. Kayıt runner ile tekrar oynatılır ama kod üretilmez, bkz. [docs/05-gelistirme.md](docs/05-gelistirme.md#yol-haritası).
- JSON'u geri içe aktarma

---

## 8. Doküman haritası

Okuma sırası önerisi:

1. **[01-mimari.md](docs/01-mimari.md):** Parçalar nasıl konuşuyor? "Node oluştur"a basınca adım adım ne oluyor?
2. **[02-teknolojiler.md](docs/02-teknolojiler.md):** Neden bu teknolojiler? Alternatifler neden elendi?
3. **[03-state-eslestirme.md](docs/03-state-eslestirme.md):** Projenin akademik çekirdeği. İki sayfanın "aynı durum" olduğuna nasıl karar veriliyor?
4. **[04-veri-modeli.md](docs/04-veri-modeli.md):** Kaydedilen verinin tam şeması ve GraphWalker'a nasıl aktarılacağı
5. **[05-gelistirme.md](docs/05-gelistirme.md):** Kodu değiştirme, hata ayıklama, yeni özellik ekleme ve yol haritası
6. **[runner/README.md](runner/README.md):** Kaydedilen yolu tarayıcıda tekrar oynatmak ve her adımı doğrulamak
