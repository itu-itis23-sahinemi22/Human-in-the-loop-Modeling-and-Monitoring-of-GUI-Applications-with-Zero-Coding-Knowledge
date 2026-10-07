# 03: State Eşleştirme: "Bu sayfa zaten bir node mu?"

Kullanıcı "Node oluştur"a bastığında sistemin cevaplaması gereken soru şu: **Bu durum daha önce kaydettiğimiz bir node mu, yoksa yeni bir durum mu?**

Bu soru projenin akademik çekirdeğidir. Tamamen otomatik araçlar tam da bu noktada zorlanır: hangi DOM farkı "yeni durum", hangisi "aynı durum, farklı veri"? Bizim yaklaşımımız soruyu ikiye bölmektir:

- **Etkileşimli element kümesi (edge set) farklıysa** makine kesin karar verir: **yeni node.** Kullanıcıya sorulmaz.
- **Element kümesi birebir aynıysa** makine yalnızca önerir, **insan onaylar.**

İlgili kod: `background.js > findSameStateNodes()`, `stateCounts()`, `urlKey()`, `content.js > fingerprint()`, `elementKey()`, `functionText()`, `targetOf()`, `isInteractable()` ve `settings.js`.

## İçindekiler

- [Algoritma (iki aşama)](#algoritma-iki-aşama)
- [Aşama 1: URL şablonu](#aşama-1-url-şablonu)
- [Aşama 2: Yapısal parmak izi (edge set) ve birebir eşitlik](#aşama-2-yapısal-parmak-izi-edge-set-ve-birebir-eşitlik)
- [Neden benzerlik değil, birebir eşitlik?](#neden-benzerlik-değil-birebir-eşitlik)
- [Küme aynıysa neden hâlâ soruluyor?](#küme-aynıysa-neden-hâlâ-soruluyor)
- [Kaydırma ve state](#kaydırma-ve-state)
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
               Aşama 2: adaylardan element kümesi BİREBİR aynı olan var mı?
                  ├─ evet ─▶ kullanıcıya sor: eşleşen her node bir seçenek ("Evet, bu node")
                  │          ya da "Hiçbiri, yeni node"
                  └─ hayır ─▶ yeni node oluştur (soru sorulmaz, sayfa ne kadar benzer olursa olsun)
```

Birden fazla node birebir eşleşebilir: kullanıcı daha önce aynı küme için "yeni node" demiş ya da Ayarlar'da bir türün işaretini kaldırmış olabilir (önceden farklı node'lar aynı kümeye iner). Bu durumda **hepsi** seçenek olarak sunulur; şu anki node önce, sonra oluşturulma sırasıyla. Yalnızca birini önermek yetmez: doğru node listede ikinci sıradaysa kullanıcı onu hiç göremez, "yeni node" deyince de her ziyarette yeni bir kopya oluşur.

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

**Yalnızca URL şablonu aynı olan node'lar aday olabilir.** Bu bilinçli bir tercih: `/cart` ile `/checkout` element kümeleri aynı olsa bile hiçbir zaman "aynı durum" önerilmez.

**Neden URL tek başına yetmiyor?**

- Aynı URL'de farklı durumlar olabilir. Menü açık/kapalı, modal açık, hata mesajı gösteriliyor... SPA'larda (tek sayfa uygulamaları) URL hiç değişmeyebilir.
- Aynı URL şablonunda farklı içerik olabilir. `/product/1` ve `/product/2` *genelde* aynı durumdur, ama bu her sitede doğru değildir.

Bu yüzden URL yalnızca **aday filtresi** olarak kullanılıyor. Asıl karar ikinci aşamada veriliyor.

---

## Aşama 2: Yapısal parmak izi (edge set) ve birebir eşitlik

### Parmak izi nedir?

Sayfadaki **şu an etkileşime girilebilen** (ekranda, kaydırmadan tıklanabilen ve devre dışı olmayan) elementlerin (link, buton, input, select...) **türlerinin sayılı kümesi** (multiset): her tür ve ekranda kaç tane olduğu. Her etkileşimli element, o durumdan çıkabilecek olası bir edge'dir; bu yüzden buna **edge set** diyoruz. Bir elementin türü (anahtarı), etiketi ile kimliğinden oluşur (`elementKey()`):

```
<button id="login-button">Login</button>        →  "button:login-button"
<input name="user-name">                        →  "input:user-name"
<select data-test="product-sort-container">     →  "select:product-sort-container"
<button>Paylaş</button>                         →  "button:Paylaş"   (kimlik yok: işlev metni)
<input placeholder="Ara">                       →  "input:Ara"       (kimlik yok: placeholder / etiket)
<a href="/about">Hakkımızda</a>                 →  "a"               (link metni kullanılmaz)
```

Kimlik için öncelik sırası: `id` > `data-testid` > `data-test` > `name` > `aria-label` > **işlev metni** > `type`. Hiçbiri yoksa sadece etiket adı kullanılır. İşlev metni, kimliği olmayan elementin ne işe yaradığını söyler: buton yazısı, form alanının etiketi ya da placeholder'ı (`functionText()`). Kimliksiz iki farklı buton ("Paylaş", "Kopyala") böylece aynı türe düşmez.

Parmak izi şöyle saklanır (her satır bir tür, `types` Ayarlar filtresi içindir):

```
[ { key: "button:Sil",      types: ["button"], count: 5 },
  { key: "input:user-name", types: ["input"],  count: 1 } ]
```

### Dört bilinçli tasarım kararı

1. **Link metni ve form değerleri dahil edilmez.** Kimliksiz "Sauce Labs Backpack" linki ile "Bike Light" linki aynı türü (`a`) üretir; link metni çoğu zaman veridir (ürün adı, başlık) ve her farklı veriyi ayrı state yapardı. Kullanıcının bir alana yazdığı değer de asla kullanılmaz. Buton yazısı ise işlevdir ("Sil", "Kaydet"), kimlik yoksa türe katılır.
2. **Sayılı küme kullanılır.** Aynı türden 5 buton olan ekran ile 4 buton olan ekran farklıdır: 5. buton 5. olası edge'dir. Sıra önemsizdir; tür ve sayılar eşitse ekranlar eşleşir.
3. **Yalnızca ekranda, kaydırmadan tıklanabilen elementler sayılır** (`content.js > isClickableOnScreen()`). Model bir otomasyon aracının arayüzden test yapması için kullanılacak; araç ekranda olmayan bir elemente kaydırmadan tıklayamaz. Kontrol bir **isabet testidir** (hit test): elementin ekranda kalan kısmının ortasındaki noktada en üstte duran element (`document.elementFromPoint()`) bu element ya da onun bir parçası mı? Otomasyon araçları da elementin ortasına tıklar. Bu tek kontrolle şunlar elenir:
   - DOM'da olup **ekran dışında** kalanlar: sayfanın aşağısında kalan ve kaydırınca görünecek elementler, `transform` ile ekran dışına itilmiş kapalı menüler
   - kaydırılabilir bir kutunun (`overflow:auto`) görünen alanının dışında kalanlar
   - üstü başka bir katmanla (modal, sabit header, cookie banner) kapalı olanlar
   - `display:none`, `hidden` niteliği, `visibility:hidden`, `pointer-events:none` ve `inert` olanlar

   Kapalı bir menünün linkleri DOM'da olsa bile sayılmaz. Menü açılınca bu linkler parmak izine girer ve durum farklılaşır. Ekran kenarında **yarım görünen** element sayılır, çünkü görünen kısmına tıklanabilir. `opacity:0` bilerek elenmez: element görünmese de tıklamayı alır (ör. özel tasarım checkbox'ların altındaki gerçek input).
4. **Devre dışı elementler sayılmaz** (`content.js > isInteractable()`). Tıklanamayan element edge üretemez, dolayısıyla edge set'e ait değildir. Elenenler: `disabled` form elemanları (`:disabled`, disabled bir `<fieldset>` içindekiler dahil) ve `aria-disabled="true"` olan ya da böyle bir elementin içindeki elementler (`role="button"` gibi özel kontroller). **Örnek:** Login butonu `disabled` olunca kümeden çıkar; sayfa geri kalanı aynı olsa bile soru sorulmadan yeni node olur. Buton tekrar aktifleşince küme eski haline döner ve ilk node önerilir.

Bu iki filtre sadece **etkileşime girilebilirliği** ilgilendiren durumlara bakar. Checkbox'ın işaretli olması, input'un değeri ya da `aria-expanded` kümeyi değiştirmez; element her iki durumda da etkileşimlidir. (Menü açılınca görünür hale gelen linkler ise 3. madde üzerinden kümeyi değiştirir.)

### Ayarlar: hangi türler state'e girer?

Panelin **Ayarlar** penceresinde (sağ üstteki çark) etkileşimli element türleri (`a`, `button`, `input`, `[role="button"]`...) bir checklist olarak listelenir. Liste `settings.js > INTERACTABLE_TYPES`'ta tanımlıdır. Yalnızca **işaretli** türlerdeki elementler state'e girer.

Seçim **karşılaştırma anında** uygulanır:

1. Parmak izi tüm türleri yakalar; her girdi hangi etkileşimli türlere uyduğunu da taşır (`types`). Node bu hali saklar.
2. "Node oluştur"da background, işaretli türlerden en az birine uyan girdileri sayar ve sayılı kümeyi böyle kurar. Bunu hem yeni sayfa hem **tüm mevcut node'lar** için yapar (`background.js > stateCounts()`). Birden fazla türe uyan bir element bir kez sayılır.

Bu sayede ayar kayıt ortasında değişse de iki taraf her zaman aynı tanımla karşılaştırılır. Örneğin linklerin işareti kaldırılırsa, yalnızca linkleri farklı olan iki sayfa aynı kümeye iner: yeni node yerine "aynı state mi?" sorusu gelir. İşaret geri konunca eski davranış döner. Bir element birden fazla türe uyabilir (`<a role="button">`); işaretli türlerden birine uyması yeter.

Not: Aksiyon listesi ayrı bir ayardır. İşaretsiz türdeki bir elemente (ör. linke) tıklamak, "Tıkla" aksiyonu işaretliyse yine kaydedilir. Bu durumda edge, kaynak node'un state'inde olmayan bir elemente dayanabilir. Bu bilinçli bir kullanıcı tercihidir.

### Eşleşme kuralı

İki sayılı küme ancak **aynı türlere ve her türden aynı sayıya** sahipse eşleşir (sıra önemsiz). Tek bir tür eklenmiş, çıkmış, değişmiş ya da bir türün sayısı değişmişse **yeni node oluşur.**

**Örnek:** Ürün listesinde bir ürün sepete eklendiğinde butonun id'si `add-to-cart-backpack` iken `remove-backpack` olur:

```
Önce : { a, a:cart-link, button:add-to-cart-backpack, button:add-to-cart-bike, select:sort }
Sonra: { a, a:cart-link, button:remove-backpack,      button:add-to-cart-bike, select:sort }

Fark : add-to-cart-backpack çıktı, remove-backpack girdi  →  küme farklı  →  yeni node (soru yok)
```

Kümelerin %67'si ortak olsa da (eski Jaccard ölçüsüyle 4/6) sonuç değişmez: **benzerlik oranı hesaplanmaz.**

### Edge hedefi state ile aynı düzeyde: "türün n'incisi"

State tür düzeyinde tanımlı ("ekranda 5 tane `button:Sil` var"). Edge'in hedefi de aynı düzeyde tutulur (`content.js > targetOf()`): her aksiyon `target: { key, index }` taşır, yani "ekranda görünen `button:Sil`'lerin DOM sırasıyla 2.'si". Konuma dayalı CSS selector (`li:nth-of-type(16) > button:nth-of-type(2)`) yedek olarak saklanır.

Neden gerekli: Kaydırılabilir bir listede liste üstteyken 1-5., kaydırınca 16-20. satırlar görünür. Sayılar eşit olduğu için bu iki ekran aynı state'tir. Edge "16. satırdaki Sil" diye kaydedilseydi, o satır diğer ekranda ekranda olmazdı ve **çakışma** olurdu. "Görünen 2. Sil" ise sayılar eşit olduğu sürece iki ekranda da vardır. Kural: **sayılı kümeleri eşit iki ekranda her "türün n'incisi" hedefi bulunur**; aynı state sayılan ekranlar arasında edge çakışması olmaz.

Bedeli: edge belirli bir veri satırını değil, ekrandaki bir **konumu** modeller ("görünen 2. Sil"). Model tabanlı test için genelde istenen budur (ekran modellenir, veri değil). Tekrar oynatma ve ileride üretilecek test kodu, elementi önce `target` ile ("görünen n'inci tür"), bulamazsa selector ile arar.

Ölçüm (gerçek Chrome, 20 satırlık kaydırılabilir liste, her satırda "Düzenle" `data-test`, "Sil" `aria-label`, kimliksiz "Paylaş"):

```
Liste üstte    : button:edit-button ×5, button:Paylaş ×5, button:Sil ×5   (satır 1-5)
Kaydırılmış    : button:edit-button ×5, button:Paylaş ×5, button:Sil ×5   (satır 15-19)  → aynı state
4 satır görünür: button:edit-button ×4, button:Paylaş ×4, button:Sil ×4                  → farklı state
Satır 16 "Sil" hedefi: { key: "button:Sil", index: 2 }
```

saucedemo'da her elementin tekil test id'si olduğu için tüm sayılar 1'dir; davranış önceki (sayısız küme) tanımla aynıdır.

---

## Neden benzerlik değil, birebir eşitlik?

Bir node'dan çıkan edge'ler, o node'daki etkileşimli elementlere dayanır. Element kümesi farklı iki sayfayı tek node sayarsak, node'un edge'leri **çakışır**:

```
v_Inventory  (iki farklı sayfa tek node'a birleştirilmiş)
   ├─ e_AddToCart       →  click #add-to-cart-backpack   (yalnızca "sepet boş" sayfasında var)
   └─ e_RemoveFromCart  →  click #remove-backpack        (yalnızca "sepette ürün var" sayfasında var)
```

GraphWalker bu modelde `v_Inventory`'deyken iki edge'i de geçerli sayar. Hangisini seçeceği sayfanın gerçek durumuna bağlı değildir; yanlış olanı seçtiğinde test, sayfada olmayan bir elementi aradığı için kırılır. Bu hata modelde görünmez, ancak test çalışırken ortaya çıkar.

Bu yüzden iki hatanın maliyeti eşit değildir:

| Hata | Ne olur? | Maliyeti |
|---|---|---|
| **Yanlış birleştirme** (edge set'i farklı iki sayfayı tek node saymak) | Node'un edge'leri çakışır | **Yüksek:** Model tutarsız olur. Fark edilmesi zordur; testler rastgele kırılır. |
| **Fazla node** (aslında "aynı" sayılabilecek iki sayfayı ayırmak) | Graph'ta bir node daha olur | **Düşük:** Her node kendi içinde tutarlıdır. Graph büyür ama doğru kalır; node yeniden adlandırılabilir. |

Kural ilk hatayı **tamamen** engeller, bedeli ikinci hatadır. Ayrıca:

- **Ayarlanacak eşik yoktur.** Önceki sürümdeki `SIMILARITY_THRESHOLD = 0.6` gibi keyfi bir sayı kalmadı. Karar deterministiktir.
- **Kullanıcı yanlış cevap veremez.** Önceki sürümde "%92 benziyor" sorusuna "Evet" demek kolaydı ve tam olarak yukarıdaki çakışmayı üretiyordu. Artık bu soru hiç sorulmuyor.

---

## Küme aynıysa neden hâlâ soruluyor?

Aynı edge set, aynı state için **gerekli** ama **yeterli** değildir. Element kümesi birebir aynı iki sayfa yine de test açısından farklı durumlar olabilir:

- Aynı şablonda farklı veri: `/product/1` ile `/product/2` (bazı modellerde aynı, bazılarında farklı durum)
- Etkileşimli olmayan içerikteki fark: bir uyarı metni, sepet sayacı, "boş liste" mesajı

Bu farkı makine güvenilir şekilde ayıramaz; anlamı modeli kuran insan bilir. Onay kartı şu anki sayfanın ekran görüntüsünü ve eşleşen her node'un ekran görüntüsünü yan yana gösterir. Kullanıcı bir aday için **"Evet, bu node"** derse şu anki node'dan o node'a edge çizilir, **"Hayır / Hiçbiri, yeni node"** derse yeni node oluşur. Hiçbir cevap edge çakışması üretmez, çünkü kümeler zaten aynıdır. Karar hatırlanmaz: aynı küme bir daha yakalandığında soru yine sorulur.

---

## Kaydırma ve state

Parmak izi yalnızca ekrandaki elementlerden oluştuğu için (yukarıda 3. madde) kaydırma state'i değiştirebilir. Bu yüzden kaydırma da **bir aksiyon olarak kaydedilir** (`content.js > onScrollEnd()`): kaydırma hareketi bitince (`scrollend` olayı) vardığı konum saklanır. Tekrar oynatırken `scrollTo(x, y)` aynı elementleri ekrana getirir. Aksiyonun şeması: [04 > Aksiyon](04-veri-modeli.md#aksiyon)

Ayarlar'da **Kaydır** aksiyonunun işareti kaldırılırsa kaydırma kaydedilmez. O zaman tek başına kaydırma, "Node oluştur" için gereken bekleyen aksiyonu sağlamaz.

Sayfa kaydırıldıktan sonra "Node oluştur"a basıldığında iki durum var:

| Ekrandaki küme | Sonuç |
|---|---|
| Bir node'unkiyle birebir aynı | Kullanıcıya "aynı state mi?" diye sorulur. Kümeler aynı olduğu için benzerlik zaten %100'dür; ayrı bir eşik yoktur. |
| Farklı (yeni elementler ekrana geldi ya da ekrandan çıktı) | Soru sorulmadan **yeni node** oluşur. Edge'in aksiyonları kaydırmayı içerir, adı `e_ScrollDown` olur. |

**Sonuçları:**

- **Kaydırma konumu state'in parçasıdır.** Aynı sayfanın üst ve alt kısmı iki ayrı node olabilir.
- **Model pencere boyutuna bağlıdır.** Ekrana sığan elementler pencere boyutuna göre değişir. Testi çalıştıran otomasyon aracı, kayıttaki pencere (viewport) boyutunu kullanmalıdır; aksi halde state'ler tutmaz.
- **Sayfanın kendi kaydırmaları da kaydedilir.** Tarayıcı kullanıcının ve sayfanın yaptığı kaydırmaları ayırt etmez (ör. bir linke tıklanınca sayfa başa kaydırılır). Konum mutlak olduğu için bu kaydırmaları tekrar oynatmak zararsızdır. Edge'e ismini ise kaydırma olmayan son aksiyon verir (`e_Product`, `e_ScrollUp` değil).

---

## Gerçek ölçümler (saucedemo.com)

Eklenti, önceki (Jaccard) sürümüyle otomatik bir testle canlı saucedemo.com üzerinde çalıştırıldı. "Parmak izi boyutu" ve "Jaccard" sütunları o çalıştırmadan alınmıştır. "Yeni kural" sütunu aynı parmak izlerine birebir eşitlik kuralının uygulanmasıyla çıkarılmıştır (yeniden ölçülmedi): Jaccard < 1 demek kümelerin farklı olması demektir. Ölçümler ekran filtresi eklenmeden önce, **tüm sayfa** üzerinden yapıldı; şimdi parmak izi yalnızca ekrandaki elementleri içerdiği için uzun sayfalarda (ör. ürün listesi) boyutlar daha küçüktür ve sonuçlar kaydırma konumuna da bağlıdır.

| Adım | Parmak izi boyutu | En iyi aday (Jaccard) | Eski sonuç | Yeni kural |
|---|---|---|---|---|
| Giriş sayfası | 3 anahtar | (yok) | Yeni node `v_SwagLabs` | Yeni node `v_SwagLabs` |
| Login sonrası ürün listesi | 24 | (farklı URL) | Yeni node `v_Inventory` | Yeni node `v_Inventory` |
| Bir ürünü sepete ekle | 24 | `v_Inventory` (0.92) | Soruldu | **Soru yok,** yeni node `v_Inventory_2` (2 buton id'si değişti) |
| Sepet | 9 | (farklı URL) | Yeni node `v_Cart` | Yeni node `v_Cart` |
| Sepetten ürün listesine dön | 24 | `v_Inventory` (0.92) | Soruldu | Sepet içeriği ve kaydırma konumu değişmediyse `v_Inventory_2` ile birebir aynı: **soruldu** |
| Ürün detayı (id=4) | 7 | (farklı URL) | Yeni node `v_InventoryItem` | Yeni node `v_InventoryItem` |
| Başka ürün detayı (id=0) | 7 | `v_InventoryItem` (0.75) | Soruldu | **Soru yok,** yeni node `v_InventoryItem_2` (ürüne bağlı buton id'si farklı) |
| Ürün detayında menüyü aç | 13 | `v_InventoryItem` (0.54) | Önerilmedi, yeni node | Yeni node (değişmedi) |

İki satır kuralın etkisini gösteriyor:

- **"Sepete ekle":** "Sepet boş" ve "sepette ürün var" artık ayrı durumlar. `Add to cart` ve `Remove` edge'leri farklı node'lardan çıkar, çakışmaz. Bu, GraphWalker modellerinde zaten beklenen modellemedir.
- **"Başka ürün detayı":** Kuralın bedeli. saucedemo buton id'sine ürün adını koyduğu için (`add-to-cart-sauce-labs-backpack`) her ürün sayfası ayrı node olur. Bkz. aşağıdaki "Veriye bağlı id'ler".

---

## Bilinen zayıflıklar

Birebir eşitlik kuralında her zayıflık aynı şekilde ortaya çıkar: **olması gerekenden fazla node.** Model tutarsızlaşmaz, ama büyür.

| Durum | Ne olur? | Olası çözüm |
|---|---|---|
| **Dinamik id'ler** (React'in `:r1:`, Ember'ın `ember123` gibi her yüklemede değişen id'leri) | Aynı sayfa her ziyarette farklı küme üretir, hiç eşleşmez. Her ziyaret yeni node olur. | Bilinen dinamik id kalıplarını (`/^:r\d+:$/`, `/^ember\d+$/`) `elementKey()` içinde yok saymak |
| **Veriye bağlı id'ler** (`add-to-cart-<ürün-adı>`) | Her ürün ve her sepet içeriği ayrı küme, dolayısıyla ayrı node üretir. State sayısı hızla artar. | id içindeki veri kısmını ayıklamak. Dikkat: edge'lerin selector'ları da aynı şekilde genelleştirilmezse çakışma sorunu geri gelir. |
| **Geçici etkileşimli elementler** (toast'taki "kapat" butonu, açılır ipucu) | Node oluşturma anında görünürse küme değişir, yeni node olur. | Belirli selector'ları parmak izinden hariç tutan bir liste |
| **Kaydırma konumuna duyarlılık** | Aynı sayfa farklı kaydırma konumlarında farklı node'lar üretir. Ekran kenarında yarım görünen bir element bile kümeyi değiştirebilir; uzun sayfalarda node sayısı artar. | Elementin en az belirli bir kısmı (ör. %50'si) ekrandaysa saymak |
| **Pencere boyutuna bağımlılık** | Aynı sayfa farklı pencere boyutlarında farklı küme üretir. Kayıt ve test farklı boyutta yapılırsa state'ler tutmaz. | Viewport boyutunu modele kaydetmek, otomasyon aracını aynı boyutta çalıştırmak |
| **Tek noktadan isabet testi** | Elementin ortası başka bir katmanla kapalıysa, kenarları tıklanabilir olsa da sayılmaz. | Bilinçli tercih: otomasyon araçları da elementin ortasına tıklar ve ortası kapalıysa hata verir. |
| **Farklı URL, aynı durum** (`/en/cart` ve `/de/cart`) | Hiç aday olmaz, kopya node oluşur. | URL normalizasyonuna dil kodu gibi kurallar eklemek |
| **Lazy-load / sonsuz kaydırma** | Kaydırdıkça yeni elementler yüklenir ve ekrana gelir; kimlikli elementlerde (ör. `item_7_title_link`) her kaydırma yeni bir küme, dolayısıyla yeni node demektir. Satıra özel kimliği olmayan listelerde ise görünen satır sayısı aynı kaldıkça state aynı kalır. | Element anahtarı normalizasyonu (aşağıda 1. fikir) |
| **Veri içeren buton yazısı** (kimliksiz `<button>Sepet (3)</button>`, "Takip et" → "Takip ediliyor") | İşlev metni türün parçası olduğu için yazı değişince tür, dolayısıyla state değişir. | Yazıdaki rakamları normalleştirmek (`Sepet (#)`); butona test id'si vermek |
| **Görünen sıra kayması** | "Görünen 2. Sil" hedefi, ekranın üst kenarında yarım görünen bir satır sayılırsa bir satır kayabilir. Sayılar da değişeceği için state farklılaşır; çakışma oluşmaz, ama node sayısı artabilir. | Yarım görünen elementleri saymamak için en az görünür alan eşiği |
| **iframe / Shadow DOM içeriği** | Parmak izine girmez; bu içerikteki değişiklik fark edilmez. | `all_frames: true` ve shadow root'ları gezmek |

---

## Elenen alternatif yöntemler

Aşağıdakilerin ilk dördü bir **benzerlik ölçüsü** üretir. Benzerlik ne kadar iyi ölçülürse ölçülsün, "çok benzer ama edge set'i farklı" iki sayfayı birleştirmeye izin verdiği için [edge çakışması](#neden-benzerlik-değil-birebir-eşitlik) sorununu taşır.

| Yöntem | Neden elendi |
|---|---|
| **Jaccard benzerliği + eşik** (önceki sürüm, eşik 0.6) | Basit ve açıklanabilirdi, ama "%92 benziyor, aynı mı?" sorusuna "Evet" demek farklı edge set'leri birleştiriyordu. Eşik değeri de keyfiydi. |
| **DOM ağacı düzenleme mesafesi** (tree edit distance) | Hesaplaması pahalı (O(n³)). Sonucu kullanıcıya açıklamak zor. Tüm DOM'u karşılaştırdığı için veri farklarına çok duyarlı. |
| **Görsel karşılaştırma** (ekran görüntüsü piksel farkı / perceptual hash) | Farklı ürün resimleri, kaydırma pozisyonu ve animasyonlar sonucu bozar. Ama birebir eşleşen adaylar arasında *yardımcı sinyal* olarak değerli (aşağıya bakın). |
| **Makine öğrenmesi** (DOM embedding, sınıflandırıcı) | Eğitim verisi yok. Kararı açıklamak zor. Demo kapsamı için aşırı. |
| **Sadece URL** | SPA'larda ve aynı URL'deki farklı durumlarda (menü, modal, hata) çalışmaz. |

---

## Geliştirme fikirleri (tez için)

1. **Element anahtarı normalizasyonu.** Veriye bağlı ve dinamik id'leri ayıklayarak node sayısını azaltmak. Edge selector'ları da aynı kurala göre genelleştirilmeli, yoksa çakışma geri gelir. Kuralı bozmadan state patlamasını azaltmanın ana yolu budur.
2. **Kullanıcı kararlarından öğrenmek.** Birebir eşleşmede verilen her "Evet / Hayır" cevabı **etiketli bir veri noktasıdır.** Bir sitede kullanıcı belirli bir URL şablonunda hep "Evet" diyorsa, o şablon için soru sorulmadan otomatik birleştirme yapılabilir.
3. **Yardımcı sinyaller.** Görsel benzerlik (perceptual hash) ve sayfa başlığı (`h1`) yalnızca birebir eşleşen adaylar arasında, kullanıcıya gösterilen öneriyi güçlendirmek için kullanılabilir. Edge set kuralının yerine geçmez.
4. **Erişilebilirlik ağacı (accessibility tree).** DOM yerine tarayıcının erişilebilirlik ağacını kullanmak, görsel olmayan "anlamsal" yapıyı daha iyi yakalayabilir.
5. **Değerlendirme.** Birkaç örnek site üzerinde insanların elle çizdiği "doğru" graph'lar ile eklentinin ürettiği graph'lar karşılaştırılarak precision/recall ve node sayısı fazlalığı ölçülebilir.
