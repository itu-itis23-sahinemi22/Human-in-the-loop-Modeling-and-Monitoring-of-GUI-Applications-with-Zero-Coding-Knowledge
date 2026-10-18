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
- [Node birleştirme](#node-birleştirme)
- [Geri al](#geri-al)
- [Kayıt hangi sekmede?](#kayıt-hangi-sekmede)
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

### `background.js`: Beyin

Eklentinin tek "durum sahibi" (single source of truth).

- Content script'ten gelen aksiyonları `buffer` dizisinde biriktirir.
- Tarayıcı seviyesindeki gezinmeleri (adres çubuğu, geri/ileri, yenile) `chrome.webNavigation` ile kendisi yakalar.
- "Node oluştur" isteğinde parmak izi ve ekran görüntüsü alır, element kümesi birebir aynı olan node'u arar, node ve edge ekler.
- Her değişiklikten sonra state'in tamamını `chrome.storage.local`'a yazar.
- Panelin Ayarlar penceresindeki seçimleri `settings` anahtarında saklar ve uygular: işaretsiz aksiyon tiplerini buffer'a almaz, işaretsiz element türlerini state karşılaştırmasına katmaz. "Beklemeleri kaydet" açıksa aksiyonlar arasındaki boşlukları ve ekranın kendiliğinden değişmesini bekleme olarak kaydeder (bkz. [Beklemeler](#beklemeler)).

### `sidepanel/`: Arayüz

- `panel.html`: iskelet. Butonlar, onay kartı, graph alanı, detay kartı ve bekleyen aksiyonlar listesi. Sağ üstteki çark, panelin üstünde açılan **Ayarlar** penceresini (`<dialog>`) açar; kaydedilmemiş değişiklik uyarısı da ayrı bir `<dialog>`'dur.
- `panel.js`: State'i ve ayarları storage'dan okur ve ekrana çizer. Butonlara basılınca background'a mesaj gönderir. Ayarlar penceresindeki kutular (iki liste ve "Beklemeler" bölümü: anahtar ve alt sınır) bir **taslaktır**: yalnızca **Kaydet** taslağı background'a gönderir. Kaydet, taslak kaydedilmiş ayarlardan farklıyken aktiftir. Taslak farklıyken pencere kapatılmak istenirse (✕, Esc, pencere dışına tıklama) uyarı açılır: "Kaydet ve çık", "Kaydetmeden çık" ya da "Geri dön".
- `panel.css`: görünüm.

### `fingerprint.js`: State'in tanımı

Bir ekranın state'ini tanımlayan kod: etkileşimli elementler (`interactableElements()`, `isInteractable()`), türleri (`elementKey()`), sayılı küme (`countElements()`, `fingerprint()`), aksiyon hedefi (`targetOf()` ve tersi `targetElement()`), görünen alan (`currentViewport()`) ve sayfanın durulma süreleri. Olay dinlemez, mesaj göndermez; yalnızca tanımlar.

Ayrı dosyadadır, çünkü kayıt ile test **aynı tanımı** kullanmalıdır. İki yerde yüklenir: eklentide content script olarak (`settings.js`'ten sonra, `content.js`'ten önce; aynı sayfadaki content script'ler ortak kapsamda çalıştığı için `content.js` bu fonksiyonları doğrudan kullanır) ve runner'da test edilen her sayfaya ([runner/README.md](../runner/README.md)). Böylece runner'ın "varılan ekran beklenen node mu?" kararı, kayıttaki "bu sayfa zaten bir node mu?" kararıyla aynı koddan gelir.

### `settings.js`: Ortak tanımlar

Ayarlar penceresindeki iki listenin (aksiyon tipleri `ACTION_TYPES`, etkileşimli element türleri `INTERACTABLE_TYPES`) ve varsayılan ayarın (`DEFAULT_SETTINGS`) **tek tanımı**. Ayarlara bağlı state karşılaştırması (`urlKey()`, `stateCounts()`, `sameCounts()`, `diffCounts()`) da buradadır; background node eşleştirmede, panel edge düzenlemede ve birleştirmede, runner doğrulamada kullanır. Build adımı olmadığı için her parça bu dosyayı ayrıca yükler: content script olarak `fingerprint.js` ve `content.js`'ten önce (`manifest.json`), service worker'da `importScripts('settings.js')`, panelde `<script>` ile, runner'da hem sayfaya hem Node tarafına. Listeye yeni bir tip eklemek; yakalamayı, panel checklist'ini ve filtreyi birlikte günceller.

### `manifest.json`: Kimlik kartı

Chrome'a "bu eklenti nedir, hangi dosya hangi ortamda çalışır, hangi izinlere ihtiyaç duyar" bilgisini verir. İzinlerin tek tek gerekçesi: [02-teknolojiler.md](02-teknolojiler.md#hangi-izin-neden-gerekli)

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
| `ACTION` | content → background | `{ action, screen, viewport, typingSince?, replaces? }` | Aksiyonu buffer'a ekler; gerekiyorsa önüne bir bekleme koyar ([Beklemeler](#beklemeler)). `typingSince`: aksiyondan önce yazmaya başlanan an; önceki bekleme o anda biter. Cevap `{ monitor }`: bu sekme ekranı aksiyonsuz da izlesin mi. Kayıt başlamadıysa, başka sekmeden geldiyse ya da tipi Ayarlar'da işaretsizse yok sayar. `screen`, aksiyonun yapıldığı andaki ekranın edge set'idir; önceki aksiyonun sonrası henüz bildirilmediyse onun sonrası olarak kullanılır. `viewport`, gönderildiği andaki sayfa boyutudur; açık bir yakınlaştırma aksiyonu bununla kapanırsa varılan boyut olarak saklanır. `replaces`: buffer'ın son aksiyonunun zamanı buysa o aksiyon düşer (çift/üçlü tıklamayla seçimde hareketin önceki tıklaması). |
| `SCREEN` | content → background | `{ screen, viewport }` | Sayfa durulunca ekranın edge set'i ve sayfanın boyutu. Sonrası bekleyen aksiyon varsa "state'i değiştirdi mi?" diye işaretler; yoksa ve ekran değiştiyse, beklemeler kaydediliyorsa ekranı değiştiren bir bekleme ekler. Ekran yeni "hemen önceki state" olur. Kayıt sekmesi dışından geleni yok sayar. Cevap `{ monitor }` (ACTION'daki gibi). |
| `MONITOR` | background → content | `{ on }` | Kayıt sekmesine ekranı aksiyonsuz da izleyip izlemeyeceğini bildirir: ayar değişince, kayıt bir sekmeye bağlanınca. Yeni yüklenen sayfa bunu ilk ACTION / SCREEN cevabından öğrenir. |
| `GET_FINGERPRINT` | background → content | (boş) | Cevap olarak `{ url, title, elements, viewport }` döner. `elements`, ekrandaki elementlerin sayılı kümesidir: `[{ key, types, count }]`. `viewport`, kümenin alındığı görünen alandır: `{ width, height, devicePixelRatio }`. |
| `CREATE_NODE` | panel → background | `{ tabId, windowId }` | "Node oluştur" akışını başlatır (aşağıda). |
| `RESOLVE` | panel → background | `{ targetId }` | Onay kartındaki cevap: seçilen aday node'un id'si ("Evet, bu node") ya da `null` ("yeni node"). Aday olmayan id yok sayılır. |
| `REMOVE_ACTION` | panel → background | `{ edgeId, index }` | Edge'den bir aksiyonu siler. Tek aksiyon kaldıysa reddeder. İlk silmede orijinal liste `recordedActions`'a kopyalanır; silinen aksiyon geri al yığınına (`state.undo`) girer. |
| `UNDO` | panel → background | (boş) | Son silmeyi ya da birleştirmeyi geri alır; ne geri getirildiğini `{ notice }` ile bildirir. Bkz. [Geri al](#geri-al) |
| `MERGE_NODES` | panel → background | `{ keepId, removeId }` | `removeId` node'unu `keepId`'ye birleştirir. URL şablonu ya da edge set'i farklıysa ya da bekleyen bir soru varsa reddeder. Bkz. [Node birleştirme](#node-birleştirme) |
| `CANCEL_PENDING` | panel → background | (boş) | Şu anki node seçilip "Node oluşturma, aksiyonlara devam et" denince: bekleyen karar atılır, kesilen aksiyonlar buffer'a geri döner (karar beklerken yapılanların önüne). |
| `RENAME` | panel → background | `{ id, name }` | Node veya edge ismini değiştirir. |
| `DELETE` | panel → background | `{ id }` | Node'u (ve bağlı edge'leri) ya da edge'i siler. |
| `SET_CURRENT` | panel → background | `{ id, tabId }` | "Buradan devam et": şu anki node'u değiştirir, buffer'ı temizler. Kayıt sekmesi kapandıysa kaydı `tabId` sekmesine bağlar. |
| `RESET` | panel → background | (boş) | Graph'ı sıfırlar. Ayarlara dokunmaz. |
| `SET_SETTINGS` | panel → background | `{ settings }` | Ayarlar'daki seçimi kaydeder (`settings` anahtarı). |

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

**Birden fazla eşleşme:** Element kümesi birden fazla node ile birebir aynı olabilir (daha önce aynı küme için "yeni node" denmiş ya da Ayarlar'da bir türün işareti kaldırılmışsa). Onay kartı eşleşen **tüm** node'ları ekran görüntüleriyle seçenek olarak gösterir. Sıra: şu anki node önce, sonra oluşturulma sırası. Kullanıcı doğru olanı seçer ya da **"Hiçbiri, yeni node"** der. Karar beklerken bir aday silinirse listeden düşer.

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

---

## Beklemeler

Bazı durumlara hiçbir tıklamayla ulaşılmaz, yalnızca beklenerek ulaşılır. Örnek: internet bankacılığında oturum zaman aşımı kullanıcıyı çıkış ekranına atar. Graph'ı kuran kişi bu durumu modele eklemek isteyebilir. Ayarlar'daki **Beklemeleri kaydet** açıkken bekleme bir aksiyon (`wait`) olarak kaydedilir. Varsayılan kapalıdır; kapalıyken kayıt eskisi gibidir.

**Bekleme kaydedilir, elle eklenmez.** Gözlenmiş bir aksiyondur; edge düzenlemedeki "aksiyon eklenemez" kuralı geçerli kalır. Bekleme sayfaya dokunmaz ama ekranı değiştirebilir; bunu görmek için kayıt sekmesinin ekranı aksiyonsuz da izlenir.

**Nasıl kaydedilir** (`background.js > BEKLEMELER`):

- Background, ekranın son aksiyondan (ya da node'dan) sonra durulduğu anı tutar (`state.idleSince`).
- **Ekran beklerken kendiliğinden değişirse** bekleme o anda kapanır ve *ekranı değiştirdi* işaretini alır. Süresi değişime kadar geçen süredir (ör. tam zaman aşımı süresi). Böyle bir bekleme ne kadar kısa olursa olsun kaydedilir. Sonraki boşluk yeni bir beklemedir.
- **Ekran değişmediyse** iki aksiyon arasındaki boşluk, Ayarlar'daki **alt sınırdan** (varsayılan 1 sn) uzunsa *ekranı değiştirmedi* işaretli bir bekleme olarak ikinci aksiyondan önce eklenir. Daha kısa boşluklar kaydedilmez; yoksa her edge, düşünme süresinden doğan beklemelerle dolardı. Ekranı değiştirmeyen bekleme edge düzenlemede uyarısız silinir.
- **Node'dan sonraki ilk aksiyona** ve **son aksiyondan "Node oluştur"a** kadar geçen süre aksiyonlar arasında değildir; ekran değişmediyse kaydedilmez.
- **Yazma:** yazma aksiyonu alan odaktan çıkınca gönderilir. Yazmadan önceki bekleme yazmaya başlanan anda biter (`typingSince`). Yazarken ekranda olanlar (ör. beliren "Temizle" butonu) kendiliğinden değişim sayılmaz.
- Bekleyen tek aksiyon bir bekleme olabilir (zaman aşımı senaryosu): "Node oluştur" buna izin verir, edge'in adı `e_Wait` olur. Beklemeler kaydediliyorsa "Node oluştur" butonu bekleyen aksiyon yokken de açıktır; background önce ekrana bakar, değişim yoksa node oluşturmaz.

**İzleme** (`content.js > setMonitoring`): yalnızca anahtar açıkken ve kayıt sekmesinde çalışır. DOM değişince sayfanın durulması beklenir (300 ms DOM değişmez, en fazla 3 sn) ve ekran (edge set) değiştiyse `SCREEN` gönderilir; değişmediyse gönderilmez. Sürekli değişen bir sayfada parmak izi en fazla 3 sn'de bir alınır. Hangi sekmenin izleyeceğini background söyler (`MONITOR` ya da `ACTION` / `SCREEN` cevabı).

**Sınır:** aksiyonsuz her değişim bekleme sayılır. Kaydedilmeyen hareketlerin etkisi de buna dahildir: fareyi üzerine getirince (hover) açılan bir menü, bekleme olarak görünür.

**Tekrar oynatma:** runner bekleme süresi kadar bekler. Ekranı değiştiren bekleme biraz geç sonuçlansa da doğrulamadaki tekrar deneme onu yakalar.

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

- Kayıt, **ilk "Node oluştur"un yapıldığı sekmeye** bağlanır (`state.tabId`). Diğer sekmelerdeki aksiyonlar yok sayılır. Kullanıcı arada başka bir sekmede bir şey araştırırsa graph kirlenmez.
- Başka bir sekmede "Node oluştur"a basılırsa hata verilir: *"Kayıt başka bir sekmede sürüyor."*
- Kayıt sekmesi **kapatılırsa** `tabId` boşaltılır ve aksiyon kaydı durur. Bekleyen aksiyon olmadan node oluşturulamadığı için devam etmenin yolu şudur: yeni sekmede bilinen bir duruma gidin, graph'ta o node'u seçin ve **Buradan devam et**'e basın. Kayıt o sekmede sürer. Panelin durum satırı bu durumu hatırlatır.

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
