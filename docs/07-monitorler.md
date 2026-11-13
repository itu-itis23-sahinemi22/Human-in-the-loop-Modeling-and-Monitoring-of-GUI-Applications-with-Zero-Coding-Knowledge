# 07: Monitörler (Run-time Monitoring)

Projenin ikinci yarısı, çıkarılan graph üzerinde koşan testin **her adımdan sonra** bir dizi kuralı kontrol etmesidir (run-time monitoring; kurallar birer *test oracle*'ıdır). Kullanıcı kod yazmadan, yan panelden kural tanımlar; test koşarken her monitör yeşil (kural bozulmadı) ya da kırmızı (bozuldu: adım numarası ve ekran görüntüsüyle) yanar. Bu doküman üç parçayı anlatır:

1. **Monitör menüsü:** monitörlerin tanımlanması (Monitörler bölümü, graph'ta sağ tık menüsü; genel kurallar ve senaryoya özel monitörler), saklanması ve GraphWalker JSON'una yazılması.
2. **Monitör türleri:** bugün yedi tür var (Input Validation, Expected Text, Expected Image, Error Text, JavaScript Error, Font Size, Action Timeout); yeni tür eklemek tek dosyada bir kayıttır.
3. **Oynatmada kontrol:** "Koşuyu oynat" denince monitörlerin alt alta listelenip yeşil / kırmızı yanması, bozulma anının ekran görüntüsü ve o görüntüde **bozulan elementin işaretlenmesi** (hata yeri); oynatmasız "Bu ekranda şimdi kontrol et".

## İçindekiler

- [Kavramlar](#kavramlar)
- [Kullanım](#kullanım)
- [Monitör türleri](#monitör-türleri)
- [Bekleme aksiyonuna monitör](#bekleme-aksiyonuna-monitör)
- [Ekrana bakmayan monitörler: JavaScript Error ve Action Timeout](#ekrana-bakmayan-monitörler-javascript-error-ve-action-timeout)
- [Senaryoya özel monitörler](#senaryoya-özel-monitörler)
- [Oynatmada kontrol](#oynatmada-kontrol)
- [Hata yeri: bozulan elementin işaretlenmesi](#hata-yeri-bozulan-elementin-işaretlenmesi)
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
| **Kapsam** | *Tüm model:* kural her node'da kontrol edilir. *Node:* kural yalnızca o node'a varıldığında kontrol edilir. *Edge:* kural yalnızca o edge oynatıldığında kontrol edilir (yazılan değer gibi aksiyon tabanlı kurallar). Bir edge birden fazla aksiyondan oluşur (kullanıcı adı yaz, şifre yaz, Login'e tıkla); monitör **edge'in seçilen aksiyonuna** bağlanabilir: o aksiyondan hemen sonra, bir sonraki aksiyon oynatılmadan kontrol edilir (kullanıcı adı deseni 1. aksiyona, şifre deseni 2. aksiyona; tıklamanın input validation'ı olmaz). Aksiyon seçilmezse edge'in tamamı: her aksiyondan sonra. Bir **bekleme** aksiyonu da seçilebilir: kontrol bekleme bitince yapılır (bkz. [Bekleme aksiyonuna monitör](#bekleme-aksiyonuna-monitör)). Örnek: "4 pt'den küçük yazı yok" tüm model; "Telefon" ekranındaki regex yalnızca o node (ya da yalnızca telefonu yazan aksiyon). |
| **Genel kural / senaryo monitörü** | Ana graph'ta tanımlanan monitör **genel kuraldır:** her senaryoda (ve "şimdi kontrol et"te) kontrol edilir ("hiçbir ekranda 500 hatası olmasın"). Bir senaryonun sekmesinde tanımlanan monitör **o senaryoya özeldir:** yalnızca o senaryo oynatılırken, senaryonun kendi graph'ında (kopyada) kontrol edilir. Aynı login edge'inden geçen iki senaryo böylece farklı beklenti taşır. Bkz. [Senaryoya özel monitörler](#senaryoya-özel-monitörler). |
| **Kontrol biçimi** | *State tabanlı* (node'a varılınca ekrana bakılır), *aksiyon tabanlı* (aksiyondan sonra ekrana bakılır), *olay tabanlı* (oynatma sırasında olan bir olaya bakılır: JavaScript hatası) ya da *süre tabanlı* (aksiyonların süresine bakılır). Son ikisi ekrana bakmaz ve yalnızca oynatmada kontrol edilir (bkz. [Ekrana bakmayan monitörler](#ekrana-bakmayan-monitörler-javascript-error-ve-action-timeout)). Tür kartında etiket olarak görünür. |
| **Tür ve parametreler** | Her monitörün bir türü (ör. `inputValidation`) ve türe göre parametreleri (alan, desen, eşik…) vardır. Türler `monitor-types.js`'te tanımlıdır; form oradan üretilir. |
| **Etkin** | Kapalı monitör tanımlı kalır ama kontrol edilmez (geçici olarak susturmak için). |
| **Sahipsiz** | Öğesi artık olmayan node / edge monitörü (silinmiş, birleştirilmiş ya da graph sıfırlanmış). Dışa aktarılmaz; düzenlenip başka öğeye taşınır ya da silinir. |
| **Işık (LED)** | Her monitörün ışığı ikilidir: **kırmızı** kural bir adımda bozuldu, **yeşil** bozulmadı. Kontrol edilemeyen durumlar (alan ekranda yok, sayfaya ulaşılamadı, adım oynatılmadı) ışığı kırmızı yapmaz; nedeni satırın ayrıntısında yazar. Önem (hata / uyarı) seçimi yoktur. |

---

## Kullanım

### Monitör tanımlamak

Panelde Senaryo bölümünün altında **Monitörler** bölümü vardır (başlıktaki sayı: tanımlı monitör sayısı). Üç yoldan monitör eklenir:

1. **Graph'ta sağ tık:** bir node'a sağ tıklayınca `"v_Telefon" node'una monitör ekle` ve `Monitörlerini göster (n)`; bir edge'e sağ tıklayınca `"e_Login" edge'ine monitör ekle`; boş alana sağ tıklayınca `Tüm modele monitör ekle`. Menü seçilen öğeyle açılır; "göster" seçeneği listeyi o öğeye süzer. Dokunmatikte uzun basma aynı işi görür. Senaryo sekmesinde aynı menü o senaryoya ekler (`… bu senaryo için monitör ekle`).
2. **Monitörler bölümünden:** **Monitör ekle** (bir node ya da edge seçiliyse o öğe önerilir, kapsam değiştirilebilir). Senaryo sekmesinde buton **Bu senaryoya monitör ekle** olur.
3. **Detay kartından:** graph'ta bir node'a ya da edge'e tıklayınca detay kartının altında **Bu node'un / edge'in monitörleri** alt bölümü ve **Bu node'a / edge'e monitör ekle** butonu çıkar (senaryo sekmesinde **… bu senaryo için monitör ekle**).

Pencere iki adımdır:

- **1. adım, tür:** gruplar altında aranabilir tür kartları; her kartta ikon, ad, kontrol biçimi etiketi (state / aksiyon / olay / süre) ve kısa açıklama. Arama ada, açıklamaya ve etikete bakar ("desen", "hata", "aksiyon", "süre").
- **2. adım, ayrıntılar:** kapsam (*Tüm model* / *Yalnızca bu node* + node listesi / *Yalnızca bu edge* + edge listesi `e_Login (v_Login → v_Telefon)` ve altında **ikinci katman: Edge'deki aksiyon** listesi — `Edge'in tamamı (her aksiyondan sonra)` ya da `1. Yaz Fill Username (input:user-name)`, `2. Yaz Fill Password`, `3. Tıkla Login` gibi edge'in kayıttaki aksiyonları; türün izin vermediği seçenek pasif), parametreler, **Etkin** anahtarı, isteğe bağlı isim, özet cümlesi, **Kaydet**. Bir yazma aksiyonu seçilince alan isteyen türde **Alan** o aksiyonun hedefiyle (`input:user-name`) kendiliğinden dolar (kullanıcı kendi yazdıysa dokunulmaz).

**Parametre yardımcıları:** alan isteyen türlerde alan, kapsamdaki ekranların kayıttaki etkileşimli elementlerinden listeden seçilebilir (parmak izi anahtarı, ör. `input:phone`; node kapsamında o node, aksiyon kapsamında edge'in çıktığı ve vardığı node'lar, tüm modelde bütün node'lar; elle CSS selector yazmak da mümkün, ör. `#phone`). Desen isteyen türlerde hazır desen çipleri (telefon, e-posta, sadece rakam, tarih, boş değil) ve **Dene** kutusu vardır: örnek bir değer yazınca ✓ uyuyor / ✗ uymuyor anında görünür. Görüntü isteyen türde (Expected Image) en kolay yol **Ekrandan seç**: açık sekmenin o anki görüntüsü bir pencerede açılır, aranacak parça fareyle dikdörtgen olarak çizilir (seçim boyutu ve gerçek boyutta önizleme görünür; **Yeniden çek** sayfayı kaydırdıktan sonra yeni görüntü alır), **Kullan** deyince parça forma girer; parça kontrolde kullanılan görüntüyle aynı kaynaktan geldiği için ölçek ve renk farkı olmaz. Ayrıca dosya seçme kutusu vardır ve panodaki bir görüntü pencereye yapıştırılabilir (⌘V / Ctrl+V); yüklenen parça boyutuyla önizlenir, **Kaldır** ile çıkarılır. Formun altındaki **özet cümlesi** monitörü düz Türkçeyle okur ("Testte e_Telefon edge'inin 1. Yaz Fill Telefon aksiyonundan hemen sonra: input:phone alanının değeri /^0?5/ desenine uymalı… Bozulursa kırmızı yanar.") ve her değişiklikte güncellenir.

Form kaydetmeden önce doğrular: zorunlu alanlar, sayı aralıkları ve düzenli ifadeler (geçersiz desen alanın altında hatayla gösterilir, kayıt yapılmaz). Metin alanında **Enter** kaydeder. Değişiklik yapılmış bir form ✕, **Vazgeç**, Esc ya da pencere dışına tıklamayla kapatılmak istenirse "Kaydetmeden çıkılsın mı?" diye sorar (Ayarlar penceresiyle aynı davranış).

### Liste

Her satırda etkin kutusu, tür ikonu ve ad, kapsam (`Tüm model`, `Node: v_Telefon`, `Edge: e_Login` ya da `Edge: e_Login · 1. Yaz Fill Username`), parametreler (`Aksiyon tabanlı · Alan: input:phone · …`), varsa **Son kontrol** satırı (ışık + açıklama; oynatmadan ya da "şimdi kontrol et"ten), **Düzenle** (tür değişmez) ve ✕. Üstteki *Tümü / Tüm model / Seçili öğe* düğmeleri listeyi süzer (*Seçili öğe*, graph'ta seçili node ya da edge'in adını gösterir). Monitörü olan node ve edge graph'ta mor haleyle görünür.

- **Silme ve geri alma:** ✕ tek monitörü siler, **Tümünü sil** iki tıklamayla hepsini; **Silmeyi geri al** son silmeyi eski yerine getirir (panel açıkken).
- **Dışa aktarma:** **GraphWalker JSON** butonu monitörleri modele yazar (aşağıda). Ayrı bir dosya yoktur: monitörler modelle birlikte taşınır. Graph'lar kartındaki **Dışa aktar** (tam yedek) de monitörleri içerir; yedek **Yükle…** ile geri yüklenince monitörler yeni graph'a kendiliğinden gelir.
- **Yükle…** (Monitörler bölümünde): daha önce dışa aktarılmış bir GraphWalker JSON'undaki monitörleri mevcut listeye ekler. Öğesi bu graph'ta olmayan monitör sahipsiz gelir, bilinmeyen tür atlanır.
- **Graph'lar ve senaryo görünümü:** monitörler graph'a aittir; başka bir graph'a geçilince onun monitörleri gelir, graph silinince monitörleri de silinir. Ana graph sekmesindeki liste **genel kurallardır.** Senaryo sekmesinde liste iki gruptur: üstte **Bu senaryonun monitörleri** (eklenir, düzenlenir, silinir), altında **Genel kurallar** (`Genel` etiketli, salt okunur; Ana graph sekmesinde düzenlenir). Ayrıntı: [Senaryoya özel monitörler](#senaryoya-özel-monitörler).

### Kontrol etmek

- **Koşuyu oynat** (Panelde oynat kartı): oynatma başlayınca adım listesinin altında **Monitörler** listesi açılır; koşuda geçerli etkin monitörler alt alta sıralanır ve adımlar ilerledikçe yanar. Ayrıntı: [Oynatmada kontrol](#oynatmada-kontrol).
- **Bu ekranda şimdi kontrol et** (Monitörler bölümü): oynatma yapmadan, açık sekmedeki ekranda tüm model monitörleri + graph'ta seçili node'un ya da edge'in monitörleri anında kontrol edilir (senaryo sekmesinde o senaryonun monitörleri de); sonuç her satırın **Son kontrol** satırında ve üstteki mesajda görünür. Hızlı deneme için: bir sayfa açın, "Font Size ≥ 4 pt" ekleyin, butona basın. Ekrana bakmayan monitörler (JavaScript Error, Action Timeout) burada kontrol edilmez: oynatma yoksa yakalanacak olay da ölçülecek süre de yoktur. Atlanırlar (mesaj kaç tane olduğunu söyler); son oynatmadaki sonuçları satırlarında kalır.

---

## Monitör türleri

Türler `extension/sidepanel/monitor-types.js`'tedir; eklemek / çıkarmak için o listeye bir kayıt yazmak yeter, arayüz değişmez.

| Tür (`id`) | Panelde adı | Grup | Kontrol biçimi | Kapsam | Parametreler | Ne kontrol eder |
|---|---|---|---|---|---|---|
| `inputValidation` | Input Validation | İşlevsel izleme | aksiyon | tüm model / node / edge (aksiyon) | alan, desen (hazır çipler), uymalı / uymamalı, boşken | Alanın değeri desene uyuyor mu? Her aksiyondan sonra alana bakılır; yazılan değer o anda alandadır. Örnek: telefon `^0?5` ile başlamalı; e-postada birden fazla `@` görülürse (`@.*@`, "uymamalı") kırmızı. |
| `expectedText` | Expected Text | İşlevsel izleme | state | tüm model / node / edge (aksiyon) | beklenen metin, **kural** (ekranda olmalı / olmamalı), büyük/küçük harf aynı olmalı (varsayılan: fark etmez) | Beklenen metin ekranda var mı ("olmalı") ya da artık yok mu ("olmamalı": geçici bir mesaj gitmiş olmalı, ör. bekleme bitince "Bekleyiniz")? Yazılan parça, görünen yazılardan **birinin içinde** (alt dize olarak) geçmeli: `innerText`'in satırları (bir etiket, bir paragraf, bir düğme yazısı), ayrıca `<input type="submit">` gibi düğmelerin değeri ve boş alanların yer tutucuları. Gizli metin sayılmaz. Büyük/küçük harf varsayılan olarak fark etmez (Türkçe İ/ı dahil; `foldText`). Parça birden çok satıra yayılmışsa (başlık + paragraf) bütün metinde de aranır; bulunursa notuyla geçer. Kalınca satırda hangi metnin arandığı, yalnızca harf farkıyla varsa o da yazar. Örnek: `v_Home` node'una varınca "Password is required" görünmeli. |
| `expectedImage` | Expected Image | İşlevsel izleme | state (**panelde**) | tüm model / node / edge (aksiyon) | görüntü (PNG / JPEG / WebP, ≤ 800×800 px, ≈1 MB; "Ekrandan seç" ile sekmenin görüntüsünden fareyle kesme, dosya seçme ya da panoya kopyalayıp forma yapıştırma), **kural** (ekranda olmalı / olmamalı), benzerlik eşiği (% 50–100, varsayılan 90) | Beklenen görüntü ekranda var mı ("olmalı") ya da artık yok mu ("olmamalı": yükleniyor simgesi, geçici kutu)? Kullanıcı bir mesajın ya da düğmenin **küçük bir parçasını** seçer (en kolayı formdaki **Ekrandan seç**: sekmenin görüntüsünde fareyle çizer; ya da ekran görüntüsünden keser — Mac ⌘⇧4, Windows Win+Shift+S — ve yükler); kontrol anında sekmenin ekran görüntüsü alınır (`captureVisibleTab`, png) ve parça görüntünün her konumunda aranır (`monitor-image.js > findImage`: önce parçanın en belirgin 16 pikseli — kenarların iki yanı — karşılaştırılır, uyarsa tüm pikseller; benzerlik = 1 − ortalama mutlak fark / 255; şeffaf pikseller sayılmaz). Eşiği geçen ilk konumun ±2 piksel komşuluğunda en iyi konum alınır ve yeşil ("benzerlik %97"); yoksa kırmızı ("en iyi benzerlik %62, eşik %90"). Parça ekrandan farklı ölçekte alındıysa (Retina 2× / 1×) 2 ve 0,5 ölçekleri de denenir. Görüntü sayfanın DOM'una bakmadığı için, metin olmayan şeyler (simge, renkli kutu, grafik) için de kullanılır. **Sınır:** sayfa yakınlaştırması (zoom) ya da tema parça alınırkenkinden farklıysa bulunamaz; görünen alanın dışı (kaydırılması gereken kısım) görüntüde yoktur. |
| `errorText` | Error Text | Hata izleme | state | tüm model / node / edge (aksiyon) | hata kalıbı (varsayılan: 404, 500, internal server error, something went wrong, bir hata oluştu) | Sayfanın görünen metninde (`document.body.innerText`) hata kalıbı geçiyor mu? Geçiyorsa bulunduğu yerin çevresiyle kırmızı. |
| `jsError` | JavaScript Error | Hata izleme | olay (**oynatmanın verisinde**) | tüm model / node / edge (aksiyon) | yok sayılacak hatalar (desen; isteğe bağlı) | Oynatma sırasında sayfada **yakalanmamış JavaScript hatası** oluştu mu (konsoldaki kırmızı "Uncaught …" satırı: atılan hata, reddedilip yakalanmayan Promise)? Ekranda hiçbir şey görünmese de yakalar (düğmeye basılır, hiçbir şey olmaz); ne bekleneceğini tarif etmek gerekmez. Kırmızıda konsoldaki satır ve atıldığı yer yazar (`"Uncaught TypeError: …" (main.js:12:5)`). Ayrıntı: [Ekrana bakmayan monitörler](#ekrana-bakmayan-monitörler-javascript-error-ve-action-timeout). |
| `fontSize` | Font Size | Erişilebilirlik | state | tüm model / node / edge (aksiyon) | alt sınır (4), birim (pt / px) | Görünen her metin parçasının `getComputedStyle(...).fontSize` değeri alt sınırın altında mı? (1 pt = 4/3 px; en fazla 5000 parça.) Çizilmeyen metin sayılmaz: simge düğmelerinde yazı boyutu 0 yapılıp yerine simge gösterilen yazılar ("Open Menu") ekranda olmadığı için küçük de sayılmaz. Küçük olanlar metinleriyle listelenir. |
| `actionTimeout` | Action Timeout | Performans | süre (**oynatmanın verisinde**) | tüm model / node / edge (aksiyon) | en fazla (saniye; 2–60, varsayılan 5) | Bir aksiyon çok mu uzun sürdü? Aksiyon başladıktan sonra testin devam edebilmesine kadar geçen süre (sayfanın durulması; son aksiyonda beklenen ekranın gelmesi) sınırı aşmamalı. Takılan, geç cevap veren sayfayı yakalar; kırmızıda hangi aksiyonun ne kadar sürdüğü yazar. Kayıttaki beklemeler ve yavaş oynatmanın araları sayılmaz. Ayrıntı: [Ekrana bakmayan monitörler](#ekrana-bakmayan-monitörler-javascript-error-ve-action-timeout). |

Element seçimi: önce parmak izi anahtarı (`input:phone`, ekrandaki etkileşimli elementler arasında, [03](03-state-eslestirme.md)'teki tanımla), uymazsa CSS selector.

**Kontrolün yeri.** Türlerin çoğu sayfada kontrol edilir (`monitor-probe.js`, content script: DOM'a bakar). `expectedImage` panelde kontrol edilir (`monitor-types.js`'te `side: 'panel'`): sayfa içinden ekran görüntüsü alınamaz, `chrome.tabs.captureVisibleTab` yalnızca eklenti sayfalarında çalışır. `monitor-run.js > probeMonitors` listeyi ikiye ayırır; aynı adımın görüntü monitörleri için tek çekim yapılır ve o çekim bozulma uyarısının görüntüsü olarak da kullanılır (ikinci çekim gerekmez; Chrome saniyede 2 çekime izin verir). `jsError` ve `actionTimeout` ne sayfada ne ekran görüntüsünde kontrol edilir (`side: 'replay'`): sonuçları oynatmanın kendi verisinden çıkar (`monitor-run.js > checkMonitors` onları ayırır; bkz. [Ekrana bakmayan monitörler](#ekrana-bakmayan-monitörler-javascript-error-ve-action-timeout)).

**Error Text ile JavaScript Error arasındaki fark:** Error Text ekranda *görünen* bir hata metnini arar ("500 Internal Server Error" yazısı); JavaScript Error ekranda hiçbir iz bırakmayan, yalnızca konsolda görünen hatayı yakalar. Biri ötekinin yerini tutmaz: sunucu hatası çoğu zaman ekrana yazılır, kod hatası çoğu zaman yazılmaz.

**Expected Text ile Error Text arasındaki fark:** Error Text bir *hata kalıbının* ekranda **olmamasını** bekler (regex, tüm metin); Expected Text bir *beklenen metnin* ekranda **olmasını** bekler (düz metin, regex yok, tek bir yazı parçasının içinde). İkisi de node'a varınca ve her adımın sonunda bakılır.

**Expected Text ile Expected Image arasındaki fark:** aynı mesaj iki yoldan da beklenebilir; metin yolu hızlı ve ölçekten bağımsızdır, görüntü yolu metin olmayan şeyleri de yakalar ve görünüşü (renk, yazı tipi) de doğrular ama aynı ölçek ve temayı ister.

---

## Bekleme aksiyonuna monitör

Bir sayfanın içeriği node değişmeden de değişebilir: düğmeye basınca "Bekleyiniz, kayıtlarınız getiriliyor…" çıkar, bir süre sonra aynı sayfada liste gelir. Kayıtta bu, edge'in içinde bir **bekleme** aksiyonudur (Beklemeleri kaydet açıkken ekranı değiştiren bekleme kendiliğinden girer; süresi edge kartındaki ✎ ile değiştirilir). Monitör bu beklemeye bağlanır ve **bekleme bittiği anda** kontrol edilir; bir sonraki aksiyon ya da node doğrulaması beklenmez:

- *Expected Text, kural "olmamalı", metin "Bekleyiniz"*: bekleme bitince geçici mesaj gitmiş olmalı. Hâlâ ekrandaysa (liste gelmedi) kırmızı yanar ve o anın görüntüsü uyarıya girer ("aksiyon 2/2: Bekle 10 sn: metin hâlâ ekranda: "Bekleyiniz, …" (olmamalıydı)").
- *Expected Text, "olmalı", listeyle gelen bir yazı* (ör. "Yazdır") ya da *Expected Image, "olmalı"/"olmamalı"* (listenin / mesaj kutusunun parçası): aynı anda içerik gelmiş mi.
- Tıklamaya bağlı *"Bekleyiniz" olmalı*: tıklamadan hemen sonra mesajın çıktığını da doğrular.

Örnek (e-Devlet): e_SGK edge'i = "SGK kaydı" tıkla + 10 sn bekle; beklemeye bağlı "Bekleyiniz olmamalı" monitörü. Sonraki sayfanın içeriği kişiye göre değiştiği için (herkesin listesi farklı) listeye değil, geçici mesajın gitmesine bakılır. Bekleme süresinin dolması bir zaman aşımıdır: süre yetmediyse monitör kırmızı yanar.

Aksiyon listesinde beklemeler süresi ve arkasından geldiği aksiyonla görünür ("6. Bekle 0,01 sn (Tıkla Login sonrası)"). Otomatik beklemelerin hepsi aynı süre ve etiketle geldiği için monitör beklemeyi **arkasından geldiği aksiyonla** tanır (`action.after = { type, label, target }`; edge'in başındaki bekleme için `null`; süre de `action.target = "wait:10"` olarak saklanır). Aynı aksiyon edge'de birden çok kez olabilir (sihirbazda iki "İleri" tıklaması): bekleme o aksiyondan sonra gelen beklemeler içindeki sırasıyla da saklanır (`nth`, 0'dan), o beklemelerin sayısıyla (`count`) ve süresi + aksiyonun etiketi kendisiyle aynı olanların sayısıyla (`alike`, kendisi dahil). Eşleştirme (`resolveWaitAction`): aynı aksiyondan (tür + hedef) sonra gelen beklemeler aday olur; aday sayısı kayıttakiyle aynıysa aynı sıradaki; sayı değiştiyse (bekleme ya da aksiyonu eklendi / silindi) yalnızca ikizi olmayan bekleme (`alike` 1) süresi ve aksiyonun etiketiyle bulunur; yine belirsizse "aksiyon bulunamadı": monitör sessizce başka bir beklemeye kaymaz (issue #5). Bağlı bekleme silinirse bulunamadı; süresi ✎ ile değişirse yine bulunur; önündeki aksiyonlar silinse de (aynı aksiyon edge'de iki kez olsa da) bağ kopmaz. Sırası kaydedilmemiş ilk sürüm kayıtları (`nth` yok) yalnızca tek adaysa bulunur; form monitörü yeniden kaydedince sırası da yazılır. Kontrol sayfa durulduktan sonra yapılır (Emir'in `afterAction`'ı `settled` bekler); içerik bekleme bittikten sonra hâlâ yükleniyorsa "yükleniyor" durumu görülür, beklenen de budur.

---

## Ekrana bakmayan monitörler: JavaScript Error ve Action Timeout

Öbür türler bir soruyu **ekrana** sorar: "şu an şu metin var mı, şu alanın değeri ne?". İki tür ise ekranda görünmeyene bakar: oynatma **sırasında** olana.

- Bir düğmeye basılır, hiçbir şey olmaz. Ekran aynıdır, ekrana bakan hiçbir kural bozulmaz; ama tarayıcının konsolunda kırmızı bir hata vardır. **JavaScript Error** bunu yakalar.
- Sayfa doğru ekrana varır ama 8 saniye sonra. Varılan ekran yine doğrudur. **Action Timeout** bunu yakalar.

Bu iki tür sayfaya soru sormaz; veri oynatma boyunca panelde toplanır ve kontrol anında ondan sonuç çıkarılır (`monitor-types.js`'te `side: 'replay'`; `monitor-run.js > OYNATMANIN KENDİ VERİSİ`). Bu yüzden **yalnızca "Koşuyu oynat"ta** kontrol edilirler; "Bu ekranda şimdi kontrol et" onları atlar.

### JavaScript Error (olay tabanlı)

**Ne yakalar.** Sayfada yakalanmayan JavaScript hataları: `throw` ile atılıp kimsenin yakalamadığı hata ve reddedilip yakalanmayan Promise; tarayıcının konsolunda kırmızı "Uncaught …" satırı olarak görünenler. Kullanıcı bir beklenti tarif etmez: hata olmamalıdır.

**Nasıl.** Oynatma sekmeye zaten DevTools protokolüyle bağlıdır (fare ve klavye için; replay.js > `attach`). Koşuda JavaScript Error monitörü varsa aynı bağlantıdan sekmenin `Runtime` alanı açılır; tarayıcı o andan sonra her yakalanmayan hatayı olduğu anda bildirir (`Runtime.exceptionThrown`). Hata, o an oynatılan adıma yazılır. Koşuda bu türden monitör yoksa hiçbir şey açılmaz.

**Ne zaman kırmızı.** Sonuca her aksiyondan sonra (sayfa durulunca) ve adımın sonunda bakılır:

- Hata varsa **o aksiyondan hemen sonra** kırmızı yanar; görüntü o anda alınır ve uyarının yeri aksiyonu söyler (`Adım 1 (e_Devam → v_Odeme) · aksiyon 1/8: Sepete ekle`).
- Son aksiyondan sonra, beklenen ekran beklenirken gelen hata adımın sonunda yakalanır.
- Hata yoksa yeşil sonuç adımın sonunda yazılır ("JavaScript hatası yok").
- **Edge'in bir aksiyonuna bağlı** monitör yalnızca o aksiyon oynatılırken gelen hatalara bakar; önceki aksiyonların hatası onu bozmaz. **Node'a bağlı** monitör o node'a varan adıma bakar; ekrana bakmadığı için node'a varılamasa da değerlendirilir.

Kırmızı satırda konsoldaki hata ve atıldığı yer yazar: `JavaScript hatası: "Uncaught TypeError: Cannot read properties of undefined (reading 'value')" (main.js:12:5)`. Yer: dosya adı, satır ve sütun (sayfanın kendi içindeki kodda sayfanın adı). Birden çok hata varsa sayısı ve ilki yazar.

**Sayılmayanlar.**

- *Oynatmadan önceki hatalar.* `Runtime` alanı açılınca tarayıcı sayfanın eski hatalarını da yeniden bildirir (zaman damgalarıyla); koşu başlamadan önce olanlar bu koşunun değildir. Başlangıç sayfası yüklenirken atılan hata da böyledir: oynatma başlangıç sayfasını kendisi yüklemez.
- *Eklentilerin kendi kodundaki hatalar* (content script'ler: bu eklenti ya da kullanıcının başka eklentileri). Sayfanın hatası değildir; çalışma ortamından (sayfanın kendi dünyası olmayan ortam) ve dosya adresinden (`chrome-extension://`) tanınır.
- *Sonradan yakalanan Promise reddi:* tarayıcı hatayı geri alır (`Runtime.exceptionRevoked`).
- *Yok sayma desenine uyanlar* (isteğe bağlı parametre). Desen hata satırında ve dosya adresinde aranır, büyük/küçük harf fark etmez; ör. `ResizeObserver|analytics` zararsız bilinen bir uyarıyı ve üçüncü parti bir dosyayı eler. Sayılmayan hata sayısı sonuçta yazar ("1 hata yok sayıldı: desene uyuyor").

**Sınırlar.** Başka siteden gelen iframe'lerin ve worker'ların hataları görülmez (tarayıcıda ayrı hedeflerdir; aynı siteden gelen iframe görülür). `console.error` ile yazılan mesajlar ve yüklenemeyen kaynaklar (404 olan resim ya da script) hata atmaz; sayılmaz. Sayfa hatayı kendisi bastırıyorsa (`window.onerror` "hallettim" diyorsa) hata konsolda da görünmez; o da sayılmaz. Adım başına en fazla 100 hata saklanır. Desenin harf duyarsızlığı Türkçe İ / ı çiftini kapsamaz (hata mesajları çoğunlukla İngilizcedir).

### Action Timeout (süre tabanlı)

**Ne ölçer.** Bir aksiyonun süresi: aksiyon başladıktan sonra testin devam edebilmesine kadar geçen süre. Üç parçadan oluşur; her biri Emir'in ilgili fonksiyonunun çevresinde ölçülür:

| Parça | Fonksiyon (replay.js) | Ne |
|---|---|---|
| `play` | `playAction` | Aksiyonun oynatılması: elementin ekrana gelmesini beklemek ve aksiyonu yapmak. |
| `settle` | `afterAction` | Aksiyondan sonra sayfanın durulması: yükleme ve DOM'un durması. |
| `arrival` | `verify` | Son aksiyondan sonra beklenen ekranın gelmesi. |

Kayıt her aksiyonun arkasına bir bekleme koyar (otomatik bekleme) ve test ancak o beklemenin ardından sayfa yeniden durulunca devam eder. Bir aksiyonun süresi bu yüzden: kendi `play` + `settle`'ı, ardından gelen beklemelerin `settle`'ı ve (son aksiyonsa) `arrival` (`monitor-run.js > actionTimes`).

**Kural aksiyon başınadır:** hiçbir aksiyon sınırdan uzun sürmemeli. Adımın toplam süresine sınır konmaz: toplam, edge'deki aksiyon sayısıyla büyür (on alanlı bir form hızlı bir sayfada da uzun sürer); takılan sayfa ise tek bir aksiyonu uzatır. Toplam yine de yeşil sonuçta yazar.

**Ne zaman kırmızı.** Her aksiyondan sonra bakılır; bir aksiyonun süresi sınırı aştıysa o anda kırmızı yanar (süre artık kısalmaz): `süre aşıldı: aksiyon 5/6 "Login" 5,6 sn sürdü (sınır 5 sn)`. Hiçbiri aşmadıysa yeşil sonuç adımın sonunda yazılır: `en uzun aksiyon 1,2 sn sürdü (aksiyon 5/6 "Login"; sınır 5 sn) · adım toplam 2,6 sn`. Ayrıca:

- **Adım yarıda kalırsa** (element 10 sn beklenip gelmedi, sayfa yüklenmedi) Emir'in oynatması adımı "kaldı" sayar. Süre o ana kadar sınırı aştıysa monitör de kırmızıdır (`… 10,1 sn sürdü ve adım tamamlanamadı`): takılan sayfa çoğu zaman tam böyle biter. Aşmadıysa "adım tamamlanamadı" (kırmızı değil).
- **Beklenen ekrana varılamazsa** son aksiyonun süresi bitmemiştir: sınır aşıldıysa kırmızı (`… sonrası 11,4 sn geçti ve beklenen ekrana varılamadı`), aşılmadıysa değerlendirilmez.
- **Aksiyona bağlı** monitör yalnızca o aksiyonun süresine bakar. Bir **beklemeye** bağlanamaz (form reddeder): beklemenin süresi kayıttan gelir.

**Sayılmayanlar** (sayfanın değil, kaydın ya da oynatmanın süresi):

- Kayıttaki bekleme aksiyonunun kendisi: süresi kayıttan gelir, her oynatmada aynıdır. Uzun bir bekleme varsa sonuçta belirtilir ("kayıttaki 3 sn bekleme sayılmadı"). Beklemeden sonraki durulma sayılır.
- **Yavaş** oynatmanın eklediği süreler: elementin çerçevelenmesi (0,5 sn) ve aksiyonlar arasındaki ara (0,4 sn). Monitör iki hızda da çalışır.
- Monitörlerin kendi kontrolleri (sayfaya sorma, görüntü alma).

**Sınırı seçmek.** Ölçülen, oynatmanın gördüğü süredir. Oynatma her aksiyondan ve her beklemeden sonra sayfanın 0,3 sn sessiz kalmasını bekler (durulma); en hızlı sayfada bile bir aksiyon bu yüzden **0,7–1 sn** sürer. Sınır kaba seçilmelidir: alt sınırı 2 sn, varsayılanı 5 sn'dir.

- Sürekli değişen sayfada (dönen bir karusel, ekrandaki saat) durulma en fazla 3 sn bekler ve bu süre ölçüme girer; böyle sayfalarda sınır büyütülmelidir.
- Yavaş oynatmada düşülen aralarda sayfa çalışmaya devam eder; ölçüm normal hıza göre biraz kısa çıkabilir.
- Ölçümün koşudan koşuya ne kadar oynadığını görmek için aynı senaryo birkaç kez oynatılıp yeşil sonuçlardaki süreler karşılaştırılabilir.

### Uyarıda ne işaretlenir: aksiyonun elementi

Bu iki türde ekranda "bozulan" bir element yoktur. Uyarı, ilgili **aksiyonun elementini** gösterir: hatanın oluştuğu tıklamanın düğmesi, sınırı aşan aksiyonun alanı. Pencerenin başlığı "Aksiyonun elementi"dir; satırda neden gösterildiği yazar ("hata bu aksiyon oynatılırken oluştu", "süresi sınırı aşan aksiyon"). Görüntüdeki kutu ve liste [Hata yeri](#hata-yeri-bozulan-elementin-işaretlenmesi) bölümündeki yapının aynısıdır.

Element, aksiyon oynatılmadan **önce** sayfada akılda tutulur (`MONITOR_KEEP`) ve monitör bozulunca yeri o elementten ölçülür (`MONITOR_LOCATE`; monitor-probe.js > AKSİYONUN ELEMENTİ). Aksiyondan sonra kayıttaki hedefle yeniden aramak yanlış elementi bulabilirdi: hedef "bu türün ekrandaki n'incisi"dir; tıklanan "Sepete ekle" düğmesi "Çıkar" olunca "1. Sepete ekle" artık bir sonraki ürünün düğmesidir. Yanlış elementi göstermektense element göstermemek yeğlenir:

- Aksiyonun elementi yoksa (bekleme, sayfaya gitme) ya da element artık ekranda değilse (tıklama başka sayfaya götürdü) uyarıda element olmaz; pencere nedenini söyler. Görüntü yine vardır.
- Hata bir bekleme sırasında yakalandıysa (kayıt her aksiyonun arkasına bekleme koyar) ondan önceki aksiyonun elementi gösterilir.

---

## Senaryoya özel monitörler

Ana graph'ta tanımlanan monitör, o node'dan ya da edge'den geçen **bütün** senaryolarda kontrol edilir; bu bir **genel kuraldır** ("hiçbir ekranda 500 hatası olmasın", "4 pt'den küçük yazı yok"). Bazı beklentiler ise senaryoya aittir: aynı login edge'inden geçen "geçerli kullanıcı → Products görünmeli" ve "geçersiz kullanıcı → hata mesajı görünmeli" senaryoları için ayrı beklenti gerekir. Bunun için bir senaryonun sekmesine geçilir (üstteki sekme şeridi; panel.js > GÖRÜNÜM) ve monitör **orada** eklenir:

- **Nereye bağlanır:** senaryo monitörü senaryonun kendi graph'ına (kopyaya; scenario.js > `scenarioSnapshot`) bağlıdır. Formdaki node, edge ve aksiyon listeleri kopyadan gelir; "Tüm model" seçeneği **Bu senaryonun tamamı** olur (senaryonun her node'unda). Ana graph kopyadan sonra değişse de monitör yerinde kalır; oynatma da kopyayı oynattığı için ikisi aynı şeye bakar. Kopya ana graph'ın tamamıdır: koşuların geçmediği bir node'a ya da edge'e de senaryo monitörü eklenebilir (koşu oradan geçmedikçe kontrol edilmez). Koşular düzenlenince ya da "Ana graph'tan yenile" denince kopya yeniden alınır; node ve edge id'leri korunduğu için monitörler bağlı kalır. Ana graph'tan silinen bir öğe kopya yenilenince düşer, monitörü sahipsiz görünür ("senaryonun graph'ında yok").
- **Liste:** senaryo sekmesinde Monitörler bölümü iki gruptur. **Bu senaryonun monitörleri** eklenir, düzenlenir, silinir, kapatılır; **Genel kurallar** `Genel` etiketiyle salt okunur listelenir (ana graph'ın monitörleri; Ana graph sekmesinde düzenlenir). Detay kartındaki alt bölüm de ikisini birlikte gösterir (`Senaryo` / `Genel` etiketleriyle); sağ tık menüsü ve butonlar o senaryoya ekler (`"v_Products" node'una bu senaryo için monitör ekle`, **Bu senaryoya monitör ekle**). Ana graph sekmesinde liste yalnızca genel kurallardır; senaryolara özel monitör varsa altta bir not sayar (`Ayrıca senaryolara özel 3 monitör var (Giriş: 2, Sepet: 1)`). Mor hale senaryo sekmesinde senaryonun monitörlerini de kapsar.
- **Oynatma:** "Koşuyu oynat" denince ışık listesinde genel kurallar ve oynatılan senaryonun monitörleri birlikte yanar; her satır `Genel` ya da `Senaryo` etiketlidir, başlık ikisini sayar (`4 monitör (2 genel, 2 senaryo) · 1 kırmızı · 3 yeşil`). Başka senaryonun monitörleri listede yoktur. Uyarılar aynı yapıya yazılır (`monitor-alarms:<graph id>`, monitör id'siyle). **Bu ekranda şimdi kontrol et** senaryo sekmesinde genel kuralları ve o senaryonun monitörlerini birlikte kontrol eder.
- **Senaryo indir:** senaryo dosyasındaki kopyada her node ve edge'in `monitors: []` yuvası o senaryonun o öğeye bağlı monitörleriyle dolu çıkar; tamamı (senaryonun tamamı kapsamlılar dahil) dosyanın `monitors` alanındadır (bkz. Veri modeli). Storage'daki kopya değişmez.
- **Yedek ve silme:** graph yedeği senaryo monitörlerini de taşır (`scenarioMonitors`, senaryo id'siyle); yüklenince aynı id'li senaryolara geri gelirler. Senaryo silinince monitörleri de silinir; "Sıfırla" senaryolarla birlikte onları da düşürür (genel kurallar sahipsiz kalır, bkz. Kavramlar). Graph silinince anahtar silinir.
- **Senaryo yükle:** Senaryo kartındaki **Yükle…** dosyayı yeni bir senaryo olarak ekler (Emir'in yükleyicisi yeni bir senaryo id'si verir); dosyanın `monitors` alanındaki monitörler bu yeni senaryonun listesine yeni id'lerle eklenir, mesaj sayısını söyler ("Dosyadaki 2 monitör de yüklendi"). Öğesi bu graph'ta olmayan monitör sahipsiz gelir, bilinmeyen tür atlanır. Dosya bu graph'la yürünemediği için reddedilirse ne senaryo ne monitörleri eklenir.

---

## Oynatmada kontrol

"Koşuyu oynat" (panel.js > PANELDE OYNATMA, replay.js) sırasında `monitor-run.js` devreye girer:

1. **Koşu başlarken** koşuda geçerli etkin monitörler seçilir: tüm model olanlar, koşudaki bir edge'e bağlı olanlar, koşunun vardığı bir node'a bağlı olanlar; genel kurallar ve oynatılan senaryonun kendi monitörleri birlikte (Emir'in `startReplay`'e verdiği `scenario: { id, graph }`; bkz. [Senaryoya özel monitörler](#senaryoya-özel-monitörler)). (Koşunun yalnızca başlangıç node'u olan bir node'a varılmaz; onun monitörleri bu koşuda listelenmez.)
2. **Her aksiyondan sonra** (sayfa durulunca) aksiyon tabanlı Input Validation alana bakar: yazılan değer o anda alandadır. **Edge'in o aksiyonuna bağlı monitörler** (hangi türden olursa olsun) de şimdi, yalnızca burada kontrol edilir; aksiyon edge'de artık yoksa (Emir'in edge kartından silinmişse) "aksiyon edge'de bulunamadı" (ışık kırmızı olmaz). Alan ekranda yoksa önceki sonuç korunur. Bozulduysa **görüntü bu anda alınır** ve uyarı kaydedilir; oynatma bir sonraki aksiyona (ör. Login tıklaması) bu bitmeden geçmez. Adımda ilk bozulma anı kalır; sonraki aksiyonlar sonucu değiştirmez. Ekrana bakmayan JavaScript Error ve Action Timeout da her aksiyondan sonra değerlendirilir: o ana kadar yakalanan bir hata ya da sınırı aşan bir aksiyon varsa o anda bozulur ([ayrıntı](#ekrana-bakmayan-monitörler-javascript-error-ve-action-timeout)).
3. **Her adımın sonunda,** varılan ekran beklenen node ile karşılaştırıldıktan sonra (replay.js > `verify`): o adımda geçerli monitörler (tüm model + varılan node'unkiler + oynatılan edge'inkiler) sayfaya sorulur (`MONITOR_PROBE`, monitor-probe.js). Ekran beklenen node değilse (adım kalacak) node monitörleri kontrol edilmez ("node'a varılamadı"); tüm model ve aksiyon monitörleri yine de kontrol edilir. Bozulan monitörler için varılan ekranın görüntüsü alınır ve uyarı kaydedilir. Ekrana bakmayan monitörlerin temiz sonucu da burada yazılır; ekrana bakmadıkları için node'a varılamasa da değerlendirilirler.
4. **Adım yarıda kalırsa** (aksiyon oynatılamadı: element gelmedi; sayfa yüklenmedi) Emir'in oynatması adımı "kaldı" sayar ve `verify`'ı çağırmaz. Ekrana bakan monitörler "adım tamamlanamadı" olur; ekrana bakmayanlar o ana kadar toplanan veriyle değerlendirilir (yakalanan hatalar; sınırı çoktan aşmış süre).
5. **Koşu bitince** oynatılmayan adımlar "adım oynatılmadı" diye not edilir, her monitörün genel sonucu Monitörler listesine **Son kontrol** olarak yazılır.

**Uyarılar: monitörün kendi ekran görüntüsü yapısı.** Bir monitör bozulduğunda görüntü (`chrome.tabs.captureVisibleTab`, node görüntüleriyle aynı biçim: jpeg, kalite 40) *bozulma anında* alınır: aksiyon tabanlı monitörde alana yazıldıktan hemen sonra, state tabanlı monitörde varılan ekranda. Adımın sonunu beklemek yanlış ekranı gösterirdi: Input Validation kullanıcı adı yazılınca bozulur ama adımın sonunda Login'e basılmış, ürün sayfası açılmıştır. Görüntü graph'ın node görüntülerine yazılmaz; uyarı olarak monitörün kendi anahtarında saklanır (`monitor-alarms:<graph id>`, bkz. Veri modeli): zaman, kaynak (oynatma / şimdi kontrol), yer (`Adım 2 (e_Devam → v_Sepet) · aksiyon 1/3: Fill Telefon`), neden, adres, görüntü. Monitörler listesinde her monitörün **Uyarılar (n)** düğmesi listeyi açar (en yenisi üstte; "Uyarıları temizle" iki adımlı); son kontrol kırmızıysa son uyarının küçük görüntüsü satırda da görünür. Graph başına son 20 uyarı tutulur. "Bu ekranda şimdi kontrol et"te bozulan monitörler de görüntülü uyarı yazar. Uyarı, bozulan **elementi** de saklar ve görüntünün üstünde işaretler: bkz. [Hata yeri](#hata-yeri-bozulan-elementin-işaretlenmesi).

**Işık listesi** (oynatma kartında, adım listesinin altında): başlıkta sayım (`3 monitör · 1 kırmızı · 2 yeşil`, sürerken "kontrol ediliyor"). Her satırda:

- **LED:** yalnızca iki renk. Herhangi bir adımda bozuldu → kırmızı; yoksa yeşil (koşu başlarken de yeşil: "şimdiye kadar bozulma yok").
- Ad ve kapsam; **adım izi:** her adım için bir kare (yeşil / kırmızı; henüz oynatılmamış adım boş); üzerine gelince o adımın sonucu, bozulan adıma tıklayınca ekran görüntüsü.
- **Ayrıntı:** bozulduysa ilk bozulan adım ve nedeni (`Adım 2 (e_Devam → v_Sepet): değer "03121234567" desene uymuyor`), bozulmadıysa kaç adımda kontrol edildiği ve son adımın özeti (`4 metin ölçüldü, en küçüğü 10,5 pt`), kontrol edilemediyse nedeni (`Kontrol edilemedi · Adım 1 (…): alan ekranda yok`).
- Bozulma anının **küçük ekran görüntüsü,** bozulan element kırmızı kutuyla işaretli; tıklayınca büyür (başlıkta adım ve varsa aksiyon: `Adım 2 (e_Devam → v_Sepet) · aksiyon 1/3: Fill Telefon`; altında bozulan elementin adı ve DOM'daki yeri).

Monitörler oynatmanın kendi sonucunu değiştirmez: adım geçti / kaldı kararı Emir'in doğrulamasıdır (edge set ve URL); monitör ışıkları ayrı listede durur. (Kırmızı monitörün koşuyu başarısız sayması runner raporunda uygulanacak; panelde oynatma bir inceleme aracı olduğu için kırmızı ışık yeterlidir.) **Durdur** basılınca sayfadan cevap beklenmez.

**Sınırlar:** sayfaya eklentinin content script'i yüklenmemişse (eklenti yüklenmeden önce açılmış sayfa, chrome:// sayfaları) kontrol yapılamaz; ışık yeşil kalır, satırda "sayfayı yenileyin" yazar. Sayfa 10 sn içinde cevap vermezse (donmuş sayfa, çok ağır bir desen) beklenmez: satırda "sayfa 10 sn içinde cevap vermedi" yazar, oynatma ve "şimdi kontrol et" askıda kalmaz. Ağır desenlere karşı: iç içe tekrar içeren desenler (`(\w+\s?)+` gibi) formda uyarılır (engellenmez), sayfada aranan metin 200 bin karakterle, yazı boyutunda gezilen metin düğümü 20 binle sınırlıdır.

---

## Hata yeri: bozulan elementin işaretlenmesi

Bir monitör bozulduğunda uyarı iki soruyu cevaplar: **hangi ekranda** (bozulma anının ekran görüntüsü) ve **ekranın neresinde** (bozulan element). Görüntü hatayı ekrana kadar yerelleştirir (*fault localization*); bozulan elementin kutusu aynı görüntünün üstünde işaretlenince hata elemente kadar iner.

**Panelde görünen.**

- **Küçük resimler** (ışık listesi, Monitörler listesindeki son uyarı, uyarı listesi): bozulan element kırmızı kutuyla işaretlidir; ipucunda adı yazar. Uyarı listesinin satırında ayrıca `Bozulan: input#user-name "Username"`.
- **"Bozulduğu andaki ekran" penceresi:** büyük görüntüde kutu ve etiketi; altında **Bozulan element** listesi. Satır, Ekrandaki elementler kartının ([01 > Ekrandaki elementler](01-mimari.md#ekrandaki-elementler-dom-ağacı)) satırıyla aynı biçimdedir: etiket, metin, parmak izi anahtarı (`input#user-name "Username" input:user-name`); altında **DOM'daki yeri** (`form › div#login › input#user-name`) ve parçaya özgü not (ölçülen yazı boyutu, benzerlik). Birden çok element numaralıdır; satırın üzerine gelince o elementin kutusu öne çıkar. Satıra ya da kutuya **tıklayınca görüntü o elemente yakınlaşır** (yan panel dar olduğu için görüntü küçülür; elementin çevresi böyle okunur, görüntü kaydırılabilir), yeniden tıklayınca eski haline döner. **Görüntüde işaretle** kutusu işaretleri kapatır: ham görüntü görünür.
- Element görüntüde yoksa (sayfanın aşağısında, kapalı bir menünün içinde) satırı yine listelenir, kutusu çizilmez ve nedeni yazar.

**Hangi türde ne işaretlenir.**

| Tür | Bozulan yer |
|---|---|
| Input Validation | Değeri desene uymayan **alan.** |
| Error Text | Desenin tuttuğu **her metin:** elementin tamamı değil, yalnızca o sözcükler (metin düğümünün içindeki aralık). Art arda tutan parçalar tek kutudur (`500` + `Internal Server Error` → "500 Internal Server Error"); `1500`'ün içindeki 500 gibi desenin tutmadığı yerler işaretlenmez. Metin birden çok elemente bölünmüşse (`Hata <b>kodu</b> 500`) hepsini içeren en içteki element. |
| Expected Text, "olmamalı" | Ekranda hâlâ duran **metin:** aynı şekilde yalnızca o sözcükler; düğme değerinde ya da yer tutucudaysa o alan. |
| Font Size | Alt sınırdan küçük **her metin parçası,** ölçülen boyutuyla ("3 pt"). |
| Expected Image, "olmamalı" | Parçanın bulunduğu **ekran bölgesi** (element değil: görüntü monitörü DOM'a bakmaz). |
| Expected Text / Image, "olmalı" | İşaretlenecek yer yoktur: beklenen şey ekranda **olmadığı** için bozulmuştur. Pencere bunu söyler; görüntü yine gösterilir. |
| JavaScript Error, Action Timeout | Ekranda bozulan bir element yoktur; **ilgili aksiyonun elementi** gösterilir (hatanın oluştuğu tıklamanın düğmesi, sınırı aşan aksiyonun alanı). Pencerenin başlığı "Aksiyonun elementi" olur. Bkz. [Uyarıda ne işaretlenir](#uyarıda-ne-işaretlenir-aksiyonun-elementi). |

**Nasıl çalışır.**

1. **Ölçüm, bozulma anında** (`monitor-probe.js > HATA YERİ`). Kuralın bozulduğuna karar veren kod, bozulan parçayı da bildirir: elementi ve kutusunu (`getBoundingClientRect`; metinde `Range.getClientRects`, satır kırılmışsa kutuların birleşimi). Ölçüm yalnızca bozulunca yapılır ve kararı etkilemez: yer bulunamazsa sonuç yine kırmızıdır, yalnızca element bilgisi eksik kalır. Sayfaya hiçbir şey çizilmez.
2. **Görüntüde görünen kısım** (`visiblePart`). Kutu, görünen alanla ve taşanı gizleyen (ya da kaydırılan) üst kutularla kesiştirilir; sabit ve mutlak konumlu kutuların bu kırpmadan ne zaman kurtulduğu hesaba katılır. Görünen kısmı olmayan element işaretlenmez ve nedeni saklanır (`above` / `below` / `left` / `right`, `clipped`, `unrendered`): kapalı bir menünün ya da sayfanın aşağısındaki bir yazının kutusu görüntüde başka bir şeyin üstüne düşerdi.
3. **Elementin adı** (`describeElement`). Etiket, metin ve anahtar Ekrandaki elementler ağacının satırıyla aynı kurallarla üretilir (alanda alanın adı, değeri asla; etkileşimli elementte parmak izi anahtarı): kullanıcı aynı elementi iki yerde aynı adla görür. Kural iki dosyada ayrı yazılıdır (`dom-tree.js > tagText, rowText` dosyanın kapanışı içindedir); eşlik testle korunur. DOM yolu, adı olan üst elementlerdir (id'siz sarmalayıcı `div` / `span` atlanır), en yakın altısı.
4. **Görüntüyle eşleme** (`monitor-locate.js > shownViewport`). Kutu CSS pikseli, görüntü ekran pikselidir; sayfa ayrıca bir CSS pikselinin görüntüde kaç piksel ettiğini bildirir (`ratio` = ekran ölçeği × tarayıcı yakınlaştırması × dokunmatik yakınlaştırma). Kural: **sayfadaki (x, y) noktası görüntüde sol üstten (x × ratio, y × ratio) pikselindedir.** Görüntünün gösterdiği alan bu yüzden sayfanın söylediği pencere boyutundan değil görüntünün kendisinden hesaplanır (`görüntü boyutu / ratio`) ve uyarıyla saklanır (`viewport`). Neden: oynatma, kayıttaki pencere boyutunu taklit eder ve üstte "hata ayıklama" çubuğu durur; sayfa değiştikten sonra alınan görüntü o zaman sayfanın yalnızca gerçekten görünen kısmıdır (ölçülenden kısa, dar ya da geniş). Kutuyu sayfanın `innerHeight`'ına oranlamak bu durumda kaydırırdı (53 px'lik çubukta yaklaşık %7); ölçek ise hiçbir durumda değişmez (düz ekran, 2× ekran, %150 ve %75 yakınlaştırma, dokunmatik yakınlaştırma, taklit edilen boyutun pencereden uzun / geniş / küçük olması ayrı ayrı ölçüldü).
5. **Çizim** (`monitor-locate.js`). Kutu, görüntünün yüzdesi olarak yerleşir: küçük resimde de büyük pencerede de, panel hangi genişlikte olursa olsun ve görüntü yakınlaştırılınca da aynı yerdedir.

**Çerçeve neden görüntüye gömülmüyor?** Kutular saklanan görüntünün üstüne çizilir, içine değil. Görüntü kanıt olarak olduğu gibi kalır (işaret kapatılıp altındaki yazı okunabilir), görüntü monitörünün eşlemesi bir çerçeveden etkilenmez ve sayfaya bir şey çizilmediği için ekran görüntüsüne ve kayda bir şey karışmaz. (Ekrandaki elementler kartının sayfadaki çerçevesi de aynı nedenle eklentinin başka her isteğinde kalkar.)

**Ekrandaki elementler kartıyla ilişkisi.** İkisi aynı soruya iki yönden bakar: kart *şu an* ekranda olan elementleri listeler ve seçileni canlı sayfada çerçeveler; uyarı *bozulma anındaki* ekranı ve o an bozulan elementi saklar. Element bu yüzden bozulma anında ölçülüp uyarıya yazılır; sonradan ağaçta aranmaz (sayfa çoktan değişmiş olabilir: Login'e basılmış, mesaj kaybolmuş). Satır biçimi ve çerçevenin görünümü bilerek aynıdır (kartta mavi, uyarıda kırmızı). Uyarıdaki elementten karttaki satıra kesin geçiş için bkz. [Sonraki adımlar](#sonraki-adımlar).

**Sınırlar.**

- Uyarı başına en fazla 10 element saklanır (önce görüntüde görünenler); kalanı sayılır ("4 element daha var").
- Üstü başka bir katmanla (pencere, yapışkan başlık) kapalı element ayırt edilmez; kutusu yerinde çizilir.
- Ölçüm ile ekran görüntüsü aynı an değildir (arası onlarca milisaniye). Element o sırada hareket ediyorsa (animasyonla gelen bir mesaj) kutu birkaç piksel kayabilir.
- Kontrolün baktığı yer neyse hata yeri de odur: yalnızca ana çerçeve (iframe'lerin ve shadow DOM'un içi kontrol edilmez; Ekrandaki elementler kartı da öyledir).
- Görüntü monitörünün "bölgesi" bir element değildir; adı ve DOM yolu yoktur.

---

## Veri modeli

**Panelde (chrome.storage.local, anahtar `monitors:<graph id>`).** Her graph'ın monitörleri kendi anahtarındadır ([04 > Storage: graph'lar](04-veri-modeli.md#storage-graphlar) düzenine paralel: `graph:<id>` ↔ `monitors:<id>`); graph state'inden ayrıdır, "Sıfırla" dokunmaz, eklenti yenilense de kalır, graph silinince anahtar da silinir.

**Uyarılar (anahtar `monitor-alarms:<graph id>`).** Monitörlerin bozulma anı kayıtları, ekran görüntüleriyle; tanımlardan ayrı tutulur ki tanımlar küçük kalsın ve dışa aktarıma (model, yedek) girmesin. Şekil: `{ format: "graph-recorder-monitor-alarms/v1", nextId, items: [{ id, monitorId, at, source: "replay" | "live", where, text, url, screenshot, step: { index, edgeId, target } | null, action: { index, count, label } | null, targets, more, viewport }] }`. `where` uyarı anında hesaplanmış metindir (graph sonradan değişse de okunur). Graph başına son 20 uyarı kalır; silinmiş monitörlerin uyarıları bir sonraki yazımda atılır; graph silinince anahtar da silinir.

Hata yeri alanları ([Hata yeri](#hata-yeri-bozulan-elementin-işaretlenmesi)):

```jsonc
"targets": [{                       // bozulan elementler (en fazla 10). []: bozulan yer bir element değil. null: bilinmiyor (eski uyarı)
  "tag": "input#user-name",         // Ekrandaki elementler satırıyla aynı: etiket · metin · anahtar
  "text": "Username",               // alanda alanın adı (değeri asla)
  "key": "input:user-name",         // etkileşimli elementte parmak izi anahtarı, değilse null
  "path": ["form", "div#login"],    // DOM'daki yeri: dıştan içe, adı olan üst elementler
  "rect": { "x": 120, "y": 180, "w": 300, "h": 40 },     // parçanın kutusu, CSS pikseli (görüntünün gösterdiği alana göre)
  "visible": { "x": 120, "y": 180, "w": 300, "h": 40 },  // görüntüde görünen kısmı; yoksa null
  "hidden": null,                   // visible null ise nedeni: above | below | left | right | clipped | unrendered
  "note": ""                        // parçaya özgü bilgi: "3 pt", "benzerlik %97"
}],
"more": 0,                                    // listeye sığmayan parça sayısı
"viewport": { "width": 1200, "height": 708 }  // görüntünün gösterdiği alan, kutularla aynı birimde; null: bilinmiyor (kutu çizilmez)
```

Görüntü monitöründe kutu ve alan görüntü pikselidir (aynı birim olmaları yeter: kutu alana oranlanır). Bu alanlar olmayan eski uyarılar okunur; yalnızca görüntüleri gösterilir.

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
- `action` (yalnızca edge kapsamında, isteğe bağlı): edge'in bağlanılan aksiyonu. Sıra (`index`) tek başına güvenilmez (Emir'in edge kartından aksiyon silinince kayar); bu yüzden tür, hedef anahtarı ve etiket de saklanır ve oynatmada aksiyon yeniden bulunur (önce kayıttaki sırada tür + hedef + etiket, sonra tür + hedef + etiket, sonra tür + hedef; hedefi olmayan aksiyonlar için tür + etiket). Hedef her kademede karşılaştırılır: aynı etiketli iki alan varken monitör öbür alana kaymaz. `null` / yok: edge'in tamamı. Dışa aktarımda edge'deki kopyaya da yazılır.
- `name`: kullanıcı ad verdiyse; `null` ise ad türden ve parametrelerden üretilir ("Input Validation · input:phone ~ /^0?5/").
- `severity`: arayüzde seçilmez, her bozulma kırmızıdır; alan veri uyumluluğu için `"error"` yazılır (eski ya da dışarıdan gelen `"warning"` de kabul edilir ve kırmızı yanar).
- Ekrana bakmayan türlerin parametreleri: `jsError` → `{ "ignore": "" }` (yok sayma deseni; boş: her hata sayılır), `actionTimeout` → `{ "maxSeconds": 5 }`.
- Kontrol sonuçları saklanmaz; oynatmanın sonucu gibi panel açıkken bellektedir. Oynatma sırasında yakalanan hatalar ve ölçülen süreler de öyledir (yalnızca bozulan sonucun metni uyarıya yazılır).

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

**Graph yedeğinde** ([04 > Graph yedeği](04-veri-modeli.md#graph-yedeği)) aynı liste `monitors: { format, items }` alanında taşınır (sahipsizler dahil, çünkü yedek graph'ın kendisidir). Background yedeği denetlerken bu alanı yok sayar; yükleme node ve edge id'lerini koruduğu için panel, yeni graph aktif olunca listeyi onun anahtarına yazar. Senaryoya özel monitörler `scenarioMonitors: { format, scenarios: { "<senaryo id>": [ … ] } }` alanındadır; yükleme senaryoları id'leriyle aldığı için aynı id'li senaryoya geri yazılırlar (senaryosu olmayan atlanır).

**Senaryoya özel monitörler (anahtar `scenario-monitors:<graph id>`).** Ana graph'ın listesinden ayrı bir anahtar; senaryo id'sine göre listeler. Kayıtların şekli genel monitörlerle aynıdır, ayrıca `scenarioId` taşırlar ve id'leri senaryo id'siyle başlar (`"s1abc.m1"`): uyarılar ve kontrol sonuçları aynı yapılarda, id çakışmadan durur. Boşalan liste silinmez (`nextId` sayması sürer; silinmiş bir monitörün id'si ve uyarıları yenisine geçmez); senaryo silinince listesi silinir. Kapsamdaki node / edge senaryonun kopyasında aranır (`scopeKind(scope, graph)`; monitor-store.js > `monitorGraphOf`).

```json
{
  "format": "graph-recorder-scenario-monitors/v1",
  "scenarios": {
    "s1abc": { "nextId": 2, "items": [
      { "id": "s1abc.m1", "type": "expectedText", "scope": "n2", "scenarioId": "s1abc",
        "params": { "text": "Products", "mode": "present", "caseSensitive": false },
        "severity": "error", "enabled": true, "name": null, "createdAt": "2026-11-01T09:00:00.000Z" }
    ] }
  }
}
```

**Senaryo dosyasında** ("Senaryo indir"; scenario.js > `SCENARIO_FORMAT`): kopyadaki her node ve edge'in `monitors` yuvası (scenario.js > `scenarioSnapshot`, storage'da hep `[]`) o senaryonun o öğeye bağlı monitörleriyle dolu yazılır; tamamı dosyanın `monitors: { format, items }` alanındadır (senaryonun tamamı kapsamlılar yalnızca burada). GraphWalker JSON'undaki düzenle aynı: liste tek doğruluk kaynağı, yuvalar kopya; sahipsizler yazılmaz. Runner bu alanları henüz okumaz.

```jsonc
{ "format": "graph-recorder-scenario/v1", "name": "Giriş", "runs": [ … ],
  "graph": { "start": "n1", "nodes": [{ "id": "n2", "name": "v_Products", "monitors": [ /* bu node'unkiler */ ] }], "edges": [ … ] },
  "monitors": { "format": "graph-recorder-monitors/v1", "items": [ /* senaryonun bütün monitörleri */ ] } }
```

**Sayfaya giden istek ve cevap** (`MONITOR_PROBE`):

```jsonc
// panel → sayfa
{ "type": "MONITOR_PROBE", "checks": [{ "id": "m2", "type": "fontSize", "params": { "min": 4, "unit": "pt" } }] }
// sayfa → panel
{ "url": "…", "title": "…", "viewport": { "width": 1200, "height": 761, "ratio": 1 },
  "results": { "m2": { "status": "fail", "text": "1 metin 4 pt'den küçük: \"Gizlilik sözleşmesi\" 3 pt",
                       "targets": [{ "tag": "small", "text": "Gizlilik sözleşmesi", "key": null, "path": ["footer"], "rect": { … }, "visible": { … }, "hidden": null, "note": "3 pt" }], "more": 0 } } }
```

`status`: `ok` | `fail` | `skip`; `text` kullanıcıya gösterilir. Işık panelde belirlenir: `fail` kırmızı, `ok` ve `skip` yeşil (skip'in nedeni satırda). `targets` / `more` yalnızca bozulan sonuçta vardır; `viewport` sayfanın ölçtüğü alan ve piksel oranıdır (panel bunu alınan görüntüyle eşler, bkz. [Hata yeri](#hata-yeri-bozulan-elementin-işaretlenmesi)).

**Aksiyonun elementi** (`MONITOR_KEEP` / `MONITOR_LOCATE`; yalnızca adımda ekrana bakmayan bir monitör varken, bkz. [Uyarıda ne işaretlenir](#uyarıda-ne-işaretlenir-aksiyonun-elementi)):

```jsonc
// aksiyon oynatılmadan önce, panel → sayfa: elementi akılda tut (ref: kayıttaki aksiyonun hedefi)
{ "type": "MONITOR_KEEP", "id": "<koşu>:<adım>:<aksiyon>", "ref": { "target": { "key": "button:add", "index": 1 }, "selector": "#add" } }
// sayfa → panel
{ "kept": true }
// monitör bozuldu, panel → sayfa: o element şimdi nerede?
{ "type": "MONITOR_LOCATE", "id": "<koşu>:<adım>:<aksiyon>" }
// sayfa → panel (element artık ekranda değilse targets [])
{ "viewport": { "width": 1200, "height": 761, "ratio": 1 }, "targets": [{ "tag": "button#add", "text": "Sepete ekle", … }], "more": 0 }
```

---

## Eklentiyle bütünleşme

Monitörler on yeni dosyadır; eklentinin kendi dosyalarında yalnızca `panel.html`'e dokuz satır (stil ve sekiz script) ve `manifest.json`'daki content script listesine bir dosya adı eklenmiştir. Panel tarafı tek dosya yerine göreve göre bölünmüştür; dosyalar klasik script'tir ve birbirlerinin global fonksiyonlarını çağırır (modül yok: panel.js de öyle), yükleme sırası aşağıdaki tablo sırasıdır.

| Dosya | Görev |
|---|---|
| `sidepanel/monitor-types.js` | Tür kataloğu: gruplar ve ikonları, kontrol biçimleri, her türün parametreleri (hazır desenler, element listesi işareti), kapsam kısıtı, doğrulama (`monitorParamProblem`), otomatik ad (`monitorAutoName`), özet cümlesi (`monitorSentence`). Arayüz içermez. |
| `sidepanel/monitor-store.js` | Veri: `monitors:<graph>`, `scenario-monitors:<graph>` ve `monitor-alarms:<graph>` anahtarları (okuma, normalize, yazma), uyarı ekleme / temizleme, kapsam ve aksiyon yardımcıları (`scopeKind`, `isOrphan`, `resolveMonitorAction`, `scopeText`…), senaryo monitörleri (`scenarioCopy`, `monitorGraphOf`, `monitorScenarioView`, `newMonitorId`), graph değişince yükleme, silinen graph'ın anahtarlarını ve silinen senaryonun monitörlerini temizleme. Arayüz içermez (hata mesajı dışında). |
| `sidepanel/monitor-locate.js` | Hata yeri: bozulan elementin (ekrana bakmayan monitörde ilgili aksiyonun elementinin) ekran görüntüsünde işaretlenmesi. Kutunun görüntüdeki yeri (`faultBoxPlace`), görüntünün gösterdiği alan (`shownViewport`), küçük resim (`shotThumb`), "Bozulduğu andaki ekran" penceresinin gövdesi (kutular, bozulan elementlerin listesi, işaret anahtarı, elemente yakınlaşma). Saf kısmı DOM'suz test edilir. |
| `sidepanel/monitor-list.js` | Monitörler bölümü (liste, filtreler, Son kontrol, Uyarılar düğmesi; senaryo sekmesinde iki grup ve `Genel` / `Senaryo` etiketleri), node / edge detayındaki alt bölüm, graph'ta sağ tık menüsü ve mor hale, silme / geri alma / tümünü silme, uyarı listesi ve "Bozulduğu andaki ekran" pencereleri. |
| `sidepanel/monitor-dialog.js` | İki adımlı ekle / düzenle formu: tür kartları, kapsam (node / edge / edge'deki aksiyon; senaryo monitöründe listeler kopyadan, "Bu senaryonun tamamı"), tanımdan üretilen parametre alanları (element listesi, hazır desenler, canlı deneme, ağır desen uyarısı), özet cümlesi, doğrulama, kaydedilmemiş değişiklik uyarısı. |
| `sidepanel/monitor-export.js` | GraphWalker JSON'una yazma (`graphWalkerModel` sarmalanır), "Yükle…" ile içe aktarma (parametre doğrulamalı), graph yedeğine yazma ve yedekten geri yükleme (senaryo monitörleri dahil), senaryo dosyasında yuvaların doldurulması (`downloadJson` sarmalanır) ve dosya yüklenince monitörlerin yeni senaryoya eklenmesi (`createScenario` sarmalanır). |
| `sidepanel/monitor-image.js` | Görüntü monitörü (`expectedImage`): sekmenin ekran görüntüsünü alma ve çözme, parçayı görüntüde arama (`findImage`: çapa ön elemesi + benzerlik; ölçekler), uyarı için jpeg; "Ekrandan seç" penceresi (görüntü sığdırılarak çizilir, fareyle seçim, önizleme, Kullan / Yeniden çek). Saf kısmı (`findImage`, `needleAnchors`) DOM'suz test edilir; pencere ilk açılışta kurulur. |
| `sidepanel/monitor-run.js` | Oynatmada kontrol: koşunun monitörleri, aksiyon ve adım sonu kontrolleri, bozulma anında görüntü ve uyarı (bozulan elementle; ölçülen alan görüntüyle eşlenir), ışık listesi; "Bu ekranda şimdi kontrol et". Kontrol listesini sayfada / panelde / oynatmanın verisinde kontrol edilenlere ayırır. Ekrana bakmayan monitörler: oynatma sırasında yakalanan JavaScript hataları (`chrome.debugger` olayları), ölçülen aksiyon süreleri, değerlendiriciler (`REPLAY_CHECKS`), aksiyonun elementinin akılda tutulması. Saf karar fonksiyonları (`thrownError`, `jsErrorVerdict`, `actionTimes`, `timeoutVerdict`) DOM'suz test edilir. |
| `monitor-probe.js` | Content script: panelden gelen kontrol listesini sayfada değerlendirir (`inputValidation`, `expectedText`, `errorText`, `fontSize`); bozulan sonuçta bozulan elementi bulur ve ölçer (HATA YERİ). Ekrana bakmayan monitörler için aksiyonun elementini akılda tutar ve yerini ölçer (AKSİYONUN ELEMENTİ). fingerprint.js'in tanımlarını kullanır. |
| `sidepanel/monitors.css` | Yalnızca monitörlere özgü stiller; renkler `panel.css`'teki tema değişkenlerinden gelir. |

`monitor-*.js` dosyaları `panel.js` ve `replay.js`'ten **sonra** yüklenir ve onların global'lerini okur (`state`, `activeGraph()`, `scenarioView`, `scenario`, `scenarioGraphOf`, `scenarioSnapshot`, `selectedId`, `renderDetails`, `cy`, `nodeById`, `showMessage`, `ACTION_TEXT`, `replay`, `shownReplay`, `capture`, `REPLAY_PAUSE_MS`); `panel.js`, `replay.js`, `scenario.js`, `background.js`, `content.js` değişmez. Bağlantı noktaları:

- **Bölümler:** `#monitors` bölümü Senaryo'nun (`#scenario`) hemen altına, alt bölüm node / edge detay kartının (`#details`) sonuna, ışık listesi oynatma kartındaki adım listesinin (`#replay-steps`) altına, sağ tık menüsü ve pencereler `body`'ye script tarafından eklenir.
- **Seçim ve sağ tık:** `cy.on('tap')` dinleyicisi panel.js'inkinden sonra çalışır (`selectedId` günceldir); sağ tık `cy.on('cxttap')` ile alınır, `#graph` üzerinde tarayıcının kendi menüsü engellenir. Menüden "ekle" seçilince öğe graph'ta doğrudan seçilir (`selectedId` + `renderDetails`; sahte bir tap olayı gönderilmez, çünkü senaryo "Elle seç"teyken panel.js tıklamayı koşuya ekleme sayar) ve form açılır.
- **Graph yeniden çizimi:** panel.js elementleri silip yeniden eklediğinde (`cy` `add` olayı) ve tema değişince (`themechange`; panel.js stil setini baştan yükler) mor hale yeniden uygulanır (node'da ve edge'de `underlay`).
- **Sarmalanan global fonksiyonlar** (`x = () => … orijinal() …`; fonksiyonlar adlarıyla çağrıldığı için sarmalanan sürüm kullanılır). İstenirse her biri ilgili fonksiyonun içine tek satırlık bir çağrı olarak da alınabilir:
  - `graphWalkerModel` (panel.js): dışa aktarıma monitörler eklenir.
  - `graphBackup` (panel.js): yedeğe monitörler (senaryo monitörleri dahil) eklenir.
  - `downloadJson` (panel.js): "Senaryo indir" dosyasında kopyanın `monitors` yuvaları doldurulur; başka dosyalara dokunulmaz.
  - `createScenario` (panel.js): Senaryo kartındaki "Yükle…" ile oluşan senaryoya dosyadaki monitörler eklenir. Dosya kutusu (`#scenario-file`) capture aşamasında okunur; monitörler yalnızca koşuları dosyadakiyle aynı olan senaryoya yazılır (dosya reddedildiyse bir sonraki "Yeni senaryo"ya geçmez).
  - `startReplay` (replay.js): koşu başlarken monitörler seçilir (genel + `options.scenario`'nun kendi monitörleri), koşu bitince sonuçlar toplanır.
  - `verify` (replay.js): adımın sonunda, ekran doğrulandıktan sonra monitörler kontrol edilir (await; oynatma sonraki adıma sonra geçer). Beklenen ekranın gelmesinin süresi ölçülür.
  - `afterAction` (replay.js): aksiyon bitince aksiyon tabanlı Input Validation, edge'in o aksiyonuna bağlı monitörler ve ekrana bakmayan monitörler kontrol edilir. Sayfanın durulmasının süresi ölçülür.
  - `attach` (replay.js): oynatma bir sekmeye bağlanınca, koşuda JavaScript Error monitörü varsa o sekmenin hataları dinlenmeye başlar (`Runtime.enable`); yoksa hiçbir şey yapılmaz.
  - `playAction` (replay.js): aksiyonun oynatılma süresi ölçülür; adımda ekrana bakmayan bir monitör varsa aksiyonun elementi önce sayfada akılda tutulur. Aksiyon oynatılamazsa o ana kadar toplanan veri değerlendirilir; hata olduğu gibi geri verilir (Emir'in oynatması aynı davranır).
  - `inPage` (replay.js): yavaş oynatmada elementin çerçevelendiği süre (istekteki `highlight`) aksiyonun ölçülen süresinden düşülür; isteğe ve cevabına dokunulmaz.
  - `renderReplay` (panel.js): oynatma kartı her çizildiğinde ışık listesi de çizilir / gizlenir (başka koşuya geçilince gizlenir).
- **Hata olayları:** `chrome.debugger.onEvent` dinlenir (oynatmanın kendi bağlantısı; ek izin gerekmez). Yalnızca süren koşunun dinlediği sekmelerin `Runtime` olayları işlenir; koşuda JavaScript Error monitörü yoksa `Runtime` alanı hiç açılmaz.
- **Sayfa:** `MONITOR_PROBE`, `MONITOR_KEEP` ve `MONITOR_LOCATE` mesajları content.js'in dinleyicisinde tanınmaz (cevap vermez), monitor-probe.js cevaplar. content.js'in kendi `MONITOR` mesajıyla (ekranı izleme) ilgisi yoktur. monitor-probe.js'in tamamı bir kapanış içindedir: aynı dünyada çalıştığı için yardımcı adları content.js'in fonksiyonlarını ezmesin.
- **Tek yazar kuralı** ([01 > Kural 1](01-mimari.md#kural-1-statei-yalnızca-backgroundjs-değiştirir-tek-yazar)) korunur: graph state'ini yine yalnızca background yazar. Monitörler ayrı anahtardadır ve tek yazarı `monitor-store.js`'tir; background bu anahtarı bilmez.
- **Node / edge silme, birleştirme, sıfırlama** için özel bir mesaj yoktur: `monitor-store.js` storage'daki `graph:<id>` değişikliğini dinler, öğesi kaybolan monitörü "sahipsiz" gösterir; öğe geri gelirse (Geri al) işaret kendiliğinden kalkar. Aynı dinleyici senaryo listesini de karşılaştırır: listeden düşen senaryonun monitörleri silinir (`dropMonitorsOfDeletedScenarios`).
- **Graph'lar:** `activeGraph` değişince o graph'ın `monitors:<id>`, `scenario-monitors:<id>` ve `monitor-alarms:<id>` anahtarları okunur. panel.js yeni graph'ı ayrı bir okumayla yüklediği için `monitor-list.js`, `state.id` yeni graph'a geçene kadar çizimi erteler (kısa aralıklarla yeniden dener). `graphs` listesinden düşen graph'ların monitör, senaryo monitörü ve uyarı anahtarları silinir.
- **Yedek:** yüklemede panel.js'in dosya kutusu (`#graph-file`) capture aşamasında okunur; yedekteki monitörler bekletilir ve yalnızca yedek seçildikten sonra oluşmuş, yedekteki tüm node'ları içeren ve henüz monitörü olmayan graph aktif olunca yazılır (vazgeçilen ya da başka bir graph'a geçilen durumda uygulanmaz; 2 dakika sonra düşer). Senaryo monitörleri yeni graph'ta aynı id'yle var olan senaryolara yazılır.
- **Senaryo görünümü** (`scenarioView`, `scenario`): kopyadaki node ve edge'ler aynı id'yi taşıdığı için hale ve liste aynen görünür. Görünümdeki seçili öğe ve sağ tık menüsü kopyadan okunur (`monitorViewGraph`); ekleme o senaryoya yapılır (`openMonitorDialog({ scenarioId })`), genel kurallar salt okunur ikinci grupta listelenir. Senaryo monitörünün node / edge'i senaryonun kopyasında aranır (`monitorGraphOf`: seçili senaryoda panelin çalışma kopyası, değilse `state.scenarios`'taki; kopyası olmayan eski senaryoda anında `scenarioSnapshot`). panel.js'in salt okunur görünüm kuralı graph'ın kendisi içindir; monitör listesi graph'ı değiştirmez.

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

Parametre türleri: `text`, `regex` (kaydedilmeden derlenir; formda canlı deneme kutusu çıkar, `presets: [{ text, value }]` ile hazır desen çipleri eklenir), `number` (`min`, `max`, `step`), `select` (`options: [{ value, text }]`), `checkbox`, `image` (küçük bir resim; değeri `{ data: 'data:image/png;base64,…', width, height }`; formda dosya seçme, panodan yapıştırma ve önizleme; `monitorImageProblem` ile boyut / biçim doğrulaması). Bir alan kayıttaki elementlerden seçilebilsin isteniyorsa parametreye `element: 'fields'` (yalnızca form alanları) ya da `element: 'all'` ekleyin. Otomatik adın belirleyici parametreyi göstermesi için `monitorAutoName()` içine, özet cümlesinin düz Türkçe okunması için `monitorSentence()` içine birer satır ekleyin.

Kontrolün kendisi: `monitor-probe.js > MONITOR_PROBES` nesnesine aynı `id` ile `(params) => { status, text }` döndüren bir fonksiyon ekleyin (sayfada çalışır; `resolveElements`, `isRendered`, `visibleTextLines`, `foldText` gibi yardımcılar hazır). Örneğin `urlCheck` için: `new RegExp(params.pattern).test(location.href)` → `ok` / `fail`. Kural bir elementte bozuluyorsa onu da bildirin: `probeFail(metin, locate(() => [elementPart(el)]))` (metnin bir parçasıysa `textPart(düğüm, baş, son)`); uyarı elementi saklar ve görüntüde işaretler, panelde başka bir şey yazmak gerekmez. Kontrol sayfada yapılamıyorsa (ekran görüntüsü, sekme bilgisi gibi yalnızca eklentinin ulaştığı şeyler) türe `side: 'panel'` yazın ve kontrolü panelde yapın: `monitor-run.js > probeInPanel` bugün yalnızca görüntü monitörünü çağırır (`checkImageMonitors`); ikinci bir panel türü gelirse orada türe göre dallanır.

Kontrol ekrana değil oynatma sırasında olana bakıyorsa (bir olay, bir süre) türe `side: 'replay'` yazın ve değerlendiriciyi `monitor-run.js > REPLAY_CHECKS` nesnesine aynı `id` ile ekleyin: `({ run, replay, step, m, moment, actions, bound }) => ({ verdict, culprit })`, sonuç o anda belli değilse `null`. `moment` kontrol anıdır (aksiyondan sonra / adımın sonunda / adım yarıda kaldı); `culprit` bozulan sonuçta elementi gösterilecek aksiyondur. Verinin toplanması türe özgüdür: JavaScript Error `chrome.debugger` olaylarını dinler, Action Timeout Emir'in fonksiyonlarının çevresinde süre ölçer. `when: 'event'` türüne her aksiyondan sonra ve adımın sonunda, `when: 'temporal'` türüne aksiyona bağlı olsa da her aksiyondan sonra bakılır. Formun "Edge'deki aksiyon" satırındaki metinler `MONITOR_WHEN`'deki `whole` / `pick` / `picked` / `wait` alanlarından gelir (yoksa ekrana bakan monitörün metinleri).

---

## Test

**Manuel kontrol listesi.** Graph'ta en az iki node ve bir edge varken:

- [ ] Senaryo'nun altında **Monitörler** bölümü var, başlıkta sayı yok, açılınca "Henüz monitör yok…" ipucu.
- [ ] Graph'ta bir node'a sağ tık → menüde `"v_…" node'una monitör ekle` ve `Monitörlerini göster (0)`; tarayıcının kendi menüsü açılmıyor. Edge'e sağ tık → `"e_…" edge'ine monitör ekle`. Boş alana sağ tık → `Tüm modele monitör ekle`. Esc, dışarı tıklama ve graph'ı kaydırma menüyü kapatıyor.
- [ ] Menüden "ekle" → öğe graph'ta seçiliyor, pencere 1. adımda açılıyor: 7 kart (Input Validation, Expected Text, Expected Image, Error Text, JavaScript Error, Font Size, Action Timeout); kartlarda kontrol biçimi etiketi. Arama: "desen", "hata", "yazı", "görüntü", "süre" (büyük harfle de).
- [ ] **Expected Text:** bir node'a "Password is required" gibi o ekranda görünen bir metin → "Bu ekranda şimdi kontrol et" yeşil, satırda bulunduğu yazı; olmayan bir metin kırmızı; harf duyarlılığı açıkken yalnızca harf farkıyla varsa satır bunu söylüyor.
- [ ] **Olmamalı kuralı ve bekleme:** Beklemeleri kaydet açıkken "Bekleyiniz" mesajı çıkan bir akış kaydet (edge'de bekleme), beklemeye bağlı Expected Text "Bekleyiniz" + "Ekranda olmamalı" → aksiyon listesinde "2. Bekle N sn", ipucu "bittikten hemen sonra"; liste zamanında gelirse yeşil, bekleme kısa tutulursa kırmızı ve uyarı görüntüsünde mesaj.
- [ ] **Expected Image:** formda **Ekrandan seç** → sekmenin görüntüsü açılıyor, mesajın etrafına dikdörtgen çizince boyut ve önizleme, **Kullan** ile forma giriyor (pencere çizim sırasında yerinden oynamıyor; 4 px'den küçük tıklama seçim sayılmıyor; **Yeniden çek** sayfa kaydırılınca yeni görüntü alıyor). Alternatif: parçayı kesip (⌘⇧4) dosya olarak ver ya da panoya kopyalayıp yapıştır → önizleme ve boyut; görüntüsüz Kaydet alan hatası veriyor; listede küçük resim. Aynı ekranda "şimdi kontrol et" yeşil (benzerlik %95+); başka ekranda kırmızı, uyarı görüntüsü o ekran. Retina'da alınmış 2× parça 1× ekranda da bulunuyor ("0,5× ölçekte").
- [ ] "Input Validation" kartı → 2. adım: kapsamda *Yalnızca bu edge* + `e_… (v_… → v_…)` seçili; altında **Edge'deki aksiyon** listesi (`Edge'in tamamı`, `1. Yaz …`, `2. Tıkla …`); bir yazma aksiyonu seçilince **Alan** kendiliğinden doluyor ve özet "… edge'inin 1. Yaz … aksiyonundan hemen sonra: … Bozulursa kırmızı yanar." diyor. **Kaydet** → listede `Edge: e_… · 1. Yaz …`, edge graph'ta mor haleli; **Düzenle** aksiyonu yeniden seçili getiriyor. Aynı edge'e şifre alanı için ikinci bir Input Validation (2. aksiyon, başka desen) eklenebiliyor.
- [ ] Node'a tıklayınca detay kartında **Bu node'un monitörleri** ve "Tüm model için tanımlı N etkin monitör…"; edge'e tıklayınca **Bu edge'in monitörleri** ve **Bu edge'e monitör ekle**.
- [ ] "Font Size" türü varsayılan `4 pt` ile geliyor; değer değiştirilebiliyor (ör. 6); Enter kaydediyor; kapsam *Tüm model*. **Düzenle** ile sonradan değiştirilebiliyor.
- [ ] Filtreler: *Seçili öğe* (adıyla) yalnızca o öğeninkileri, *Tüm model* yalnızca genel olanları gösteriyor; seçim yokken *Seçili öğe* pasif.
- [ ] Doğrulama (geçersiz desen, boş zorunlu alan), kaydedilmemiş değişiklik uyarısı, Düzenle (tür kilitli), etkin kutusu (hale kalkıyor), silme / geri alma, Tümünü sil ("Emin misin?").
- [ ] **Bu ekranda şimdi kontrol et:** 3 pt yazı içeren bir sayfada "Font Size" kırmızı, "Error Text" yeşil; mesajda "N kırmızı, M yeşil". Eklenti yüklenmeden önce açılmış sayfada ışık yeşil ama satırda "sayfayı yenileyin".
- [ ] **Koşuyu oynat:** adım listesinin altında Monitörler listesi; adımlar ilerledikçe ışıklar yanıyor, başlıkta "kontrol ediliyor"; sonunda sayım. Bozulan monitörde kırmızı ayrıntı ve küçük ekran görüntüsü, tıklayınca büyüyor; adım izindeki karelerin üzerine gelince adımın sonucu. Yalnızca yeşil / kırmızı. Başka senaryoya geçince liste gizleniyor, geri dönünce görünüyor. Monitörler listesinde **Son kontrol … (son oynatma)**.
- [ ] **Uyarı anı:** Input Validation'ı bozan bir koşuda (ör. kullanıcı adı deseni `^admin`) büyütülen görüntü, Login'e basılmadan önceki ekranı (yazılmış alanla) gösteriyor; başlıkta adım ve aksiyon. Monitörler listesinde **Uyarılar (n)**: liste penceresinde zaman, yer, neden, görüntü; "Uyarıları temizle" iki adımlı. Panel kapatılıp açılınca uyarılar duruyor; "Bu ekranda şimdi kontrol et"te kırmızı çıkan monitöre de uyarı ekleniyor.
- [ ] **Hata yeri:** Input Validation'ı bozan koşuda küçük resimde alanın üstünde kırmızı kutu; büyütünce kutu etiketli (`input#user-name`), altında **Bozulan element** satırı (etiket, alanın adı, anahtar) ve DOM'daki yeri; **Görüntüde işaretle** kapatılınca kutu kalkıyor; satıra tıklayınca görüntü alana yakınlaşıyor (yazılan değer okunuyor), yeniden tıklayınca geri dönüyor. Font Size birkaç metinde bozulunca satırlar numaralı, satırın üzerine gelince kutusu öne çıkıyor; sayfanın aşağısındaki metin listede ama kutusuz, nedeni yazıyor. Error Text'te kutu paragrafın tamamını değil yalnızca hata metnini sarıyor. Expected Text "olmalı" bozulunca "İşaretlenecek element yok…" notu. Kutu, sayfa yakınlaştırılmışken (⌘+ / Ctrl +) ve panel daraltılıp genişletilince de elementin üstünde.
- [ ] **JavaScript Error:** hata atan bir akış kaydet (ör. Swag Labs'te `error_user`: bazı ürünlerde "Add to cart" hata atar ve hiçbir şey olmaz). Tüm modele JavaScript Error ekle (desen boş) ve oynat: o adımda kırmızı, satırda konsoldaki hata (`"Uncaught Error: Failed to add item to the cart."`) ve dosya:satır:sütun; yer "aksiyon n/m: Add to cart"; küçük resimde tıklanan düğme işaretli, pencerede başlık **Aksiyonun elementi**. Hata atmayan akışta yeşil ("JavaScript hatası yok"). Yok sayma desenine hatanın bir parçası yazılınca yeşil ve "1 hata yok sayıldı". "Bu ekranda şimdi kontrol et" bu monitörü atlıyor, son oynatma sonucu satırda kalıyor.
- [ ] **Action Timeout:** tüm modele Action Timeout (5 sn) ekle ve geç cevap veren bir akışı oynat (ör. Swag Labs'te `performance_glitch_user` ile giriş: Login'den sonra sayfa 5 sn takılır): Login aksiyonunda kırmızı (`süre aşıldı: aksiyon … "Login" 5,x sn sürdü (sınır 5 sn)`). Hızlı akışta yeşil ve satırda `en uzun aksiyon … · adım toplam …`. **Yavaş** işaretliyken de aynı sonuç, ölçülen süreler yakın. Formda sınır 2'nin altına inmiyor; bir bekleme aksiyonu seçilince kayıt reddediliyor.
- [ ] Oynatma kalırsa (yanlış ekran) node monitörlerinin satırında "node'a varılamadı", tüm model monitörleri yine kontrol edilmiş. **Durdur** sonrası kalan adımların karesi boş, satırda "oynatma durduruldu".
- [ ] **GraphWalker JSON**: `models[0].properties.graphRecorder.monitors.items` tüm monitörleri, ilgili vertex'in ve edge'in `properties.monitors` alanı yalnızca kendininkileri içeriyor. GraphWalker CLI `check` hâlâ geçiyor.
- [ ] Node / edge silinince satır "Sahipsiz: öğe (…) artık yok", üstte sarı uyarı ve **Sahipsizleri sil**; **Geri al** ile dönünce işaret kalkıyor. Yedek dışa / içe aktarma, graph geçişi ve silme, panel yeniden açılınca kalıcılık, Sıfırla.
- [ ] **Senaryoya özel monitör:** iki senaryo aynı edge'den geçsin. Bir senaryonun sekmesinde Monitörler bölümü iki grup: üstte boş "Bu senaryonun monitörleri", altta "Genel kurallar" (`Genel` etiketli, düğmeleri pasif). **Bu senaryoya monitör ekle** → pencere başlığında senaryo adı, "Bu senaryonun tamamı" seçeneği, node listesi kopyadan, özet `"Giriş" senaryosunda, testte …`; kaydedince yalnızca o senaryonun listesinde, Ana graph sekmesinde altta "Ayrıca senaryolara özel 1 monitör var (Giriş: 1)". Sağ tık → `"v_…" node'una bu senaryo için monitör ekle`, sayım senaryo + genel. Öteki senaryonun sekmesinde görünmüyor. **Koşuyu oynat**: ışık listesinde `Genel` ve `Senaryo` etiketli satırlar, başlıkta `(n genel, m senaryo)`; öteki senaryoyu oynatınca bu monitör listede yok. **Senaryo indir** dosyasında node'un `monitors` yuvası dolu ve `monitors.items`; aynı dosya Senaryo kartındaki **Yükle…** ile yüklenince yeni senaryoda aynı monitörler ("Dosyadaki n monitör de yüklendi"). Yedek dışa / içe aktarınca senaryo monitörleri geri geliyor; senaryo silinince monitörleri gidiyor.
- [ ] Karanlık temada kartlar, pencere, liste, ışıklar, sağ tık menüsü ve hale okunaklı.

**Otomatik testler (uçtan uca,** [tests/README.md](../tests/README.md)**).** Eklenti gerçek Chromium'a yüklenir, yerel sayfalarda kayıt yapılır, panel butonlarla sürülür.

- `node tests/e2e/monitors.test.js` (menü): tür kartları (7 kart, 4 grup) ve etiketler, arama (kontrol biçiminde de); node monitörü (parmak izinden element listesi, hazır desen, canlı deneme, özet cümlesi); tüm model monitörü; sağ tık menüsünden edge monitörü (kapsam, element listesi, edge'deki aksiyon listesi ve aksiyon seçilince alanın dolması, düzenlemede aksiyonun yeniden seçili gelmesi, özet, hale, detay alt bölümü, dışa aktarımda `edges[].properties.monitors`); senaryo düzenlenirken sağ tık menüsünün koşuya adım eklememesi; ağır desen uyarısı; boş alana sağ tık, Esc; "Monitörlerini göster"; `monitors:<graph>` anahtarındaki şekil; filtreler, etkin kutusu, düzenleme; doğrulama ve kaydedilmemiş değişiklik uyarısı; GraphWalker JSON'u ve runner'ın (`loadModel`) okuması; graph başına saklama ve geçiş; yedekle dışa / içe aktarma; graph silme; node silme / geri alma; senaryo görünümü; yeniden açılış; Sıfırla; konsolda hata yok.
- `node tests/e2e/monitor-unit.test.js` (birim, tarayıcısız): `monitorParamProblem` (görüntü sınırları dahil), `monitorPatternWarning`, `monitorAutoName`, `monitorSentence`, `monitorActionRef` / `resolveMonitorAction` (aynı etiketli iki alan, silinen / kayan / etiketi değişen aksiyon, hedefsiz aksiyon; bekleme: issue #5'in iki durumu, aynı aksiyondan sonra iki eş bekleme, sihirbazdaki iki "İleri"nin beklemeleri, ikizi olmayan bekleme, sırası kaydedilmemiş kayıt), `normalizeActionRef`, `normalizeMonitors`, `normalizeAlarms`; `findImage` yapay görüntülerde (tam yerinde bulma, küçük renk farkı, başka parça, şeffaf pikseller, düz parça, parça görüntüden büyük, iş sınırı); hata yeri (`normalizeLocation`, kutunun görüntüdeki yeri `faultBoxPlace`, etiketin yeri `faultLabelSide`, görüntünün gösterdiği alan `shownViewport`: görüntü ölçülen alandan kısa / dar / geniş, 2× ekran, yakınlaştırma); ekrana bakmayan monitörler (`monitor-run.js`'ten çıkarılan saf fonksiyonlar): yakalanan hatanın okunması `thrownError` (konsol satırı, yer, hata nesnesi olmayan atışlar, eklenti dosyası), `jsErrorVerdict` (sayım, yok sayma deseni), aksiyon süreleri `actionTimes` (bekleme sayılmaz, ardındaki durulma aksiyona yazılır, son aksiyona beklenen ekranın gelmesi), `timeoutVerdict` (sınırda yuvarlama, aksiyondan sonra / adımın sonunda / varılamadı / yarıda kaldı, aksiyona bağlı), işaretin adı (`faultWord`) ve pencere notu.
- `node tests/e2e/monitor-wait.test.js` (bekleme + "olmamalı"): düğmeye basınca "Bekleyiniz…" çıkan, 1,5 sn sonra aynı sayfada liste gelen yerel site; Beklemeleri kaydet açık → edge'de tıklama + ekranı değiştiren bekleme; formda bekleme "Bekle 2,5 sn" ve ipucu, Kural seçeneği; beklemeye bağlı Expected Text (olmamalı "Bekleyiniz", olmalı "Yazdır") ve Expected Image (olmamalı mesaj parçası), tıklamaya bağlı "Bekleyiniz olmalı"; hızlı sayfada hepsi yeşil; bekleme süresi ✎ ile değişince monitörler bağlı; yavaş sayfada bekleme monitörleri kırmızı, uyarı görüntüsünde "Bekleyiniz", "aksiyon 2/2: Bekle 3 sn".
- `node tests/e2e/monitor-expect.test.js` (Expected Text / Expected Image): Login → Home → Login kaydı; tür kartları ve arama; formdan PNG yükleme (önizleme, boyut, özet; görüntüsüz ve yanlış türde dosyada hata; düzenlemede önizleme, Kaldır, kaydedilmemiş değişiklik); "Ekrandan seç" (sekmenin görüntüsü sığdırılmış, fareyle sürükleyince seçim boyutu mesaj kutusu kadar, önizleme, Kullan ile forma girip kaydediliyor; yanlışlıkla tıklama seçim değil; Vazgeç forma dokunmuyor; seçilen parça "şimdi kontrol et"te %100 benzerlikle bulunuyor); node'lara bağlı metin monitörleri ("şimdi kontrol et": var / yok / harf duyarsız / harf duyarlı / iki satıra yayılan / gizli metin, düğme değeri); görüntü monitörleri (mesaj parçası yeşil, Login düğmesi parçası Home'da kırmızı "benzer bir bölge yok", 2× parça 0,5 ölçekte, tüm model); "olmamalı" kuralı (olmayan metin yeşil, ekrandaki parça kırmızı "hâlâ ekranda"); bozulanlara görüntülü uyarı; oynatmada iki adımda yeşil / kırmızı, Login node'una varınca düğme yazısı ve görüntüsü, tüm model parçası adım 2'de kırmızı; uyarıların sayfası; GraphWalker JSON'unda görüntü; konsolda hata yok.
- `node tests/e2e/monitor-scenario.test.js` (senaryoya özel monitörler): Giris → Uygulama → Giris kaydı, iki genel kural, aynı edge'den geçen "Kısa" ve "Uzun" senaryoları; senaryo sekmesinde iki grup (genel kurallar `Genel` etiketli ve pasif), formdan senaryo monitörü (başlıkta senaryo adı, "Bu senaryonun tamamı", node listesi kopyadan, özet senaryo adıyla; `scenario-monitors:<graph>` anahtarında senaryo id'siyle, kopya storage'da boş), sağ tık menüsü ve detay alt bölümü (etiketler, sayım), hale, ana graph sekmesinde not; oynatmada Kısa: 2 genel + 1 senaryo hepsi yeşil, Uzun: 4 satır ve senaryo monitörü kırmızı (uyarı senaryo id'li, görüntülü), ötekinin monitörü listede yok; "şimdi kontrol et" senaryoda 4 monitör; "Senaryo indir" dosyasında yuvalar ve liste, panel kopyası değişmemiş; dosya "Yükle…" ile yüklenince monitörleri yeni senaryoda (yeni id'lerle), o senaryo silinince gidiyor; yedekte `scenarioMonitors` ve yüklenince geri gelme; senaryo silinince monitörleri, monitör silme / geri alma, graph silinince anahtar; konsolda hata yok.
- `node tests/e2e/monitor-run.test.js` (kontrol): kuralları bilerek bozan sayfalarda (3 pt yazı; "500 Internal Server Error" metni; 5 ile başlamayan telefon) dört monitörle oynatma. Oynatma sürerken liste ve "kontrol ediliyor"; Emir'in oynatması yine geçiyor; her monitörün ışığı, adım izi ve ayrıntısı (Font Size kırmızı adım 1 / yeşil adım 2, Error Text kırmızı adım 2, Input Validation'da yazılan değer, node monitörü yeşil); yalnızca yeşil / kırmızı; ekran görüntüleri ve büyütme; uyarılar `monitor-alarms:<graph>`'ta ve bozulma anında alınmış (Input Validation görüntüsü Telefon sayfasında, "Devam" tıklanmadan; aksiyon bilgisiyle), edge'in aksiyonuna bağlı monitörler (1. aksiyon = yazınca Telefon sayfasında, 2. aksiyon = Devam tıklanınca Sepet sayfasında; sırası yanlış kaydedilmiş aksiyon tür + hedefle bulunuyor; silinmiş aksiyon "bulunamadı", kırmızı değil), Monitörler listesinde "Uyarılar (n)" ve liste penceresi; "Son kontrol"; başka senaryoda listenin gizlenmesi; "Bu ekranda şimdi kontrol et" (kırmızıya uyarı); yeniden açılışta uyarıların durması; "Uyarıları temizle"; konsolda hata yok.
- `node tests/e2e/monitor-js-timeout.test.js` (ekrana bakmayan monitörler): hataları bilerek atan ve bilerek takılan yerel site (tıklanınca hata atıp adı değişen düğme, 1,2 sn takılan düğme, her tuşta hata atan alan, yakalanmayan Promise reddi, 8 sn takılan ödeme, son aksiyondan 3 sn sonra gelen hata). On üç monitörle dört oynatma. *Normal hızda:* her hata doğru adımda ve aksiyonda; oynatmadan önceki hata, eklentinin kendi dünyasında atılan hata (test onu ikinci bir DevTools oturumuyla kurar) ve desene uyan hata sayılmıyor; aksiyona ve node'a bağlı monitörler; süreler doğru aksiyonda, takılan düğmenin süresi kilidi kapsıyor, yeşil sonuçta en uzun aksiyon ve toplam; uyarıda **tıklanan** düğme işaretli (adı değişmiş olsa da; aynı adlı öbür düğme değil), kutunun doğruluğu görüntüden (zemin rengi); sayfa değiştiyse element yok; "Aksiyonun elementi" başlığı ve notları; "şimdi kontrol et" bu monitörleri atlıyor. *Yavaş oynatmada:* ölçülen süreler normal hızdakine yakın (vurgu ve aralar sayılmıyor), sonuçlar aynı. *Yarıda kalan adım* (element gelmiyor): süre kırmızı "adım tamamlanamadı", hatalar yine değerlendiriliyor. *Varılamayan ekran:* süre kırmızı, sınırı aşmayan "değerlendirilmedi", ekrana bakan node monitörü "node'a varılamadı". *Form:* kartlar, kapsam ve aksiyon metinleri, geçersiz desen, sınırın alt değeri, beklemeye bağlanamama; konsolda hata yok.
- `node tests/e2e/monitor-locate.test.js` (hata yeri): üç yerel sayfa. *Sayfada yer bulma* (doğrudan `MONITOR_PROBE`): şifre alanında ve contenteditable'da değer sızmaması, taşmanın dışında kalan element (`clipped`; sabit ve mutlak kutuların kurtulması), birden çok düğüme bölünmüş metin, yer tutucu ve düğme değeri, Türkçe harf katlama ("GİRİŞ" ~ "giriş": yalnızca o sözcük), `text-transform`, kaynağında satır sonu olan metin, desenin art arda tuttuğu parçaların tek kutu olması ve "1500"ün işaretlenmemesi, `visibility: hidden` alan, 14 parçadan ilk 10'u + `more`, görünen alanın kenarında kesilen element; elementin adının Ekrandaki elementler ağacındaki (`DOM_TREE`) satırıyla aynı olması (alan, düğme, paragraf, başlık). *Oynatma:* altı monitörün uyarısında bozulan element (etiket, metin, anahtar, DOM yolu, kutu); **kutunun doğruluğu görüntüden sınanır:** elementlerin zemini ayırt edici renktedir, saklanan kutunun içindeki ortalama renk o renk, hemen dışı beyaz olmalı. *Arayüz:* küçük resimlerde kutu (kırpılmış görüntüde doğru yerde), pencerede kutunun büyütülmüş görüntüde tam elementin alanı olması, yan panel genişliğinde (420 px) aynı kontrol ve satıra tıklayınca elemente yakınlaşma, etiket, liste satırları, işaret anahtarı, satır ↔ kutu, bölge, element olmayan durum, uyarı listesi. *Şimdi kontrol et:* kaydırılmış sayfa, görünen alanın üstünde kalan metin (`above`), %150 yakınlaştırma, dokunmatik yakınlaştırma (×2, kaydırılmış), görüntünün ölçülen alandan kısa ve dar gelmesi (çekim taklit edilir). Eski uyarı (alan yok), alanı bilinmeyen uyarı, yeniden açılışta kalıcılık; konsolda hata yok.
- Eklentinin diğer uçtan uca testleri (`graphs`, `scenarios`, `scenario-graphs`, `compare`, `buffer`, `replay`, `replay-start`, `scenario-run`, `dom-tree`) bu dosyalar yüklüyken de aynı sonucu veriyor.

---

## Sonraki adımlar

1. **Yeni türler:** ihtiyaca göre `monitor-types.js`'e kayıt, `monitor-probe.js`'e (ekrana bakmayan türde `monitor-run.js > REPLAY_CHECKS`'e) kontrol eklenir (yukarıdaki tarif). Yapı değişmez.
2. **Runner tarafı:** aynı kontroller runner'da (`runner/lib/oracle.js`'in yanında) her edge'den sonra çalıştırılır ve rapora girer (monitör, kapsam, adım numarası, ekran görüntüsü; kırmızı monitör koşuyu başarısız sayar). Sayfa kontrolleri için `monitor-probe.js` Playwright'ın `page.addInitScript`'iyle sayfaya verilebilir (fingerprint.js gibi). Ekrana bakmayan iki tür için Playwright'ın `pageerror` olayı ve adımların süresi kullanılabilir; karar fonksiyonları (`jsErrorVerdict`, `timeoutVerdict`) saftır, olduğu gibi çağrılabilir.
3. **Senaryoya özel monitörler:** gerekirse aynı form, scenario.js'teki `monitors: []` yuvalarına bağlanır.
4. **DOM ağacından monitör:** panelin Ekrandaki elementler kartında ([01 > Ekrandaki elementler](01-mimari.md#ekrandaki-elementler-dom-ağacı)) bir satırdan, o elementin anahtarıyla dolu monitör formu açılır. Kart bugün yalnızca gösterir; satırlar etkileşimli elementlerin parmak izi anahtarını (`input:phone`) zaten taşır.
5. **Senaryo dosyasından yükleme:** Senaryo kartındaki **Yükle…** dosyadaki monitörleri de alabilir (Emir'in yükleyicisi yeni id verdiği için monitörler yeni senaryoya eşlenir).
6. **Uyarıdan canlı sayfaya:** sayfa hâlâ bozulduğu ekrandaysa uyarıdaki element canlı sayfada da çerçevelenebilir ve Ekrandaki elementler kartındaki satırı seçilebilir. Kartın ağacı elementleri sırayla numaralar ve numaralar her yenilemede değişir; uyarıdaki elementi ağaçtaki satırla **kesin** eşlemek için `dom-tree.js`'e küçük bir ek gerekir (ör. anahtar ve DOM yoluyla element arayan bir mesaj ya da ağaç düğümlerinde elementin kutusu). Ad benzerliğiyle eşlemek aynı adlı elementlerde (liste satırları) yanlış elementi gösterebileceği için yapılmadı. Runner raporunda da aynı `targets` kullanılabilir.
7. **Süre dolduğu anda uyarı:** Action Timeout bugün aksiyon bitince bakar; takılan sayfada kırmızı ışık aksiyon bittiğinde (ya da oynatma 10 sn sonra vazgeçtiğinde) yanar. Bir zamanlayıcıyla, sınır dolduğu anda yakılıp takılı ekranın görüntüsü alınabilir.
8. **Başka olaylar:** JavaScript Error'ın kullandığı bağlantıdan (`chrome.debugger`) ağ hataları (başarısız istek, 4xx / 5xx cevap: `Network` alanı) ve `console.error` satırları da dinlenebilir; her biri `REPLAY_CHECKS`'e bir değerlendirici ve kataloğa bir kayıttır.
