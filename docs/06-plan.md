# 06: Plan: Test Senaryosu Üretimi ve Çalıştırma

Şu ana kadar eklenti, kullanıcı sitede gezerken graph'ı çıkarıyordu. Sonraki adım bu graph üzerinde **test senaryosu üretmek ve çalıştırmak**. Bu doküman 14 Ekim 2026 haftasının işlerini, sırasını ve tasarım kararlarını toplar. İş ilerledikçe güncellenir: her fazın yapılacakları işaretlenir.

## İçindekiler

- [Bu haftanın işleri](#bu-haftanın-işleri)
- [Sıra ve gerekçe](#sıra-ve-gerekçe)
- [Faz 1: Viewport kaydı ve `resize` aksiyonu](#faz-1-viewport-kaydı-ve-resize-aksiyonu)
- [Faz 2: Runner (ilk sürüm)](#faz-2-runner-ilk-sürüm)
- [Faz 3: Beklemeleri kaydet](#faz-3-beklemeleri-kaydet)
- [Faz 4: Yeni sekmede ya da başka sitede devam](#faz-4-yeni-sekmede-ya-da-başka-sitede-devam)
- [Faz 5: Karşılaştırma ekranı](#faz-5-karşılaştırma-ekranı)
- [Faz 6: Senaryo planlama ve rapor](#faz-6-senaryo-planlama-ve-rapor)
- [Kapsam dışı](#kapsam-dışı)
- [Riskler](#riskler)
- [Bilinen zayıflıklar ve iyileştirme fikirleri](#bilinen-zayıflıklar-ve-iyileştirme-fikirleri)

---

## Bu haftanın işleri

| # | İş | Kısaca |
|---|---|---|
| 1 | Test planlama ve çalıştırma | Graph'tan yol (senaryo) üretmek, yolu gerçek tarayıcıda oynatmak, her adımda varılan ekranı doğrulamak |
| 2 | Benzer node'lar için detaylı karşılaştırma | "Aynı state mi?" onay kartında şu anki ekranı eşleşen her adayla görsel olarak karşılaştırmak |
| 3 | Farklı çözünürlük | Testi çalıştıranın ekranı graph'ı kaydedenden büyük ya da küçükse ne olur? |
| 4 | Bekleme aksiyonu | Yalnızca beklenerek ulaşılan durumları (oturum zaman aşımı) kaydetmek |
| 5 | Yeni sekmede / başka sitede devam | Graph'ı başka bir sekmede, gerekirse tamamen farklı bir sitede genişletmeye devam etmek |

---

## Sıra ve gerekçe

| Faz | İş | Tahmini süre | Durum |
|---|---|---|---|
| 1 | Viewport kaydı ve `resize` aksiyonu (iş 3) | 0,5 gün | Yapıldı |
| 2 | Runner, ilk sürüm (iş 1) | 2 gün | Yapıldı |
| 3 | Beklemeleri kaydet (iş 4) | 0,5–1 gün | Yapıldı |
| 4 | Yeni sekmede devam (iş 5) | 1,5–2 gün | Yapıldı |
| 5 | Karşılaştırma ekranı (iş 2) | 1 gün | Yapıldı |
| 6 | Senaryo planlama ve rapor (iş 1) | kalan süre | |

- **Kayıt formatını değiştiren iş önce gelir.** Viewport'u kaydedilmemiş bir graph, testte doğru boyutta çalıştırılamaz. Bu yüzden Faz 1 en başta: bundan sonra kaydedilen her graph bu bilgiyi taşır.
- **Runner erken gelir.** Haftanın ana çıktısı ve en riskli işi odur. Tekrar oynatmanın gerçek sorunları erken görülür; bekleme ve sekme tasarımı varsayıma değil gözleme dayanır. Sonraki fazların her biri runner'da hemen uçtan uca denenir; yeni aksiyon tipleri runner'a yalnızca yeni bir durum olarak eklenir.
- **Karşılaştırma ekranı bağımsızdır.** Yalnızca paneli ilgilendirir. Fark hesabı runner'ın hata raporunda da ("beklenen node / gerçek ekran") kullanılır.
- **Hafta yetmezse sondan kesilir:** önce Faz 6, sonra Faz 5.

---

## Faz 1: Viewport kaydı ve `resize` aksiyonu

*İş 3. Durum: yapıldı.*

### Problem

State, ekranda kaydırmadan tıklanabilen elementlerden oluşur ([03 > Kaydırma ve state](03-state-eslestirme.md#kaydırma-ve-state)). Ekrana neyin sığdığını belirleyen şey monitör çözünürlüğü değil, sayfanın **CSS piksel** cinsinden görünen alanıdır: viewport (`innerWidth × innerHeight`). Bu alanı monitör, işletim sistemi ölçeklemesi (%125 gibi), pencere boyutu, yan panel ve DevTools'un kapladığı yer ve tarayıcı yakınlaştırması birlikte belirler.

Bu fazdan önce viewport kaydedilmiyordu. Pencere boyutunun değişmesi de aksiyon sayılmıyordu: etkisi ya o an açık olan aksiyonun "ekranı değiştirdi mi?" işaretine yazılıyor ya da hiç görünmüyordu. Tekrar oynatmada bu değişim yeniden üretilemiyordu.

### Testi çalıştıranın ekranı farklıysa

| Durum | Ne olur? |
|---|---|
| **Daha büyük** | Ekrana daha çok element sığar. Ekrandaki küme beklenen kümenin üst kümesi olur, birebir doğrulama başarısız olur. Kayıtta kaydırmayla ayrılmış iki node tek ekrana düşer. |
| **Daha küçük** | Daha az element sığar. Küme beklenenin alt kümesi olur, doğrulama yine başarısız olur. Aksiyonun hedefi ekran dışında kalabilir; otomasyon aracının hedefi görmek için kendiliğinden kaydırması da state'i değiştirir. |
| **Breakpoint aşılır** (mobil düzen) | Element türleri değişir (menü linkleri hamburger menüye girer), aksiyon hedefleri ortadan kalkar. Model o boyut için geçersizdir; ayrı bir graph gerekir. |

### Karar

Test, **kayıttaki viewport emüle edilerek** çalışır. Playwright'ın viewport emülasyonu fiziksel ekrandan bağımsızdır: testi çalıştıranın ekranı ne olursa olsun sayfa kayıttaki boyutu görür. Böylece yukarıdaki üç durum oluşmaz.

Bilerek farklı boyutta test (responsive test) bu haftanın kapsamı dışındadır. Olası yol: kayıtta ekran filtresi uygulanmamış ikinci bir parmak izi (tüm sayfadaki etkileşimli elementler) saklamak ve "toleranslı modda" doğrulamayı onunla yapmak. Breakpoint değişimini bu da çözmez.

### Yapılanlar

- [x] Node'a `viewport` alanı: `{ width, height, devicePixelRatio }`, node oluşturulduğu andaki CSS piksel boyutu ve piksel oranı.
- [x] `resize` aksiyonu: pencereyi sürüklemek, yan paneli ya da DevTools'u açmak, tam ekrana geçmek. Varılan viewport saklanır. Sürükleme boyunca gelen olaylar tek aksiyon olur.
- [x] Yakınlaştırma da sayfanın CSS piksel boyutunu değiştirir ve aynı olayı tetikler; ikisini `devicePixelRatio` ayırır (yakınlaştırma onu da değiştirir). Yakınlaştırma aksiyonu varılan viewport'u da saklar: Playwright'ta tarayıcı yakınlaştırması yoktur, aynı ekran bu boyut ve piksel oranıyla kurulur.
- [x] Panel: node detayında viewport, aksiyon satırında varılan boyut. Ayarlar'da **Pencere boyutu** aksiyon tipi.
- [x] Dışa aktarım `graph-recorder/v5`: vertex'lerde `viewport`.
- [x] Dokümanlar: [01](01-mimari.md), [03 > Pencere boyutu ve state](03-state-eslestirme.md#pencere-boyutu-ve-state), [04](04-veri-modeli.md), [05](05-gelistirme.md), README.

### Kabul kriteri

- Pencere boyutu değişince "Bekleyen aksiyonlar"da tek bir `Pencere boyutu  Resize → 1280×720` satırı çıkar. Ctrl + ile yakınlaştırınca bu satır çıkmaz, yalnızca `Zoom in` çıkar.
- Node detayında viewport görünür. Dışa aktarılan JSON'da her vertex'te `viewport`, yakınlaştırma aksiyonunda varılan `viewport` vardır.

### Bilinen sınırlar

- **Farklı boyutta "Buradan devam et":** Kayıt farklı boyuttaki bir pencerede sürdürülürse aradaki boyut farkı kaydedilmez, çünkü o sayfada boyut değişmemiştir. Faz 4'te sekme değişimiyle birlikte ele alınacak: kayıt farklı boyutlu bir pencerede sürerse edge bir `resize` ile başlar.
- **Farklı ölçekli monitör:** Pencereyi farklı ölçekli bir monitöre taşımak `devicePixelRatio`'yu yakınlaştırma olmadan değiştirir. Bu değişim kaydedilmez; yakınlaştırmayla karıştırılmaması için böyle bırakıldı.

---

## Faz 2: Runner (ilk sürüm)

*İş 1. Durum: yapıldı. Kullanım ve tasarım: [runner/README.md](../runner/README.md).*

### Amaç

Dışa aktarılan GraphWalker JSON'undaki bir yolu gerçek bir tarayıcıda oynatmak ve her edge'den sonra varılan ekranın beklenen node olduğunu doğrulamak.

### Tasarım kararları

- **Araç: Node.js + Playwright.** Eklentiyle aynı dil olduğu için parmak izi kodu sayfaya olduğu gibi enjekte edilir; Java/Selenium'da bu kodun çevrilmesi gerekirdi. Viewport emülasyonu, popup ve sekme olayları, otomatik bekleme hazır gelir. [04](04-veri-modeli.md#aksiyon)'teki tekrar oynatma karşılıkları da zaten Playwright biçiminde yazılmıştır.
- **Konum: `runner/`.** Eklentiden ayrı durur; eklentinin "build yok, bağımlılık yok" ilkesi bozulmaz. npm bağımlılığı yalnızca runner'da olur.
- **Ortak parmak izi.** `content.js`'teki parmak izi fonksiyonları (`interactableElements`, `isInteractable`, `elementKey`, `countElements`, `targetOf`) `extension/fingerprint.js`'e taşınır. Eklenti onu content script olarak, runner `context.addInitScript` ile yükler. Kayıt ve test aynı state tanımını kullanır.
- **Aksiyonun hedefi.** Önce `target` (`{ key, index }`: ekrandaki n'inci türdeş element, parmak iziyle aynı sıralama), bulunamazsa `selector` kullanılır.
- **Doğrulama (oracle).** Edge'in aksiyonlarından sonra sayfa durulunca parmak izi alınır ve hedef node'un edge set'iyle (dışa aktarımdaki Ayarlar ile) birebir karşılaştırılır. Eşleşmezse süre dolana kadar tekrar denenir, çünkü sayfa geç yüklenebilir. Başarısızlıkta fark raporlanır: `button:Sil 5 ≠ 4`.
- **Viewport.** Tarayıcı bağlamı başlangıç node'unun viewport'uyla açılır. `resize` ve `zoom` aksiyonları viewport'u ve piksel oranını değiştirir.
- **Gizli değerler.** Şifreler kayıtta `******` olarak saklanır. Runner gerçek değeri bir secrets dosyasından alır (ör. `{ "input:password": "..." }`).
- **Yol.** Bu fazda yol elle verilen bir edge listesidir ya da GraphWalker `offline` çıktısıdır. Generator seçimi Faz 6'dadır.

### Yapılanlar

- [x] `extension/fingerprint.js`: parmak izi fonksiyonları ortak dosyaya taşındı; eklentinin davranışı değişmedi (Faz 1 testi tekrar koşuldu, 20/20). `urlKey()` ve yeni `diffCounts()` `settings.js`'te.
- [x] `runner/`: model okuma, format kontrolü (v4, v5), başlangıç node'unun görünen alanıyla tarayıcı açma
- [x] Yol: virgülle edge adları ya da id'leri, JSON dizi ya da GraphWalker `offline` çıktısı (düz ve `--verbose`). Aynı adlı edge'ler bulunulan node'a göre ayrılır.
- [x] Aksiyon oynatıcı: `click`, `input`, `enter`, `key`, `contextmenu`, `focus`, `scroll`, `navigate`, `history`, `reload`, `resize`, `zoom`. `select` ve `clipboard` henüz oynatılmıyor.
- [x] Doğrulama: durulma bekleme, parmak izi, birebir karşılaştırma, tekrar deneme, fark raporu, başarısız adımın ekran görüntüsü
- [x] Konsol çıktısı: adım adım edge, geçti / kaldı; çıkış kodu
- [x] Dokümanlar: [runner/README.md](../runner/README.md), [02 > Runner](02-teknolojiler.md#10-runner-playwright-nodejs), 01, 03, 04, 05, README

### Kabul kriteri

Karşılandı ([05 > Test](05-gelistirme.md#test)):

- saucedemo'da eklentiyle kaydedilen 8 edge'lik yol (giriş, sepete ekleme, sepet, yakınlaştırma, pencere boyutu) geçti.
- Bir edge'in hedefi bilerek bozulunca runner o edge'de durdu ve farkı gösterdi (`add-to-cart` butonu yerine `remove`).
- GraphWalker'ın `offline` ile ürettiği yollar da geçti.

### Not

GraphWalker CLI 4.3.3, Java 17 ya da 21 ister ([04 > GraphWalker ile doğrulama](04-veri-modeli.md#graphwalker-ile-doğrulama)). Geliştirme makinesinde Java 25'in yanında JDK 17 de kurulu; GraphWalker onunla çalıştı.

---

## Faz 3: Beklemeleri kaydet

*İş 4. Durum: yapıldı. Tasarım: [01 > Beklemeler](01-mimari.md#beklemeler).*

### Problem

Bazı durumlara hiçbir tıklamayla ulaşılmaz, yalnızca beklenerek ulaşılır. Örnek: internet bankacılığında oturum zaman aşımı kullanıcıyı çıkış ekranına atar. Graph'ı kuran kişi bu durumu modele eklemek isteyebilir. Bugün kayıt yalnızca aksiyonları görür; aksiyonsuz geçen süre ve o sürede ekranın kendiliğinden değişmesi kaydedilmez ([01 > Edge düzenleme](01-mimari.md#edge-düzenleme): "Sayfanın aksiyonsuz değişimleri ayrıca izlenmez").

### Karar

- Ayarlar'da **Beklemeleri kaydet** anahtarı olur (varsayılan kapalı). Kapalıyken kayıt bugünkü gibidir.
- Ekranı değiştirmeyen beklemeler için **alt sınır** varsayılan 1 saniyedir ve Ayarlar'dan değiştirilebilir. Ekranı değiştiren bekleme süresi ne olursa olsun kaydedilir.
- Açıkken aksiyonlar arasında geçen süre `wait` aksiyonu olarak kaydedilir (`ms`).
- Açıkken state sürekli izlenir. Ekran aksiyonsuz değişirse bunu bekleme yapmıştır; bekleme "ekranı değiştirdi" işaretini alır.
- Bekleme elle eklenmez, kaydedilir; yani gözlenmiş bir aksiyondur. Edge düzenlemedeki "aksiyon eklenemez" kuralı geçerli kalır.

### Ayrıntılar

- **Bekleme, ekran kendiliğinden değiştiği anda kapanır.** Süresi değişime kadar geçen süredir (ör. tam zaman aşımı süresi). Sonraki boşluk yeni bir beklemedir. Böylece runner yalnızca gerektiği kadar bekler.
- **Ekranı değiştirmeyen bekleme** "ekranı değiştirmedi" işaretiyle gelir ve edge düzenlemede uyarısız silinir.
- **Sürekli izleme** yalnızca anahtar açıkken ve kayıt sekmesinde çalışır: DOM her durulduğunda parmak izi alınır. Sürekli hareket eden sayfalarda (carousel) sıklık sınırlanır.
- **Bekleyen tek aksiyon bir bekleme olabilir** (zaman aşımı senaryosu). "Node oluştur" buna izin verir; edge'in adı `e_Wait` olur.
- **Node'dan sonraki ilk aksiyona ve son aksiyondan "Node oluştur"a** kadar geçen süre aksiyonlar arasında değildir; ekran değişmediyse kaydedilmez.
- **Yazma:** yazma aksiyonu alan odaktan çıkınca gönderilir. Yazmadan önceki bekleme yazmaya başlanan anda biter; yazarken ekranda olanlar kendiliğinden değişim sayılmaz.
- **Runner'da** `wait`, süre kadar beklemek demektir. Runner ayrıca kendi bekleme mekanizmalarını kullanır (durulma, Playwright'ın otomatik beklemesi, doğrulamada tekrar deneme); bu yüzden kayıttaki her kısa boşluk testte gerekli değildir.

### Yapılanlar

- [x] Ayarlar'da "Beklemeler" bölümü: anahtar ve alt sınır (saniye). Alt sınır anahtar kapalıyken pasif; geçersiz değer varsayılana döner. Durum satırı beklemelerin kaydedildiğini gösterir.
- [x] `wait` aksiyonu: aksiyonlar arası bekleme, ekranı değiştiren bekleme, `e_Wait`, panelde süre
- [x] Kayıt sekmesinde ekranı aksiyonsuz izleme (yalnızca anahtar açıkken), yazma süresince izlemenin susması
- [x] Runner: `wait` oynatma
- [x] Dokümanlar: 01, 04, 05, README, runner/README

### Ek: fareyle üzerine gelme

Beklemeleri test ederken çıkan soru: fareyi üzerine getirince açılan menü bekleme olarak görünüyordu. Ayarlar'a **Üzerine gelme (fare)** aksiyon tipi eklendi, varsayılan kapalı. CSS ile açılan menüde fare etkileşimli bir elementin üzerine gelince ekrana bakılır; JS ile açılan menüde değişim fare hareketinden en fazla 1 sn sonra başladıysa imlecin altındaki element tetikleyicidir. Yalnızca ekranı değiştiren üzerine gelme tutulur. Runner `hover()` ile oynatır. Tasarım: [01 > Fareyle üzerine gelme](01-mimari.md#fareyle-üzerine-gelme).

### Kabul kriteri

Karşılandı ([05 > Test](05-gelistirme.md#test)): son tıklamadan 4 sn sonra kendiliğinden "Oturum sona erdi"ye geçen bir sayfada beklenince `e_Wait` edge'i oluştu (3,7 sn, "ekranı değiştirdi"); runner aynı yolu oynattı ve geçti.

---

## Faz 4: Yeni sekmede ya da başka sitede devam

*İş 5. Durum: yapıldı. Tasarım: [01 > Kayıt hangi sekmede?](01-mimari.md#kayıt-hangi-sekmede).*

### Problem

Kayıt tek sekmeye bağlıdır (`state.tabId`); başka bir sekmede "Node oluştur" *"Kayıt başka bir sekmede sürüyor"* hatası verir. İki gerçek senaryo var:

- **Site yeni sekme ya da pencere açar:** `target=_blank` linkler, ödeme ve OAuth popup'ları.
- **Kullanıcı yeni sekmede başka bir siteye gider:** tipik örnek, kayıt olduktan sonra e-postadaki doğrulama linkine tıklamak.

### Karar

Kayıt sekmesi olmayan bir sekme aktif olunca panel sorar: *"Farklı bir sekmedesiniz. Grafa bu sekmede devam edilsin mi?"*

- **Evet:** kayıt bu sekmede sürer.
- **Hayır:** önceki sekme ve link hatırlanır; kullanıcı oraya dönene kadar aksiyon kaydedilmez.

### Ayrıntılar

- **"Hayır" o sekme için hatırlanır.** Araştırma için açılan sekmeye her geçişte soru tekrar çıkmaz.
- **Dönüş:** kayıt sekmesine geri geçmek. O sekme kapandıysa kayıt, aynı link ve aynı state (URL şablonu ve edge set) yakalanınca sürer. Yalnızca link yetmez: SPA'larda link aynı kalırken ekran değişebilir.
- **Soru background'da tutulur.** [Kural 1](01-mimari.md#kural-1-statei-yalnızca-backgroundjs-değiştirir-tek-yazar)'e uygun olarak soru, onay kartındaki `pending` gibi bekleyen bir karardır; panel onu çizer, cevap mesajla döner.
- **Yeni aksiyon tipi `tab`:** `open`, `switch` ya da `close`. Sekme, açılış sırasıyla tanımlanır, çünkü Chrome'un sekme id'si tekrar oynatmada aynı kalmaz. Sekmeyi site açtıysa (link, popup) açılış o tıklamanın sonucudur; kullanıcı açtıysa "yeni sekme aç ve adrese git" olarak kaydedilir.
- **Graph bağlı kalır.** Yeni sekmedeki ilk ekran, şu anki node'dan çıkan bir edge'in hedefidir. Ayrık ikinci bir başlangıç noktası yoktur; GraphWalker oraya hiç ulaşamazdı.
- **Farklı boyutlu pencere:** yeni sekme farklı boyutta bir penceredeyse edge bir `resize` ile başlar (Faz 1'in bilinen sınırı).
- **Runner** aktif sayfayı takip eder: site açtığında `context.waitForEvent('page')`, kullanıcı açtığında `context.newPage()`.

### Yapılanlar

- [x] Kayda katılmamış sekme aktif olunca soru (background'da bekleyen karar, panelde kart); "Evet" / "Hayır"; "Hayır" denen sekme hatırlanır; orada "Node oluştur" soruyu yeniden sorar
- [x] `tab` aksiyonu: `open` (sayfa açtı / kullanıcı açtı), `switch`, `close`; kayda katılmış sekmeler arası geçiş sorulmaz
- [x] Yeni sekme farklı boyuttaysa ardından `resize` (Faz 1'in bilinen sınırının sekme kısmı)
- [x] Kayıt sekmelerinin hepsi kapanınca yalnızca şu anki node'un ekranındaki sekmede devam
- [x] Runner: çok sekme; sekme adresiyle (URL şablonu) bulunur, sıra numarasıyla değil
- [x] Dokümanlar: 01, 04, 05, README, runner/README

Bir tasarım değişikliği: planda sekme kimliği "açılış sırası" idi. GraphWalker'ın yolu edge'leri kayıttaki sırayla yürümeyebildiği için (aynı sekmeyi açan edge iki kez geçilirse) sıra numaraları kayardı; sekme adresiyle bulunuyor.

### Kabul kriteri

Karşılandı ([05 > Test](05-gelistirme.md#test)). Ayrıca kayıt sekmeleri kapandıktan sonra devam etme ve "Node oluştur" ile sorunun yeniden sorulması da denendi.

- `target=_blank` bir linke tıklayıp yeni sekmeye geçince soru çıkar. **Evet** denince yeni sekmede node oluşur; edge'de tıklama ve sekme aksiyonu vardır.
- **Hayır** denince o sekmede aksiyon kaydedilmez. Eski sekmeye dönünce kayıt sürer; o sekmeye tekrar geçince soru çıkmaz.
- Runner bu yolu iki sekmede oynatır.

---

## Faz 5: Karşılaştırma ekranı

*İş 2. Durum: yapıldı. Yöntem: [03 > Görsel karşılaştırma](03-state-eslestirme.md#görsel-karşılaştırma).*

### Kapsam

"Aynı state mi?" onay kartı ("Evet, bu node" / "Hayır, yeni node"). Kart açıldığında adayların edge set'i şu anki ekranla zaten birebir aynıdır. Kullanıcı, etkileşimli olmayan içerikteki farka bakarak karar verir: sepet sayacı, uyarı metni, farklı ürün ([03 > Küme aynıysa neden hâlâ soruluyor?](03-state-eslestirme.md#küme-aynıysa-neden-hâlâ-soruluyor)). Bugün kart ekran görüntülerini yan yana gösteriyor. Hedef: şu anki ekranı eşleşen **tüm** adaylarla rahat ve net bir şekilde karşılaştırmak.

### Görsel karşılaştırma

- Şu anki ekran ile seçili aday büyük boyutta gösterilir. Görünümler: yan yana, üst üste (fark katmanı), kaydırıcı (perde).
- Farklı pikseller vurgulanır, farklı bölgeler kutu içine alınır.
- Her aday için fark oranı (değişen piksellerin yüzdesi) yardımcı sinyal olarak gösterilir. Karar kullanıcınındır; otomatik seçim yapılmaz.

### Teknik çerçeve

- **Piksel karşılaştırması:** iki görüntü aynı boyuta getirilir. Her piksel için algısal renk farkı (YIQ renk uzayında mesafe, pixelmatch yaklaşımı) bir eşikle karşılaştırılır. Kenar yumuşatma (anti-aliasing) pikselleri fark sayılmaz.
- **Bölge çıkarma:** farklı pikseller ızgara hücrelerinde toplanır; komşu hücreler birleşerek kutu olur (bağlantılı bileşenler).
- **Ön koşul:** iki görüntü aynı viewport ve piksel oranında alınmış olmalı (Faz 1 bunları kaydeder). Farklıysa karşılaştırma uyarıyla yapılır.
- **Sınırlar:** farklı ürün resimleri, animasyon ve kaydırma konumu farkı gürültü üretir. Bu yüzden görsel fark yalnızca **birebir eşleşen adaylar arasında** kullanılır ve eşleştirme kuralının yerine geçmez ([03 > Geliştirme fikirleri](03-state-eslestirme.md#geliştirme-fikirleri-tez-için), 3. madde).
- Yöntem ve eşik, tez için 03'e "Görsel karşılaştırma" bölümü olarak yazılır.

### Yapılanlar

- [x] `sidepanel/compare.js`: küçültme, YIQ renk farkı, ızgarayla bölgeler, fark oranı
- [x] Kartta her adayın altında görsel fark oranı ve "Karşılaştır"
- [x] Karşılaştırma penceresi: Fark / Perde / Yan yana, aday seçimi, adres ve başlık farkı, görünen alan uyarısı, pencereden karar
- [x] 03'e "Görsel karşılaştırma" bölümü (yöntem, eşikler, ölçüm, sınırlar); 01, 05, README

Plandan bir sapma: kenar yumuşatma pikselleri pixelmatch'teki gibi tek tek tespit edilmiyor; ekran görüntüleri JPEG olduğu için asıl gürültü sıkıştırmadan geliyor ve küçültme ile hücre eşiği ikisini birlikte bastırıyor.

### Kabul kriteri

Karşılandı ([05 > Test](05-gelistirme.md#test)): sayaç farkı <%0,1 ve tek kutu rakamın üstünde; afiş farkı %28,9.

Sepette 1 ve 2 ürün olan, edge set'i aynı iki ekran (yalnızca sayaç farklı): fark kutusu sayaç bölgesini gösterir, fark oranı düşüktür. Tamamen farklı bir ürün resmi gösteren aday daha yüksek oran gösterir.

---

## Faz 6: Senaryo planlama ve rapor

*İş 1.*

- **Yol üretimi:** GraphWalker generator'ları ile: `random(edge_coverage(100))`, `random(vertex_coverage(100))`, `a_star(reached_vertex(v_X))` (iki node arası en kısa yol), `quick_random(...)`. Yol `offline` ile önceden üretilir ve runner'a verilir; runner bu çıktıyı zaten okuyor (Faz 2). Kalan iş: generator seçimini ve yol üretimini tek komuta bağlamak.
- **Senaryo dosyası:** `scenarios/*.json`: model, generator, üretilen yol, secrets referansı. Tekrar çalıştırılabilir.
- **Çıkmaz node'lar:** yol orada biter. Her senaryo temiz bir oturumla (yeni tarayıcı bağlamı) başlar.
- **Rapor:** JSON ve HTML: senaryo, adım adım edge, süre, geçti / kaldı, hata anındaki ekran görüntüsü ve fark (Faz 5'in görünümüyle). Sonra JUnit XML (CI için).
- **İsteğe bağlı:** panelden generator seçip senaryo dosyası indirmek. Testi panelden doğrudan çalıştırmak kapsam dışıdır (native messaging ya da yerel bir sunucu gerekir).

---

## Kapsam dışı

Bu hafta yapılmayacaklar:

- Bilerek farklı ekran boyutunda test (toleranslı mod) ve mobil breakpoint'ler
- Testi panelden doğrudan çalıştırmak
- Java/Selenium test kodu üretimi ([04 > Sonraki adım: test kodu iskeleti](04-veri-modeli.md#sonraki-adım-test-kodu-iskeleti))
- iframe ve Shadow DOM içeriği

---

## Riskler

| Risk | Etki | Önlem |
|---|---|---|
| **Sıra kayması** | Dinamik listelerde `target.index` kayar, yanlış elemente tıklanır. | `selector` yedeği; doğrulamada fark raporu hatayı gösterir. |
| **Gizli durum** | Aynı edge set, aynı durum için yeterli değildir. Doğrulama yalnızca görünen etkileşimli kümeyi kontrol eder; sepet içeriği gibi farkları görmez. | Raporda bu sınır açıkça yazılır. |
| **Piksel oranını çalışırken değiştirmek** | Playwright'ta `deviceScaleFactor` bağlam açılırken verilir. Kayıttaki yakınlaştırmayı oynatmak için çalışma anında değiştirmek gerekir. | Çözüldü: CDP `Emulation.setDeviceMetricsOverride` çalışıyor; ayar gezinmeden sonra da kalıyor. |
| **Sürekli izleme maliyeti** (Faz 3) | Hareketli sayfalarda parmak izi çok sık alınır, kayıt yavaşlar. | Sıklık sınırı; yalnızca anahtar açıkken. |
| **Otomasyon tespiti** | Bazı siteler otomasyonla açılan tarayıcıyı engeller. | Demo hedefi saucedemo. |
| **Java sürümü** | GraphWalker 4.3.3, Java 25 ile çalışmaz. | Çözüldü: geliştirme makinesinde JDK 17 var. |

---

## Bilinen zayıflıklar ve iyileştirme fikirleri

Fazlar ilerledikçe görülen zayıf noktalar ve sonradan yapılabilecek iyileştirmeler. Her madde ilgili kalıcı dokümanda da (01, 03, runner/README) anlatılır; burası toplu liste.

### Görünen alan (Faz 1)

| Zayıflık | Etki | İyileştirme fikri |
|---|---|---|
| Farklı boyuttaki pencerede "Buradan devam et" | Boyut farkı kaydedilmez; test o edge'de tutmayabilir. | Sekme değişiminde yapıldı (Faz 4: yeni sekme farklı boyuttaysa `resize` eklenir). "Buradan devam et" ve kapanmış sekmeden sonra devam için de aynısı yapılabilir. |
| Farklı ölçekli monitöre taşıma | `devicePixelRatio` yakınlaştırmasız değişir, kaydedilmez. | Background'ın yakınlaştırma olayıyla eşleştirip ayırt etmek. |
| Bilerek farklı boyutta test yok | Responsive davranış test edilemez. | Ekran filtresiz ikinci parmak izi ve toleranslı doğrulama modu. |

### Runner (Faz 2)

| Zayıflık | Etki | İyileştirme fikri |
|---|---|---|
| `select` ve `clipboard` oynatılmıyor | Bu aksiyonları içeren edge "desteklenmiyor" diye kalır. | Alanda `setSelectionRange`, sayfada `Range`; pano izni ve `Control+V`. |
| Gizli durum görülmez | Sepet sayısı gibi etkileşimli olmayan farklar doğrulamaya girmez. | Node'a isteğe bağlı metin/değer kontrolleri; görsel fark (Faz 5) yardımcı sinyal olarak. |
| Değerini yalnızca `change` ile işleyen alanlar | Edge'in son aksiyonuysa doğrulama işlenmemiş ekranı görebilir. | Bir sonraki aksiyon aynı alanda değilse `fill`'den sonra `change` göndermek. |
| Temiz oturum | Kayıt giriş yapılmış sayfada başladıysa başlangıç tutmaz. | Playwright `storageState` ile oturumu dosyadan yüklemek. |
| Sonuç yalnızca konsolda | Raporlanamaz, CI'a bağlanamaz. | JSON/HTML rapor, JUnit XML (Faz 6). |
| Runner'ın otomatik testleri repoda yok | Test betikleri her oturumda yeniden yazılıyor. | `runner/test/` altında yerel test sayfalarıyla bir test paketi (eklentinin "bağımlılık yok" ilkesi runner'ı bağlamıyor). |
| Hedef sırası kayabilir | Dinamik listelerde "türün n'incisi" başka elementi gösterebilir. | Selector ile hedefin aynı elementi gösterip göstermediğini kontrol edip uyarmak. |

### Beklemeler (Faz 3)

| Zayıflık | Etki | İyileştirme fikri |
|---|---|---|
| Aksiyonsuz her değişim bekleme sayılır | Sürekli değişen sayfalarda (carousel, canlı akış) edge'ler ekranı değiştiren kısa beklemelerle dolar. | Belirli selector'ları izlemeden hariç tutmak; çok sık değişen sayfada uyarı. |
| Bekleme insanın düşünme süresini içerir | Testler gereğinden yavaş olabilir. | Runner'da "ekranı değiştirmeyen beklemeleri atla" seçeneği. |
| Arka plandaki sekme | Chrome arka plan sekmede zamanlayıcıları yavaşlatır; kullanıcı beklerken başka sekmeye geçerse değişim geç fark edilir, süre uzar. | Sekmeye dönüşte ekrana hemen bakmak; süreyi değişimin olduğu andan almak. |
| İzleme maliyeti | Açıkken her DOM değişiminde (en fazla 3 sn'de bir) parmak izi alınır. | Değişen alt ağaç etkileşimli element içermiyorsa parmak izi almamak. |

### Fareyle üzerine gelme (Faz 3 eki)

| Zayıflık | Etki | İyileştirme fikri |
|---|---|---|
| Değişimi fareye bağlamak tahmindir | Fare hareketinden hemen sonra kendiliğinden gelen değişim üzerine gelmeye mal edilebilir. | Değişen elementlerin tetikleyiciye yakınlığına (DOM'da ortak ata, ekranda yakın konum) bakmak. |
| Tetikleyici en içteki element | Menünün dinleyicisi bir üst elementte olabilir. | Değişen alt ağacı içeren en yakın atayı tetikleyici seçmek. |
| Etiket ve hedef üzerine gelindikten sonra alınır | Etiket açılan butonun yazısını içerebilir; hedefin sırası sonraki ekrana göredir. | Fare girişinde hedefi ve etiketi önceden hesaplamak (yalnızca etkileşimli elementlerde ucuz). |
| CSS ile açılan, etkileşimli olmayan tetikleyici | Ekrana bakılmaz, yakalanmaz. | Fare bir süre durduğunda (ör. 300 ms) her elementte ekrana bakmak. |

### Sekmeler (Faz 4)

| Zayıflık | Etki | İyileştirme fikri |
|---|---|---|
| Sekme adresiyle bulunur | Aynı adreste (URL şablonu) birden fazla açık sekme varsa en son kullanılan seçilir; kayıtta başka biri kastedilmiş olabilir. | Sekmeye açılış zinciriyle (hangi sekme açtı) birlikte kimlik vermek. |
| "Hayır" denen sekmede sonradan "Evet" | O sekmede kaydedilmemiş aksiyonların etkisi tekrar oynatılamaz (kullanıcının açtığı sekme tekrar oynatılırken boş sayfa açılıp adrese gidilir). | "Evet"ten önce sekmede aksiyon yapıldıysa uyarmak. |
| Kullanıcının açtığı sekme = "yeni sekme ve adres" | Adrese giderken gönderilen form, oturum gibi şeyler taşınmaz. | Sekmenin geçmişindeki gezinmeleri de aksiyon olarak almak. |
| Sayfanın kendini kapatması (`window.close()`) | Kayıtta kapanış aksiyonu olur; tekrar oynatırken sayfa zaten kapanmıştır, sonraki adım kapanmış sayfada denenebilir. | Runner'da kapanmış sayfayı izlemek, kapanış aksiyonunda kontrol etmek. |
| Popup ayrı penceredir | Yan panel pencere başınadır; soru ana pencerenin panelinde çıkar, kullanıcı görmeyebilir. | Popup penceresi açılınca bildirim (`chrome.notifications`) ya da rozet. |
| Yalnızca aktif olunca sorulur | Arka planda açılan (Ctrl+tık) sekme, kullanıcı ona geçene kadar sorulmaz. | Açılışta bekleyen soru olarak tutmak. |
| "Buradan devam et" sekme listesini sıfırlar | Kayıt kapanmış sekmelerden sonra sürerse önceki sekmeler kayıttan düşer. | Açık kalan kayıt sekmelerini korumak. |

### Görsel karşılaştırma (Faz 5)

| Zayıflık | Etki | İyileştirme fikri |
|---|---|---|
| Kenar yumuşatma tek tek tespit edilmiyor | Küçük puntolu ince bir metin farkı küçültmede kaybolabilir ya da yumuşatma farkı bölge sanılabilir. | Pixelmatch'in kenar yumuşatma kontrolünü eklemek; ekran görüntüsünü daha yüksek kalitede saklamak (depolama bedeli). |
| Kaydırma konumu farkı | Aynı içerik kaymış göründüğü için büyük bir fark çıkar. | Görüntüleri hizalayarak (dikey kaydırmayı bularak) karşılaştırmak. |
| Animasyon, döngüyle değişen resim, reklam | Önemsiz bölgeler farklı görünür. | Kullanıcının bölgeyi "önemsiz" işaretlemesi; sitede o bölgeyi sonraki karşılaştırmalarda yok saymak. |
| Yalnızca görünen kısım | Ekran dışındaki farklar görülmez. | Tam sayfa ekran görüntüsü (yalnızca karşılaştırma için). |
| Fark metin olarak yok | Sayaç "1 ↔ 2" gibi farkı kullanıcı görselden okumak zorunda. | Node'a görünen metni de kaydedip metin farkını göstermek. |
| Görsel fark runner'da kullanılmıyor | Doğrulama gizli durumu (sepet sayacı) görmüyor. | Doğrulamada yardımcı sinyal: node'un ekran görüntüsüyle fark büyükse uyarı. |

