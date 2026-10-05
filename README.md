# Graph Recorder: Gezerek Test Modeli Çıkarma (Demo)

Bir web sitesinde normal şekilde gezerken, o sitenin **durum grafiğini** (state graph) yarı otomatik olarak çıkaran bir Chrome eklentisi.

Kullanıcı yalnızca "şu an önemli bir durumdayım" demek için **Node oluştur** butonuna basar. İki basış arasında yaptığı tıklama, yazma ve gezinmeler otomatik olarak **edge** (geçiş) olarak kaydedilir. Ziyaret edilen sayfa daha önce kaydedilmiş bir durumsa sistem bunu fark eder ve kullanıcıya "Bu aynı node mu?" diye sorar.

> Bu demo GraphWalker'dan **bağımsızdır**. Amaç, graph'ın tarayıcıda gezerken çıkarılabildiğini göstermektir. Veri modeli GraphWalker'a kolayca aktarılacak şekilde tasarlanmıştır (bkz. [docs/04-veri-modeli.md](docs/04-veri-modeli.md)).

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

- **İnsan:** "Node oluştur"a basar ("bu bir durum"). Benzer node önerisini onaylar ya da reddeder.
- **Makine:** İki basış arasındaki aksiyonları kaydeder. Sayfanın parmak izini ve ekran görüntüsünü alır. Daha önce görülmüş bir durumu tanıyıp önerir. Node ve edge'leri isimlendirip graph'ı çizer.

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
| 4 | Bir ürünü **Add to cart** ile sepete ekleyin | **Node oluştur** | Panel sorar: *"Bu sayfa mevcut v_Inventory node'una %92 benziyor. Aynı state mi?"* |
| 5 | | **Evet, aynı node** | `v_Inventory` üzerinde kendine dönen bir `e_AddToCart` edge'i (self-loop) oluşur. |
| 6 | Sepet ikonuna tıklayın | **Node oluştur** | Yeni node `v_Cart` ve `e_Cart...` edge'i oluşur. |
| 7 | **Continue Shopping**'e basın | **Node oluştur**, sonra **Evet** | `v_Cart → v_Inventory` edge'i oluşur. Graph'ta döngü kapanır. |
| 8 | | **JSON indir** | Tüm graph bir `.json` dosyasına iner. |

**Temel kural:** "Evet, aynı node" cevabı yeni node oluşturmaz, **şu anki node'dan aynı olduğu düşünülen node'a bir edge çizer.** Hiçbir aksiyon yapmadan aynı sayfada tekrar "Node oluştur"a basarsanız çizilecek bir şey olmadığı için soru sorulmaz; panel mavi bir bilgi mesajı gösterir.

Panelde diğer işlemler:

- **Graph'taki bir node veya edge'e tıklamak:** detay kartını açar. Node için ekran görüntüsünü, edge için kaydedilmiş aksiyon listesini gösterir.
- **İsmi kaydet:** otomatik verilen ismi (`e_Cart1Items` gibi) daha anlamlı bir isimle değiştirir.
- **Buradan devam et:** bir sonraki edge'in hangi node'dan çıkacağını elle seçer. Kayda geçirmeden bilinen bir duruma döndüyseniz kullanın.
- **Sil:** seçili node'u (ve ona bağlı edge'leri) ya da seçili edge'i siler.
- **Sıfırla:** her şeyi temizler. Yanlışlıkla basılmasın diye iki kez tıklamak gerekir.

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
└── extension/                   ← Chrome'a yüklenen klasör (build yok, olduğu gibi çalışır)
    ├── manifest.json            ← eklentinin kimlik kartı: izinler, hangi dosya nerede çalışır
    ├── background.js            ← BEYİN: graph state'i, node/edge mantığı, state eşleştirme
    ├── content.js               ← SENSÖR: her sayfaya enjekte edilir, aksiyonları yakalar
    ├── sidepanel/               ← ARAYÜZ: Chrome'un yan panelinde açılan sayfa
    │   ├── panel.html           ←   iskelet (butonlar, kartlar, graph alanı)
    │   ├── panel.css            ←   görünüm
    │   └── panel.js             ←   state'i okur, Cytoscape ile çizer, butonları bağlar
    └── lib/
        └── cytoscape.min.js     ← graph çizim kütüphanesi (v3.34.3, MIT lisanslı)
```

Toplam kod yaklaşık **950 satır**: `background.js` ~320, `panel.js` ~270, `content.js` ~175, geri kalanı HTML/CSS/manifest. Kütüphane hariç tek bir dış bağımlılık yoktur.

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
- **background.js** sayfalardan bağımsız yaşar. State'i yalnızca o değiştirir.
- **panel.js** state'i yalnızca okur ve çizer. Bir değişiklik istediğinde background'a mesaj gönderir.

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
| **Jaccard benzerliği** | "Bu sayfa zaten bir node mu?" | Basit, açıklanabilir, hızlı. Kararı zaten kullanıcı onaylıyor. |

Her seçimin gerekçesi ve elenen alternatifler: [docs/02-teknolojiler.md](docs/02-teknolojiler.md)

---

## 7. Demo neyi yapar, neyi yapmaz

**Yapar:**

- Tıklama, form doldurma (text/select/checkbox), Enter, adres çubuğundan gezinme, geri/ileri ve yenileme aksiyonlarını kaydeder.
- Her aksiyon için tekrar oynatılabilir bir CSS selector üretir (`#login-button`, `[data-test=...]` gibi).
- Node'lar için ekran görüntüsü alır ve graph'ın içinde küçük resim olarak gösterir.
- Daha önce görülmüş durumları tanıyıp kullanıcıya önerir.
- Node ve edge'leri GraphWalker geleneğine uygun isimlendirir (`v_Inventory`, `e_Login`).
- Şifre alanlarını maskeler (`******`).
- Graph'ı JSON olarak dışa aktarır.

**Yapmaz (bilinçli olarak kapsam dışı):**

- iframe içi ve Shadow DOM içi aksiyonlar
- Birden fazla sekmeye yayılan akışlar (kayıt tek sekmeye bağlıdır)
- Sürükle-bırak, hover menüler, klavye kısayolları
- GraphWalker formatına export ve kaydı tekrar oynatma (replay). Bunlar bir sonraki adımdır, bkz. [docs/05-gelistirme.md](docs/05-gelistirme.md#yol-haritası).
- JSON'u geri içe aktarma

---

## 8. Doküman haritası

Okuma sırası önerisi:

1. **[01-mimari.md](docs/01-mimari.md):** Parçalar nasıl konuşuyor? "Node oluştur"a basınca adım adım ne oluyor?
2. **[02-teknolojiler.md](docs/02-teknolojiler.md):** Neden bu teknolojiler? Alternatifler neden elendi?
3. **[03-state-eslestirme.md](docs/03-state-eslestirme.md):** Projenin akademik çekirdeği. İki sayfanın "aynı durum" olduğuna nasıl karar veriliyor?
4. **[04-veri-modeli.md](docs/04-veri-modeli.md):** Kaydedilen verinin tam şeması ve GraphWalker'a nasıl aktarılacağı
5. **[05-gelistirme.md](docs/05-gelistirme.md):** Kodu değiştirme, hata ayıklama, yeni özellik ekleme ve yol haritası
