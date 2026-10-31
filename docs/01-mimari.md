# 01: Mimari

Bu doküman eklentinin hangi parçalardan oluştuğunu, parçaların birbiriyle nasıl konuştuğunu ve "Node oluştur"a basıldığında adım adım ne olduğunu anlatır.

## İçindekiler

- [Neden üç parça?](#neden-üç-parça)
- [Bileşenler](#bileşenler)
- [Temel iki kural](#temel-iki-kural)
- [Mesajlar](#mesajlar)
- ["Node oluştur" akışı](#node-oluştur-akışı)
- [Edge oluşturma kuralları](#edge-oluşturma-kuralları)
- [Aksiyonlar nasıl yakalanıyor?](#aksiyonlar-nasıl-yakalanıyor)
- [Edge düzenleme](#edge-düzenleme)
- [Beklemeler](#beklemeler)
- [Fareyle üzerine gelme](#fareyle-üzerine-gelme)
- [Node birleştirme](#node-birleştirme)
- [Geri al](#geri-al)
- [Kayıt hangi sekmede?](#kayıt-hangi-sekmede)
- [Graph'lar](#graphlar)
- [Senaryolar](#senaryolar)
- [Panelde oynatma](#panelde-oynatma)
- [Service worker'ın ölümlülüğü](#service-workerın-ölümlülüğü)

---

## Neden üç parça?

Bir Chrome eklentisi tek bir program gibi çalışmaz. Chrome, güvenlik nedeniyle eklentiyi farklı yetkilere sahip **ayrı ortamlara** böler. Bizim işimiz için bu ortamların üçü gerekiyor:

| Ortam | DOM'a erişir mi? | Ne kadar yaşar? | Chrome API'leri |
|---|---|---|---|
| **Content script** (`content.js`) | Evet, ziyaret edilen sayfanın DOM'una | Sayfa kadar. Sayfa değişince yok olur. | Çok kısıtlı (sadece mesajlaşma) |
| **Service worker** (`background.js`) | Hayır | Olay geldikçe uyanır, ~30 sn boşta kalınca kapanır | Hepsi (sekmeler, ekran görüntüsü, storage...) |
| **Extension sayfası** (`sidepanel/`) | Kendi HTML'ine | Panel açık olduğu sürece | Hepsi |

Bu tablo tasarımı doğrudan belirliyor:

- Tıklamaları görebilen tek ortam content script, ama sayfayla birlikte öldüğü için **veri tutamaz**.
- Veriyi tutabilecek ortam background, ama **sayfayı göremez**.
- Bu yüzden content script yakalar ve hemen gönderir, background biriktirir ve karar verir, panel gösterir.

---

## Bileşenler

### `content.js`: Sensör

Ziyaret edilen **her** sayfaya Chrome tarafından otomatik olarak eklenir (`manifest.json > content_scripts`).

- **Aksiyon yakalama:** `click`, `mouseup` (metin seçme), `contextmenu`, `change`, `focusin` (Tab ile odak), `focusout` (düzenlenebilir alanlar), `keydown`, `copy` / `cut` / `paste`, `scrollend` ve pencerenin `resize` olaylarını dinler. Her aksiyonu bir nesneye çevirip (`{type, target, selector, label, value, url, time}`; kaydırmada `target`/`value` yerine `x, y`) background'a gönderir. `target` hedefi state ile aynı düzeyde tutar: "ekrandaki n'inci `button:Sil`" ([03](03-state-eslestirme.md#edge-hedefi-state-ile-aynı-düzeyde-türün-ncisi)).
- **Aksiyonun sonrası:** Her aksiyondan, sayfa yüklenmesinden, geri/ileriden ve pencere boyutu değişiminden (yakınlaştırma dahil) sonra sayfanın durulmasını bekler (300 ms DOM değişmez; en fazla 3 sn) ve ekranın edge set'ini background'a bildirir (`SCREEN`). Yazmaya başlanınca (`beforeinput`) beklemeden bildirir: yazının etkisi önceki aksiyona karışmasın. Background aksiyonun state'i değiştirip değiştirmediğini bununla bulur. Detay: [Edge düzenleme](#edge-düzenleme)
- **Parmak izi:** Background `GET_FINGERPRINT` isteği gönderdiğinde ekranda, kaydırmadan tıklanabilen ve devre dışı olmayan etkileşimli elementlerin listesini ve sayfanın görünen alanını (viewport) döndürür. Parmak izinin tanımı `fingerprint.js`'tedir (aşağıda). Detay: [03-state-eslestirme.md](03-state-eslestirme.md)
- **Selector üretimi:** Her aksiyon için elementi tekil olarak bulan bir CSS selector üretir. Kayıtların ileride tekrar oynatılabilmesi buna bağlıdır.
- **Panelde oynatma:** Panel bir koşuyu oynatırken elementin yerini, sayfanın durulmasını ve parmak izini `REPLAY` isteğiyle buradan alır (bkz. [Panelde oynatma](#panelde-oynatma)).

### `background.js`: Beyin

Eklentinin tek "durum sahibi" (single source of truth).

- Content script'ten gelen aksiyonları `buffer` dizisinde biriktirir.
- Tarayıcı seviyesindeki gezinmeleri (adres çubuğu, geri/ileri, yenile) `chrome.webNavigation` ile, sekme geçişlerini (`chrome.tabs`) kendisi yakalar; kayda katılmamış bir sekme aktif olunca "bu sekmede devam edilsin mi?" diye sorar ([Kayıt hangi sekmede?](#kayıt-hangi-sekmede)).
- "Node oluştur" isteğinde parmak izi ve ekran görüntüsü alır, element kümesi birebir aynı olan node'u arar, node ve edge ekler.
- Her değişiklikten sonra aktif graph'ın state'inin tamamını `chrome.storage.local`'a yazar (`graph:<id>`); graph listesini ve aktif graph'ı da o tutar ([Graph'lar](#graphlar)).
- Panelin Ayarlar penceresindeki seçimleri `settings` anahtarında saklar ve uygular: işaretsiz aksiyon tiplerini buffer'a almaz (isteğe bağlı tipler, ör. üzerine gelme, işaretlenmedikçe kapalıdır), işaretsiz element türlerini state karşılaştırmasına katmaz. "Beklemeleri kaydet" açıksa aksiyonlar arasındaki boşlukları ve ekranın kendiliğinden değişmesini bekleme olarak kaydeder (bkz. [Beklemeler](#beklemeler)).

### `sidepanel/`: Arayüz

- `panel.html`: iskelet. Butonlar, onay kartı, graph alanı, detay kartı ve bekleyen aksiyonlar listesi. Sağ üstteki çark, panelin üstünde açılan **Ayarlar** penceresini (`<dialog>`) açar; kaydedilmemiş değişiklik uyarısı da ayrı bir `<dialog>`'dur.
- **Senaryo** bölümü (`panel.js > SENARYO`): test yollarını (koşular) kurar ve graph üzerinde önizler: seçili koşunun edge'leri sıra numarasıyla vurgulu, vardığı node işaretli, diğerleri soluk. Elle yolda koşunun vardığı node'dan çıkan bir edge'e tıklanır (gidilebilecekler kesik çizgili); yol çıkmaz bir node'a varınca "Yeni koşu" baştan başlar. Koşuların başlangıç node'u **Başlangıç** listesinden seçilir (varsayılan graph'ın başlangıcı; seçilen node çift çizgili). Graph'ın başlangıcı dışındaki bir başlangıç yalnızca panelde oynatılır: runner her koşuyu temiz bir tarayıcıda başlattığı için böyle bir senaryoyu reddeder. Senaryo panelin kendi durumudur (graph state'i değil); "Senaryo indir" ile dosyaya alınır, runner oynatır ([04 > Senaryo dosyası](04-veri-modeli.md#senaryo-dosyası)).
- `compare.js`: onay kartındaki görsel karşılaştırma: iki ekran görüntüsünün piksel farkı, farklı bölgeler, fark oranı ([03 > Görsel karşılaştırma](03-state-eslestirme.md#görsel-karşılaştırma)). Panelde oynatmada kalınan ekran da bununla karşılaştırılır.
- `replay.js`: **Panelde oynat**: seçili koşuyu kullanıcının tarayıcısında, açık sekmede oynatır (bkz. [Panelde oynatma](#panelde-oynatma)).
- `panel.js`: State'i ve ayarları storage'dan okur ve ekrana çizer. Butonlara basılınca background'a mesaj gönderir. Ayarlar penceresindeki kutular (iki liste ve "Beklemeler" bölümü: anahtar, alt sınır ve aksiyon sonrası otomatik bekleme süresi) bir **taslaktır**: yalnızca **Kaydet** taslağı background'a gönderir. Kaydet, taslak kaydedilmiş ayarlardan farklıyken aktiftir. Taslak farklıyken pencere kapatılmak istenirse (✕, Esc, pencere dışına tıklama) uyarı açılır: "Kaydet ve çık", "Kaydetmeden çık" ya da "Geri dön".
- `panel.css`: görünüm.

### `fingerprint.js`: State'in tanımı

Bir ekranın state'ini tanımlayan kod: etkileşimli elementler (`interactableElements()`, `isInteractable()`), türleri (`elementKey()`), sayılı küme (`countElements()`, `fingerprint()`), aksiyon hedefi (`targetOf()` ve tersi `targetElement()`), görünen alan (`currentViewport()`), sayfanın durulma süreleri ve tekrar oynatırken beklenen durulma (`settled()`). Olay dinlemez, mesaj göndermez; yalnızca tanımlar.

Ayrı dosyadadır, çünkü kayıt ile test **aynı tanımı** kullanmalıdır. İki yerde yüklenir: eklentide content script olarak (`settings.js`'ten sonra, `content.js`'ten önce; aynı sayfadaki content script'ler ortak kapsamda çalıştığı için `content.js` bu fonksiyonları doğrudan kullanır) ve runner'da test edilen her sayfaya ([runner/README.md](../runner/README.md)). Böylece runner'ın "varılan ekran beklenen node mu?" kararı, kayıttaki "bu sayfa zaten bir node mu?" kararıyla aynı koddan gelir.

### `scenario.js`: Senaryo

Senaryonun biçimi (`SCENARIO_FORMAT`), koşuların graph'ta yürünebilirliği (`runProblem`), kapsama (`coverageOf`), senaryo graph'ı (`scenarioSnapshot`) ve kopyadan sonra ana graph'taki değişiklikler (`snapshotDrift`). Panel `<script>` ile, background `importScripts` ile, runner Node'da yükler; kapsama ve kopya her yerde aynı hesaplanır.

### `settings.js`: Ortak tanımlar

Ayarlar penceresindeki iki listenin (aksiyon tipleri `ACTION_TYPES`, etkileşimli element türleri `INTERACTABLE_TYPES`) ve varsayılan ayarın (`DEFAULT_SETTINGS`) **tek tanımı**. Ayarlara bağlı state karşılaştırması (`urlKey()`, `stateCounts()`, `sameCounts()`, `diffCounts()`) da buradadır; background node eşleştirmede, panel edge düzenlemede ve birleştirmede, runner doğrulamada kullanır. Build adımı olmadığı için her parça bu dosyayı ayrıca yükler: content script olarak `fingerprint.js` ve `content.js`'ten önce (`manifest.json`), service worker'da `importScripts('settings.js')`, panelde `<script>` ile, runner'da hem sayfaya hem Node tarafına. Listeye yeni bir tip eklemek; yakalamayı, panel checklist'ini ve filtreyi birlikte günceller.

### `manifest.json`: Kimlik kartı

Chrome'a "bu eklenti nedir, hangi dosya hangi ortamda çalışır, hangi izinlere ihtiyaç duyar" bilgisini verir. İzinlerin tek tek gerekçesi: [02-teknolojiler.md](02-teknolojiler.md#hangi-izin-neden-gerekli). `key` alanı eklentinin kimliğini sabitler (`limihkoliileclgenbfinjjkgimopjen`): paketlenmemiş eklentinin kimliği normalde klasör yolundan gelir; planlayıcının host'u yalnızca bu kimliğe izin verir ([Senaryolar > GraphWalker](#graphwalker-ile-üretim)).

---

## Temel iki kural

Kod bu iki kurala göre yazıldı. Değişiklik yaparken bunları bozmamak gerekir.

### Kural 1: State'i yalnızca `background.js` değiştirir (tek yazar)

Panel bir node'un ismini değiştirmek istediğinde storage'a kendisi yazmaz, background'a `RENAME` mesajı gönderir.

**Neden?** Background, hız için state'i bellekte de tutar (bkz. [Service worker'ın ölümlülüğü](#service-workerın-ölümlülüğü)). Panel storage'a doğrudan yazsaydı background'daki kopya eskide kalırdı. Background bir sonraki yazışında panelin değişikliğini sessizce ezerdi. Tek yazar olunca bu tür yarış durumları (race condition) oluşamaz.

### Kural 2: Veri tek yönde akar

```
buton ──▶ mesaj ──▶ background state'i değiştirir ──▶ storage'a yazar
                                                          │
render() ◀── panel yeni state'i alır ◀── storage.onChanged ┘
```

Panel hiçbir zaman "işlem başarılı, şimdi şu kutuyu güncelleyeyim" diye kendi ekranını elle değiştirmez. Her şey storage'daki state'ten yeniden çizilir. Ekranda görünen ile kaydedilen arasında tutarsızlık oluşamaz. Kodu takip etmek de kolaylaşır: "ekran neden böyle?" sorusunun cevabı her zaman "state böyle"dir.

---

## Mesajlar

Parçalar `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` ile JSON mesajlar gönderir. Mesajların tam listesi:

| Mesaj | Gönderen → Alan | İçerik | Ne yapar |
|---|---|---|---|
| `ACTION` | content → background | `{ action, screen, viewport, typingSince?, replaces? }` | Aksiyonu buffer'a ekler; gerekiyorsa önüne bir bekleme koyar ([Beklemeler](#beklemeler)). `typingSince`: aksiyondan önce yazmaya başlanan an; önceki bekleme o anda biter. Cevap `{ monitor, hover }`: bu sekme ekranı aksiyonsuz da izlesin mi, fareyle üzerine gelmeyi kaydetsin mi. Kayıt başlamadıysa, başka sekmeden geldiyse ya da tipi Ayarlar'da işaretsizse yok sayar. `screen`, aksiyonun yapıldığı andaki ekranın edge set'idir; önceki aksiyonun sonrası henüz bildirilmediyse onun sonrası olarak kullanılır. `viewport`, gönderildiği andaki sayfa boyutudur; açık bir yakınlaştırma aksiyonu bununla kapanırsa varılan boyut olarak saklanır. `replaces`: buffer'ın son aksiyonunun zamanı buysa o aksiyon düşer (çift/üçlü tıklamayla seçimde hareketin önceki tıklaması). |
| `SCREEN` | content → background | `{ screen, viewport }` | Sayfa durulunca ekranın edge set'i ve sayfanın boyutu. Sonrası bekleyen aksiyon varsa "state'i değiştirdi mi?" diye işaretler; yoksa ve ekran değiştiyse, beklemeler kaydediliyorsa ekranı değiştiren bir bekleme ekler. Ekran yeni "hemen önceki state" olur. Kayıt sekmesi dışından geleni yok sayar. Cevap `{ monitor, hover }` (ACTION'daki gibi). |
| `SYNC` | panel → background | (boş) | Panel açılınca gönderir: background graph listesini kurar (gerekirse eski `state` anahtarını taşır), panel ardından storage'dan okur. |
| `NEW_GRAPH` | panel → background | (boş) | Boş bir "Yeni graph" ekler ve ona geçer. Karar beklerken ya da oynatma sürerken reddeder. Bkz. [Graph'lar](#graphlar) |
| `SWITCH_GRAPH` | panel → background | `{ id }` | Aktif graph'ı değiştirir: bırakılanın bekleyen aksiyonları ve sekme bağları silinir; geçilende node varsa aktif sekme için sorulur. Karar beklerken ya da oynatma sürerken reddeder. |
| `RENAME_GRAPH` | panel → background | `{ id, name }` | Graph'ı yeniden adlandırır; ad artık otomatik değişmez. Boş ad reddedilir, aynı ad varsa sonuna "(2)". |
| `DELETE_GRAPH` | panel → background | `{ id }` | Graph'ı siler. Aktif olan silinirse en son değişen diğerine, o da yoksa yeni boş graph'a geçer. |
| `IMPORT_GRAPH` | panel → background | `{ graph }` | Graph yedeğini denetler, yeni bir graph olarak ekler ve ona geçer ([04 > Graph yedeği](04-veri-modeli.md#graph-yedeği)). |
| `NEW_SCENARIO` | panel → background | `{ scenario: { id, name, start, planner, runs } }` | Senaryoyu aktif graph'a ekler; ad tekil yapılır, `{ name }` döner. Bkz. [Senaryolar](#senaryolar) |
| `SAVE_SCENARIO` | panel → background | `{ scenario }` | Senaryoyu günceller (koşular, başlangıç, ad); `{ name }` döner. Senaryo silinmişse reddeder. |
| `DELETE_SCENARIO` | panel → background | `{ id }` | Senaryoyu siler. |
| `MONITOR` | background → content | `{ monitor, hover }` | Kayıt sekmesine ekranı aksiyonsuz da izleyip izlemeyeceğini ve fareyle üzerine gelmeyi kaydedip kaydetmeyeceğini bildirir: ayar değişince, kayıt bir sekmeye bağlanınca. Yeni yüklenen sayfa bunu ilk ACTION / SCREEN cevabından öğrenir. |
| `GET_FINGERPRINT` | background → content | (boş) | Cevap olarak `{ url, title, elements, viewport }` döner. `elements`, ekrandaki elementlerin sayılı kümesidir: `[{ key, types, count }]`. `viewport`, kümenin alındığı görünen alandır: `{ width, height, devicePixelRatio }`. |
| `CREATE_NODE` | panel → background | `{ tabId, windowId }` | "Node oluştur" akışını başlatır (aşağıda). |
| `RESOLVE` | panel → background | `{ targetId }` | Onay kartındaki cevap: seçilen aday node'un id'si ("Evet, bu node") ya da `null` ("yeni node"). Aday olmayan id yok sayılır. |
| `REMOVE_ACTION` | panel → background | `{ edgeId, index }` | Edge'den bir aksiyonu siler. Tek aksiyon kaldıysa reddeder. İlk silmede orijinal liste `recordedActions`'a kopyalanır; silinen aksiyon geri al yığınına (`state.undo`) girer. |
| `RECORD_NAVIGATE` | panel → background | `{ tabId, url }` | Panelin açacağı gezinmeyi ("Başlangıç node'una dön") kayıt sekmesindeyse `navigate` aksiyonu olarak ekler; gezinmeden önce gönderilir. Bkz. [Panelde oynatma](#panelde-oynatma) |
| `REMOVE_BUFFERED` | panel → background | `{ index, time }` | "Bekleyen aksiyonlar"dan bir aksiyonu siler. `index` sırasındaki aksiyonun zamanı `time` değilse (liste bu arada değişti) ya da "aynı node mu?" sorusu bekliyorsa reddeder. Geri al yığınına girmez. Bkz. [Bekleyen aksiyonları silme](#bekleyen-aksiyonları-silme) |
| `UNDO` | panel → background | (boş) | Son silmeyi ya da birleştirmeyi geri alır; ne geri getirildiğini `{ notice }` ile bildirir. Bkz. [Geri al](#geri-al) |
| `MERGE_NODES` | panel → background | `{ keepId, removeId }` | `removeId` node'unu `keepId`'ye birleştirir. URL şablonu ya da edge set'i farklıysa ya da bekleyen bir soru varsa reddeder. Bkz. [Node birleştirme](#node-birleştirme) |
| `CANCEL_PENDING` | panel → background | (boş) | Şu anki node seçilip "Node oluşturma, aksiyonlara devam et" denince: bekleyen karar atılır, kesilen aksiyonlar buffer'a geri döner (karar beklerken yapılanların önüne). |
| `RENAME` | panel → background | `{ id, name }` | Node veya edge ismini değiştirir. |
| `DELETE` | panel → background | `{ id }` | Node'u (ve bağlı edge'leri) ya da edge'i siler. |
| `RESOLVE_TAB` | panel → background | `{ follow }` | "Bu sekmede devam edilsin mi?" sorusunun cevabı. `true`: kayıt bu sekmede sürer (`tab` aksiyonu); kayıt sekmesi kapanmışsa yalnızca sekme şu anki node'un ekranındaysa. `false`: sekme hatırlanır, bir daha sorulmaz. Bkz. [Kayıt hangi sekmede?](#kayıt-hangi-sekmede) |
| `SET_CURRENT` | panel → background | `{ id, tabId }` | "Buradan devam et": şu anki node'u değiştirir, buffer'ı temizler. Kayıt sekmesi kapandıysa kaydı `tabId` sekmesine bağlar. |
| `RESET` | panel → background | (boş) | Graph'ı sıfırlar. Ayarlara dokunmaz. |
| `SET_SETTINGS` | panel → background | `{ settings }` | Ayarlar'daki seçimi kaydeder (`settings` anahtarı). |
| `REPLAY` | panel → background | `{ active, endNodeId?, tabId? }` | Panelde oynatma başladı (`active: true`: kayıt durur, bekleyen aksiyonlar atılır) ya da bitti. Bitince `endNodeId` varsa (koşu geçti) kayıt o node'dan ve `tabId` sekmesinde sürer; yoksa şu anki node bilinmez. Bkz. [Panelde oynatma](#panelde-oynatma) |
| `REPLAY` | panel → content | `{ op, target?, selector?, ... }` | Panelde oynatmada sayfa işleri: `settled` (durulunca parmak izi), `locate` (elementin tıklanacak noktası, üstü kapalı mı, türü; istenirse çerçeveler), `focus`, `choose` (açılır liste), `scroll`. |

Background her mesaja üç cevaptan biriyle döner:

- `{ ok: true }`: işlem tamam.
- `{ error: "..." }`: işlem yapılamadı. Panel mesajı **kırmızı** kutuda gösterir.
- `{ notice: "..." }`: işlem gerekmedi, kullanıcı bilgilendiriliyor. Panel mesajı **mavi** kutuda gösterir.

---

## "Node oluştur" akışı

Projenin kalbi `background.js` içindeki `createNode()` ve `commit()` fonksiyonlarıdır.

```
Kullanıcı          panel.js              background.js                 content.js
    │                  │                       │                            │
    │  Node oluştur    │                       │                            │
    │─────────────────▶│ aktif sekmeyi bul     │                            │
    │                  │ CREATE_NODE{tabId}    │                            │
    │                  │──────────────────────▶│ ilk node değil VE buffer boş?
    │                  │◀── { notice } ────────│   └─ evet ─▶ DUR (mavi bilgi mesajı)
    │                  │                       │                            │
    │                  │                       │ GET_FINGERPRINT            │
    │                  │                       │───────────────────────────▶│
    │                  │                       │ {url,title,elements}       │
    │                  │                       │◀───────────────────────────│
    │                  │                       │ findSameStateNodes()       │
    │                  │                       │  (Ayarlar'daki türlerle)   │
    │                  │                       │                            │
    │                  │                       │ captureVisibleTab()        │
    │                  │                       │ actions = buffer           │
    │                  │                       │ buffer  = []               │
    │                  │                       │                            │
    │                  │                       │   ├─ birebir eşleşen YOK ─▶ commit(yeni node)
    │                  │                       │   └─ birebir eşleşen VAR ─▶ state.pending = {...}
    │                  │                       │ save() ──▶ storage         │
    │                  │◀── storage.onChanged ─│                            │
    │                  │ render()              │                            │
    │                  │                       │                            │
    │   (eşleşen varsa onay kartı görünür)     │                            │
    │  aday seç / yeni │                       │                            │
    │─────────────────▶│ RESOLVE{targetId}     │                            │
    │                  │──────────────────────▶│ commit(mevcut / yeni node) │
    │                  │                       │ save() ──▶ storage         │
    │                  │◀── storage.onChanged ─│                            │
    │                  │ render()              │                            │
```

Dikkat edilecek üç nokta:

1. **Bekleyen aksiyon yoksa node oluşturulmaz:** İlk node dışında, son node'dan beri hiç aksiyon kaydedilmediyse akış en başta durur, çünkü aksiyonsuz bir edge tekrar oynatılamaz. Panel bu durumda "Node oluştur" butonunu zaten kilitler. Background da ayrıca kontrol eder ve *"Bekleyen aksiyon yok. Node oluşturmak için önce sayfada bir aksiyon yapın."* bilgisiyle döner. Ayarlar'da işaretsiz tipteki aksiyonlar buffer'a hiç girmediği için sayılmaz. Parmak izi ve ekran görüntüsü alınmaz.
2. **Buffer'ın kesildiği an:** `actions = buffer; buffer = []` satırı onay beklenmeden **hemen** çalışır. Kullanıcı karar verirken sayfada başka bir şey yaparsa, o aksiyonlar bir *sonraki* edge'e aittir. Bekleyen karar ise kendi aksiyonlarını `state.pending.actions` içinde saklar.
3. **Bekleyen karar varken** "Node oluştur" butonu kilitlenir. Önce soru cevaplanmalıdır.

---

## Edge oluşturma kuralları

**Temel kural:** Şu anki node (`from`) varsa, hedef ister yeni ister mevcut node olsun, `from → hedef` edge'i **her zaman** çizilir. Kullanıcı onay kartında bir aday için **"Evet, bu node"** derse edge, şu anki node'dan o node'a çizilir. İkisi aynı node ise edge bir **self-loop** olur.

**Birden fazla eşleşme:** Element kümesi birden fazla node ile birebir aynı olabilir (daha önce aynı küme için "yeni node" denmiş ya da Ayarlar'da bir türün işareti kaldırılmışsa). Onay kartı eşleşen **tüm** node'ları ekran görüntüleriyle seçenek olarak gösterir; her adayın altında görsel fark oranı, **Karşılaştır** ile geniş karşılaştırma penceresi vardır ([03 > Görsel karşılaştırma](03-state-eslestirme.md#görsel-karşılaştırma)). Sıra: şu anki node önce, sonra oluşturulma sırası. Kullanıcı doğru olanı seçer ya da **"Hiçbiri, yeni node"** der. Karar beklerken bir aday silinirse listeden düşer.

**Eşleşme kuralı:** Mevcut bir node, ancak URL şablonu ve etkileşimli element kümesi (edge set: ekranda tıklanabilen, devre dışı olmayan elementler) sayfayla **birebir aynıysa** eşleşir. Tek bir element bile farklıysa, sayfa ne kadar benzer olursa olsun soru sorulmadan yeni node oluşur. Gerekçe: [03 > Neden birebir eşitlik?](03-state-eslestirme.md#neden-benzerlik-değil-birebir-eşitlik)

Durumların tamamı (`from` = şu anki node):

| Durum | Sonuç |
|---|---|
| İlk node (`from` yok) | Sadece node oluşur, edge yok. Bu node `startNodeId` olur. |
| Birebir eşleşen node yok (element kümesi tüm node'lardan farklı) | **Soru sorulmaz.** Yeni node + `from → yeni` edge |
| Birebir eşleşen node(lar) var, kullanıcı **"Hayır / Hiçbiri, yeni node"** dedi | Yeni node + `from → yeni` edge |
| Birebir eşleşen node(lar) var, kullanıcı başka bir aday için **"Evet, bu node"** dedi | Yeni node oluşmaz. `from → seçilen` edge çizilir. Seçilen node'un kayıtlı verisi (ekran görüntüsü, elementler) değişmez. |
| Kullanıcı **şu anki node** (`from`) için "Evet, bu node" dedi | İki seçenek sorulur. **Kendine dönen edge olarak kaydet:** `from → from` **self-loop** çizilir. **Node oluşturma, aksiyonlara devam et:** node ve edge oluşmaz, aksiyonlar buffer'a geri döner ve bir sonraki "Node oluştur"a kadar birikmeye devam eder. |
| Bekleyen aksiyon yok (ilk node hariç) | **Node oluşturulmaz, hiçbir şey değişmez.** Buton kilitlidir; background mavi bir bilgi mesajıyla döner. Sayfa kaydedilemeyen bir şekilde değiştiyse (iframe içi, hover menü, sayfanın kendi yönlendirmesi) önce kaydedilebilen bir aksiyon gerekir. |
| `from` silinmiş | Node oluşur ama edge oluşmaz. Kullanıcı "Buradan devam et" ile bir başlangıç seçmelidir. |

**İsimlendirme:**

- Node: `v_` + URL'nin son anlamlı parçası (`/inventory.html` → `v_Inventory`). Yoksa sayfa başlığı kullanılır (`Swag Labs` → `v_SwagLabs`). Aynı isim varsa sonuna `_2`, `_3` eklenir.
- Edge: `e_` + son aksiyonun etiketi (`Login` butonu → `e_Login`, `Add to cart` → `e_AddToCart`). Kaydırmalar ve pencere boyutu değişimleri atlanır: bir linke tıklandıktan sonra sayfa kendini başa kaydırsa da, arada DevTools açılsa da edge `e_Product` olur. Beklemeler de atlanır. Edge yalnızca bunlardan oluşuyorsa adı `e_ScrollDown` / `e_ScrollUp` / `e_Resize` / `e_Wait` olur.
- Türkçe karakterler sadeleştirilir (`Giriş yap` → `GirisYap`), çünkü bu isimler ileride Java/JS metot adı olacak.

---

## Aksiyonlar nasıl yakalanıyor?

### Sayfa içi olaylar (`content.js`)

| Olay | Kaydedilen aksiyon | Not |
|---|---|---|
| `click` | `click` | Form alanlarına tıklamalar yok sayılır (bkz. aşağıda). Hedef, `closest()` ile en yakın etkileşimli elemente yükseltilir: butonun içindeki `<span>`'e tıklanınca butonun kendisi kaydedilir. |
| `click` (aynı elemente hızlı art arda: `event.detail` ≥ 2) | `multiclick` | Çift, üçlü, … tıklama tek harekettir: tarayıcının tıklama sayacı, işletim sisteminin çift tıklama süresi içindeki tıklamaları sayar. İlk tıklama `click` olarak gider; sonraki her tıklama hareketin önceki aksiyonunun yerine geçen bir `multiclick` gönderir (`count` = sayaç; aksiyonun öncesi ilk tıklamanın öncesidir). Arada başka bir aksiyon gittiyse hareket yeniden başlar. Ayarlar'da **Çoklu tıklama** kapalıysa her tıklama ayrı `click` olarak kaydedilir. Kutu **Tıkla**'ya bağlıdır: Tıkla'nın işareti kalkınca onun da işareti kalkar ve kutu pasif olur. Metne çift / üçlü tıklayıp seçmek `select`'tir (aşağıda). |
| `change` | `input` | text, select, checkbox, radio... Değer kaydedilir. Şifreler maskelenir. |
| `mouseup` (fare kaydıysa, çift/üçlü tıklandıysa ya da Shift ile tıklandıysa ve seçili metin varsa) | `select` | Metin seçmek tıklama değildir: tarayıcının ardından ürettiği `click` yok sayılır. Seçilen metin ve onu içeren element (metin alanında alan ve `start`/`end` aralığı) kaydedilir. Çift/üçlü tıklamada hareketin önceki tıklaması ya da kelime seçimi zaten gönderilmiştir; background onu bu seçimle değiştirir. Shift+tıklama ve klavyeyle (aşağıda) genişletilen seçim de son seçimin yerini alır. Butona, linke çift tıklamak seçim sayılmaz. |
| `contextmenu` (sağ tık, menü tuşu, Shift+F10) | `contextmenu` | Sağ tuş `click` üretmez. Sayfa olayı engellediyse (`blocked`) tarayıcının menüsü yerine kendi menüsünü açmıştır. Menü tuşu ve Shift+F10 tuş olarak kaydedilmez. |
| `focusin` (Tab / Shift+Tab sonrası) | `focus` | Tab tuşu kaydedilmez (tekrar oynatırken sayfadaki sıraya bağlı kalırdı); odağın gittiği element kaydedilir. Background yalnızca state'i değiştiren odağı tutar ("içeriğe atla" linkinin görünmesi gibi); formda alandan alana geçmek gürültü olarak düşer. Aksiyonun öncesi Tab'a basıldığı andır. |
| `copy` / `cut` / `paste` | `clipboard` | Klavyeden, sağ tık menüsünden ya da Chrome menüsünden yapılsa da gelir; bu yüzden Ctrl+C/X/V tuş olarak kaydedilmez. Kopyalanan / yapıştırılan metin ve sayfanın işlemi engelleyip engellemediği (`blocked`: sayfa `preventDefault()` çağırdı) kaydedilir: sitenin kopyalama / yapıştırma iznini test etmek için. Hiçbir şey seçili değilken Chrome `copy` olayı üretmez. |
| `focusout` (`contenteditable`) | `input` | Zengin metin editörlerinde `change` yoktur; odak alandan çıkınca metin (`innerText`) değiştiyse kaydedilir. |
| `keydown` + Enter (input içinde) | önce `input`, sonra `enter` | Enter, `change`'den *önce* tetiklenir. Sıra doğru olsun diye değer burada kaydedilir. |
| `keydown` (komut tuşları) | `key` | Metin harf harf kaydedilmez; alanın değeri `input` ile kaydedilir. Kaydedilenler: alan dışında her tuş (Escape, oklar, Delete, `/`, `c`...; butonda/linkte Enter ve Space hariç, onları tarayıcı `click` olarak üretir), alanda Escape, tek satırlı alanda ArrowUp/Down (öneri seçmek) ve Ctrl/Alt/Cmd kısayolları (imleç ve Ctrl+C/V/Z gibi düzenleme tuşları hariç). Hiç kaydedilmeyenler: Tab, tek başına Ctrl/Shift, kopyala/kes/yapıştır (`clipboard` kaydeder), tarayıcının kısayolları (Ctrl +/-, F5, Alt+←, Ctrl+F, F12...; `content.js > BROWSER_SHORTCUTS`). AltGr ile yazılan karakterler (`@`) kısayol sayılmaz. Tuştan önce alandaki değer kaydedilir: "Fill Search → Press ArrowDown". Aynı tuşa sayfa durulmadan tekrar basılırsa tek aksiyon olur (`Press ArrowDown ×3`). |
| `keydown` (tarayıcıda varsayılan işi olan tuşlar) | `key`, `select` ya da hiçbiri | Shift+oklar/Home/End ve Ctrl+A metin seçer; alan dışında Space, PageUp/Down, Home/End ve oklar sayfayı kaydırır. Bu tuşların ne yaptığı olay bitince bilinir; karar 100 ms sonra verilir: sayfa olayı engellediyse tuşu sayfa kullanmıştır (`key`, ör. galeride ok tuşu); seçim değiştiyse `select` (alan dışında Ctrl+A tüm sayfa metni saklanmasın diye `key`); sayfa kaydıysa hiçbiri (kaydırma `scroll` olarak gelir); hiçbiri olmadıysa `key`. Bu arada başka bir aksiyon gelirse önce tuşun kararı verilir. |
| `scrollend` (sayfa ya da kaydırılabilir kutu) | `scroll` | `scroll` olayı kaydırma boyunca onlarca kez gelir; `scrollend` hareket bitince bir kez gelir. Vardığı konum (`x`, `y`) kaydedilir. Sayfanın kendi yaptığı kaydırmalar da kaydedilir (tarayıcı bunları kullanıcınınkinden ayırmaz); konum mutlak olduğu için tekrar oynatmada zararsızdır. |
| `mouseover` + ekran değişimi (Ayarlar'da işaretliyse) | `hover` | Fareyi üzerine getirince ekran değiştiyse kaydedilir; değişmediyse kayda girmez. Varsayılan kapalı. Bkz. [Fareyle üzerine gelme](#fareyle-üzerine-gelme) |
| `resize` (pencere) | `resize` | Pencereyi sürüklemek, yan paneli ya da DevTools'u açmak, tam ekrana geçmek sayfanın görünen alanını değiştirir; ekrana sığan elementler, yani state de değişebilir. Varılan boyut (`viewport`, CSS piksel) kaydedilir. Olay sürükleme boyunca her karede gelir: ilk olay hemen gönderilir, sonrakiler birleşir; background açık aksiyonu günceller, sürükleme tek aksiyon olur. Yakınlaştırma da bu olayı tetikler ama `devicePixelRatio`'yu da değiştirdiği için ayrılır; onu background `zoom` olarak kaydeder (aşağıda). |

content.js tüm aksiyonları yakalar ve gönderir. Ayarlar'da işaretli olmayan tipleri `background.js > addAction()` buffer'a eklemez; tarayıcı seviyesindeki gezinmeler de (aşağıda) aynı süzgeçten geçer.

Üç teknik detay:

- **Capture phase** (`addEventListener(..., true)`): Olayları sayfanın kendi kodundan önce görürüz. Sayfa `stopPropagation()` çağırsa bile kayıt kaçmaz.
- **`event.isTrusted` kontrolü:** Yalnızca gerçek kullanıcı olayları kaydedilir. Sayfanın JavaScript'le ürettiği sahte tıklamalar yok sayılır.
- **Form alanına tıklama yok sayılır:** Bir input'a tıklamak sadece odaklanmaktır. Değeri zaten `change` ile gelecektir; tıklamayı da kaydetmek gürültü üretirdi.

### Tarayıcı seviyesindeki gezinmeler (`background.js`)

Adres çubuğuna URL yazmak ya da geri tuşuna basmak sayfanın *içinde* olmaz, bu yüzden content script bunları göremez. Bunları background iki olayla yakalar:

- `chrome.webNavigation.onCommitted`: klasik sayfa geçişleri (yeni bir HTML belgesi yüklenir)
- `chrome.webNavigation.onHistoryStateUpdated`: SPA geçişleri (React/Vue router gibi; sayfa yeniden yüklenmez, sadece URL değişir). Örneğin saucedemo.com bir SPA'dır ve oradaki geri tuşu yalnızca bu olayla görülebilir.

İki olay aynı fonksiyona (`onNavigation`) bağlıdır ve şu tabloya göre aksiyon üretir:

| Chrome'un bildirdiği geçiş | Kaydedilen aksiyon |
|---|---|
| `transitionQualifiers` içinde `forward_back` | `history` (Geri/İleri) |
| `transitionType: reload` | `reload` |
| `transitionType: typed / auto_bookmark / generated` | `navigate` (adres çubuğu, yer imi) |
| `link`, `form_submit` ve diğerleri | *Kaydedilmez*: content.js zaten `click` / `enter` olarak kaydetti. |

Tarayıcı yakınlaştırması (Ctrl + / Ctrl -, Ctrl + tekerlek, menü) da sayfanın içinde olmaz. Background bunu `chrome.tabs.onZoomChange` ile yakalar ve `zoom` aksiyonu üretir: oran büyüdüyse `Zoom in`, küçüldüyse `Zoom out`; varılan oran (`zoom`) saklanır. Yakınlaştırma sayfanın CSS piksel boyutunu ve piksel oranını da değiştirdiği için varılan boyut (`viewport`) da saklanır: tarayıcı yakınlaştırması olmayan otomasyon araçları (Playwright) aynı ekranı bu boyutla kurar. Boyut, aksiyonu kapatan bildirimle (`SCREEN` ya da sonraki aksiyon) gelir. State yalnızca ekrana sığan elementlerden oluştuğu için yakınlaştırma da kaydırma gibi state'i değiştirebilir. Chrome oranı site başına sakladığı için başka bir siteye geçince oran kendiliğinden de değişebilir; bu da kaydedilir, oran mutlak olduğu için tekrar oynatmada zararsızdır. Sayfa durulmadan art arda gelen yakınlaştırmalar (tekerleğin her çentiği) tek aksiyon olur: oran güncellenir, başlangıç oranına (`fromZoom`) dönülürse aksiyon düşer.

---

## Edge düzenleme

Graph'ta bir edge seçilince detay kartı aksiyonlarını listeler. Kullanıcı gereksiz bir aksiyonu (ör. iki kez tıklanmış aynı buton) silebilir.

**Kurallar:**

- **En az bir aksiyon kalır.** Aksiyonsuz edge tekrar oynatılamaz. Son kalan aksiyonun sil butonu pasiftir; background da reddeder.
- **Aksiyon eklenemez.** Silmede kalan her aksiyon sayfada gerçekten yapılmış ve gözlemlenmiştir. Elle eklenen aksiyon ise hiç gözlemlenmemiş olurdu (hedefi o ekranda mı, edge'i hedef ekrana götürür mü bilinmez). Eksik aksiyon varsa edge yeniden kaydedilir: kaynak node seçilip "Buradan devam et", aksiyonlar yapılır, eski edge silinir.
- **Karar kullanıcının, kanıt makinenin.** Her aksiyon kayıt sırasında "state'i değiştirdi mi?" diye işaretlenir (`changed`, aşağıda). Panel bunu her aksiyonun yanında gösterir:
  - *ekranı değiştirmedi*: Aksiyondan önceki ve sonraki state aynı. Silmek edge set açısından güvenli; uyarısız silinir.
  - *ekranı değiştirdi*: Silinmek istenince gerekçeli uyarı çıkar; edge'in son aksiyonuysa "silinirse edge hedef node'un ekranına varmaz" da eklenir. Kullanıcı yine de silebilir.
  - *etkisi bilinmiyor*: Bu özellikten önce kaydedilmiş edge ya da aksiyonun sonrası görülemedi (aşağıda). Silmeden önce uyarı çıkar.
- **Geri alınabilir.** Aksiyon silmesi de genel geri al yığınına yazılır (bkz. aşağıda [Geri al](#geri-al)).
- **İzlenebilir.** İlk silmede kayıttaki orijinal liste `edge.recordedActions`'a kopyalanır; panel "düzenlendi (kayıtta 3)" gösterir. GraphWalker çıktısında edge `edited: true` ve `recordedActions` taşır. Tüm silmeler geri alınınca işaret kalkar.

**İşaret nasıl bulunur?** Background hafızada tek bir state tutar: **hemen önceki** (`state.screen`). Node oluşturulunca (ya da "Buradan devam et" denince) bu, node'un state'idir. Aksiyondan sonra sayfa durulunca content.js yeni ekranı bildirir (`SCREEN`). Aksiyon, hemen önceki state ile bu yeni state karşılaştırılarak işaretlenir ve yeni state "hemen önceki" olur:

```
node (S0) ── tıkla ── duruldu: S1 ── zoom ── duruldu: S2 ── Node oluştur: S3
             S0 vs S1                S1 vs S2                 (açık aksiyon varsa S2 vs S3)
```

- Ekranın kendisi aksiyonda saklanmaz, sadece işaret (`true` / `false` / `null`). Karşılaştırma işaretlendiği andaki Ayarlar'la yapılır.
- Aksiyonu background yakalasa da (yakınlaştırma, adres çubuğu, geri, yenile) ya da olay geldiğinde ekran zaten değişmiş olsa da (pencere boyutu) öncesi bilinir: bir önceki aksiyonun sonrasıdır. Sonrası, yeni sayfa ya da yeni boyuttaki sayfa durulunca gelir.
- Sonrası bildirilmeden yeni aksiyon gelirse (ör. yazıp hemen Enter) açık aksiyon, yeni aksiyonun yapıldığı andaki ekranla kapatılır. Yazmanın öncesi yazmaya başlamadan önceki state'tir; yazarken ortaya çıkan buton da yazmanın etkisi sayılır.
- Sonrası bildirilmeden background'ın yakaladığı bir aksiyon ya da pencere boyutu değişimi gelirse (ör. tıklayıp 300 ms içinde Ctrl +) iki aksiyonun etkisi ayrılamaz; ikisi de *etkisi bilinmiyor* olur.
- Tab ile odak (`focus`) işaretlendiği an state'i değiştirmediyse düşer: formda alandan alana geçmek edge'e gürültü olarak girmez. Bekleyen tek aksiyon böyle düşerse "Node oluştur" node oluşturmaz.
- Sayfanın aksiyonsuz değişimleri (durulduktan sonra gelen yükleme, hover) "Beklemeleri kaydet" kapalıyken izlenmez; bir sonraki aksiyonun etkisine karışır. Açıkken ekranı değiştiren bir bekleme olarak kaydedilir (aşağıda).

Bu bir **ipucudur, kesin doğrulama değil**: bir aksiyon edge set'i değiştirmeden de önemli olabilir (sunucuda bir şeyi değiştirmek gibi). Kesin doğrulamayı runner yapar: yolu tekrar oynatıp her edge'in hedef ekrana vardığını kontrol eder ([runner/README.md](../runner/README.md)).

### Bekleyen aksiyonları silme

Edge oluşmadan önce de yanlışlıkla yapılan bir aksiyon (fazladan bir tıklama, gereksiz bir odak) "Bekleyen aksiyonlar"dan silinebilir; her satırda ✕ vardır. Kurallar edge düzenlemeyle aynı kanıta dayanır:

- **Yalnızca silme.** Aksiyon eklenmez, sırası değişmez (yukarıdaki gerekçe).
- *Ekranı değiştirmedi* işaretli aksiyon uyarısız silinir. Ekranı değiştiren, etkisi bilinmeyen ya da sonrası henüz görülmemiş (sayfa durulmamış) aksiyonda ve sekme aksiyonunda gerekçeli uyarı çıkar: silinirse oluşacak edge tekrar oynatılınca node'un ekranına varmayabilir ya da sonraki aksiyonlar başka sekmede yapılır.
- **Geri alınmaz.** Aksiyon sayfada yeniden yapılabilir; geri al yığını graph'taki silmeler içindir.
- **Karar beklerken ve oynatma sürerken kapalı.** "Aynı node mu?" sorusu beklerken bekleyen aksiyonların bir kısmı kararın içindedir.
- Panel aksiyonu sırası ve zamanıyla gösterir (`REMOVE_BUFFERED { index, time }`); liste bu arada değiştiyse (yeni aksiyon geldi) background başka bir aksiyonu silmez, reddeder.
- Silinen aksiyon açıksa (sonrası henüz görülmediyse) sayfa durulunca gelen ekran aksiyonsuz bir değişim gibi işlenir; "Beklemeleri kaydet" açıksa bile bekleme eklenmez (boşluk o anda başlar).
- Yazma (`input`) silinince alandaki yazı sayfada kalır: alana yazmaya devam edilirse alanın o anki tam değeriyle yeni bir `input` aksiyonu oluşur.

**Sınırlar:**

- Uyarı yalnızca aksiyonun kendi etkisine bakar. Ekranı değiştirmeyen bir aksiyon sonraki adımın önkoşulu olabilir ("Login" ancak alanlar doluyken çalışır); böyle bir alan doldurma uyarısız silinir, oynatmada sonraki adım kalır. İyileştirme: silinen aksiyonla sonraki aksiyonların hedefleri arasında bağımlılık uyarısı (aynı form gibi).
- Silme geri alınmaz; bazı aksiyonlar (sayfanın açtığı sekme, oturum zaman aşımı beklemesi) sayfada kolay tekrarlanmaz. İyileştirme: bekleyen aksiyon silmelerini de geri al yığınına almak.
- Karar beklerken yapılan yanlış aksiyon önce karar verilip sonra silinir. İyileştirme: karardaki aksiyonlarla sonradan gelenleri ayırıp yalnızca sonradan gelenleri silinebilir göstermek.

**Filtre** (`panel.js > AKSİYON FİLTRESİ`): edge detayındaki ve "Bekleyen aksiyonlar"daki listenin başlığında **Filtrele** kutusu vardır. Kutuda listedeki aksiyon türleri çıkar; işaretlenen türler listede gizlenir. Örnek: *Bekle, Tıkla, Tıkla, Bekle, Resize* listesinde *Tıkla* işaretlenince *1. Bekle, 4. Bekle, 5. Resize* görünür.

- Yalnızca gösterimdir: aksiyon silinmez; oynatma, dışa aktarma ve edge'in adı etkilenmez. Görünen satırlar listedeki asıl sıra numarasını korur.
- Otomatik bekleme kaydedilen beklemeden ayrı bir türdür (*Bekle (otomatik)*): yalnızca otomatik beklemeler gizlenebilir.
- İki listenin filtresi ayrıdır; edge filtresi bütün edge'lerde geçerlidir. Başlıkta kaç aksiyonun gizlendiği yazar (*Filtrele · 3 gizli*).
- Seçim bu tarayıcıda hatırlanır (`localStorage > actionFilters`); panel yeniden açılınca aynı türler gizli gelir.

---

## Beklemeler

Bazı durumlara hiçbir tıklamayla ulaşılmaz, yalnızca beklenerek ulaşılır. Örnek: internet bankacılığında oturum zaman aşımı kullanıcıyı çıkış ekranına atar. Graph'ı kuran kişi bu durumu modele eklemek isteyebilir. Ayarlar'daki **Beklemeleri kaydet** açıkken bekleme bir aksiyon (`wait`) olarak kaydedilir. Varsayılan kapalıdır; kapalıyken kayıt eskisi gibidir.

**Bekleme kaydedilir, elle eklenmez** (otomatik bekleme dışında, aşağıda). Gözlenmiş bir aksiyondur; edge düzenlemedeki "aksiyon eklenemez" kuralı geçerli kalır. Bekleme sayfaya dokunmaz ama ekranı değiştirebilir; bunu görmek için kayıt sekmesinin ekranı aksiyonsuz da izlenir.

**Nasıl kaydedilir** (`background.js > BEKLEMELER`):

- Background, ekranın son aksiyondan (ya da node'dan) sonra durulduğu anı tutar (`state.idleSince`).
- **Ekran beklerken kendiliğinden değişirse** bekleme o anda kapanır ve *ekranı değiştirdi* işaretini alır. Süresi değişime kadar geçen süredir (ör. tam zaman aşımı süresi). Böyle bir bekleme ne kadar kısa olursa olsun kaydedilir. Sonraki boşluk yeni bir beklemedir.
- **Ekran değişmediyse** iki aksiyon arasındaki boşluk, Ayarlar'daki **alt sınırdan** (varsayılan 1 sn) uzunsa *ekranı değiştirmedi* işaretli bir bekleme olarak ikinci aksiyondan önce eklenir. Daha kısa boşluklar kaydedilmez; yoksa her edge, düşünme süresinden doğan beklemelerle dolardı. Ekranı değiştirmeyen bekleme edge düzenlemede uyarısız silinir.
- **Node'dan sonraki ilk aksiyona** kadar geçen süre de aynı kuralla kaydedilir: bekleme node başarıyla oluşunca (onay kartı varsa karar verilince) ya da "Buradan devam et"ten sonra başlar; ekran değişirse hemen, değişmezse ilk aksiyondan önce edge'in ilk aksiyonu olarak eklenir.
- **Son aksiyondan "Node oluştur"a** kadar geçen süre aksiyonlar arasında değildir; ekran değişmediyse kaydedilmez.
- **Yazma:** yazma aksiyonu alan odaktan çıkınca gönderilir. Yazmadan önceki bekleme yazmaya başlanan anda biter (`typingSince`). Yazarken ekranda olanlar (ör. beliren "Temizle" butonu) kendiliğinden değişim sayılmaz.
- **Süre değiştirilebilir** (`background.js > setWait`): "Bekleyen aksiyonlar"da ve edge detayında her beklemenin yanında **✎**; süre satırda saniye olarak yazılır (Enter ya da odaktan çıkmak kaydeder, Esc vazgeçer; 0–3600 sn). Yalnızca süre değişir: tip, sıra ve *ekranı değiştirdi* işareti kalır. Edge'de değişiklik silme gibidir: kayıttaki orijinal liste `recordedActions`'ta saklanır, **Geri al** ile geri alınır. Ekranı değiştiren bir beklemeyi (zaman aşımı) kısaltmak oynatmada o ekrana erken bakmak demektir; doğrulamadaki tekrar deneme (10 sn) farkı ancak o kadar örter.
- Bekleyen tek aksiyon bir bekleme olabilir (zaman aşımı senaryosu): "Node oluştur" buna izin verir, edge'in adı `e_Wait` olur. Beklemeler kaydediliyorsa "Node oluştur" butonu bekleyen aksiyon yokken de açıktır; background önce ekrana bakar, değişim yoksa node oluşturmaz.

**İzleme** (`content.js > setMonitoring`): yalnızca anahtar açıkken ve kayıt sekmesinde çalışır. DOM değişince sayfanın durulması beklenir (300 ms DOM değişmez, en fazla 3 sn) ve ekran (edge set) değiştiyse `SCREEN` gönderilir; değişmediyse gönderilmez. Sürekli değişen bir sayfada parmak izi en fazla 3 sn'de bir alınır. Hangi sekmenin izleyeceğini background söyler (`MONITOR` ya da `ACTION` / `SCREEN` cevabı).

**Sınır:** aksiyonsuz her değişim bekleme sayılır; kaydedilmeyen hareketlerin etkisi de. Fareyi üzerine getirince açılan bir menü, Ayarlar'da **Üzerine gelme** kapalıyken bekleme olarak görünür; açıkken `hover` aksiyonu olur (aşağıda). Sürekli değişen sayfalarda (carousel, canlı akış) her değişim ekranı değiştiren bir bekleme üretebilir.

**Otomatik bekleme** (`background.js > withAutoWaits`): Ayarlar'daki **Beklemeleri kaydet** anahtarından bağımsız, her zaman açıktır. Edge kaydedilirken (node oluşunca ya da onay kartında karar verilince) bekleme olmayan her aksiyonun arkasına **Aksiyon sonrası bekleme** süresi (varsayılan 10 ms, 0–60000 ms) kadar bir `wait` eklenir. Bu yüzden edge her zaman bir beklemeyle biter: `Tıkla, Wait, Yaz, Wait`.

- Aksiyonun arkasında kaydedilmiş bir bekleme varsa (*Beklemeleri kaydet*) otomatik bekleme eklenmez; kaydedilen kendi süresiyle onun yerine geçer.
- "Bekleyen aksiyonlar"a eklenmez, yalnızca edge'e girer: buffer'ın son aksiyonu açık aksiyondur (sonrası bekleniyor; yazma, kaydırma, resize birleşir), arkasına bekleme konamaz.
- `auto: true` işaretlidir; panel etkisini *otomatik eklendi* diye gösterir. Etkisi ölçülmez (`changed: null`): önceki aksiyonun yüklemesi bekleme sırasında sürebilir, runner onu sapma saymaz. Silerken uyarı çıkmaz; süresi diğer beklemeler gibi ✎ ile değişir.
- Ayardaki süre değişince yalnızca yeni kaydedilen edge'ler etkilenir; eski edge'ler eski süreleriyle kalır.

**Tekrar oynatma:** runner bekleme süresi kadar bekler. Ekranı değiştiren bekleme biraz geç sonuçlansa da doğrulamadaki tekrar deneme onu yakalar.

---

## Fareyle üzerine gelme

Bazı menüler ve kartlar fare üzerine gelince açılır: tıklama yoktur ama ekrana yeni etkileşimli elementler gelir, yani state değişir. Ayarlar'daki **Üzerine gelme (fare)** işaretliyse bu bir `hover` aksiyonu olarak kaydedilir. Diğer aksiyon tiplerinin aksine **varsayılan kapalıdır** (`settings.js > ACTION_TYPES > optional`): fare sayfada sürekli dolaşır ve değişimi fareye bağlamak bir tahmindir; kullanıcı bilerek açmalıdır.

**Nasıl yakalanır** (`content.js > FAREYLE ÜZERİNE GELME`): iki tür menü var.

- **CSS ile açılan menü** (`.menu:hover .alt { display: block }`) DOM'u değiştirmez; olay dinleyerek görülemez. Fare etkileşimli bir elementin üzerine gelince sayfanın durulması beklenir ve ekrana bakılır.
- **JavaScript ile açılan menü** (`mouseenter`) DOM'u değiştirir. Değişim fare hareketinden en fazla 1 sn sonra başladıysa imlecin altındaki element tetikleyici sayılır. Fare 1 sn'dir kıpırdamıyorsa değişim kendiliğindendir (zaman aşımı gibi); bekleme olarak kalır.

Ekran (edge set) değiştiyse ve fare hâlâ tetikleyicinin üzerindeyse `hover` gönderilir. Background, Tab odağındaki gibi yalnızca state'i değiştiren üzerine gelmeyi tutar; fareyi bir butonun üzerinden geçirmek kayda girmez. Tarayıcı, sayfa düzeni değişince imleç yerinde dururken de fare olayı üretir; konum değişmediyse hareket sayılmaz. Açıkken kayıt sekmesinin ekranı izlenir (Beklemeler'deki gibi).

**Fareyi hızla tıklanacak elemente götürmek:** fare bir menüden çıkıp hemen tıklarsa menünün kapanması ayrı bir aksiyon olmaz, tıklamanın öncesine katılır. Tekrar oynatırken de araç tıklamak için fareyi oraya götürür, aynı şey olur.

**Tekrar oynatma:** runner elementin ortasına fareyi getirir (`hover()`); CSS `:hover` da `mouseenter` de çalışır.

**Sınırlar** (tahmine dayalı olduğu için):

- Değişim fare hareketinden hemen sonra kendiliğinden olursa (aynı anda gelen bir bildirim gibi) üzerine gelmeye mal edilebilir.
- JS menüsünde tetikleyici, imlecin altındaki en içteki elementtir (ör. kartın içindeki bir yazı); menünün asıl dinleyicisi onun bir üstü olabilir. Tekrar oynatırken farenin aynı noktaya gelmesi çoğu zaman yeter.
- Etiket ve hedef üzerine gelindikten sonraki ekrandan alınır: kartın etiketi açılan butonun yazısını da içerebilir (`Hover Kart Satın al`).
- CSS ile açılan ama etkileşimli olmayan bir element (ör. düz bir `li`) üzerine gelince ekrana bakılmaz; böyle menüler yakalanmaz.
- Her etkileşimli elementin üzerine gelişte (sayfa durulmuyorsa) parmak izi alınır; çok elementli sayfalarda fare hareketi biraz maliyetlidir.

---

## Node birleştirme

Node detayındaki **Birleştir…** butonu, seçili node'u başka bir node ile birleştirir. Tipik kullanım: kullanıcı onay kartında "Hayır, yeni node" demiş, sonra iki node'un aslında aynı durum olduğuna karar vermiş. Birleştirme, o "Evet" kararının sonradan verilmesidir.

**Ne olur:** Kaldırılan node'a gelen ve ondan çıkan tüm edge'ler kalan node'a bağlanır; ikisi arasındaki edge'ler kendine dönen edge (self-loop) olur. Kaldırılan node silinir. Başlangıç ya da şu anki node idiyse bu rol kalan node'a geçer. Kalan node kendi adını, ekran görüntüsünü ve parmak izini korur. Hangisinin kalacağını kullanıcı seçer; varsayılan, önce oluşturulan node'dur.

**Kurallar:**

- **Edge set'i farklı node'lar hiçbir zaman birleştirilemez.** Sadece URL şablonu ve edge set'i (şu anki Ayarlar ile) birebir aynı node'lar seçilebilir. Diğerleri pencerede sebebiyle pasif görünür (ör. "edge set farklı: `button:Sil` 5 ≠ 4"); background da isteği ayrıca reddeder. Sebebi projenin temel kuralı: edge set'i farklı iki node'u birleştirmek, kaldırılan node'dan gelen edge'lerin hedefinin kalan node'un ekranında olmamasına (çakışmaya) yol açar. İki node'u aynı saymak isteyen kullanıcı, farkın kaynağını tanımdan çıkarmalıdır (Ayarlar'da o türün işaretini kaldırmak); o zaman node'lar aynı edge set'e iner ve birleştirilebilir.
- **Sadece ayar sayesinde eşitlik uyarısı.** Edge set'ler yalnızca Ayarlar'da kapalı türler yüzünden eşitse pencere uyarır: o türler tekrar açılırsa fark geri gelir ama node tek kalır.
- **Gizli durum notu.** Aynı edge set, aynı durum için gerekli ama yeterli değildir. Ekranda görünmeyen bir fark varsa (sepetteki ürün sayısı, giriş yapan kullanıcı) birleştirmek, testin geçerli olmayan bir yolu seçmesine yol açabilir. Pencere bunu her seferinde hatırlatır.
- **Tekrar eden edge'ler kullanıcıya aittir.** Birleştirme sonrası aynı kaynak, hedef ve aksiyon dizisine sahip edge'ler olabilir. Bunlara dokunulmaz; panel sadece sayısını bildirir, istenirse elle silinir.
- **Bekleyen soru varken birleştirme yapılmaz.**
- **Geri alınabilir:** Geri al / Ctrl+Z kaldırılan node'u eski yerine, taşınan edge'leri eski uçlarına döndürür.

---

## Geri al

Yanlışlıkla silinen bir node ya da edge graph'ı bozabilir. Bu yüzden her **silme** geri alınabilir: araç çubuğundaki **Geri al** butonu ya da panele odaklıyken **Ctrl+Z** (Mac'te Cmd+Z).

- **Ne kaydedilir:** node silme (bağlı edge'leriyle birlikte), edge silme, edge'den aksiyon silme ve node birleştirme. Her işlem, kaldırılanı ve eski yerini (listedeki sırasını, birleştirmede taşınan edge'lerin eski uçlarını) `state.undo` yığınına yazar (`background.js > remove()`, `removeAction()`, `mergeNodes()`).
- **Nasıl geri alınır:** Son silme tersine çevrilir (`background.js > undo()`). Node, edge'leri ve eski sıralarıyla döner. Başlangıç ya da şu anki node idiyse, bu rolleri de geri gelir (kullanıcı arada başka bir node seçmediyse). Yığında en fazla 20 silme tutulur.
- **Neden tüm graph'ın kopyası değil:** Her silmede graph'ın kopyasını almak ekran görüntüleri yüzünden depolamayı hızla şişirirdi. Silinen parçayı ve yerini saklamak yeterli, çünkü geri al hep en son silmeden başlar (LIFO).
- **Sınırlar:** Sadece silmeler geri alınır (node oluşturma, isim değiştirme geri alınmaz). **Sıfırla** geri alınamaz; bu yüzden iki tıklamayla onaylanır. Son node silinince graph sıfırlanmaz, boş kalır; böylece silme geri alınabilir.
- **Ctrl+Z ne zaman çalışmaz:** İsim alanında yazarken (tarayıcı metni geri alır) ve bir pencere (dialog) açıkken.

Silme sonrası panel *"v_X silindi. Geri almak için Geri al ya da Ctrl+Z."* der; butonun üzerine gelince neyin geri alınacağı yazar.

---

## Kayıt hangi sekmede?

Kayıt **ilk "Node oluştur"un yapıldığı sekmede** başlar. Akış başka sekmelere de yayılabilir: site yeni bir sekme ya da pencere açar (`target=_blank` link, ödeme / OAuth penceresi) ya da kullanıcı başka bir sitenin sekmesine geçer (kayıt olduktan sonra e-postadaki doğrulama linki). Aksiyonlar her an yalnızca **aktif kayıt sekmesinden** (`state.tabId`) kabul edilir; kayda katılan sekmeler `state.tabs`'ta tutulur (`background.js > SEKMELER`).

**Kayda katılmamış bir sekme aktif olunca** panel sorar: *"Farklı bir sekmedesiniz. Grafa bu sekmede devam edilsin mi?"* (sekmeyi kayıt sekmesi açtıysa: *"Kayıt sekmesinin açtığı bir sekmedesiniz..."*). Soru background'da bekleyen bir karardır (`state.tabPrompt`); panel onu kart olarak çizer, cevap `RESOLVE_TAB` mesajıyla döner.

- **Evet:** kayıt bu sekmede sürer. Edge'e bir `tab` aksiyonu (`open`) eklenir ve sekmenin ekranı bu aksiyonun sonrası olur. Sekmeyi kayıt sekmesi açtıysa (`webNavigation.onCreatedNavigationTarget`) açılış önceki aksiyonun (tıklamanın) sonucudur (`by: "page"`); kullanıcı açtıysa "yeni sekme aç ve bu adrese git" demektir (`by: "user"`). Yeni sekmenin görünen alanı öncekinden farklıysa (başka pencere) ardından bir `resize` eklenir.
- **Hayır:** sekme hatırlanır (`state.declinedTabs`), o sekmeye her geçişte soru tekrar çıkmaz. Kayıt eski sekmede kalır, bu sekmedeki aksiyonlar yok sayılır: kullanıcı arada başka bir sekmede bir şey araştırırsa graph kirlenmez. Kayıt sekmesine dönünce kayıt kaldığı yerden sürer.
- Soruyu cevaplamadan kayıt sekmesine dönülürse soru kalkar; o sekmeye tekrar geçince yeniden sorulur.
- "Hayır" denen bir sekmede **Node oluştur**'a basılırsa soru yeniden sorulur: kullanıcı fikrini değiştirmiştir.

**Kayda katılmış sekmeler arası geçiş sorulmaz**, `tab` aksiyonu (`switch`) olarak eklenir. Kayda katılmış bir sekme kapanırsa ve kayıtta başka sekme kaldıysa kapanış da bir aksiyondur (`close`); aktif sekme kapandıysa Chrome'un öne getirdiği sekmeye (kayda katılmışsa) geçilir.

**Tekrar oynatırken** sekme sıra numarasıyla değil adresiyle (URL şablonu) bulunur. GraphWalker'ın yolu edge'leri kayıttaki sırayla yürümeyebilir; aynı sekmeyi açan bir edge iki kez geçilirse sıra numaraları kayardı ([runner/README.md > Aksiyonların karşılığı](../runner/README.md#aksiyonların-karşılığı)).

**Kayıt sekmelerinin hepsi kapanırsa** aksiyon kaydı durur. Başka bir sekmede soruya "Evet" denince kayıt, o sekme **şu anki node'un ekranındaysa** (URL şablonu ve edge set'i aynı) sürer; değilse sonraki edge'ler kayıttaki ekranlarla tutmayacağı için reddedilir. Diğer yol: graph'ta bir node seçip **Buradan devam et**. Panelin durum satırı bu durumu hatırlatır.

---

## Graph'lar

Birden fazla graph saklanır (örneğin her site ya da her akış için bir graph); kayıt her zaman **aktif** graph'a yapılır. Her graph storage'da kendi anahtarındadır (`graph:<id>`), liste ve aktif graph ayrı anahtarlarda ([04 > Storage](04-veri-modeli.md#storage-graphlar)). Background yalnızca aktif graph'ı bellekte tutar (`background.js > GRAPH'LAR`).

Panelde açılır-kapanır **Graph'lar** kartı: her satırda ad, node / edge sayısı (üzerine gelince oluşturma ve son değişiklik zamanı), **✎** (satırda yeniden adlandır: Enter kaydeder, Esc vazgeçer) ve **✕** (onaylı sil). Satıra tıklamak o graph'a geçer. Altta **Yeni graph**, **Dışa aktar**, **Yükle…**.

- **Ad.** Yeni graph "Yeni graph" olarak açılır; ilk node oluşunca adı o sayfanın başlığından (yoksa alan adından) gelir. Kullanıcı yeniden adlandırdıysa ad bir daha kendiliğinden değişmez. Aynı ad varsa sonuna "(2)" eklenir. Dışa aktarılan GraphWalker modelinin ve senaryo dosyasındaki `model`'in adı graph'ın adından gelir; node adları gibi yalnızca harf ve rakam ("Swag Labs" → `SwagLabs`), çünkü GraphWalker model adından kod üretir ve runner modeli dosya adıyla bulur.
- **Geçiş.** Karar ("aynı node mu?") beklerken ve panelde oynatma sürerken kapalıdır. Bekleyen aksiyon varsa panel önce sorar: *"... "Bekleyen aksiyonlar"daki N aksiyon silinecek."* Bırakılan graph'ın bekleyen aksiyonları ve sekme bağları silinir, şu anki node'u kalır. Gerekçe: kayıt sekmesiyle bağ kopmalıdır (yoksa bir sitenin sayfası öbür graph'a kaydedilir); bağ kopunca kayda dönüş ([Kayıt hangi sekmede?](#kayıt-hangi-sekmede): "kayıt sekmelerinin hepsi kapanırsa") bekleyen aksiyonları zaten siler, saklamak bir şey kazandırmaz.
- **Geçilen graph'ta** kayıt, "kayıt sekmelerinin hepsi kapandı" durumundaki gibi sürer: graph'ta node varsa aktif sekme için hemen sorulur (*"Kayıt sekmesi yok (kapandı ya da graph değişti). Bu sekme şu anki node'un ekranındaysa kayıt burada sürsün mü?"*); sekme o node'un ekranındaysa "Evet" kaydı orada sürdürür. Diğer yol: bir node seçip **Buradan devam et**. Panelde seçim, senaryo ve oynatma sonucu sıfırlanır (önceki graph'ın edge'leriydi).
- **Sil.** Geri alınamaz; onay penceresi node / edge sayısını ve önce dışa aktarmayı hatırlatır. Aktif graph silinirse en son değişen diğer graph'a, başka yoksa boş bir "Yeni graph"a geçilir: her zaman bir aktif graph vardır. **Sıfırla** yalnızca aktif graph'ı boşaltır, ad ve liste kalır.
- **Dışa aktar / Yükle…** Graph'ın ekran görüntüleriyle tam yedeği; yüklenen dosya yeni bir graph olur ve ona geçilir ([04 > Graph yedeği](04-veri-modeli.md#graph-yedeği)). Yüklenen graph'ta şu anki node boştur: kayıt "Buradan devam et" ile sürer.
- **Eski sürümden.** Önceki sürümün tek `state` anahtarı ilk açılışta bir graph'a taşınır; kullanıcı bir şey yapmaz.

**Sınırlar:**

- Graph'lar arasında node ya da edge taşınmaz, iki graph birleştirilemez. İyileştirme: yedeği mevcut graph'a "ekle" (id'leri yeniden numaralayarak).
- Kayıt aynı anda yalnızca bir graph'a yapılır; iki sitede paralel kayıt için graph'lar arasında geçmek gerekir ve her geçişte bekleyen aksiyonlar silinir.
- Yedek ekran görüntülerini base64 olarak taşır; büyük graph'larda dosya onlarca MB olabilir. İyileştirme: görüntüleri ayrı dosyalar olarak bir zip'te taşımak.

---

## Senaryolar

Senaryo, graph üzerinde test yoludur: başlangıç node'undan başlayan bir ya da birden fazla koşu ([04 > Senaryo dosyası](04-veri-modeli.md#senaryo-dosyası)). Senaryolar **graph'ın içinde** saklanır (`state.scenarios`); graph silinince gider, graph yedeğine girer.

Paneldeki **Senaryo** kartının başında Graph'lar kartıyla aynı desende bir liste vardır: her satırda ad ve kapsama (`2/3 edge · 1 koşu`), yürünemiyorsa ⚠ ve "yürünemiyor"; **✎** satırda yeniden adlandırır, **✕** onayla siler; satıra tıklamak seçer. Altta **Yeni senaryo** ("Senaryo N") ve **Yükle…** (dosya listeye yeni senaryo olarak eklenir). Seçili senaryo yokken düzenleme alanı (strateji, başlangıç, koşular, oynatma) gizlidir.

- **Önce "Yeni senaryo".** Senaryo seçili değilken graph'ta edge'e tıklamak senaryoya bir şey eklemez, edge'in detayını açar: kazara senaryo oluşmaz.
- **Kendiliğinden kayıt.** Seçili senaryo düzenlendikçe (edge eklemek, geri almak, yeni koşu, temizle, başlangıç) kaydedilir; ayrı "Kaydet" yoktur. Panel seçili senaryonun çalışma kopyasını tutar ve her değişikliği background'a yazdırır (state'i yine yalnızca background yazar). Storage'dan gelen değişiklik çalışma kopyasının üstüne yazmaz: hızlı ardışık tıklamalarda önceki bir kaydın bildirimi yeni eklenen edge'i geri almasın. Yalnızca seçili senaryo silindiyse seçim kalkar.
- **Seçim hatırlanır.** Her graph'ta en son seçilen senaryo panelin `localStorage`'ında durur; panel yeniden açılınca ya da graph'a geri dönülünce o senaryo seçili gelir.
- **Yürünemeyen senaryo.** Graph değişip (edge silindi, node birleştirildi) koşular yürünemez olursa senaryo silinmez, listede ⚠ ile işaretlenir; seçilince nedeni yazılır, oynatma ve indirme kapalıdır. Silme geri alınınca işaret kalkar.
- **Ad** graph içinde tekildir (aynı ad varsa "(2)"). İndirilen dosya `<Model>-<Senaryo>.json` (ör. `SwagLabs-GirisAkisi.json`), dosyadaki `name` senaryonun adıdır.

### Senaryo graph'ı ve görünüm sekmeleri

Her senaryonun kendi graph'ı vardır: koşularının geçtiği node'ların ve edge'lerin ana graph'tan **kopyası** (`scenario.graph`; `scenario.js > scenarioSnapshot`). İleride senaryoya özel monitörler (node'da ya da edge'de kontrol edilecek koşullar) buraya bağlanacak: monitör ana graph'a değil senaryoya aittir, aynı ekran iki senaryoda farklı kontrol edilebilir. Kopyadaki her node ve edge'de şimdilik boş `monitors: []` alanı vardır; arayüzde görünmez.

- **Ne zaman alınır?** Senaryo oluşunca ve koşuları her değiştiğinde (edge eklemek, geri almak, yeni koşu, temizle, başlangıç, GraphWalker'ın Üret'i). Yeniden adlandırma kopyayı değiştirmez. Background kaydederken alır (asıl kayıt); panel aynı fonksiyonla anında gösterir, cevap gelince background'unkini kullanır (bu arada koşular yine değiştiyse yerel kopya kalır).
- **Dondurulmuş.** Ana graph sonradan değişse de kopya değişmez. Ekran görüntüleri kopyalanmaz: node id'siyle ana graph'tan okunur (storage iki katına çıkmasın); node ana graph'tan silindiyse "ekran görüntüsü yok".
- **Oynatılan kopyadır.** Panelde **Koşuyu oynat** koşunun edge'lerini ve node'larını kopyadan alır (`panel.js > replayGraph`), ana graph'tan değil: ana graph kopyadan sonra değiştiyse senaryo olduğu gibi oynatılır, fark oynatmadan önceki kartta söylenir (bkz. [Panelde oynatma](#panelde-oynatma)). `startReplay` oynatılan senaryoyu da alır (`scenario: { id, graph }`, `replay.scenario`): senaryoya özel monitörler hangi senaryonun hangi graph'ının oynatıldığını oradan okur.
- **Değişiklik uyarısı.** Panel kopyayı ana graph'la karşılaştırır (`scenario.js > snapshotDrift`): silinen ya da değişen (ad, URL şablonu, edge set, uçlar, aksiyonlar) node ve edge'ler; koşuların kullandığı, ana graph'ta olan ama kopyada olmayan edge'ler ("eklendi", ör. silme geri alındı). Karşılaştırma anahtar sırasından bağımsızdır: Chrome storage nesne anahtarlarını sıralar, mesajla gelen nesne sıralamaz. Fark varsa sekmede "•", senaryo görünümünde uyarı ve **Ana graph'tan yenile** (kopya yeniden alınır, monitörler id'yle korunur).

**Görünüm sekmeleri.** Graph'ın üstünde, graph'ta senaryo varsa: **Ana graph** ve her senaryo için bir sekme. Sekme şeridi Senaryo kartındaki listeyle eştir: senaryo sekmesine geçmek o senaryoyu listede de seçer; senaryo görünümündeyken listede başka bir senaryo seçmek görünümü ona geçirir.

- Senaryo görünümünde yalnızca o senaryonun graph'ı çizilir (çerçeve kesik çizgili); üstte not: node / edge sayısı, kopyanın zamanı, "salt okunur".
- **Salt okunur.** Edge'e tıklamak koşuya bir şey eklemez, detayını açar; detayda ad değiştirilmez, aksiyon silinmez, "Buradan devam et" / "Birleştir" / "Sil" yoktur. Koşular "Ana graph" sekmesinde düzenlenir (Senaryo kartı bunu söyler).
- **Kayıt sürer.** Senaryo görünümündeyken de kayıt ana graph'a yapılır; yeni node ana graph'a eklenir, senaryo görünümü değişmez.
- **Karşılıklı bağlantılar.** Senaryo görünümündeki detayda **Ana graph'ta göster** aynı öğeyi ana graph'ta açar (silinmişse söyler). Ana graph'ta node ya da edge detayında **Kullanan senaryolar**: o öğeyi koşularında kullanan senaryolar; tıklayınca o senaryonun graph'ı, öğe seçili.
- Panelde oynatma sürerken ve graph değişince ana graph görünümüne dönülür.

İndirilen senaryo dosyasında ve graph yedeğinde kopya da vardır (`graph`); runner kullanmaz. Yüklenen senaryo dosyasının kopyası alınmaz: senaryo bu graph'tan yeniden kopyalanır.

**Senaryoların ve senaryo graph'larının sınırları:**

- Panel aynı anda iki pencerede açıksa ikisi de kendi çalışma kopyasını yazar; sonra yazan kazanır. İyileştirme: kayıtta sürüm numarası, eskiyse reddetmek.
- Senaryo silme geri alınmaz (graph'taki geri al yığınına girmez). İyileştirme: senaryo silmelerini de yığına almak.
- Senaryo graph'ı yalnızca koşuların geçtiği kısımdır; kopyalanan node'un ekran görüntüsü ana graph'tan okunur, node ana graph'tan silinince görüntü de gider. İyileştirme: monitör eklenen node'ların görüntüsünü kopyaya almak.
- Ana graph'taki değişiklik kopyaya kendiliğinden yansımaz; koşu düzenlenince kopya tümüyle yeniden alındığı için o ana kadarki farklar da sessizce gelir. İyileştirme: yeniden almadan önce farkı gösterip onay istemek (monitör eklendiğinde önem kazanır).
- Senaryolar graph'a bağlıdır; başka bir graph'a kopyalanamaz. Aynı site için iki graph varsa senaryo dosyası indirilip öbüründe yüklenir (edge id'leri tutmuyorsa reddedilir).


### GraphWalker ile üretim

**Strateji** listesinde "Elle seç"in yanında üç GraphWalker hedefi vardır: tüm edge'ler, tüm node'lar, bir node'a ulaş. Seçilince ulaşılacak node (yalnızca son hedefte), tohum (boşsa rastgele) ve **Üret** çıkar. Üret seçili senaryonun koşularının yerine yazar (koşular doluysa önce sorar); elle düzeltmek için "Elle seç"e dönülür, ilk elle değişiklikte `planner` "elle" olur. Strateji listesi seçili senaryoyu kim ürettiyse onu gösterir; özet satırı hedefi ve tohumu yazar.

```
panel.js ▸ Üret
   │ chrome.runtime.sendNativeMessage('com.graphrecorder.planner',
   │   { type: 'plan', graph: { start, nodes, edges }, goal, target, seed })   ekran görüntüsü yok
   ▼
Chrome ▸ host.cmd ▸ node host.js            (%LOCALAPPDATA%\GraphRecorder, kurulum bir kez)
   │ graphwalker.js ▸ java -jar graphwalker-cli.jar offline ...   (Java sürümü; çağrı başına ~1 sn)
   │               ya da graphwalker.exe offline ...           (Rust sürümü; kurulumda seçilir)
   ▼
{ runs, planner: { engine: "graphwalker", cli, goal, generator, seed, deadEnd? }, unreachable }
   ▼
panel: koşular senaryoya yazılır ve kaydedilir; bildirim kapsamayı ve ulaşılamayanları söyler
```

- Senaryonun başlangıcı yolların başlangıcıdır (başka bir node seçildiyse oradan üretilir).
- Host kurulu değilse panel kurulumu (`runner\install-planner.cmd`) ve aynı senaryoyu panel olmadan üretecek komutu (`node runner/plan.js <Model>.json`) söyler; kimlik uyuşmazsa kurulumun yeniden çalıştırılmasını.
- Üretim kuralları (ulaşılabilen kısım, çıkmaz node'da bölme, tohum): [runner/README.md > Planlayıcı](../runner/README.md#planlayıcı-graphwalker-ile-senaryo).

---

## Panelde oynatma

Senaryo bölümündeki **Koşuyu oynat**, seçili koşuyu kullanıcının kendi tarayıcısında, açık sekmede oynatır; kullanıcı her adımı görür. Runner aynı işi temiz bir tarayıcıda yapar ve rapor yazar ([runner/README.md](../runner/README.md)); panelde oynatma ise graph'ı kuran kişinin hızlı, görsel kontrolüdür: "kaydım tekrar oynatılabiliyor mu?".

```
panel.js ▸ Koşuyu oynat
   │ 0. temizlik penceresi: seçili site verileri silinir (chrome.browsingData), sekme başlangıca gider
   │ 1. başlangıç kontrolü: GET_FINGERPRINT ↔ koşunun ilk node'u (farklıysa uyarı kartı)
   │ 2. REPLAY {active: true} ──▶ background: kayıt durur
   ▼
replay.js ── her edge, her aksiyon ─────────────────────────────────────┐
   │  content.js'e REPLAY {op}: locate / focus / choose / scroll        │
   │  chrome.debugger (CDP): Input.dispatchMouseEvent / KeyEvent,       │
   │                         Input.insertText, Emulation (resize)       │
   │  chrome.tabs: navigate, back/forward, reload, zoom, sekmeler       │
   │  edge sonunda: REPLAY {op: settled} ▸ compareScreen ↔ hedef node   │
   ▼                                                                    │
panel: graph'ta ilerleme (yeşil / kesik / kırmızı), adım listesi ◀──────┘
   │ 3. REPLAY {active: false, endNodeId, tabId} ──▶ background
   ▼    geçtiyse kayıt vardığı node'dan sürer; kaldıysa şu anki node bilinmez
```

- **Oynatmadan önce temizlik.** "Koşuyu oynat" önce bir pencere açar. Pencerede senaryonun graph'ındaki her site (node adreslerinin origin'i, başlangıç sitesi önce) ve altında silinebilecek veriler listelenir: çerezler, HTTP önbelleği, Cache Storage, localStorage ve sessionStorage (Chrome ikisini birlikte siler), IndexedDB, service worker'lar, dosya sistemi. Site kutusu altındaki türlerin hepsini işaretler. Seçim senaryoya kaydedilir (`scenario.cleanup`); ilk açılışta hiçbir şey seçili değildir. **Temizle ve oynat** seçili verileri yalnızca o siteler için siler (`chrome.browsingData.remove` + `origins`) ve sekmeyi başlangıç node'unun adresine götürür; silinen veri ancak sayfa yeniden yüklenince etkisini gösterir. Bu gezinme, "Başlangıç node'una dön"deki gibi kayıt sekmesindeyse `navigate` aksiyonu olarak kaydedilir. **Temizlemeden oynat** doğrudan başlangıç kontrolüne geçer. Runner'da gerekmez: her koşuyu temiz bir tarayıcıda başlatır. Ne silinir, ne zaman silinmeli: [08 > Site verileri](08-site-verileri.md).
- **Başlangıç kullanıcının sorumluluğudur.** Oynatma sayfaya kendisi gitmez. Önce ekran, koşunun ilk node'uyla (senaryonun başlangıcı; varsayılan graph'ın başlangıcı) aynı kuralla karşılaştırılır: URL şablonu ve edge set'i. Farklıysa panel uyarır: *"Başlangıç node'ları aynı değil ... Koşu doğru sonuç vermeyecektir."* Fark listesiyle birlikte gösterilir; kullanıcı "Yine de oynat" diyebilir. "Bekleyen aksiyonlar" silinecekse de aynı kartta söylenir. Koşu senaryonun graph'ından (kopya) oynatılır; ana graph kopyadan sonra değiştiyse kart farkı söyler ve **Ana graph'tan yenile** çıkar (kopya yeniden alınır, kontrol tekrarlanır); "Yine de oynat" kopyayı oynatır. Sekmedeki sayfa okunamıyorsa (tarayıcının kendi sayfası, eklentiden önce açılmış sayfa) ve adres farklıysa da kart açılır; o zaman "Yine de oynat" yoktur (oynatma ilk adımda kalırdı). Görünen alan farklıysa edge set'i burada karşılaştırılmaz (state ekrana sığan elementlerden oluşur, yanlış boyutta tutmayabilir); yalnızca adrese bakılır, karşılaştırmayı oynatma boyutu kurduktan sonra yapar (aşağıda).
- **Başlangıç node'una dön.** Sekme başlangıç node'unun adresinde (URL şablonu) değilse kartta bu buton çıkar. Sekme node'un kayıttaki adresine (`node.url`) gider; yeni sayfa durulunca ekranı alınır (`replay.js > goToAddress`). Site başka bir adrese yönlendirdiyse (giriş gerektiren sayfa: saucedemo'da çıkış yapılmışken `inventory.html` giriş sayfasına döner) panel bunu söyler, uyarı kalır: *"Site başka bir adrese yönlendirdi: ... Başlangıç ekranına elle ulaşın (örneğin önce giriş yapın)."* Graph'ın başından o node'a giden yolu oynatmak (giriş dahil) yapılmaz. Sonra kontrol yeniden yapılır, kart güncellenir. Ekran tutuyorsa kartta en fazla "bekleyen aksiyonlar silinecek" kalır.

  Gezinme kayıt sekmesindeyse adres çubuğuna yazmak gibi `navigate` aksiyonu olarak kaydedilir (`RECORD_NAVIGATE`): Chrome eklentinin açtığı gezinmeyi bağlantı sayar, background onu kendisi göremez; ama tarayıcı gerçekten gitti, kullanıcı "Vazgeç" deyip kayda sürerse edge'e girmelidir (pencere boyutu ve yakınlaştırma da zaten böyle kaydedilir).
- **Başlangıç boyutu** (`replay.js > fitStart`). Oynatma, sekmeye bağlandıktan hemen sonra görünen alanı başlangıç node'unun kaydedildiği boyuta getirir. Pencere değil, `resize` aksiyonu gibi taklit (`Emulation.setDeviceMetricsOverride`, DevTools'un cihaz modu) kullanılır: pencereyi büyütmek yan panel, kenarlıklar ve ekran ölçeği yüzünden birkaç piksel kaçırabiliyordu, eklenti de panelin genişliğini değiştiremez (Chrome'un API'si izin vermez); taklit panelden ve pencereden bağımsız, piksel piksel tutar. Önce piksel oranı için sekmenin yakınlaştırması ayarlanır (piksel oranı = ekran ölçeği × yakınlaştırma; Chrome bunu site başına saklar, oynatmadan sonra da kalır). Taklidin boyutu ekran pikseli, görünen alan CSS pikselidir: boyut yakınlaştırmayla çarpılıp kurulur, ölçülür, kalan fark düzeltilir. Sonra ekran başlangıç node'uyla karşılaştırılır; tutmazsa ilk adıma uyarı yazılır, oynatma sürer ("Yine de oynat" gibi; ilk edge'in doğrulaması asıl sonucu verir). Taklit oynatma bitince kaldırılır, sekme kendi boyutuna döner: kayıt oradan sürerse fark sonraki ekranda `resize` aksiyonu olarak kaydedilir.
- **Gerçek olaylar.** Fare, klavye ve metin girişi DevTools protokolüyle (`chrome.debugger`) gönderilir: sayfa bunları gerçek kullanıcı olayı (`isTrusted`) olarak görür; CSS `:hover`, sayfanın tuş dinleyicileri, `target=_blank` link çalışır. Sayfanın içinden üretilen olaylar (`dispatchEvent`) bunları yapamazdı. Bedeli: `debugger` izni ve Chrome'un oynatma boyunca gösterdiği "hata ayıklama başlatıldı" çubuğu. Çubukta "İptal"e basılırsa oynatma durur.
- **Aksiyonlar runner'la aynı tablodur** ([runner/README.md > Aksiyonların karşılığı](../runner/README.md#aksiyonların-karşılığı)): element önce kayıttaki hedefle ("türün n'incisi"), yoksa selector'la bulunur; tıklamadan önce fare elementin üzerine gelir, element kaydıysa ya da üstü bir katmanla kapalıysa yeniden bulunur (Playwright'ın tıklamadan önce elementin durmasını beklemesi gibi). Her aksiyondan sonra sayfanın durulması beklenir (`fingerprint.js > settled`); her edge'in sonunda varılan ekran hedef node'la karşılaştırılır, eşleşene kadar 10 sn tekrar denenir. `select` ve `clipboard` henüz oynatılmaz.
- **Şifreler.** Kayıtta `******` olan alanlar için panel şifre kutusu gösterir; değer yalnızca panel açıkken bellekte durur, saklanmaz.
- **Kayıt durur.** Oynatılan olaylar gerçek olay gibi geldiği için oynatma sürerken background kayda giden her yolu (aksiyon, ekran, gezinme, yakınlaştırma, sekme olayları) yok sayar. Bayrak `chrome.storage.session`'dadır: service worker uyuyup uyansa da kalır. Panel oynatma sürerken kapanırsa bir sonraki açılışta bayrak temizlenir.
- **Bitince.** Koşu geçtiyse kayıt vardığı node'dan, oynatmanın bittiği sekmede sürer ("Buradan devam et" gibi). Kaldıysa ya da durdurulduysa tarayıcının hangi ekranda olduğu bilinmez: şu anki node boşalır, kullanıcı bir node seçip "Buradan devam et"e basar. Kalınan adımda fark listesi görünür; **Beklenen ekranla karşılaştır** kalınan ekranın görüntüsünü, beklenen node'un kayıttaki görüntüsüyle onay kartındaki görünümlerle (Fark, Perde, Yan yana) karşılaştırır.
- **Yavaş** seçiliyken her element aksiyondan önce kısa süre çerçevelenir ve aksiyonlar arasında beklenir: kullanıcı takip edebilsin.

**Başlangıca dönmenin sınırları:**

- Yönlendirme yalnızca adresten anlaşılır. Site giriş ekranını aynı adreste gösteriyorsa ya da yönlendirmeyi sayfa durulduktan sonra yapıyorsa özel mesaj çıkmaz; kart yine fark listesiyle kalır. İyileştirme: varılan ekranı graph'taki diğer node'larla da karşılaştırıp "giriş sayfasındasınız (`v_Login`)" demek.
- Node'un kayıttaki adresine gidilir. Adreste oturuma özel bir değer (tek kullanımlık bağlantı, oturum kimliği) varsa o adres artık çalışmayabilir. İyileştirme: graph'ın başından o node'a en kısa yolu oynatmak (hazırlık yolu).
- Kayıt sekmesinde dönülüp "Vazgeç" denirse gezinme ve boyut değişimleri bekleyen aksiyonlarda kalır; kullanıcı istemiyorsa siler.

---

## Service worker'ın ölümlülüğü

Manifest V3'te background bir **service worker**'dır. Chrome, boşta kalan worker'ı yaklaşık 30 saniye sonra kapatır. Yeni bir olay (mesaj, gezinme) geldiğinde tekrar başlatır. Worker kapanınca bellekteki her değişken silinir.

Bu yüzden `background.js`:

1. State'in asıl yerini **`chrome.storage.local`** olarak kabul eder. Her değişiklikten sonra `save()` çağırır.
2. Worker her uyandığında state'i storage'dan **bir kez** okur:

   ```js
   let statePromise = null;
   function getState() {
     statePromise ??= chrome.storage.local.get('state').then((r) => r.state ?? emptyState());
     return statePromise;
   }
   ```

   Ayarlar da aynı desenle okunur (`getSettings()`), ama ayrı bir anahtarda (`settings`) durur; bu yüzden "Sıfırla" ayarları silmez.

   Aynı anda gelen iki mesaj aynı `statePromise`'i paylaşır, yani **aynı nesne** üzerinde çalışır. Her mesaj storage'dan kendi kopyasını okusaydı, hızlı art arda gelen iki aksiyondan biri diğerinin kaydını ezebilirdi (ör. bir input'tan çıkıp hemen butona tıklamak, `change` ve `click` olaylarını milisaniyeler içinde üretir).
