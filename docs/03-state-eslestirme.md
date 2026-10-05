# 03: State Eşleştirme: "Bu sayfa zaten bir node mu?"

Kullanıcı "Node oluştur"a bastığında sistemin cevaplaması gereken soru şu: **Bu durum daha önce kaydettiğimiz bir node mu, yoksa yeni bir durum mu?**

Bu soru projenin akademik çekirdeğidir. Tamamen otomatik araçlar tam da bu noktada zorlanır: hangi DOM farkı "yeni durum", hangisi "aynı durum, farklı veri"? Bizim yaklaşımımız soruyu **makineye çözdürmek** yerine **makineye önerdirip insana onaylatmaktır.**

İlgili kod: `background.js > findSimilarNode()`, `jaccard()`, `urlKey()` ve `content.js > fingerprint()`, `elementKey()`.

## İçindekiler

- [Algoritma (iki aşama)](#algoritma-iki-aşama)
- [Aşama 1: URL şablonu](#aşama-1-url-şablonu)
- [Aşama 2: Yapısal parmak izi ve Jaccard benzerliği](#aşama-2-yapısal-parmak-izi-ve-jaccard-benzerliği)
- [Eşik değeri neden 0.6?](#eşik-değeri-neden-06)
- [Gerçek ölçümler (saucedemo.com)](#gerçek-ölçümler-saucedemocom)
- [Bilinen zayıflıklar](#bilinen-zayıflıklar)
- [Elenen alternatif yöntemler](#elenen-alternatif-yöntemler)
- [Geliştirme fikirleri (tez için)](#geliştirme-fikirleri-tez-için)

---

## Algoritma (iki aşama)

```
yeni sayfa ──▶ Aşama 1: URL şablonu aynı olan node'ları bul (aday listesi)
                  │
                  ▼
               Aşama 2: her aday için Jaccard(aday.elements, sayfa.elements)
                  │
                  ▼
               en yüksek skor ≥ 0.6 ?
                  ├─ evet ─▶ kullanıcıya sor: "X node'una %NN benziyor. Aynı mı?"
                  └─ hayır ─▶ yeni node oluştur (soru sorulmaz)
```

---

## Aşama 1: URL şablonu

URL'yi "sayfa şablonu"na indirgiyoruz (`urlKey()`):

| Kural | Örnek |
|---|---|
| Sorgu parametreleri (`?...`) atılır | `/inventory-item.html?id=4` → `/inventory-item.html` |
| Hash (`#...`) atılır | `/docs#kurulum` → `/docs` |
| Sayısal path parçaları `:id` olur | `/product/42` → `/product/:id` |
| 16+ karakterli hex/UUID parçaları `:id` olur | `/order/3f2a...-9c1b` → `/order/:id` |
| Sondaki `/` atılır | `/cart/` → `/cart` |

**Yalnızca URL şablonu aynı olan node'lar aday olabilir.** Bu bilinçli bir tercih: `/cart` ile `/checkout` hiçbir zaman "aynı durum" önerilmez.

**Neden URL tek başına yetmiyor?**

- Aynı URL'de farklı durumlar olabilir. Menü açık/kapalı, modal açık, hata mesajı gösteriliyor... SPA'larda (tek sayfa uygulamaları) URL hiç değişmeyebilir.
- Aynı URL şablonunda farklı içerik olabilir. `/product/1` ve `/product/2` *genelde* aynı durumdur, ama bu her sitede doğru değildir.

Bu yüzden URL yalnızca **aday filtresi** olarak kullanılıyor. Asıl karşılaştırma ikinci aşamada yapılıyor.

---

## Aşama 2: Yapısal parmak izi ve Jaccard benzerliği

### Parmak izi nedir?

Sayfadaki **görünür, etkileşimli** elementlerin (link, buton, input, select...) **yapısal anahtarlarının kümesi.** Bir elementin anahtarı, etiketi ile kimliğinden oluşur (`elementKey()`):

```
<button id="login-button">Login</button>        →  "button:login-button"
<input name="user-name">                        →  "input:user-name"
<select data-test="product-sort-container">     →  "select:product-sort-container"
<a href="/about">Hakkımızda</a>                 →  "a"
```

Kimlik için öncelik sırası: `id` > `data-testid` > `data-test` > `name` > `aria-label` > `type`. Hiçbiri yoksa sadece etiket adı kullanılır.

### Üç bilinçli tasarım kararı

1. **Metin dahil edilmez.** "Sauce Labs Backpack" linki ile "Bike Light" linki aynı anahtarı (`a`) üretir. Aksi halde 10 ürünlü liste ile 3 ürünlü liste farklı durum sayılırdı. Biz **"aynı ekran, farklı veri"**yi aynı durum saymak istiyoruz.
2. **Küme (Set) kullanılır.** 20 tane `a` anahtarlı link tek bir `a` olarak sayılır. Liste uzunluğu benzerliği etkilemez.
3. **Yalnızca görünür elementler sayılır** (`element.checkVisibility()`). Kapalı bir menünün linkleri DOM'da olsa bile sayılmaz. Menü açılınca bu linkler parmak izine girer ve durum farklılaşır.

### Jaccard benzerliği

İki kümenin ne kadar örtüştüğünü 0 ile 1 arasında ölçer:

```
              |A ∩ B|        ortak anahtar sayısı
Jaccard  =  ───────────  =  ─────────────────────────────
              |A ∪ B|        toplam farklı anahtar sayısı
```

**Örnek:** Ürün listesinde bir ürün sepete eklendiğinde butonun id'si `add-to-cart-backpack` iken `remove-backpack` olur:

```
Önce : { a, a:cart-link, button:add-to-cart-backpack, button:add-to-cart-bike, select:sort }
Sonra: { a, a:cart-link, button:remove-backpack,      button:add-to-cart-bike, select:sort }

Ortak : a, a:cart-link, button:add-to-cart-bike, select:sort    → 4
Toplam: yukarıdaki 4 + add-to-cart-backpack + remove-backpack   → 6
Jaccard = 4 / 6 = 0.67
```

**Neden Jaccard?** Hesaplaması basit (birkaç satır), kümelerin boyutundan bağımsız, simetrik ve kullanıcıya "%67 benziyor" diye tek cümleyle açıklanabiliyor.

---

## Eşik değeri neden 0.6?

`background.js` başında: `const SIMILARITY_THRESHOLD = 0.6;`

Sistem iki tür hata yapabilir. Bu iki hatanın **maliyeti eşit değildir**:

| Hata | Ne olur? | Kullanıcıya maliyeti |
|---|---|---|
| **Yanlış öneri** (farklı durumu "aynı" sanmak) | Onay kartı çıkar | **Düşük:** "Hayır, yeni node"a bir tık. |
| **Kaçırılan eşleşme** (aynı durumu "farklı" sanmak) | Soru sorulmadan kopya node oluşur | **Yüksek:** Kullanıcı fark etmeyebilir. Fark ederse kopyayı silip graph'ı elle düzeltmesi gerekir. |

Son kararı insan verdiği için eşiği **bilerek düşük** tuttuk: emin olmadığında sormak, sormamaktan iyidir. İlk denemede eşik 0.7'ydi. Yukarıdaki küçük test sayfasında (0.67) eşleşme kaçırıldığı için 0.6'ya düşürüldü.

---

## Gerçek ölçümler (saucedemo.com)

Eklenti, otomatik bir testle canlı saucedemo.com üzerinde çalıştırıldı. Ölçülen benzerlikler:

| Adım | Parmak izi boyutu | En iyi aday | Benzerlik | Sonuç |
|---|---|---|---|---|
| Giriş sayfası | 3 anahtar | (yok) | | Yeni node `v_SwagLabs` |
| Login sonrası ürün listesi | 24 | (farklı URL) | | Yeni node `v_Inventory` |
| Bir ürünü sepete ekle | 24 | `v_Inventory` | **0.92** | Önerildi (2 buton id'si değişti) |
| Sepet | 9 | (farklı URL) | | Yeni node `v_Cart` |
| Sepetten ürün listesine dön | 24 | `v_Inventory` | **0.92** | Önerildi |
| Ürün detayı (id=4) | 7 | (farklı URL) | | Yeni node `v_InventoryItem` |
| Başka ürün detayı (id=0) | 7 | `v_InventoryItem` | **0.75** | Önerildi (`?id=` atıldığı için aynı şablon) |
| Ürün detayında menüyü aç | 13 | `v_InventoryItem` | **0.54** | **Önerilmedi**, yeni node |

Son satır algoritmanın doğru ayırt ettiği bir durum: menü açıkken 6 yeni etkileşimli element (menü linkleri ve kapatma butonu) görünür hale gelir, sayfa yapısal olarak belirgin şekilde değişir. Bu, GraphWalker modellerinde genellikle ayrı bir durum (`v_MenuOpen`) olarak modellenir.

---

## Bilinen zayıflıklar

| Durum | Ne olur? | Olası çözüm |
|---|---|---|
| **Dinamik id'ler** (React'in `:r1:`, Ember'ın `ember123` gibi her yüklemede değişen id'leri) | Aynı sayfa her ziyarette farklı anahtarlar üretir, benzerlik düşer. | Bilinen dinamik id kalıplarını (`/^:r\d+:$/`, `/^ember\d+$/`) yok saymak |
| **Veriye bağlı id'ler** (`add-to-cart-<ürün-adı>`) | Filtre değişince farklı ürünler gelir, anahtarlar değişir. | id içindeki veri kısmını ayıklamak ya da id yerine `data-test` önekini kullanmak |
| **Ortak elementlerin ağırlığı** (header, menü, footer her sayfada aynı) | Küçük sayfalarda ortak kısım benzerliği yapay olarak yükseltir. | Her sayfada görülen anahtarlara daha düşük ağırlık vermek (TF-IDF benzeri) |
| **Farklı URL, aynı durum** (`/en/cart` ve `/de/cart`) | Hiç aday olmaz, kopya node oluşur. | URL normalizasyonuna dil kodu gibi kurallar eklemek |
| **Lazy-load / sonsuz kaydırma** | Kaydırma miktarına göre parmak izi değişir. | Pratikte düşük etki (Set kullanımı tekrarları eler) |
| **iframe / Shadow DOM içeriği** | Parmak izine girmez. | `all_frames: true` ve shadow root'ları gezmek |

---

## Elenen alternatif yöntemler

| Yöntem | Neden elendi |
|---|---|
| **Sadece URL** | SPA'larda ve aynı URL'deki farklı durumlarda (menü, modal, hata) çalışmaz. |
| **DOM ağacı düzenleme mesafesi** (tree edit distance) | Hesaplaması pahalı (O(n³)). Sonucu kullanıcıya açıklamak zor. Tüm DOM'u karşılaştırdığı için veri farklarına çok duyarlı. |
| **Görsel karşılaştırma** (ekran görüntüsü piksel farkı / perceptual hash) | Farklı ürün resimleri, kaydırma pozisyonu ve animasyonlar benzerliği bozar. Ama *ikinci bir sinyal* olarak değerli (aşağıya bakın). |
| **Makine öğrenmesi** (DOM embedding, sınıflandırıcı) | Eğitim verisi yok. Kararı açıklamak zor. Demo kapsamı için aşırı. |
| **Tam eşitlik** (parmak izi hash'i birebir aynı mı?) | Sepete ürün eklemek gibi en küçük değişiklik bile eşleşmeyi bozar. |

---

## Geliştirme fikirleri (tez için)

1. **Kullanıcı kararlarından öğrenmek.** Hibrit yaklaşımın gizli bir avantajı var: kullanıcının her "Evet / Hayır" cevabı **etiketli bir veri noktasıdır** (`benzerlik = 0.75 → aynı`, `benzerlik = 0.62 → farklı`). Bu veriyle eşik değeri siteye özel olarak otomatik ayarlanabilir. İleride ağırlıklı bir model de eğitilebilir.
2. **Çoklu sinyal.** Jaccard + URL + görsel benzerlik (perceptual hash) + sayfa başlığı (`h1`), ağırlıklı ortalama ile birleştirilebilir.
3. **Ağırlıklı Jaccard.** Her sayfada görülen header/footer anahtarlarına daha düşük ağırlık vermek.
4. **Erişilebilirlik ağacı (accessibility tree).** DOM yerine tarayıcının erişilebilirlik ağacını kullanmak, görsel olmayan "anlamsal" yapıyı daha iyi yakalayabilir.
5. **Değerlendirme.** Birkaç örnek site üzerinde insanların elle çizdiği "doğru" graph'lar ile eklentinin önerileri karşılaştırılarak precision/recall ölçülebilir.
