# Graph Recorder: Gezerek Test Modeli Çıkarma (Demo)

Bir web sitesinde normal şekilde gezerken, o sitenin **durum grafiğini** (state graph) yarı otomatik olarak çıkaran bir Chrome eklentisi.

Kullanıcı yalnızca "şu an önemli bir durumdayım" demek için **Node oluştur** butonuna basar. İki basış arasında yaptığı tıklama, yazma, kaydırma ve gezinmeler otomatik olarak **edge** (geçiş) olarak kaydedilir. Ekranda tıklanabilen etkileşimli elementler (butonlar, linkler, alanlar) daha önce kaydedilmiş bir node'unkilerle birebir aynıysa sistem kullanıcıya "Bu aynı node mu?" diye sorar. Element kümesi tek bir elementle bile farklıysa, sayfa ne kadar benzer olursa olsun soru sorulmadan yeni node oluşur.

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

**Temel kurallar:**

- **Edge set farklıysa her zaman yeni node.** Edge set, ekranda tıklanabilen etkileşimli elementlerin **türleri ve sayılarıdır** (ör. `button:Sil ×5`). Bir tür eklenmiş, çıkmış, değişmiş, `disabled` olmuş, kaydırma ile ekran dışına çıkmış ya da bir türün sayısı değişmişse (5 Sil yerine 4) soru sorulmaz. Sebebi: bir node'dan çıkan edge'ler o node'daki elementlere dayanır; farklı edge set'leri tek node saymak edge'lerin çakışmasına yol açar. Edge'ler de hedeflerini aynı düzeyde kaydeder ("ekrandaki 2. `button:Sil`"), böylece aynı state sayılan ekranlarda her hedef bulunur. Detay: [docs/03-state-eslestirme.md](docs/03-state-eslestirme.md#neden-benzerlik-değil-birebir-eşitlik)
- **Kaydırma da bir aksiyondur.** State yalnızca ekranda görünen elementlerden oluşur; DOM'da olup ekran dışında kalanlar sayılmaz. Sayfayı kaydırıp "Node oluştur"a basarsanız: ekrandaki küme değiştiyse soru sorulmadan yeni node (`e_ScrollDown`), aynı kaldıysa "aynı state mi?" sorusu gelir. Detay: [docs/03 > Kaydırma ve state](docs/03-state-eslestirme.md#kaydırma-ve-state)
- **"Evet, bu node"** cevabı yeni node oluşturmaz, **şu anki node'dan seçilen node'a bir edge çizer.** Sayfa birden fazla node ile birebir aynıysa onay kartı hepsini ekran görüntüleriyle listeler; doğru olanı seçersiniz ya da "Hiçbiri, yeni node" dersiniz.
- **Şu anki node seçilirse** (kartta "(şu anki node)" etiketli olan) iki seçenek sunulur: **Kendine dönen edge olarak kaydet** (self-loop; sayfanın durumunu değiştirmeyen bir işlem için) ya da **Node oluşturma, aksiyonlara devam et** (hiçbir şey kaydedilmez, aksiyonlar "Bekleyen aksiyonlar"da kalır ve birikmeye devam eder).
- **Bekleyen aksiyon yoksa node oluşturulmaz.** İlk node hariç, son node'dan beri hiç aksiyon kaydedilmediyse "Node oluştur" butonu kilitlidir, çünkü aksiyonsuz bir edge tekrar oynatılamaz. Ayarlar'da işareti kaldırılmış aksiyonlar sayılmaz.

Panelde diğer işlemler:

- **Graph'taki bir node veya edge'e tıklamak:** detay kartını açar. Node için ekran görüntüsünü, edge için kaydedilmiş aksiyon listesini gösterir.
- **İsmi kaydet:** otomatik verilen ismi (`e_Cart1Items` gibi) daha anlamlı bir isimle değiştirir.
- **Edge aksiyonlarını düzenlemek:** edge detayında her aksiyonun yanında "ekranı değiştirdi / değiştirmedi" işareti ve sil butonu (✕) vardır. Ekranı değiştirmeyen aksiyon (ör. iki kez tıklanmış aynı buton) doğrudan silinir; ekranı değiştiren aksiyon için gerekçeli uyarı çıkar. En az bir aksiyon kalır, aksiyon eklenemez (eksik aksiyon için edge yeniden kaydedilir). Silme **Geri al** ile geri alınır. Detay: [docs/01 > Edge düzenleme](docs/01-mimari.md#edge-düzenleme)
- **Aydınlık / karanlık tema:** sağ üstte çarkın solundaki ay/güneş simgesi. Seçim hatırlanır; seçim yapılmadıysa sistem teması kullanılır.
- **Buradan devam et:** bir sonraki edge'in hangi node'dan çıkacağını elle seçer. Kayda geçirmeden bilinen bir duruma döndüyseniz kullanın. Kayıt sekmesi kapandıysa kayıt, butona bastığınız sekmede sürer.
- **Sil:** seçili node'u (ve ona bağlı edge'leri) ya da seçili edge'i siler.
- **Geri al** (araç çubuğu) ya da **Ctrl+Z:** son silmeyi geri alır: node (bağlı edge'leriyle birlikte), edge ya da edge'den silinen aksiyon eski yerine döner. Son 20 silme saklanır. Butonun üzerine gelince neyin geri alınacağı yazar. Ctrl+Z için panele odaklanmış olmak gerekir; isim alanında yazarken Ctrl+Z metni geri alır.
- **Sıfırla:** graph'ı temizler (ayarlar kalır). Yanlışlıkla basılmasın diye iki kez tıklamak gerekir. Sıfırlama geri alınamaz.
- **Ayarlar** (sağ üstteki çark simgesi, panelin üstünde açılan pencere): iki checklist. Değişiklikler **Kaydet**'e basınca uygulanır; Kaydet yalnızca bir değişiklik varken aktiftir. Kaydetmeden kapatmaya çalışırsanız (✕, Esc ya da pencere dışına tıklama) "Kaydet ve çık / Kaydetmeden çık / Geri dön" uyarısı çıkar.
  - *Kaydedilecek aksiyonlar:* işaretsiz tipteki aksiyonlar (ör. Kaydır) "Bekleyen aksiyonlar"a eklenmez.
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
└── extension/                   ← Chrome'a yüklenen klasör (build yok, olduğu gibi çalışır)
    ├── manifest.json            ← eklentinin kimlik kartı: izinler, hangi dosya nerede çalışır
    ├── background.js            ← BEYİN: graph state'i, node/edge mantığı, state eşleştirme
    ├── content.js               ← SENSÖR: her sayfaya enjekte edilir, aksiyonları yakalar
    ├── settings.js              ← AYARLAR: aksiyon/element türü listeleri ve edge set karşılaştırması (üç parça da yükler)
    ├── sidepanel/               ← ARAYÜZ: Chrome'un yan panelinde açılan sayfa
    │   ├── panel.html           ←   iskelet (butonlar, kartlar, graph alanı)
    │   ├── panel.css            ←   görünüm (aydınlık / karanlık tema renkleri)
    │   ├── panel.js             ←   state'i okur, Cytoscape ile çizer, butonları bağlar
    │   └── theme.js             ←   tema seçimi (sayfa çizilmeden önce uygulanır)
    └── lib/
        └── cytoscape.min.js     ← graph çizim kütüphanesi (v3.34.3, MIT lisanslı)
```

Toplam kod yaklaşık **1250 satır** (yorumlar dahil): `background.js` ~380, `panel.js` ~330, `content.js` ~275, `settings.js` ~45, geri kalanı HTML/CSS/manifest. Kütüphane hariç tek bir dış bağımlılık yoktur.

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
- **settings.js** üçünün ortak kullandığı listeleri (aksiyon tipleri, etkileşimli element türleri) tanımlar.

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

- Tıklama, form doldurma (text/select/checkbox), Enter, kaydırma (sayfa ve kaydırılabilir kutular), adres çubuğundan gezinme, geri/ileri ve yenileme aksiyonlarını kaydeder.
- Her aksiyon için tekrar oynatılabilir bir CSS selector üretir (`#login-button`, `[data-test=...]` gibi).
- Node'lar için ekran görüntüsü alır ve graph'ın içinde küçük resim olarak gösterir.
- Ekranda tıklanabilen etkileşimli element kümesi değişen her durumu (kaydırma dahil) ayrı sayar; birebir aynı kümeyi daha önce görülmüş durum olarak kullanıcıya önerir.
- Ayarlar'dan hangi aksiyon tiplerinin kaydedileceği ve hangi element türlerinin state'e gireceği seçilir.
- Node ve edge'leri GraphWalker geleneğine uygun isimlendirir (`v_Inventory`, `e_Login`).
- Şifre alanlarını maskeler (`******`).
- Graph'ı **GraphWalker JSON modeli** olarak dışa aktarır. URL, parmak izi, ekran görüntüsü ve kaydedilen tarayıcı aksiyonları GraphWalker'ın `properties` alanlarında taşınır. GraphWalker CLI 4.3.3 ile doğrulandı (`check`, `offline`). Bkz. [docs/04 > Dışa aktarılan JSON](docs/04-veri-modeli.md#dışa-aktarılan-json)

**Yapmaz (bilinçli olarak kapsam dışı):**

- iframe içi ve Shadow DOM içi aksiyonlar
- Birden fazla sekmeye yayılan akışlar (kayıt tek sekmeye bağlıdır)
- Sürükle-bırak, hover menüler, klavye kısayolları
- GraphWalker için test kodu üretmek ve kaydı tekrar oynatmak (replay). Bunlar bir sonraki adımdır, bkz. [docs/05-gelistirme.md](docs/05-gelistirme.md#yol-haritası).
- JSON'u geri içe aktarma

---

## 8. Doküman haritası

Okuma sırası önerisi:

1. **[01-mimari.md](docs/01-mimari.md):** Parçalar nasıl konuşuyor? "Node oluştur"a basınca adım adım ne oluyor?
2. **[02-teknolojiler.md](docs/02-teknolojiler.md):** Neden bu teknolojiler? Alternatifler neden elendi?
3. **[03-state-eslestirme.md](docs/03-state-eslestirme.md):** Projenin akademik çekirdeği. İki sayfanın "aynı durum" olduğuna nasıl karar veriliyor?
4. **[04-veri-modeli.md](docs/04-veri-modeli.md):** Kaydedilen verinin tam şeması ve GraphWalker'a nasıl aktarılacağı
5. **[05-gelistirme.md](docs/05-gelistirme.md):** Kodu değiştirme, hata ayıklama, yeni özellik ekleme ve yol haritası
