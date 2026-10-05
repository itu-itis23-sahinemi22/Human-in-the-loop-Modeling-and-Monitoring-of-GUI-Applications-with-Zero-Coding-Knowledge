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

- **Aksiyon yakalama:** `click`, `change` ve `keydown(Enter)` olaylarını dinler. Her aksiyonu bir nesneye çevirip (`{type, selector, label, value, url, time}`) background'a gönderir.
- **Parmak izi:** Background `GET_FINGERPRINT` isteği gönderdiğinde sayfadaki görünür etkileşimli elementlerin listesini döndürür. Detay: [03-state-eslestirme.md](03-state-eslestirme.md)
- **Selector üretimi:** Her aksiyon için elementi tekil olarak bulan bir CSS selector üretir. Kayıtların ileride tekrar oynatılabilmesi buna bağlıdır.

### `background.js`: Beyin

Eklentinin tek "durum sahibi" (single source of truth).

- Content script'ten gelen aksiyonları `buffer` dizisinde biriktirir.
- Tarayıcı seviyesindeki gezinmeleri (adres çubuğu, geri/ileri, yenile) `chrome.webNavigation` ile kendisi yakalar.
- "Node oluştur" isteğinde parmak izi ve ekran görüntüsü alır, benzer node arar, node ve edge ekler.
- Her değişiklikten sonra state'in tamamını `chrome.storage.local`'a yazar.

### `sidepanel/`: Arayüz

- `panel.html`: iskelet. Butonlar, onay kartı, graph alanı, detay kartı ve bekleyen aksiyonlar listesinden oluşur.
- `panel.js`: State'i storage'dan okur ve ekrana çizer. Butonlara basılınca background'a mesaj gönderir.
- `panel.css`: görünüm.

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
| `ACTION` | content → background | `{ action }` | Aksiyonu buffer'a ekler. Kayıt başlamadıysa ya da başka sekmeden geldiyse yok sayar. |
| `GET_FINGERPRINT` | background → content | (boş) | Cevap olarak `{ url, title, elements[] }` döner. |
| `CREATE_NODE` | panel → background | `{ tabId, windowId }` | "Node oluştur" akışını başlatır (aşağıda). |
| `RESOLVE` | panel → background | `{ useExisting: bool }` | Onay kartındaki "Evet / Hayır" cevabı |
| `RENAME` | panel → background | `{ id, name }` | Node veya edge ismini değiştirir. |
| `DELETE` | panel → background | `{ id }` | Node'u (ve bağlı edge'leri) ya da edge'i siler. |
| `SET_CURRENT` | panel → background | `{ id }` | "Buradan devam et": şu anki node'u değiştirir, buffer'ı temizler. |
| `RESET` | panel → background | (boş) | Her şeyi sıfırlar. |

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
    │                  │──────────────────────▶│ GET_FINGERPRINT            │
    │                  │                       │───────────────────────────▶│
    │                  │                       │ {url,title,elements}       │
    │                  │                       │◀───────────────────────────│
    │                  │                       │ findSimilarNode()          │
    │                  │                       │                            │
    │                  │                       │ buffer boş VE benzer = şu anki node?
    │                  │◀── { notice } ────────│   └─ evet ─▶ DUR (mavi bilgi mesajı)
    │                  │                       │                            │
    │                  │                       │ captureVisibleTab()        │
    │                  │                       │ actions = buffer           │
    │                  │                       │ buffer  = []               │
    │                  │                       │                            │
    │                  │                       │   ├─ benzer YOK ─▶ commit(yeni node)
    │                  │                       │   └─ benzer VAR ─▶ state.pending = {...}
    │                  │                       │ save() ──▶ storage         │
    │                  │◀── storage.onChanged ─│                            │
    │                  │ render()              │                            │
    │                  │                       │                            │
    │   (benzer varsa onay kartı görünür)      │                            │
    │  Evet / Hayır    │                       │                            │
    │─────────────────▶│ RESOLVE{useExisting}  │                            │
    │                  │──────────────────────▶│ commit(mevcut / yeni node) │
    │                  │                       │ save() ──▶ storage         │
    │                  │◀── storage.onChanged ─│                            │
    │                  │ render()              │                            │
