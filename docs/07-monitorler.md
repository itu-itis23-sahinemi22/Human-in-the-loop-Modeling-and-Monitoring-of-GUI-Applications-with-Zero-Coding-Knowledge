# 07: Monitörler (Run-time Monitoring)

Projenin ikinci yarısı, çıkarılan graph üzerinde koşan testin **her adımdan sonra** bir dizi kuralı kontrol etmesidir (run-time monitoring; kurallar birer *test oracle*'ıdır). Kullanıcı kod yazmadan, yan panelden kural tanımlar; test koşarken her monitör yeşil (kural bozulmadı) ya da kırmızı (bozuldu: adım numarası ve ekran görüntüsüyle) yanar. Bu doküman üç parçayı anlatır:

1. **Monitör menüsü:** monitörlerin tanımlanması (Monitörler bölümü, graph'ta sağ tık menüsü), saklanması ve GraphWalker JSON'una yazılması.
2. **Monitör türleri:** bugün üç tür var (Input Validation, Error Text, Font Size); yeni tür eklemek tek dosyada bir kayıttır.
3. **Oynatmada kontrol:** "Koşuyu oynat" denince monitörlerin alt alta listelenip yeşil / kırmızı yanması, bozulma anının ekran görüntüsü; oynatmasız "Bu ekranda şimdi kontrol et".

## İçindekiler

- [Kavramlar](#kavramlar)
- [Kullanım](#kullanım)
- [Monitör türleri](#monitör-türleri)
- [Oynatmada kontrol](#oynatmada-kontrol)
- [Veri modeli](#veri-modeli)
- [Eklentiyle bütünleşme](#eklentiyle-bütünleşme)
- [Yeni bir monitör türü eklemek](#yeni-bir-monitör-türü-eklemek)
- [Test](#test)
- [Sonraki adımlar](#sonraki-adımlar)

---

## Kavramlar

| Kavram | Anlamı |
|---|---|
| **Monitör** | Test her adım attıktan (her edge oynatıldıktan) sonra kontrol edilen bir kural. Örnek: "ekranda 4 pt'den küçük yazı yok", "telefon alanının değeri `^0?5` desenine uyuyor". |
| **Kapsam** | *Tüm model:* kural her node'da kontrol edilir. *Node:* kural yalnızca o node'a varıldığında kontrol edilir. *Edge:* kural yalnızca o edge oynatıldığında kontrol edilir (yazılan değer gibi aksiyon tabanlı kurallar). Bir edge birden fazla aksiyondan oluşur (kullanıcı adı yaz, şifre yaz, Login'e tıkla); monitör **edge'in seçilen aksiyonuna** bağlanabilir: o aksiyondan hemen sonra, bir sonraki aksiyon oynatılmadan kontrol edilir (kullanıcı adı deseni 1. aksiyona, şifre deseni 2. aksiyona; tıklamanın input validation'ı olmaz). Aksiyon seçilmezse edge'in tamamı: her aksiyondan sonra. Örnek: "4 pt'den küçük yazı yok" tüm model; "Telefon" ekranındaki regex yalnızca o node (ya da yalnızca telefonu yazan aksiyon). |
| **Kontrol biçimi** | *State tabanlı* (node'a varılınca ekrana bakılır) ya da *aksiyon tabanlı* (aksiyondan sonra). Tür kartında etiket olarak görünür. |
| **Tür ve parametreler** | Her monitörün bir türü (ör. `inputValidation`) ve türe göre parametreleri (alan, desen, eşik…) vardır. Türler `monitor-types.js`'te tanımlıdır; form oradan üretilir. |
| **Etkin** | Kapalı monitör tanımlı kalır ama kontrol edilmez (geçici olarak susturmak için). |
| **Sahipsiz** | Öğesi artık olmayan node / edge monitörü (silinmiş, birleştirilmiş ya da graph sıfırlanmış). Dışa aktarılmaz; düzenlenip başka öğeye taşınır ya da silinir. |
| **Işık (LED)** | Her monitörün ışığı ikilidir: **kırmızı** kural bir adımda bozuldu, **yeşil** bozulmadı. Kontrol edilemeyen durumlar (alan ekranda yok, sayfaya ulaşılamadı, adım oynatılmadı) ışığı kırmızı yapmaz; nedeni satırın ayrıntısında yazar. Önem (hata / uyarı) seçimi yoktur. |

---

## Kullanım

### Monitör tanımlamak

Panelde Senaryo bölümünün altında **Monitörler** bölümü vardır (başlıktaki sayı: tanımlı monitör sayısı). Üç yoldan monitör eklenir:

1. **Graph'ta sağ tık:** bir node'a sağ tıklayınca `"v_Telefon" node'una monitör ekle` ve `Monitörlerini göster (n)`; bir edge'e sağ tıklayınca `"e_Login" edge'ine monitör ekle`; boş alana sağ tıklayınca `Tüm modele monitör ekle`. Menü seçilen öğeyle açılır; "göster" seçeneği listeyi o öğeye süzer. Dokunmatikte uzun basma aynı işi görür. Senaryo sekmesinde (salt okunur) yalnızca "göster" vardır.
2. **Monitörler bölümünden:** **Monitör ekle** (bir node ya da edge seçiliyse o öğe önerilir, kapsam değiştirilebilir).
3. **Detay kartından:** graph'ta bir node'a ya da edge'e tıklayınca detay kartının altında **Bu node'un / edge'in monitörleri** alt bölümü ve **Bu node'a / edge'e monitör ekle** butonu çıkar.

Pencere iki adımdır:

- **1. adım, tür:** gruplar altında aranabilir tür kartları; her kartta ikon, ad, kontrol biçimi etiketi (state / aksiyon) ve kısa açıklama. Arama ada, açıklamaya ve etikete bakar ("desen", "hata", "aksiyon").
- **2. adım, ayrıntılar:** kapsam (*Tüm model* / *Yalnızca bu node* + node listesi / *Yalnızca bu edge* + edge listesi `e_Login (v_Login → v_Telefon)` ve altında **ikinci katman: Edge'deki aksiyon** listesi — `Edge'in tamamı (her aksiyondan sonra)` ya da `1. Yaz Fill Username (input:user-name)`, `2. Yaz Fill Password`, `3. Tıkla Login` gibi edge'in kayıttaki aksiyonları; türün izin vermediği seçenek pasif), parametreler, **Etkin** anahtarı, isteğe bağlı isim, özet cümlesi, **Kaydet**. Bir yazma aksiyonu seçilince alan isteyen türde **Alan** o aksiyonun hedefiyle (`input:user-name`) kendiliğinden dolar (kullanıcı kendi yazdıysa dokunulmaz).

**Parametre yardımcıları:** alan isteyen türlerde alan, kapsamdaki ekranların kayıttaki etkileşimli elementlerinden listeden seçilebilir (parmak izi anahtarı, ör. `input:phone`; node kapsamında o node, aksiyon kapsamında edge'in çıktığı ve vardığı node'lar, tüm modelde bütün node'lar; elle CSS selector yazmak da mümkün, ör. `#phone`). Desen isteyen türlerde hazır desen çipleri (telefon, e-posta, sadece rakam, tarih, boş değil) ve **Dene** kutusu vardır: örnek bir değer yazınca ✓ uyuyor / ✗ uymuyor anında görünür. Formun altındaki **özet cümlesi** monitörü düz Türkçeyle okur ("Testte e_Telefon edge'inin 1. Yaz Fill Telefon aksiyonundan hemen sonra: input:phone alanının değeri /^0?5/ desenine uymalı… Bozulursa kırmızı yanar.") ve her değişiklikte güncellenir.

Form kaydetmeden önce doğrular: zorunlu alanlar, sayı aralıkları ve düzenli ifadeler (geçersiz desen alanın altında hatayla gösterilir, kayıt yapılmaz). Metin alanında **Enter** kaydeder. Değişiklik yapılmış bir form ✕, **Vazgeç**, Esc ya da pencere dışına tıklamayla kapatılmak istenirse "Kaydetmeden çıkılsın mı?" diye sorar (Ayarlar penceresiyle aynı davranış).

### Liste

Her satırda etkin kutusu, tür ikonu ve ad, kapsam (`Tüm model`, `Node: v_Telefon`, `Aksiyon: e_Login`), parametreler (`Aksiyon tabanlı · Alan: input:phone · …`), varsa **Son kontrol** satırı (ışık + açıklama; oynatmadan ya da "şimdi kontrol et"ten), **Düzenle** (tür değişmez) ve ✕. Üstteki *Tümü / Tüm model / Seçili öğe* düğmeleri listeyi süzer (*Seçili öğe*, graph'ta seçili node ya da edge'in adını gösterir). Monitörü olan node ve edge graph'ta mor haleyle görünür.

- **Silme ve geri alma:** ✕ tek monitörü siler, **Tümünü sil** iki tıklamayla hepsini; **Silmeyi geri al** son silmeyi eski yerine getirir (panel açıkken).
- **Dışa aktarma:** **GraphWalker JSON** butonu monitörleri modele yazar (aşağıda). Ayrı bir dosya yoktur: monitörler modelle birlikte taşınır. Graph'lar kartındaki **Dışa aktar** (tam yedek) de monitörleri içerir; yedek **Yükle…** ile geri yüklenince monitörler yeni graph'a kendiliğinden gelir.
- **Yükle…** (Monitörler bölümünde): daha önce dışa aktarılmış bir GraphWalker JSON'undaki monitörleri mevcut listeye ekler. Öğesi bu graph'ta olmayan monitör sahipsiz gelir, bilinmeyen tür atlanır.
- **Graph'lar ve senaryo görünümü:** monitörler graph'a aittir; başka bir graph'a geçilince onun monitörleri gelir, graph silinince monitörleri de silinir. Senaryo sekmesinde (senaryonun graph'ı, salt okunur) öğenin monitörleri ve halesi görünür; ekleme ve düzenleme **Ana graph** sekmesinde yapılır.

### Kontrol etmek

- **Koşuyu oynat** (Panelde oynat kartı): oynatma başlayınca adım listesinin altında **Monitörler** listesi açılır; koşuda geçerli etkin monitörler alt alta sıralanır ve adımlar ilerledikçe yanar. Ayrıntı: [Oynatmada kontrol](#oynatmada-kontrol).
- **Bu ekranda şimdi kontrol et** (Monitörler bölümü): oynatma yapmadan, açık sekmedeki ekranda tüm model monitörleri + graph'ta seçili node'un ya da edge'in monitörleri anında kontrol edilir; sonuç her satırın **Son kontrol** satırında ve üstteki mesajda görünür. Hızlı deneme için: bir sayfa açın, "Font Size ≥ 4 pt" ekleyin, butona basın.

---

## Monitör türleri

Türler `extension/sidepanel/monitor-types.js`'tedir; eklemek / çıkarmak için o listeye bir kayıt yazmak yeter, arayüz değişmez.

| Tür (`id`) | Panelde adı | Grup | Kontrol biçimi | Kapsam | Parametreler | Ne kontrol eder |
|---|---|---|---|---|---|---|
| `inputValidation` | Input Validation | İşlevsel izleme | aksiyon | tüm model / node / edge (aksiyon) | alan, desen (hazır çipler), uymalı / uymamalı, boşken | Alanın değeri desene uyuyor mu? Her aksiyondan sonra alana bakılır; yazılan değer o anda alandadır. Örnek: telefon `^0?5` ile başlamalı; e-postada birden fazla `@` görülürse (`@.*@`, "uymamalı") kırmızı. |
| `errorText` | Error Text | Hata izleme | state | tüm model / node / edge (aksiyon) | hata kalıbı (varsayılan: 404, 500, internal server error, something went wrong, bir hata oluştu) | Sayfanın görünen metninde (`document.body.innerText`) hata kalıbı geçiyor mu? Geçiyorsa bulunduğu yerin çevresiyle kırmızı. |
| `fontSize` | Font Size | Erişilebilirlik | state | tüm model / node / edge (aksiyon) | alt sınır (4), birim (pt / px) | Görünen her metin parçasının `getComputedStyle(...).fontSize` değeri alt sınırın altında mı? (1 pt = 4/3 px; en fazla 5000 parça.) Çizilmeyen metin sayılmaz: simge düğmelerinde yazı boyutu 0 yapılıp yerine simge gösterilen yazılar ("Open Menu") ekranda olmadığı için küçük de sayılmaz. Küçük olanlar metinleriyle listelenir. |

Element seçimi: önce parmak izi anahtarı (`input:phone`, ekrandaki etkileşimli elementler arasında, [03](03-state-eslestirme.md)'teki tanımla), uymazsa CSS selector.

---

## Oynatmada kontrol

"Koşuyu oynat" (panel.js > PANELDE OYNATMA, replay.js) sırasında `monitor-run.js` devreye girer:

1. **Koşu başlarken** koşuda geçerli etkin monitörler seçilir: tüm model olanlar, koşudaki bir edge'e bağlı olanlar, koşunun vardığı bir node'a bağlı olanlar. (Koşunun yalnızca başlangıç node'u olan bir node'a varılmaz; onun monitörleri bu koşuda listelenmez.)
2. **Her aksiyondan sonra** (sayfa durulunca) aksiyon tabanlı Input Validation alana bakar: yazılan değer o anda alandadır. **Edge'in o aksiyonuna bağlı monitörler** (hangi türden olursa olsun) de şimdi, yalnızca burada kontrol edilir; aksiyon edge'de artık yoksa (Emir'in edge kartından silinmişse) "aksiyon edge'de bulunamadı" (ışık kırmızı olmaz). Alan ekranda yoksa önceki sonuç korunur. Bozulduysa **görüntü bu anda alınır** ve uyarı kaydedilir; oynatma bir sonraki aksiyona (ör. Login tıklaması) bu bitmeden geçmez. Adımda ilk bozulma anı kalır; sonraki aksiyonlar sonucu değiştirmez.
3. **Her adımın sonunda,** varılan ekran beklenen node ile karşılaştırıldıktan sonra (replay.js > `verify`): o adımda geçerli monitörler (tüm model + varılan node'unkiler + oynatılan edge'inkiler) sayfaya sorulur (`MONITOR_PROBE`, monitor-probe.js). Ekran beklenen node değilse (adım kalacak) node monitörleri kontrol edilmez ("node'a varılamadı"); tüm model ve aksiyon monitörleri yine de kontrol edilir. Bozulan monitörler için varılan ekranın görüntüsü alınır ve uyarı kaydedilir.
4. **Koşu bitince** oynatılmayan adımlar "adım oynatılmadı" diye not edilir, her monitörün genel sonucu Monitörler listesine **Son kontrol** olarak yazılır.

**Uyarılar: monitörün kendi ekran görüntüsü yapısı.** Bir monitör bozulduğunda görüntü (`chrome.tabs.captureVisibleTab`, node görüntüleriyle aynı biçim: jpeg, kalite 40) *bozulma anında* alınır: aksiyon tabanlı monitörde alana yazıldıktan hemen sonra, state tabanlı monitörde varılan ekranda. Adımın sonunu beklemek yanlış ekranı gösterirdi: Input Validation kullanıcı adı yazılınca bozulur ama adımın sonunda Login'e basılmış, ürün sayfası açılmıştır. Görüntü graph'ın node görüntülerine yazılmaz; uyarı olarak monitörün kendi anahtarında saklanır (`monitor-alarms:<graph id>`, bkz. Veri modeli): zaman, kaynak (oynatma / şimdi kontrol), yer (`Adım 2 (e_Devam → v_Sepet) · aksiyon 1/3: Fill Telefon`), neden, adres, görüntü. Monitörler listesinde her monitörün **Uyarılar (n)** düğmesi listeyi açar (en yenisi üstte; "Uyarıları temizle" iki adımlı); son kontrol kırmızıysa son uyarının küçük görüntüsü satırda da görünür. Graph başına son 20 uyarı tutulur. "Bu ekranda şimdi kontrol et"te bozulan monitörler de görüntülü uyarı yazar.

**Işık listesi** (oynatma kartında, adım listesinin altında): başlıkta sayım (`3 monitör · 1 kırmızı · 2 yeşil`, sürerken "kontrol ediliyor"). Her satırda:

- **LED:** yalnızca iki renk. Herhangi bir adımda bozuldu → kırmızı; yoksa yeşil (koşu başlarken de yeşil: "şimdiye kadar bozulma yok").
- Ad ve kapsam; **adım izi:** her adım için bir kare (yeşil / kırmızı; henüz oynatılmamış adım boş); üzerine gelince o adımın sonucu, bozulan adıma tıklayınca ekran görüntüsü.
- **Ayrıntı:** bozulduysa ilk bozulan adım ve nedeni (`Adım 2 (e_Devam → v_Sepet): değer "03121234567" desene uymuyor`), bozulmadıysa kaç adımda kontrol edildiği ve son adımın özeti (`4 metin ölçüldü, en küçüğü 10,5 pt`), kontrol edilemediyse nedeni (`Kontrol edilemedi · Adım 1 (…): alan ekranda yok`).
- Bozulma anının **küçük ekran görüntüsü;** tıklayınca büyür (başlıkta adım ve varsa aksiyon: `Adım 2 (e_Devam → v_Sepet) · aksiyon 1/3: Fill Telefon`).

Monitörler oynatmanın kendi sonucunu değiştirmez: adım geçti / kaldı kararı Emir'in doğrulamasıdır (edge set ve URL); monitör ışıkları ayrı listede durur. (Kırmızı monitörün koşuyu başarısız sayması runner raporunda uygulanacak; panelde oynatma bir inceleme aracı olduğu için kırmızı ışık yeterlidir.) **Durdur** basılınca sayfadan cevap beklenmez.

**Sınırlar:** sayfaya eklentinin content script'i yüklenmemişse (eklenti yüklenmeden önce açılmış sayfa, chrome:// sayfaları) kontrol yapılamaz; ışık yeşil kalır, satırda "sayfayı yenileyin" yazar.

---

## Veri modeli

**Panelde (chrome.storage.local, anahtar `monitors:<graph id>`).** Her graph'ın monitörleri kendi anahtarındadır ([04 > Storage: graph'lar](04-veri-modeli.md#storage-graphlar) düzenine paralel: `graph:<id>` ↔ `monitors:<id>`); graph state'inden ayrıdır, "Sıfırla" dokunmaz, eklenti yenilense de kalır, graph silinince anahtar da silinir.

**Uyarılar (anahtar `monitor-alarms:<graph id>`).** Monitörlerin bozulma anı kayıtları, ekran görüntüleriyle; tanımlardan ayrı tutulur ki tanımlar küçük kalsın ve dışa aktarıma (model, yedek) girmesin. Şekil: `{ format: "graph-recorder-monitor-alarms/v1", nextId, items: [{ id, monitorId, at, source: "replay" | "live", where, text, url, screenshot, step: { index, edgeId, target } | null, action: { index, count, label } | null }] }`. `where` uyarı anında hesaplanmış metindir (graph sonradan değişse de okunur). Graph başına son 20 uyarı kalır; silinmiş monitörlerin uyarıları bir sonraki yazımda atılır; graph silinince anahtar da silinir.

```json
{
  "format": "graph-recorder-monitors/v1",
  "nextId": 4,
  "items": [
    { "id": "m1", "type": "inputValidation", "scope": "e5",
      "action": { "index": 0, "type": "input", "label": "Fill Telefon", "target": "input:phone" },
      "params": { "selector": "input:phone", "pattern": "^0?5", "mode": "match", "whenEmpty": "skip" },
      "severity": "error", "enabled": true, "name": "Telefon 5 ile başlamalı", "createdAt": "2026-10-24T09:00:00.000Z" },
    { "id": "m2", "type": "fontSize", "scope": "global",
      "params": { "min": 4, "unit": "pt" },
      "severity": "error", "enabled": true, "name": null, "createdAt": "2026-10-24T09:01:00.000Z" },
    { "id": "m3", "type": "errorText", "scope": "n3",
      "params": { "pattern": "\\b(404|500)\\b" },
      "severity": "error", "enabled": true, "name": null, "createdAt": "2026-10-24T09:02:00.000Z" }
  ]
}
```

- `scope`: `"global"`, node id'si (`n3`) ya da edge id'si (`e5`). Hangisi olduğu graph'a bakılarak anlaşılır; öğe yoksa monitör sahipsizdir.
- `action` (yalnızca edge kapsamında, isteğe bağlı): edge'in bağlanılan aksiyonu. Sıra (`index`) tek başına güvenilmez (Emir'in edge kartından aksiyon silinince kayar); bu yüzden tür, hedef anahtarı ve etiket de saklanır ve oynatmada aksiyon yeniden bulunur (önce sıra + etiket, sonra tür + hedef, en son etiket). `null` / yok: edge'in tamamı. Dışa aktarımda edge'deki kopyaya da yazılır.
- `name`: kullanıcı ad verdiyse; `null` ise ad türden ve parametrelerden üretilir ("Input Validation · input:phone ~ /^0?5/").
- `severity`: arayüzde seçilmez, her bozulma kırmızıdır; alan veri uyumluluğu için `"error"` yazılır (eski ya da dışarıdan gelen `"warning"` de kabul edilir ve kırmızı yanar).
- Kontrol sonuçları saklanmaz; oynatmanın sonucu gibi panel açıkken bellektedir.

**Dışa aktarılan GraphWalker JSON'unda.** GraphWalker bilmediği property'leri yok sayar (bkz. [04 > GraphWalker formatı](04-veri-modeli.md)); runner da `properties`'i olduğu gibi okur.

```jsonc
"models": [{
  "properties": {
    "graphRecorder": {
      "format": "graph-recorder/v5", "exportedAt": "…", "settings": { … },
      "monitors": { "format": "graph-recorder-monitors/v1", "items": [ /* tüm monitörler; id, type, name, scope, params, severity, enabled */ ] }
    }
  },
  "vertices": [{ "id": "n3", "name": "v_Sepet", "properties": { "url": "…", "elements": [ … ], "monitors": [ /* yalnızca bu node'unkiler */ ] } }],
  "edges": [{ "id": "e5", "name": "e_Devam", "properties": { "uiActions": [ … ], "monitors": [ /* yalnızca bu aksiyonunkiler */ ] } }]
}]
```

Tek doğruluk kaynağı model düzeyindeki listedir; vertex'teki ve edge'deki `monitors` o öğeye ait kayıtların kopyasıdır (modeli okuyan, "bu node'da / bu aksiyondan sonra ne kontrol edilecek?" sorusunu listeyi süzmeden cevaplasın diye). Sahipsiz monitörler yazılmaz. Öğede monitör yoksa alan hiç yazılmaz.

**Graph yedeğinde** ([04 > Graph yedeği](04-veri-modeli.md#graph-yedeği)) aynı liste `monitors: { format, items }` alanında taşınır (sahipsizler dahil, çünkü yedek graph'ın kendisidir). Background yedeği denetlerken bu alanı yok sayar; yükleme node ve edge id'lerini koruduğu için panel, yeni graph aktif olunca listeyi onun anahtarına yazar.

**Senaryo kopyasındaki `monitors` alanları** (scenario.js > `scenarioSnapshot`; her node ve edge'de `monitors: []`) senaryoya özel monitörler için ayrılmış ayrı bir yerdir; buradaki model monitörleriyle karışmaz ve bu menü ona dokunmaz. Senaryoya özel monitör gerekirse aynı tür kataloğu ve form oraya da bağlanabilir.

**Sayfaya giden istek ve cevap** (`MONITOR_PROBE`):

```jsonc
// panel → sayfa
{ "type": "MONITOR_PROBE", "checks": [{ "id": "m2", "type": "fontSize", "params": { "min": 4, "unit": "pt" } }] }
// sayfa → panel
{ "url": "…", "title": "…", "results": { "m2": { "status": "fail", "text": "1 metin 4 pt'den küçük: \"Gizlilik sözleşmesi\" 3 pt" } } }
```

`status`: `ok` | `fail` | `skip`; `text` kullanıcıya gösterilir. Işık panelde belirlenir: `fail` kırmızı, `ok` ve `skip` yeşil (skip'in nedeni satırda).

---

## Eklentiyle bütünleşme

Monitörler beş yeni dosyadır; eklentinin kendi dosyalarında yalnızca `panel.html`'e dört satır (stil ve üç script) ve `manifest.json`'daki content script listesine bir dosya adı eklenmiştir.

| Dosya | Görev |
|---|---|
| `sidepanel/monitor-types.js` | Tür kataloğu: gruplar ve ikonları, kontrol biçimleri, her türün parametreleri (hazır desenler, element listesi işareti), kapsam kısıtı, doğrulama (`monitorParamProblem`), otomatik ad (`monitorAutoName`), özet cümlesi (`monitorSentence`). Arayüz içermez. |
| `sidepanel/monitors.js` | Bölüm, node / edge detayındaki alt bölüm, graph'ta sağ tık menüsü, iki adımlı form penceresi (tür kartları + ayrıntılar); storage (tanımlar ve uyarılar); uyarı listesi ve "Bozulduğu andaki ekran" pencereleri; dışa / içe aktarma; graph'taki hale. |
| `sidepanel/monitor-run.js` | Oynatmada kontrol: koşunun monitörleri, aksiyon ve adım sonu kontrolleri, bozulma anında görüntü ve uyarı, ışık listesi; "Bu ekranda şimdi kontrol et". |
| `monitor-probe.js` | Content script: panelden gelen kontrol listesini sayfada değerlendirir. fingerprint.js'in tanımlarını kullanır. |
| `sidepanel/monitors.css` | Yalnızca monitörlere özgü stiller; renkler `panel.css`'teki tema değişkenlerinden gelir. |

`monitors.js` ve `monitor-run.js`, `panel.js` ve `replay.js`'ten **sonra** yüklenir ve onların global'lerini okur (`state`, `graphs`, `activeGraph()`, `scenarioView`, `selectedId`, `cy`, `nodeById`, `showMessage`, `replay`, `replayResult`, `shownReplay`, `seconds`); `panel.js`, `replay.js`, `background.js`, `content.js` değişmez. Bağlantı noktaları:

- **Bölümler:** `#monitors` bölümü Senaryo'nun (`#scenario`) hemen altına, alt bölüm node / edge detay kartının (`#details`) sonuna, ışık listesi oynatma kartındaki adım listesinin (`#replay-steps`) altına, sağ tık menüsü ve pencereler `body`'ye script tarafından eklenir.
- **Seçim ve sağ tık:** `cy.on('tap')` dinleyicisi panel.js'inkinden sonra çalışır (`selectedId` günceldir); sağ tık `cy.on('cxttap')` ile alınır, `#graph` üzerinde tarayıcının kendi menüsü engellenir. Menüden "ekle" seçilince öğe graph'ta seçilir (panel.js'in tap dinleyicisi tetiklenir) ve form açılır.
- **Graph yeniden çizimi:** panel.js elementleri silip yeniden eklediğinde (`cy` `add` olayı) ve tema değişince (`themechange`; panel.js stil setini baştan yükler) mor hale yeniden uygulanır (node'da ve edge'de `underlay`).
- **Sarmalanan global fonksiyonlar** (`x = () => … orijinal() …`; fonksiyonlar adlarıyla çağrıldığı için sarmalanan sürüm kullanılır). İstenirse her biri ilgili fonksiyonun içine tek satırlık bir çağrı olarak da alınabilir:
  - `graphWalkerModel` (panel.js): dışa aktarıma monitörler eklenir.
  - `graphBackup` (panel.js): yedeğe monitörler eklenir.
  - `startReplay` (replay.js): koşu başlarken monitörler seçilir, koşu bitince sonuçlar toplanır.
  - `verify` (replay.js): adımın sonunda, ekran doğrulandıktan sonra monitörler kontrol edilir (await; oynatma sonraki adıma sonra geçer).
  - `afterAction` (replay.js): aksiyon bitince aksiyon tabanlı Input Validation ve edge'in o aksiyonuna bağlı monitörler kontrol edilir.
  - `renderReplay` (panel.js): oynatma kartı her çizildiğinde ışık listesi de çizilir / gizlenir (başka koşuya geçilince gizlenir).
- **Sayfa:** `MONITOR_PROBE` mesajı content.js'in dinleyicisinde tanınmaz (cevap vermez), monitor-probe.js cevaplar. content.js'in kendi `MONITOR` mesajıyla (ekranı izleme) ilgisi yoktur. monitor-probe.js'in tamamı bir kapanış içindedir: aynı dünyada çalıştığı için yardımcı adları content.js'in fonksiyonlarını ezmesin.
- **Tek yazar kuralı** ([01 > Kural 1](01-mimari.md#kural-1-statei-yalnızca-backgroundjs-değiştirir-tek-yazar)) korunur: graph state'ini yine yalnızca background yazar. Monitörler ayrı anahtardadır ve tek yazarı `monitors.js`'tir; background bu anahtarı bilmez.
- **Node / edge silme, birleştirme, sıfırlama** için özel bir mesaj yoktur: `monitors.js` storage'daki `graph:<id>` değişikliğini dinler, öğesi kaybolan monitörü "sahipsiz" gösterir; öğe geri gelirse (Geri al) işaret kendiliğinden kalkar.
- **Graph'lar:** `activeGraph` değişince o graph'ın `monitors:<id>` ve `monitor-alarms:<id>` anahtarları okunur. panel.js yeni graph'ı ayrı bir okumayla yüklediği için `monitors.js`, `state.id` yeni graph'a geçene kadar çizimi erteler (kısa aralıklarla yeniden dener). `graphs` listesinden düşen graph'ların monitör ve uyarı anahtarları silinir.
- **Yedek:** yüklemede panel.js'in dosya kutusu (`#graph-file`) capture aşamasında okunur; yedekteki monitörler bekletilir ve yalnızca yedek seçildikten sonra oluşmuş, yedekteki tüm node'ları içeren ve henüz monitörü olmayan graph aktif olunca yazılır (vazgeçilen ya da başka bir graph'a geçilen durumda uygulanmaz; 2 dakika sonra düşer).
- **Senaryo görünümü** (`scenarioView`): kopyadaki node ve edge'ler aynı id'yi taşıdığı için hale ve liste aynen görünür; ekleme butonu gizlenir, satırlar pasiftir, sağ tık menüsünde yalnızca "göster" vardır (panel.js'in salt okunur görünüm kuralı).

---

## Yeni bir monitör türü eklemek

`monitor-types.js > MONITOR_TYPES` listesine bir kayıt ekleyin; tür kartı, form, liste, doğrulama ve dışa aktarma kendiliğinden gelir:

```js
{
  id: 'urlCheck', text: 'URL Check',   // JSON'a yazılan tür adı (sonradan değiştirmeyin) ve panelde görünen ad
  group: 'functional',                 // MONITOR_GROUPS'tan bir grup (yeni grup gerekiyorsa oraya bir satır)
  when: 'state', scope: 'any',         // kontrol biçimi; kapsam: 'any' | 'global' | 'node' | 'edge' | 'node-edge'
  hint: 'Beklenen adrese gelindi mi? Sayfanın adresi verilen desene uymalı.',
  params: [{ key: 'pattern', text: 'Adres deseni (regex)', kind: 'regex', required: true, placeholder: 'ör. /cart$' }],
}
```

Parametre türleri: `text`, `regex` (kaydedilmeden derlenir; formda canlı deneme kutusu çıkar, `presets: [{ text, value }]` ile hazır desen çipleri eklenir), `number` (`min`, `max`, `step`), `select` (`options: [{ value, text }]`), `checkbox`. Bir alan kayıttaki elementlerden seçilebilsin isteniyorsa parametreye `element: 'fields'` (yalnızca form alanları) ya da `element: 'all'` ekleyin. Otomatik adın belirleyici parametreyi göstermesi için `monitorAutoName()` içine, özet cümlesinin düz Türkçe okunması için `monitorSentence()` içine birer satır ekleyin.

Kontrolün kendisi: `monitor-probe.js > MONITOR_PROBES` nesnesine aynı `id` ile `(params) => { status, text }` döndüren bir fonksiyon ekleyin (sayfada çalışır; `resolveElements`, `isRendered` gibi yardımcılar hazır). Örneğin `urlCheck` için: `new RegExp(params.pattern).test(location.href)` → `ok` / `fail`.

---

## Test

**Manuel kontrol listesi.** Graph'ta en az iki node ve bir edge varken:

- [ ] Senaryo'nun altında **Monitörler** bölümü var, başlıkta sayı yok, açılınca "Henüz monitör yok…" ipucu.
- [ ] Graph'ta bir node'a sağ tık → menüde `"v_…" node'una monitör ekle` ve `Monitörlerini göster (0)`; tarayıcının kendi menüsü açılmıyor. Edge'e sağ tık → `"e_…" edge'ine monitör ekle`. Boş alana sağ tık → `Tüm modele monitör ekle`. Esc, dışarı tıklama ve graph'ı kaydırma menüyü kapatıyor.
- [ ] Menüden "ekle" → öğe graph'ta seçiliyor, pencere 1. adımda açılıyor: 3 kart (Input Validation, Error Text, Font Size); kartlarda kontrol biçimi etiketi. Arama: "desen", "hata", "yazı" (büyük harfle de).
- [ ] "Input Validation" kartı → 2. adım: kapsamda *Yalnızca bu edge* + `e_… (v_… → v_…)` seçili; altında **Edge'deki aksiyon** listesi (`Edge'in tamamı`, `1. Yaz …`, `2. Tıkla …`); bir yazma aksiyonu seçilince **Alan** kendiliğinden doluyor ve özet "… edge'inin 1. Yaz … aksiyonundan hemen sonra: … Bozulursa kırmızı yanar." diyor. **Kaydet** → listede `Edge: e_… · 1. Yaz …`, edge graph'ta mor haleli; **Düzenle** aksiyonu yeniden seçili getiriyor. Aynı edge'e şifre alanı için ikinci bir Input Validation (2. aksiyon, başka desen) eklenebiliyor.
- [ ] Node'a tıklayınca detay kartında **Bu node'un monitörleri** ve "Tüm model için tanımlı N etkin monitör…"; edge'e tıklayınca **Bu edge'in monitörleri** ve **Bu edge'e monitör ekle**.
- [ ] "Font Size" türü varsayılan `4 pt` ile geliyor; değer değiştirilebiliyor (ör. 6); Enter kaydediyor; kapsam *Tüm model*. **Düzenle** ile sonradan değiştirilebiliyor.
- [ ] Filtreler: *Seçili öğe* (adıyla) yalnızca o öğeninkileri, *Tüm model* yalnızca genel olanları gösteriyor; seçim yokken *Seçili öğe* pasif.
- [ ] Doğrulama (geçersiz desen, boş zorunlu alan), kaydedilmemiş değişiklik uyarısı, Düzenle (tür kilitli), etkin kutusu (hale kalkıyor), silme / geri alma, Tümünü sil ("Emin misin?").
- [ ] **Bu ekranda şimdi kontrol et:** 3 pt yazı içeren bir sayfada "Font Size" kırmızı, "Error Text" yeşil; mesajda "N kırmızı, M yeşil". Eklenti yüklenmeden önce açılmış sayfada ışık yeşil ama satırda "sayfayı yenileyin".
- [ ] **Koşuyu oynat:** adım listesinin altında Monitörler listesi; adımlar ilerledikçe ışıklar yanıyor, başlıkta "kontrol ediliyor"; sonunda sayım. Bozulan monitörde kırmızı ayrıntı ve küçük ekran görüntüsü, tıklayınca büyüyor; adım izindeki karelerin üzerine gelince adımın sonucu. Yalnızca yeşil / kırmızı. Başka senaryoya geçince liste gizleniyor, geri dönünce görünüyor. Monitörler listesinde **Son kontrol … (son oynatma)**.
- [ ] **Uyarı anı:** Input Validation'ı bozan bir koşuda (ör. kullanıcı adı deseni `^admin`) büyütülen görüntü, Login'e basılmadan önceki ekranı (yazılmış alanla) gösteriyor; başlıkta adım ve aksiyon. Monitörler listesinde **Uyarılar (n)**: liste penceresinde zaman, yer, neden, görüntü; "Uyarıları temizle" iki adımlı. Panel kapatılıp açılınca uyarılar duruyor; "Bu ekranda şimdi kontrol et"te kırmızı çıkan monitöre de uyarı ekleniyor.
- [ ] Oynatma kalırsa (yanlış ekran) node monitörlerinin satırında "node'a varılamadı", tüm model monitörleri yine kontrol edilmiş. **Durdur** sonrası kalan adımların karesi boş, satırda "oynatma durduruldu".
- [ ] **GraphWalker JSON**: `models[0].properties.graphRecorder.monitors.items` tüm monitörleri, ilgili vertex'in ve edge'in `properties.monitors` alanı yalnızca kendininkileri içeriyor. GraphWalker CLI `check` hâlâ geçiyor.
- [ ] Node / edge silinince satır "Sahipsiz: öğe (…) artık yok", üstte sarı uyarı ve **Sahipsizleri sil**; **Geri al** ile dönünce işaret kalkıyor. Yedek dışa / içe aktarma, graph geçişi ve silme, senaryo görünümü (salt okunur), panel yeniden açılınca kalıcılık, Sıfırla.
- [ ] Karanlık temada kartlar, pencere, liste, ışıklar, sağ tık menüsü ve hale okunaklı.

**Otomatik testler (uçtan uca,** [tests/README.md](../tests/README.md)**).** Eklenti gerçek Chromium'a yüklenir, yerel sayfalarda kayıt yapılır, panel butonlarla sürülür.

- `node tests/e2e/monitors.test.js` (menü): tür kartları ve etiketler, arama; node monitörü (parmak izinden element listesi, hazır desen, canlı deneme, özet cümlesi); tüm model monitörü; sağ tık menüsünden edge monitörü (kapsam, element listesi, edge'deki aksiyon listesi ve aksiyon seçilince alanın dolması, düzenlemede aksiyonun yeniden seçili gelmesi, özet, hale, detay alt bölümü, dışa aktarımda `edges[].properties.monitors`); boş alana sağ tık, Esc; "Monitörlerini göster"; `monitors:<graph>` anahtarındaki şekil; filtreler, etkin kutusu, düzenleme; doğrulama ve kaydedilmemiş değişiklik uyarısı; GraphWalker JSON'u ve runner'ın (`loadModel`) okuması; graph başına saklama ve geçiş; yedekle dışa / içe aktarma; graph silme; node silme / geri alma; senaryo görünümü; yeniden açılış; Sıfırla; konsolda hata yok.
- `node tests/e2e/monitor-run.test.js` (kontrol): kuralları bilerek bozan sayfalarda (3 pt yazı; "500 Internal Server Error" metni; 5 ile başlamayan telefon) dört monitörle oynatma. Oynatma sürerken liste ve "kontrol ediliyor"; Emir'in oynatması yine geçiyor; her monitörün ışığı, adım izi ve ayrıntısı (Font Size kırmızı adım 1 / yeşil adım 2, Error Text kırmızı adım 2, Input Validation'da yazılan değer, node monitörü yeşil); yalnızca yeşil / kırmızı; ekran görüntüleri ve büyütme; uyarılar `monitor-alarms:<graph>`'ta ve bozulma anında alınmış (Input Validation görüntüsü Telefon sayfasında, "Devam" tıklanmadan; aksiyon bilgisiyle), edge'in aksiyonuna bağlı monitörler (1. aksiyon = yazınca Telefon sayfasında, 2. aksiyon = Devam tıklanınca Sepet sayfasında; sırası yanlış kaydedilmiş aksiyon tür + hedefle bulunuyor; silinmiş aksiyon "bulunamadı", kırmızı değil), Monitörler listesinde "Uyarılar (n)" ve liste penceresi; "Son kontrol"; başka senaryoda listenin gizlenmesi; "Bu ekranda şimdi kontrol et" (kırmızıya uyarı); yeniden açılışta uyarıların durması; "Uyarıları temizle"; konsolda hata yok.
- Eklentinin diğer uçtan uca testleri (`graphs`, `scenarios`, `scenario-graphs`, `compare`, `buffer`, `replay`, `replay-start`, `scenario-run`) bu dosyalar yüklüyken de aynı sonucu veriyor.

---

## Sonraki adımlar

1. **Yeni türler:** ihtiyaca göre `monitor-types.js`'e kayıt, `monitor-probe.js`'e kontrol eklenir (yukarıdaki tarif). Yapı değişmez.
2. **Runner tarafı:** aynı kontroller runner'da (`runner/lib/oracle.js`'in yanında) her edge'den sonra çalıştırılır ve rapora girer (monitör, kapsam, adım numarası, ekran görüntüsü; kırmızı monitör koşuyu başarısız sayar). Sayfa kontrolleri için `monitor-probe.js` Playwright'ın `page.addInitScript`'iyle sayfaya verilebilir (fingerprint.js gibi).
3. **Senaryoya özel monitörler:** gerekirse aynı form, scenario.js'teki `monitors: []` yuvalarına bağlanır.