```

Dikkat edilecek üç nokta:

1. **Erken çıkış:** Son node'dan beri hiç aksiyon kaydedilmediyse ve sayfa hâlâ şu anki node'a benziyorsa, çizilecek bir edge yoktur. Kullanıcıya "aynı mı?" diye sorulmaz (cevap "evet" olsa da hiçbir şey değişmeyecekti). Panel *"Son node'dan beri aksiyon kaydedilmedi. Hâlâ v_X node'undasınız."* der. Ekran görüntüsü de alınmaz.
2. **Buffer'ın kesildiği an:** `actions = buffer; buffer = []` satırı onay beklenmeden **hemen** çalışır. Kullanıcı karar verirken sayfada başka bir şey yaparsa, o aksiyonlar bir *sonraki* edge'e aittir. Bekleyen karar ise kendi aksiyonlarını `state.pending.actions` içinde saklar.
3. **Bekleyen karar varken** "Node oluştur" butonu kilitlenir. Önce soru cevaplanmalıdır.

---

## Edge oluşturma kuralları

**Temel kural:** Şu anki node (`from`) varsa, hedef ister yeni ister mevcut node olsun, `from → hedef` edge'i **her zaman** çizilir. Kullanıcı onay kartında **"Evet, aynı node"** derse edge, şu anki node'dan aynı olduğu düşünülen node'a çizilir. İkisi aynı node ise edge bir **self-loop** olur.

Durumların tamamı (`from` = şu anki node):

| Durum | Sonuç |
|---|---|
| İlk node (`from` yok) | Sadece node oluşur, edge yok. Bu node `startNodeId` olur. |
| Benzer node yok | Yeni node + `from → yeni` edge |
| Benzer node var, kullanıcı **"Hayır, yeni node"** dedi | Yeni node + `from → yeni` edge |
| Benzer node var, kullanıcı **"Evet, aynı node"** dedi | Yeni node oluşmaz. `from → mevcut` edge çizilir. `from == mevcut` ise **self-loop** olur. |
| Aksiyon yok, sayfa başka bir node'a benziyor | Soru sorulur. Cevap ne olursa olsun edge çizilir; adı `e_Transition` olur, aksiyon listesi boştur. Sayfa kaydedilemeyen bir şekilde değişmiş demektir, ör. bir iframe içinden ya da sayfanın kendi kodu yönlendirdi. |
| Aksiyon yok, sayfa hâlâ `from`'a benziyor | **Soru sorulmaz, hiçbir şey değişmez.** Panel mavi bir bilgi mesajı gösterir (bkz. yukarıdaki "Erken çıkış"). |
| `from` silinmiş | Node oluşur ama edge oluşmaz. Kullanıcı "Buradan devam et" ile bir başlangıç seçmelidir. |

**İsimlendirme:**

- Node: `v_` + URL'nin son anlamlı parçası (`/inventory.html` → `v_Inventory`). Yoksa sayfa başlığı kullanılır (`Swag Labs` → `v_SwagLabs`). Aynı isim varsa sonuna `_2`, `_3` eklenir.
- Edge: `e_` + son aksiyonun etiketi (`Login` butonu → `e_Login`, `Add to cart` → `e_AddToCart`).
- Türkçe karakterler sadeleştirilir (`Giriş yap` → `GirisYap`), çünkü bu isimler ileride Java/JS metot adı olacak.

---

## Aksiyonlar nasıl yakalanıyor?

### Sayfa içi olaylar (`content.js`)

| Olay | Kaydedilen aksiyon | Not |
|---|---|---|
| `click` | `click` | Form alanlarına tıklamalar yok sayılır (bkz. aşağıda). Hedef, `closest()` ile en yakın etkileşimli elemente yükseltilir: butonun içindeki `<span>`'e tıklanınca butonun kendisi kaydedilir. |
| `change` | `input` | text, select, checkbox, radio... Değer kaydedilir. Şifreler maskelenir. |
| `keydown` + Enter (input içinde) | önce `input`, sonra `enter` | Enter, `change`'den *önce* tetiklenir. Sıra doğru olsun diye değer burada kaydedilir. |

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

---

## Kayıt hangi sekmede?

- Kayıt, **ilk "Node oluştur"un yapıldığı sekmeye** bağlanır (`state.tabId`). Diğer sekmelerdeki aksiyonlar yok sayılır. Kullanıcı arada başka bir sekmede bir şey araştırırsa graph kirlenmez.
- Başka bir sekmede "Node oluştur"a basılırsa hata verilir: *"Kayıt başka bir sekmede sürüyor."*
- Kayıt sekmesi **kapatılırsa** `tabId` boşaltılır. Kullanıcı yeni bir sekmede "Node oluştur"a basarak kaldığı yerden devam edebilir.

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

   Aynı anda gelen iki mesaj aynı `statePromise`'i paylaşır, yani **aynı nesne** üzerinde çalışır. Her mesaj storage'dan kendi kopyasını okusaydı, hızlı art arda gelen iki aksiyondan biri diğerinin kaydını ezebilirdi (ör. bir input'tan çıkıp hemen butona tıklamak, `change` ve `click` olaylarını milisaniyeler içinde üretir).
