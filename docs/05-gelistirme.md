# 05: Geliştirme, Hata Ayıklama ve Yol Haritası

## İçindekiler

- [Geliştirme döngüsü](#geliştirme-döngüsü)
- [Hata ayıklama: hangi console nerede?](#hata-ayıklama-hangi-console-nerede)
- [Sık karşılaşılan sorunlar](#sık-karşılaşılan-sorunlar)
- [Nasıl genişletilir? (tarifler)](#nasıl-genişletilir-tarifler)
- [Test](#test)
- [Yol haritası](#yol-haritası)

---

## Geliştirme döngüsü

1. Kodu düzenleyin.
2. `chrome://extensions` sayfasında Graph Recorder kartındaki **yenile (⟳)** ikonuna basın.
3. `content.js`'i, `fingerprint.js`'i ya da `settings.js`'i değiştirdiyseniz kayıt yaptığınız **sayfayı da yenileyin (F5)**. Eski sayfada eski script çalışmaya devam eder.
4. Yan paneli kapatıp tekrar açın.

Kayıtlı graph, eklenti yenilense de silinmez; `chrome.storage.local`'da durur.

Runner için yenileme gerekmez: her çalıştırmada eklentinin `fingerprint.js` ve `settings.js` dosyalarını yeniden okur. Bu iki dosyadaki bir değişiklik kaydı da testi de etkiler; kayıtla test aynı tanımla kalsın diye ikisi birlikte denenmelidir.

---

## Hata ayıklama: hangi console nerede?

Eklentinin üç parçası üç ayrı ortamda çalıştığı için (bkz. [01-mimari.md](01-mimari.md#neden-üç-parça)) üç ayrı DevTools penceresi vardır:

| Parça | DevTools nasıl açılır |
|---|---|
| `background.js` | `chrome://extensions` → Graph Recorder kartında **"Service worker"** linki |
| `sidepanel/` | Yan panelde sağ tık → **İncele** (Inspect) |
| `content.js` | Kayıt yapılan sayfada F12 → Console sekmesi → üstteki **"top"** açılır menüsünden **"Graph Recorder (Bitirme Demo)"** seçilir |

**Aktif graph'ın state'ini görmek** için background ya da panel console'una yazın (graph listesi: `(await chrome.storage.local.get('graphs')).graphs`):

```js
const { activeGraph } = await chrome.storage.local.get('activeGraph');
const state = (await chrome.storage.local.get('graph:' + activeGraph))['graph:' + activeGraph];
state
```

**Belirli bir node'un parmak izini görmek:**

```js
state.nodes.find(n => n.name === 'v_Inventory').elements
```

**Sıfırlamak** için paneldeki **Sıfırla** butonunu (aktif graph) ya da Graph'lar kartındaki ✕'i kullanın. `chrome.storage.local.clear()` tek başına yetmez: background aktif graph'ın ve graph listesinin bir kopyasını bellekte tuttuğu için bir sonraki yazışında eski veriyi geri yazar. Mutlaka `clear()` kullanılacaksa ardından eklentiyi yenileyin.

---

## Sık karşılaşılan sorunlar

| Belirti | Sebep | Çözüm |
|---|---|---|
| *"Bu sayfaya erişilemedi. Sayfayı yenileyip tekrar deneyin."* | Sayfa eklenti yüklenmeden (ya da yenilenmeden) önce açılmıştı, content script yok. | Sayfayı F5 ile yenileyin. |
| Aynı hata, `chrome://` ya da Chrome Web Store sayfasında | Chrome, eklentilerin bu sayfalara kod eklemesine izin vermez. | Normal bir web sitesinde çalışın. |
| Panelde *"Farklı bir sekmedesiniz. Grafa bu sekmede devam edilsin mi?"* | Kayda katılmamış bir sekme aktif oldu (ya da orada "Node oluştur"a basıldı). | Akış bu sekmede sürüyorsa **Evet**; yalnızca bakıyorsanız **Hayır** (sekme bir daha sorulmaz, aksiyonları kaydedilmez). |
| "Bekleyen aksiyonlar" listesi dolmuyor | (1) Henüz hiç node oluşturulmadı (kayıt başlamadı). (2) Başka sekmedesiniz. (3) Eklenti yenilendi ama sayfa yenilenmedi. (4) Aksiyon bir iframe içinde. (5) O aksiyon tipinin Ayarlar'da işareti kaldırılmış. (6) Kayıt sekmesi kapatıldı. | Sırasıyla kontrol edin. (6) için: bir node seçip **Buradan devam et**'e basın. |
| "Node oluştur" butonu kilitli | Son node'dan beri bekleyen aksiyon yok (ilk node hariç node oluşturmak için en az bir aksiyon gerekir) ya da bekleyen bir "aynı node mu?" sorusu var. | Sayfada bir aksiyon yapın ya da soruyu cevaplayın. |
| Tıklamalar sayfaya hiç ulaşmıyor (eklentiyle ilgisiz) | Chrome'un "şifre ihlali" ya da "şifreyi kaydet" diyaloğu açık. | Diyaloğu kapatın. |
| Graph'ta "aynı" sayfa iki ayrı node olarak görünüyor | Element kümeleri birebir aynı değil (bilinçli kural). Console'da iki node'un `elements` dizisini karşılaştırın. Sebep genelde (1) farklı kaydırma konumu ya da pencere boyutu: ekrandaki elementler farklı (node detayındaki görünen alanları karşılaştırın), (2) dinamik ya da veriye bağlı bir id (bkz. [03 > Bilinen zayıflıklar](03-state-eslestirme.md#bilinen-zayıflıklar)). | Fark gerçekten anlamsızsa `fingerprint.js > elementKey()` içinde o id'yi normalleştirin. Node'ları elle birleştirmeyin: farklı kümeler edge çakışması üretir. |
| Yan panel açılmıyor | Chrome sürümü 114'ten eski | Chrome'u güncelleyin. |
| Runner başlangıçta kalıyor (*"Beklenen ekrana varılmadı"*, ilk satır) | Runner her çalıştırmaya boş bir oturumla başlar; kayıt giriş yapılmış bir sayfada başlamıştı. | Kaydı giriş sayfasından başlatın; giriş de bir edge olsun. |
| Runner: *"değeri maskeli (******)"* | Şifre alanının gerçek değeri kayıtta yoktur. | `--secrets` dosyasında hatadaki anahtarla verin: `{ "input:password": "..." }` |
| Runner'da bir edge'de *"Beklenen ekrana varılmadı"*, fark birkaç tür | Sayfa kayıttakinden farklı bir duruma vardı. Farktaki türlere bakın: kaydedilmemiş bir aksiyon (hover ile açılan menü), gizli durum (sepet içeriği, giriş yapan kullanıcı) ya da değişen veri. | Ekran görüntüsüne (`runner/out`) bakın. Edge'i yeniden kaydedin ya da veriye bağlı id'yi `fingerprint.js > elementKey()` içinde normalleştirin. |

---

## Nasıl genişletilir? (tarifler)

### State eşleştirme kuralı

Ayarlanacak bir eşik yoktur. `background.js > findSameStateNodes()` yalnızca URL şablonu ve element kümesi birebir aynı olan node'ları döndürür. Bu kuralı gevşetmek (ör. benzerlik eşiğine geri dönmek) farklı edge set'lerin birleşmesine ve edge çakışmasına yol açar. Gerekçe: [03 > Neden birebir eşitlik?](03-state-eslestirme.md#neden-benzerlik-değil-birebir-eşitlik)

Node sayısı fazla geliyorsa kuralı değil, parmak izini değiştirin: `fingerprint.js > elementKey()` içinde dinamik ya da veriye bağlı id'leri normalleştirin.

### Yeni bir aksiyon tipi eklemek (örnek: çift tıklama)

1. **`content.js`:** dinleyiciyi ekleyin.
   ```js
   document.addEventListener('dblclick', (event) => {
     if (!event.isTrusted) return;
     const el = event.target.closest(INTERACTIVE) || event.target;
     send({ type: 'dblclick', selector: cssSelector(el), label: 'DoubleClick ' + visibleText(el) });
   }, true);
   ```
2. **`settings.js`:** `ACTION_TYPES` listesine ekleyin: `{ type: 'dblclick', text: 'Çift tıkla' }`. Paneldeki adı ve Ayarlar'daki kutusu buradan gelir. Tip varsayılan kapalı olacaksa (gürültülü ya da tahmine dayalıysa, üzerine gelme gibi) `optional: true` ekleyin; o zaman yalnızca işaretlenince kaydedilir (`enabledActions`).
3. **`runner/lib/actions.js > playAction()`:** tekrar oynatma karşılığını ekleyin (ör. `element.dblclick()`). Eklenmezse runner bu aksiyonda adımı "desteklenmiyor" diye başarısız sayar.
4. **`docs/04-veri-modeli.md`** ve **`runner/README.md`:** aksiyon tipleri tablolarına yeni satırı ekleyin.

Background'da değişiklik gerekmez: gelen her aksiyonu, tipi Ayarlar'da işaretliyse buffer'a ekler.

### Yeni bir etkileşimli element türü eklemek (örnek: ARIA checkbox)

`settings.js > INTERACTABLE_TYPES` listesine ekleyin: `{ selector: '[role="checkbox"]', text: 'ARIA checkbox' }`. Başka değişiklik gerekmez: `content.js`'teki `INTERACTIVE` seçicisi, parmak izindeki gruplama, Ayarlar checklist'i ve background'daki filtre bu listeden türer.

### Selector önceliğini değiştirmek

`content.js > cssSelector()` içindeki dizi:

```js
for (const attr of ['data-testid', 'data-test', 'name', 'aria-label']) {
```

Test ettiğiniz site farklı bir test niteliği kullanıyorsa (ör. `data-cy`, `data-qa`) diziye ekleyin. Aynı niteliği `elementKey()` fonksiyonuna da eklemek parmak izini iyileştirir.

### Parmak izine yeni bir sinyal eklemek

1. `fingerprint.js > fingerprint()` dönüş nesnesine yeni alanı ekleyin (ör. `h1: document.querySelector('h1')?.innerText`).
2. Alan `capture` nesnesine otomatik kopyalanır (`{ ...page }`), ama node'a kopyalanmaz. `background.js > commit()` içinde node nesnesine elle eklenmeli.
3. `background.js > findSameStateNodes()` içinde eşleşme koşuluna ekleyin. Sinyal eşleşmeyi yalnızca daraltabilir (daha çok yeni node); element kümesi farklı iki sayfayı eşleştirmemeli.
4. Runner'ın doğrulaması da aynı koşulu kullanmalıysa `runner/lib/oracle.js > compare()` içine ekleyin; yoksa runner bu sinyali kontrol etmeden geçer.

### GraphWalker çıktısına alan eklemek

Dışa aktarım `sidepanel/panel.js > graphWalkerModel()` içindedir. Yeni bir bilgi taşımak için ilgili vertex ya da edge'in `properties` nesnesine ekleyin. GraphWalker'ın kendi alanlarına (`actions`, `guard`, `requirements`, `sharedState`) yalnızca GraphWalker anlamında değer yazın. Değişiklikten sonra çıktıyı GraphWalker CLI ile doğrulayın (bkz. [04 > GraphWalker ile doğrulama](04-veri-modeli.md#graphwalker-ile-doğrulama)).

---

## Test

**Otomatik uçtan uca testler.** `tests/e2e/` altındaki testler eklentiyi gerçek bir Chromium'a yükler, yerel sayfalarda kayıt yapar, paneli ve background'ı mesajlarla sürer, gerekirse modeli runner'da oynatır. Hepsi: `node tests/e2e/run-all.js` (yaklaşık 10 dakika; `--offline` internet isteyeni atlar). Kurulum runner'ınkiyle aynıdır. Liste ve yeni test ekleme: [tests/README.md](../tests/README.md). Aşağıdaki test sonuçları bu testlerden gelir.

**Manuel duman testi (smoke test).** Her değişiklikten sonra 3 dakikada yapılabilir. Adımlar [README > Kullanım](../README.md#3-kullanım-örnek-senaryo) bölümündeki saucedemo senaryosudur. Kontrol listesi:

- [ ] İlk node oluşuyor ve içinde ekran görüntüsü var. Graph'lar kartında aktif graph'ın adı "Swag Labs" oluyor.
- [ ] Graph'lar kartında **Yeni graph**: bekleyen aksiyon varsa silineceği soruluyor; boş graph açılıyor. Eski graph'ın satırına tıklayınca node'ları geri geliyor ve aktif sekme için "Kayıt sekmesi yok ... sürsün mü?" soruluyor. **Dışa aktar** ile inen `.graph.json` **Yükle…** ile "(2)" ekli yeni bir satır olarak geliyor; ✕ onay sorup siliyor.
- [ ] Login sonrası `e_Login` edge'i 3 aksiyonla oluşuyor, şifre `******`.
- [ ] Sepete ekledikten sonra soru **gelmiyor**; yeni node `v_Inventory_2` ve `e_AddToCart` edge'i oluşuyor.
- [ ] Sepetten **Continue Shopping** ile dönünce "aynı node mu?" sorusu geliyor (aday `v_Inventory_2`). "Evet" denince `v_Cart → v_Inventory_2` edge'i çiziliyor.
- [ ] Ürün listesinde menüyü açıp "Node oluştur"a basınca soru gelmiyor, yeni node oluşuyor.
- [ ] Giriş sayfasında node oluşturduktan sonra kullanıcı adı alanına bir şey yazıp (aksiyon) DevTools'ta Login butonuna `disabled` ekleyince, "Node oluştur"da soru gelmiyor, yeni node oluşuyor. Alanı tekrar değiştirip `disabled`'ı kaldırınca ilk node öneriliyor.
- [ ] Sayfayı kaydırınca "Bekleyen aksiyonlar"da `Kaydır  Scroll down → 0, 600` gibi bir satır çıkıyor.
- [ ] "Bekleyen aksiyonlar"da ekranı değiştirmeyen bir aksiyonun ✕'i onu uyarısız siliyor; ekranı değiştiren aksiyonda uyarı çıkıyor, "Vazgeç" silmiyor. "Aynı node mu?" sorusu beklerken ✕ görünmüyor.
- [ ] Ürün listesinde aşağı kaydırıp "Node oluştur"a basınca (ekrana başka ürünler geldi) soru gelmiyor; yeni node ve `e_ScrollDown` edge'i oluşuyor. Tekrar en üste kaydırıp basınca, en üstteki ürün listesi node'u için "aynı state mi?" sorusu geliyor.
- [ ] Ctrl + ile yakınlaştırınca "Bekleyen aksiyonlar"da `Yakınlaştır/Uzaklaştır  Zoom in → %110` gibi bir satır çıkıyor; Ctrl - ile `Zoom out`. Ctrl + tekerlekle birkaç çentik tek satır oluyor. Chrome menüsünden yakınlaştırıp node oluşturunca edge'deki zoom aksiyonunun etkisi "bilinmiyor" değil, "ekranı değiştirdi / değiştirmedi". Başka bir sitenin sekmesinde yakınlaştırma kaydedilmiyor (aynı sitenin başka sekmesinde yakınlaştırılınca Chrome kayıt sekmesini de yakınlaştırır; bu kaydedilir).
- [ ] Pencere kenarını sürükleyince "Bekleyen aksiyonlar"da tek bir `Pencere boyutu  Resize → 1100×760` gibi satır çıkıyor; yan paneli genişletmek ya da DevTools'u açmak da aynı satırı üretiyor. Ctrl + ile yakınlaştırınca bu satır çıkmıyor, yalnızca `Zoom in` çıkıyor. Yalnızca pencere boyutundan oluşan edge'in adı `e_Resize`; tıklama + pencere boyutu edge'inin adı tıklamadan geliyor.
- [ ] Node detayında URL'nin yanında görünen alan (`1280×720`, yakınlaştırmada `@1.25x` gibi) yazıyor. GraphWalker JSON'unda format `graph-recorder/v5`, her vertex'te `viewport`, `resize` ve `zoom` aksiyonlarında varılan `viewport` var.
- [ ] Ayarlar'da **Beklemeler**: alt sınır başta 1 ve pasif; **Beklemeleri kaydet** işaretlenince aktif. Kaydedince durum satırında "Beklemeler kaydediliyor (en az 1,0 sn)" yazıyor; alt sınır boş bırakılırsa 1'e dönüyor.
- [ ] Beklemeler açıkken iki tıklama arasında 2 sn beklemek `Bekle  Wait → 2,0 sn` satırı bırakıyor; 1 sn'den kısa boşluk bırakmıyor. Node oluşturduktan sonra ilk aksiyondan önceki bekleme kaydedilmiyor. Bir alana yazarken beliren buton bekleme sayılmıyor.
- [ ] Belli bir süre sonra kendiliğinden değişen bir sayfada (oturum zaman aşımı) hiçbir şey yapmadan beklemek, ekran değişince `Bekle` satırı bırakıyor; "Node oluştur" `e_Wait` edge'ini oluşturuyor ve aksiyonun yanında "ekranı değiştirdi" yazıyor. Anahtar kapalıyken bekleme satırı hiç çıkmıyor.
- [ ] Ayarlar'da **Üzerine gelme (fare)** başta işaretsiz. İşaretlenince fareyle üzerine gelince açılan bir menü (CSS ya da JS) `Üzerine gelme (fare)  Hover ...` satırı bırakıyor; ekranı değiştirmeyen bir butonun üzerinden geçmek satır bırakmıyor. Fare dururken kendiliğinden gelen değişim hover değil bekleme oluyor.
- [ ] `target=_blank` bir linke tıklayınca panelde "Kayıt sekmesinin açtığı bir sekmedesiniz" kartı çıkıyor. **Evet**: "Bekleyen aksiyonlar"da `Sekme  Open tab ...` satırı, kayıt yeni sekmede sürüyor. Sekmeyi kapatınca `Close tab` ve `Switch to tab` satırları geliyor, kayıt eski sekmede sürüyor.
- [ ] Yeni bir sekmede başka bir siteye gidince kart çıkıyor; **Hayır** deyince o sekmedeki tıklamalar kaydedilmiyor ve o sekmeye tekrar geçince soru çıkmıyor. Orada "Node oluştur"a basınca soru yeniden çıkıyor.
- [ ] Onay kartında her adayın altında "Görsel fark: %..." yazıyor. **Karşılaştır** pencereyi açıyor: Fark görünümünde değişen yer kırmızı ve kutulu; Perde'de sürgü iki görüntüyü açıp kapatıyor; Yan yana'da iki görüntü kutularla. Aday değiştirilebiliyor; pencereden "Evet, bu node" edge'i o adaya çiziyor. Adres farklıysa ve görünen alan farklıysa pencere yazıyor.
- [ ] **Senaryo** bölümünde senaryo yokken ipucu "Yeni senaryo" diyor, edge'e tıklamak edge detayını açıyor. **Yeni senaryo** "Senaryo 1"i ekleyip seçiyor; edge'ler eklendikçe listede kapsama güncelleniyor, panel kapatılıp açılınca senaryo ve seçim duruyor. ✎ satırda yeniden adlandırıyor, ✕ onay sorup siliyor. Senaryonun kullandığı bir edge silinince satırda ⚠, Geri al ile kalkıyor.
- [ ] **Senaryo** bölümü açılınca graph soluklaşıyor, başlangıçtan çıkan edge'ler kesik çizgili. Edge'e tıklayınca koşuya ekleniyor (sıra numarasıyla vurgulu); koşunun vardığı node'dan çıkmayan edge reddediliyor. Çıkmaz node'da ipucu "Yeni koşu" diyor. **Senaryo indir** dosyayı `<Model>-<Senaryo>.json` adıyla indiriyor; **Yükle…** listeye yeni senaryo olarak ekliyor. Bölüm kapanınca graph normale dönüyor.
- [ ] İndirilen senaryo `node runner/run.js <Model>-<Senaryo>.json` ile oynuyor; `runner/out/...` altında `report.html`, `report.json`, `junit.xml` oluşuyor.
- [ ] Senaryo bölümünde **Koşuyu oynat**: koşuda şifre varsa önce şifre kutusu doluyor. Sekme koşunun ilk node'unda değilse "Başlangıç node'ları aynı değil ... doğru sonuç vermeyecektir" kartı çıkıyor ("Vazgeç" / "Yine de oynat"). İlk node'dayken oynatma başlıyor: Chrome'un "hata ayıklama" çubuğu çıkıyor, elementler çerçevelenip tıklanıyor, graph'ta geçen edge'ler yeşil, adım listesi doluyor; bitince çubuk kalkıyor, "Koşu geçti" ve kayıt son node'dan sürüyor. Oynatma sürerken "Bekleyen aksiyonlar"a bir şey eklenmiyor. **Durdur** ve çubuktaki "İptal" oynatmayı durduruyor. Kalan bir adımda fark listesi ve **Beklenen ekranla karşılaştır** çıkıyor.
- [ ] Senaryo bölümünde **Başlangıç** listesinin ilki "(graph'ın başlangıcı)". Başka bir node seçilince graph'ta o node çift çizgili, ipucu "yalnızca panelde oynatılır" diyor, gidilebilecek edge'ler o node'dan çıkanlar; dolu koşular o node'dan yürünemiyorsa temizleniyor. İndirilen senaryoda `start` var; runner bu senaryoyu "node'undan başlıyor" diye reddediyor; panelde o node'un ekranından oynatma çalışıyor.
- [ ] Başka bir sitedeyken **Koşuyu oynat**: kartta **Başlangıç node'una dön (adres …)**. Basınca sekme başlangıç sayfasına gidiyor, "Bekleyen aksiyonlar"da `GoTo …` satırı çıkıyor, kartta en fazla "silinecek" uyarısı kalıyor. saucedemo'da çıkış yapılmışken `inventory.html` başlangıçlı senaryoda buton "Site başka bir adrese yönlendirdi" diyor, kart kalıyor.
- [ ] Pencereyi daraltıp ya da yakınlaştırmayı değiştirip **Koşuyu oynat**: kartta "Görünen alan farklı" ve **Başlangıç node'una dön (boyut …)**. Basınca yakınlaştırma ve pencere boyutu kayıttakine geliyor, kart güncelleniyor. Pencere tam ekranken ve kayıttan sonra yan panel genişletildiyse pencere tam ekranda kalıyor, kart "yan paneli yaklaşık N piksel daraltın" diyor; panel sürüklendikçe N azalıyor, tutunca kart kendiliğinden yenileniyor.
- [ ] Sayfada (alan dışında) Escape'e basınca `Tuş  Press Escape` satırı çıkıyor; ok tuşunu basılı tutunca tek satır `Press ArrowDown ×N` oluyor. Alana yazılan harfler satır üretmiyor; alan değeri `Fill` olarak geliyor. Ctrl +, F5, Tab ve butonda Enter tuş olarak kaydedilmiyor.
- [ ] Arama kutusuna yazıp ArrowDown ile öneri seçip Enter'a basınca sıra: `Fill`, `Press ArrowDown`, `Submit`.
- [ ] Türkçe klavyede bir alana `@` yazmak (AltGr+Q) tuş olarak kaydedilmiyor.
- [ ] Bir paragrafta fareyle sürükleyerek metin seçince `Metin seç  Select "..."` satırı çıkıyor, `Tıkla` satırı çıkmıyor. Kelimeye çift tıklayınca tek bir `Select` satırı kalıyor.
- [ ] Alanda Shift+← ile seçim genişletince tek `Select` satırı kalıyor; alanda Ctrl+A `Select`, sayfada Ctrl+A `Press Control+a`.
- [ ] Sayfada Space ya da PageDown ile kaydırınca yalnızca `Scroll down` geliyor, `Press Space` gelmiyor.
- [ ] Sağ tıklayınca `Sağ tık menüsü  Right click ...` satırı çıkıyor, `Tıkla` çıkmıyor. Kendi menüsünü açan bir sitede (ör. Google Drive) satırda "sayfanın kendi menüsü" yazıyor.
- [ ] Formda Tab ile alandan alana geçmek satır bırakmıyor (sayfa durulunca düşüyor). "İçeriğe atla" linki olan bir sitede ilk Tab `Focus ...` satırı bırakıyor.
- [ ] Arama kutusuna yazıp alandan çıkmadan yan paneldeki "Node oluştur"a basınca edge'de `Fill` var (sayfa odağı kaybedince `change` gelir).
- [ ] Seçili metni Ctrl+C ile ve sağ tık > Kopyala ile kopyalayınca `Kopyala/Kes/Yapıştır  Copy "..."` satırı çıkıyor; `Tuş` satırı çıkmıyor. Kopyalamayı engelleyen bir sitede satırda "sayfa engelledi" yazıyor.
- [ ] `contenteditable` bir alana yazıp dışına tıklayınca `Fill` satırı çıkıyor; değiştirmeden çıkınca çıkmıyor.
- [ ] Son node'dan beri hiçbir aksiyon yoksa "Node oluştur" butonu kilitli; üzerine gelince sebebi yazıyor. Bir aksiyon yapınca açılıyor.
- [ ] Ayarlar'da **Kaydır**'ın işaretini kaldırınca kaydırmalar "Bekleyen aksiyonlar"a eklenmiyor; tek başına kaydırma butonu açmıyor.
- [ ] Ayarlar'da **Link**'in işaretini kaldırınca, yalnızca linkleri farklı olan bir sayfa için yeni node yerine "aynı state mi?" sorusu geliyor. İşaret geri konunca aynı sayfa yeni node oluyor.
- [ ] **Sıfırla** ayarları değiştirmiyor; panel kapatılıp açılınca kutular aynı.
- [ ] Çark Ayarlar penceresini açıyor. Açılışta **Kaydet** pasif; bir kutu değişince aktif, geri alınınca yine pasif.
- [ ] Kaydetmeden ✕, Esc ya da pencere dışına tıklayınca uyarı çıkıyor. "Geri dön" değişiklikleri koruyor, "Kaydetmeden çık" atıyor (tekrar açınca kayıtlı hali), "Kaydet ve çık" kaydediyor.
- [ ] Aynı küme için bir kez "Hayır, yeni node" dedikten sonra o sayfaya tekrar gelince onay kartı **iki** adayı listeliyor. İkinci aday seçilince yeni node oluşmuyor, edge o node'a çiziliyor.
- [ ] Kartta "(şu anki node)" adayının "Evet, bu node"u iki seçenekli pencere açıyor. "Node oluşturma, aksiyonlara devam et": edge oluşmuyor, aksiyonlar "Bekleyen aksiyonlar"a geri dönüyor. "Kendine dönen edge olarak kaydet": self-loop çiziliyor. "Geri dön" karta döndürüyor.
- [ ] Bir edge seçince aksiyonların yanında "ekranı değiştirdi / değiştirmedi" işareti var. Değiştirmeyen aksiyon ✕ ile uyarısız siliniyor; değiştiren aksiyon için gerekçeli uyarı çıkıyor. Tek aksiyon kalınca ✕ pasif.
- [ ] Bir node'u (ya da edge'i) silince "Geri al" aktifleşiyor; Ctrl+Z ya da butonla node bağlı edge'leriyle geri geliyor.
- [ ] Çarkın solundaki ay/güneş temayı değiştiriyor; panel kapatılıp açılınca seçim duruyor.
- [ ] "Hayır, yeni node" ile oluşan kopya node'da **Birleştir…** penceresi açılıyor: kopyanın aslı seçilebilir, edge set'i farklı node'lar sebebiyle pasif. Birleştirince aradaki edge kendine dönen edge oluyor; Ctrl+Z geri alıyor.
- [ ] Ürün detayından tarayıcının geri tuşuyla dönünce edge adı `e_Back` oluyor.
- [ ] Node/edge'e tıklayınca detay kartı açılıyor, isim değiştirilebiliyor.
- [ ] Mevcut node silinince durum satırı "seçili değil" diyor. "Buradan devam et" çalışıyor.
- [ ] Eklenti yenilenince graph kaybolmuyor.
- [ ] **GraphWalker JSON** ile inen `<Model>.json`, GraphWalker CLI'da `check` ile hatasız geçiyor ve `offline` yol üretiyor (Java 17 ile).

**Otomatik test.** Geliştirme sırasında eklenti Puppeteer ile gerçek Chrome'a yüklenip üç şekilde test edildi:

1. **Background mantığı:** yerel bir test sitesinde 18 kontrol.
2. **Panelin gerçek butonları:** "Node oluştur", onay kartındaki "Evet" ve "Hayır" butonlarına tıklanarak 15 kontrol yapıldı. Bunlar arasında "Evet → şu anki node'dan eşleşen node'a edge" kuralı ve "aksiyon yoksa soru sorulmaz" kuralı da var.
3. **Canlı saucedemo.com:** [03](03-state-eslestirme.md#gerçek-ölçümler-saucedemocom)'teki ölçümler bu çalıştırmadan alınmıştır.

Bu üç test önceki (Jaccard benzerliği) sürümle yapıldı. Birebir eşitlik kuralı, mock'lanmış Chrome API'leriyle `background.js` üzerinde ayrıca test edildi: farklı küme (tek element farkı dahil) soru sormadan yeni node, sıra farkı olan aynı küme soru, aynı küme ama farklı URL şablonu yeni node. `content.js` da DevTools protokolüyle (CDP) sürülen headless Chrome'da, 800×600 pencerede bir test sayfasıyla denendi:

- **Elenenler:** `disabled` buton, disabled `<fieldset>` içi, `aria-disabled="true"`, `inert`, `display:none`, `visibility:hidden`, `pointer-events:none`, ekranın altında kalan (kaydırınca görünecek) buton, `transform` ile ekran dışına itilmiş menü linki, kaydırma kutusunun görünmeyen kısmındaki buton, üstü bir katmanla kapalı buton.
- **Sayılanlar:** `opacity:0`, gizli bir ebeveyn içindeki `visibility:visible` buton, satıra bölünmüş link, içinde blok element olan link, ekran kenarında yarım görünen buton.
- **Aksiyonlar:** Buton tekrar aktifleşince küme eski haline dönüyor. Sayfa kaydırması (aşağı/yukarı), kutu kaydırması ve gerçek fare tekerleği kaydırması doğru konum ve yönle kaydediliyor. Sahte (`isTrusted=false`) `scrollend` yok sayılıyor.

Not: `--virtual-time-budget` ile çalışan headless modda ikinci ve sonraki `scrollend` olayları gelmedi; gerçek zamanlı (CDP) testte hepsi geldi. Bu, sanal zamanın bir yan etkisi.

**Uçtan uca test (gerçek eklenti).** Chrome 137 ve sonrasının markalı sürümlerinde `--load-extension` çalışmıyor. Bu yüzden eklenti, CDP'nin `Extensions.loadUnpacked` komutuyla yüklendi (`--remote-debugging-pipe --enable-unsafe-extension-debugging` gerekir; `file://` sayfalarına content script girmediği için test sayfası yerel bir HTTP sunucusundan açıldı). Panel sayfası ayrı bir pencerede gerçek `chrome.*` API'leriyle çalıştı. Tıklama ve kaydırma gerçek fare olaylarıyla gönderildi, ayarlar Ayarlar penceresinin kutularına ve butonlarına tıklanarak değiştirildi. Doğrulananlar:

- Checklist'ler `settings.js`'ten doluyor (7 aksiyon tipi, 12 element türü), varsayılan hepsi işaretli.
- Çark Ayarlar penceresini açıyor. Kaydet yalnızca değişiklik varken aktif (değişiklik geri alınınca pasif). Kaydetmeden ✕ ve Esc uyarı açıyor; "Geri dön" taslağı koruyor, "Kaydetmeden çık" storage'a yazmıyor ve tekrar açınca kayıtlı hali gösteriyor, "Kaydet ve çık" kaydedip iki pencereyi de kapatıyor. Değişiklik yokken pencere dışına tıklama doğrudan kapatıyor.
- Node elementleri sayılı küme olarak (`{ key, types, count }`) saklanıyor; iki türe uyan buton tek girdi. Tıklama aksiyonu `target: { key: "button:toggle", index: 1 }` taşıyor.
- Bekleyen aksiyon 0 iken buton kilitli ve background isteği reddediyor.
- İşaretsiz **Kaydır** aksiyonu buffer'a girmiyor ve butonu açmıyor; tıklama giriyor.
- **Link** işaretsizken sadece link farkı olan sayfa için soru geliyor (filtre eski node'a da uygulandı); işaret geri konunca aynı fark yeni node oluyor.
- Onay kartındaki "Evet, bu node" butonu panelden tıklanınca edge seçilen node'a çiziliyor. Şu anki node seçilince iki seçenekli pencere açılıyor: "Geri dön" kararı bekletiyor; "devam et" edge oluşturmadan aksiyonu buffer'a geri veriyor (Node oluştur butonu açık kalıyor); sonraki denemede "Kendine dönen edge" biriken iki aksiyonu tek self-loop'ta kaydediyor.
- Ayar değişince iki node aynı kümeye indiğinde kart iki adayı listeliyor (şu anki node önce, "(şu anki node)" etiketiyle), alt buton "Hiçbiri, yeni node" oluyor; ikinci aday seçilince yeni node oluşmadan edge ona çiziliyor.
- **Sıfırla** ayarları koruyor.
- Panelin ürettiği GraphWalker modeli (`graphWalkerModel()`), GraphWalker CLI 4.3.3'te `check` ile hatasız geçti ve `offline` ile edge kapsaması yolu üretti.
- **Edge düzenleme:** "noop, noop, toggle" edge'inde işaretler "değiştirmedi, değiştirmedi, değiştirdi". Değiştirmeyen aksiyon uyarısız silindi ve "düzenlendi (kayıtta 3)" göründü. Değiştiren son aksiyon için gerekçeli uyarı ("ortaya çıkan: `a:new-link +1`", "edge'in son aksiyonu") çıktı, Vazgeç silmedi. Tek aksiyon kalınca sil butonu pasif oldu ve background da reddetti. GraphWalker çıktısında `edited`/`recordedActions` var, ekran parmak izleri yok.
- **Geri al:** Panelden silinen node (bağlı edge'iyle) Ctrl+Z ile, silinen edge "Geri al" butonuyla geri geldi; düzenlenmiş edge düzenlenmiş haliyle döndü.
- **Tema:** Ay/güneş butonu temayı değiştiriyor, tercih `localStorage`'a yazılıyor, sayfa arka planı ve graph renkleri temaya uyuyor.
- **Node birleştirme:** Panelde "Hayır, yeni node" ile kopya oluşturuldu. Birleştir penceresinde edge set'i farklı node pasif ve sebebi yazılı ("edge set farklı: `a:new-link` 5 ≠ 4"); kopyanın aslı seçilebilir, varsayılan olarak önce oluşturulan kalıyor. Birleştirince aradaki edge kendine dönen edge oldu, Ctrl+Z geri aldı. Link türü kapatılınca farklı node birleştirilebilir hale geldi ve "yalnızca Ayarlar ... yüzünden eşit" uyarısı çıktı; tür açıkken background aynı isteği reddetti.
- **Bulunan yarış durumu:** Ayarlar penceresi kapatılıp çok hızlı yeniden açılınca geç gelen `close` olayı yanlışlıkla "kaydedilmemiş değişiklik" uyarısı açıyordu (dört koşunun birinde). Pencere yeniden açıldıysa eski `close` olayı artık yok sayılıyor; düzeltmeden sonra dört koşunun dördü de geçti.

**Pencere boyutu ve yakınlaştırma.** Eklenti, Playwright'ın Chromium'una `--load-extension` ile yüklendi (markalı Chrome'un aksine Chromium'da çalışır). Pencere boyutu CDP'nin `Browser.setWindowBounds` komutuyla, kullanıcının pencereyi sürüklemesi gibi değiştirildi; yakınlaştırma `chrome.tabs.setZoom` ile yapıldı. Test sayfasında `min-width: 1000px` medya sorgusuyla yalnızca geniş ekranda görünen bir buton vardı. 18 kontrolün hepsi geçti:

- Node'un `viewport`'u sayfanın `innerWidth × innerHeight` ve `devicePixelRatio` değeriyle aynı.
- Genişliği 1200'den 900'e altı adımda küçültmek tek bir `resize` aksiyonu üretti; aksiyon varılan boyutu taşıyor ve geniş ekran butonu kaybolduğu için "ekranı değiştirdi" işaretli.
- %125 yakınlaştırma `resize` üretmedi; `zoom` aksiyonu varılan boyutu (`devicePixelRatio: 1.25`) saklıyor.
- Tıklama + boyut + yakınlaştırma edge'inin adı `e_Always`; yalnızca boyuttan oluşan edge'in adı `e_Resize`.
- Dışa aktarım `graph-recorder/v5`; vertex'lerde ve `resize`/`zoom` aksiyonlarında `viewport` var, `changed` yok. Node detayında `707×599 @1.25x` yazıyor.

Parmak izi kodu `fingerprint.js`'e taşındıktan sonra aynı test (iki ek kontrolle: `settings.js > urlKey()` ve panelin fark metni) tekrar koşuldu; 20 kontrolün hepsi geçti.

**Runner.** Uçtan uca: eklentiyle kayıt → dışa aktarım → (GraphWalker) → runner. Kayıt, canlı saucedemo.com'da eklenti yüklü Chromium'la yapıldı: giriş (`******` şifreyle), sepete ekleme, sepet, %125 yakınlaştırma ve geri, alışverişe dönüş, pencereyi daraltma ve geri genişletme. Sonuç 6 node ve 8 edge; iki edge aynı adı (`e_Resize`) taşıyor. Model, panelin dışa aktarımıyla (`graphWalkerModel()`) alındı.

- **Tüm yol:** 8/8 edge geçti (8,5 sn). Kayıttaki gerçek yakınlaştırma ve pencere boyutu, runner'da görünen alan emülasyonuyla aynı state'e vardı.
- **Bozuk hedef:** `e_AddToCart`'ın hedefi elle `v_Inventory` yapıldı. Runner o edge'de durdu, farkı tam olarak yazdı (`button:add-to-cart-sauce-labs-backpack: beklenen 1, ekranda 0` ve `button:remove-...: beklenen 0, ekranda 1`), ekran görüntüsünü kaydetti; çıkış kodu 1.
- **Eksik şifre:** `--secrets` olmadan `e_Login`'in 2. aksiyonunda eksik anahtarı (`input:password`) yazarak durdu.
- **Olmayan edge:** Yolda o node'dan çıkmayan bir edge, tarayıcı açılmadan çıkış kodu 2 ile reddedildi.
- **Yakınlaştırma:** Yalnızca 1000 px üstünde görünen butonlu yerel bir sayfada kayıt yapıldı: %125 yakınlaştırma butonu gizledi, geri almak gösterdi; pencereyi daraltmak da aynısını yaptı. Runner'da dört edge geçti. Yakınlaştırmanın varılan boyutu modelden silinince (eski kayıt) boyut oranlardan hesaplandı, yine geçti. Ölçüm: emülasyondan sonra sayfa `innerWidth × innerHeight` için 947×599 ve `devicePixelRatio` için 1.25 görüyor; gezinmeden sonra da aynı.
- **GraphWalker:** CLI 4.3.3 (Java 17) `check` ile v5 modelinde sorun bulmadı. `offline "random(edge_coverage(100))"` 12 ve 10 edge'lik iki yol üretti; düz (`currentElementName`) ve `--verbose` (`currentElementID`) çıktıların ikisi de runner'da geçti.

**Beklemeler.** Yerel bir test sayfasında: iki buton, yazınca beliren bir "Temizle" butonu ve son tıklama ya da tuştan 4 sn sonra ekranı kendiliğinden "Oturum sona erdi"ye çeviren bir zaman aşımı. 15 kontrolün hepsi geçti:

- Ayarlar arayüzü: alt sınır varsayılan 1 ve anahtar kapalıyken pasif; işaretleyince alan ve Kaydet aktif; boş alt sınır kaydedilince 1'e döndü; durum satırı güncellendi.
- Tıkla, 1,5 sn bekle, Tıkla, 0,3 sn sonra Tıkla, yaz, Tıkla: edge `click, wait (1,2 sn, ekranı değiştirmedi), click, click, input, click`. Kısa boşluk ve node'dan sonraki ilk boşluk kaydedilmedi; yazarken beliren buton bekleme sayılmadı.
- Hiçbir şey yapmadan beklemek: zaman aşımı ekranı değiştirince tek bir bekleme (3,7 sn, ekranı değiştirdi) kaydedildi; "Node oluştur" `e_Wait` edge'ini oluşturdu. Panelde `Bekle  Wait → 3,7 sn`.
- Anahtar kapalıyken iki tıklama arasındaki 1,5 sn kaydedilmedi.
- Runner aynı modelin üç edge'ini (zaman aşımı dahil) geçti.

Bu değişiklikten sonra önceki testler de tekrar koşuldu ve geçti: pencere boyutu (20/20), yakınlaştırma tekrarı (4/4, iki model), saucedemo kayıt ve runner (8/8).

**Fareyle üzerine gelme.** Yerel bir test sayfasında: CSS `:hover` ile açılan bir menü ("Ürünler" → "Bir"), `mouseenter` ile "Satın al" butonu çıkan bir kart (etkileşimli olmayan tetikleyici), etkisiz bir buton ve tıklamadan 2 sn sonra kendiliğinden buton ekleyen bir zamanlayıcı. 13 kontrolün hepsi geçti:

- Ayarlar: "Üzerine gelme" listede ve varsayılan işaretsiz, diğer tipler işaretli; işaretleyince `enabledActions: ["hover"]` kaydedildi, pencere tekrar açılınca işaretli.
- Etkisiz butonun üzerine gelmek kayda girmedi. CSS menü `hover(#products)` (hedef `a:products #1`, ekranı değiştirdi) ve ardından alt menüye tıklama: edge `e_Bir`. JS kartı `hover(#card)`.
- Fare dururken gelen değişim `hover` değil bekleme oldu; tıklamaya giderken karttan çıkmanın etkisi ayrı bir aksiyon olmadı, tıklamanın öncesine katıldı.
- Ayar kapalıyken üzerine gelme kaydedilmedi. Runner üç edge'i (hover'lar dahil) geçti.

İlk koşuda JS kartı bekleme olarak kaydedildi: tarayıcı `mouseover` / `mouseenter`'ı `mousemove`'dan önce gönderdiği için fare konumu kartın menüsü açıldığında henüz güncellenmemişti. Konum artık sınır olaylarında da (`mouseout`, `mouseover`) güncelleniyor. Ardından bekleme, pencere boyutu, yakınlaştırma ve saucedemo testleri tekrar koşuldu ve geçti.

**Sekmeler.** İki yerel sunucuyla (iki ayrı origin: "başka site") bir mağaza (`target=_blank` linkle "Dokümanlar" sekmesini açar) ve bir posta sayfası ("Doğrula"). Eklenti Chromium'da, panel ayrı bir sekmede gerçek `chrome.*` API'leriyle çalıştı; sekmeler gerçekten açılıp kapatıldı. 21 kontrolün hepsi ilk koşuda geçti:

- Linkle açılan sekme: kart "Kayıt sekmesinin açtığı..." metniyle çıktı (`openedByPage: true`). **Evet**: kayıt yeni sekmede, aksiyonlar `click, tab(open, page)`, sekme aksiyonu "ekranı değiştirdi"; node ve `e_OpenTabDocs` edge'i.
- Yeni sekmede tıklayıp sekmeyi kapatmak: `click, tab(close, aktif), tab(switch)`; kayıt eski sekmede sürdü, oradaki ekran ilk node ile aynı state olarak önerildi.
- Kullanıcının açtığı başka site: kart (`openedByPage: false`). **Hayır**: sekme hatırlandı, oradaki tıklama kaydedilmedi; kayıt sekmesine dönüp tekrar gelince soru çıkmadı. Orada "Node oluştur": soru yeniden çıktı.
- Başka bir sekmede başka site, **Evet**: `tab(open, user), click`; o sitede node.
- Kayıt sekmelerinin hepsi kapandıktan sonra yeni bir sekmede **Evet**: sekme şu anki node'un ekranında değilken reddedildi; sayfada aynı ekrana gelindikten sonra kayıt o sekmede sürdü.
- Runner üç edge'i iki sekmede oynattı ve geçti (linkle açılan sekmeye geçiş, kapatıp dönüş, başka sitede yeni sekme).

**Görsel karşılaştırma.** Yerel bir sepet sayfası: sayaç ("Sepet (n)", etkileşimli değil) ve büyük renkli bir afiş; link ve buton her sayfada aynı. Üç ziyaretle iki aday oluştu: yalnızca sayacı farklı olan ve yalnızca afişi farklı olan. 18 kontrolün hepsi geçti:

- Kartta iki adayın altında görsel fark: afiş farkı %28,9, sayaç farkı <%0,1 (%0,012, tek bölge). Sayaç farkının kutusu sayfadaki rakamın konumunu içeriyor (CSS pikselinden karşılaştırma ölçeğine çevrilerek ölçüldü). Aynı görüntü %0, bölge yok.
- Pencere: Fark görünümü (bir tuval), bilgi satırı, adres farkı uyarısı; Perde (üstteki görüntü ve sürgü), Yan yana (iki tuval); aday değiştirince oran değişti. Pencereden "Evet, bu node": edge seçilen adaya çizildi, pencere kapandı.
- Pencere daraltılıp aynı sayfada tekrar sorulunca "Görünen alanlar farklı" uyarısı çıktı.

İlk sürümde Fark görünümü 480 piksellik karşılaştırma ölçeğinde çiziliyordu ve büyütülünce bulanıktı; görüntü artık tam çözünürlükte çiziliyor, fark ve kutular büyütülüyor. Ardından pencere boyutu, bekleme, üzerine gelme ve sekme testleri tekrar koşuldu ve geçti.

**Senaryo ve raporlar.** Çıkmaz node'u olan bir yerel site kaydedildi: ana sayfa → A → ana sayfa, ana sayfa → B (B'den çıkış yok). 23 kontrolün hepsi geçti:

- Panelde Senaryo bölümü: başlangıçtan çıkan iki edge kesik çizgili; B'ye giden edge koşu 1 oldu ("1/3 edge · 2/3 node"), ipucu çıkmaz node'u söyledi, koşunun edge'i vurgulu ve vardığı node işaretli. Koşu B'de bitmişken A'ya giden edge reddedildi. "Yeni koşu" ile A ve geri: "3/3 edge · 3/3 node · 2 koşu", sekmeler "Koşu 1 (1) | Koşu 2 (2)", edge'de sıra numarası; geri al son edge'i sildi; bölüm kapanınca vurgular kalktı.
- "Senaryo indir": `Ana-senaryo.json` (`model: "Ana.json"`, koşular `[[B], [A, geri]]`, kapsama 3/3); temizleyip "Yükle…" ile geri yüklendi.
- Runner: iki koşu, 5/5 adım geçti; `report.json` (2 koşu, 5 adım), `junit.xml` (2 testsuite, 5 testcase, 0 hata), `report.html` "GEÇTİ".
- Bozuk model (B'ye giden edge "ana sayfaya varır" dendi) ve ilk koşuya bir edge daha eklendi: ilk koşu kırıldı, kalan adımı atlandı, ikinci koşu yine geçti (4/6 adım, çıkış kodu 1). `junit.xml`: 1 hata, 1 atlandı, geçerli XML. `report.html` tarayıcıda açıldı: fark tablosu (3 tür), iki ekran görüntüsü ve görsel fark tuvali çizildi.

İlk koşuda test, panelde edge'e "tıklamak" için `cy.getElementById(id).emit('tap')` sonucunu döndürdüğü için takıldı: Playwright cytoscape koleksiyonunu (döngüsel bir nesne) serileştirmeye çalışıyordu. Ürün kodunda değil test betiğindeydi; fonksiyon artık değer döndürmüyor.

Ardından bekleme, üzerine gelme, pencere boyutu, yakınlaştırma ve saucedemo testleri tekrar koşuldu ve geçti.

**Panelde oynatma.** Yerel bir test sitesi gerçek kullanıcı olaylarıyla kaydedildi (8 node, 7 edge): şifreli giriş (şifre JavaScript'le kontrol ediliyor), tıklama, açılır liste, checkbox, alanda Escape, CSS hover menüsü ve `target=_blank` ile yeni sekme. Tüm edge'ler tek koşu yapılıp paneldeki butonlarla oynatıldı; 27 kontrolün hepsi tarayıcı yakınlaştırması %100'de ve %150'de geçti:

- Koşuda maskeli alan olduğu için şifre kutusu çıktı; boşken oynatma hata verdi. Sekme ürün sayfasındayken "Başlangıç node'ları aynı değil ... doğru sonuç vermeyecektir" kartı çıktı; test sırasında yapılan gezinmeler "Bekleyen aksiyonlar"da olduğu için başlangıç doğruyken de "N aksiyon silinecek" kartı çıktı.
- Oynatma sürerken durum satırı ("Oynatılıyor · adım 1/7 ..."), Durdur butonu, "Node oluştur" kilidi ve kayıt bayrağı doğru. 7/7 edge geçti (~5,5 sn, Yavaş kapalı). Oynatma boyunca yeni node, edge ya da aksiyon kaydedilmedi, sekme sorusu sorulmadı. Bitince kayıt son node'dan ve oynatmanın açtığı yeni sekmeden sürdü (oradaki tıklama kaydedildi), bayrak kalktı, eklenti sekmelerden ayrıldı, graph'ta 7 edge yeşildi.
- Site bozuldu (ürün sayfasına fazladan buton): ilk edge kaldı, fark `button:extra: beklenen 0, ekranda 1`, kalan 6 adım atlandı, ekran görüntüsü alındı, "Beklenen ekranla karşılaştır" penceresi görsel farkı çizdi. Kalınca şu anki node boşaldı ve panel "Buradan devam et"i söyledi.
- Yavaş modda başlatılıp Durdur'a basıldı: "Durduruldu", bayrak kalktı.

İlk denemede son edge kaldı: hover menüsü açıkken linkin yeri ölçülüyor, fare linke giderken menü kapanıp link yukarı kayıyordu; tıklama eski noktaya düşüyordu. Artık fare önce elementin üzerine gelip konum yeniden ölçülüyor, element bir katmanın altındaysa bekleniyor. Yakınlaştırmada fare koordinatlarının sayfanın CSS pikselinde verilmesi gerektiği %150 testinde doğrulandı (ekranın piksel birimiyle denenince giriş tıklaması ıskaladı). Ardından pencere boyutu, bekleme, üzerine gelme, sekme, karşılaştırma, senaryo ve yakınlaştırma testleri (runner dahil; durulma artık `fingerprint.js`'ten) tekrar koşuldu ve geçti.

**Başlangıç node'u ve kayıttaki boyuta getirmek.** 4 node'lu bir site kaydedildi (giriş → uygulama → göster → onay); 14 kontrolün hepsi geçti. Başlangıç listesi graph'ın başlangıcıyla başladı; ikinci node seçilince ipucu çıktı, graph'ta o node işaretlendi, gidilebilecek tek edge onun edge'iydi; giriş edge'i reddedildi; kapsama "2/3 edge · 3/4 node". İndirilen senaryoda `start` vardı; runner onu çıkış kodu 2 ve "node'undan başlıyor" mesajıyla reddetti; "Yükle…" başlangıcı geri getirdi. Pencere 1000×720'ye küçültülüp yakınlaştırma %125 yapıldı: kartta "Görünen alan farklı: kayıtta 1184×749, şu an 787×455 @1.25x" ve buton çıktı; butondan sonra görünen alan tam 1184×749 @1x oldu, kartta yalnızca bekleyen aksiyon uyarısı kaldı; seçilen başlangıçtan oynatma 2/2 geçti. Başlangıç graph'ın başlangıcına geri alınınca koşu yürünemediği için temizlendi. İlk denemede pencere Chrome'un "en az %50'si ekranda" kuralına takıldı (test tarayıcısının sanal ekranı küçüktü); pencere artık ekranın kullanılabilir alanına sığdırılıyor.

Elle testte buton tam ekran pencereyi normal boyuta aldı ve görünen alan daha da küçüldü (1483×1128'den 1463×1118'e): fark pencereden değil, kayıttan sonra genişletilen yan panelden geliyordu ve tam ekran pencere zaten büyüyemezdi. Artık pencere büyüyemiyorsa ona dokunulmuyor, kullanıcı yan paneli daraltmaya yönlendiriliyor; sonuç kötüleşirse pencere eski haline dönüyor. Taklit edilmiş Chrome API'leriyle birim testi (7 kontrol): tam ekran ve genişlik eksik (pencere değişmedi, eksik 287 × 0,8 = 230 ekran pikseli), tam ekrandan küçülme (normal pencere, tuttu), ekrandan büyük normal pencere (dokunulmadı), yakınlaştırma ve pencere birlikte, kötüleşince geri alma, yaklaşıp tutturamayınca kalma. Uçtan uca testte pencere tam ekrana alınıp geniş yan panel sekmenin genişliği daraltılarak taklit edildi (19 kontrolün hepsi geçti): pencere tam ekranda kaldı, kart "287 piksel daraltın" dedi, buton gizlendi; daraltıldıkça "100 piksel", fazla daraltınca "10 piksel fazla daralttınız" yazdı; tutunca yönlendirme bitti ve görünen alan uyarısı kalktı. Küçük sanal ekranda pencereye dokunulmadı, yakınlaştırma düzeldi, genişlik ve yükseklik için ayrı yönlendirme çıktı.

**Senaryo listesi.** Üç node'lu yerel bir sitede (ana sayfa → A → geri, ana sayfa → B çıkmaz) 26 kontrolün hepsi geçti. Senaryo yokken ipucu göründü, düzenleme alanı gizliydi, edge'e tıklamak senaryo oluşturmadı, edge detayını açtı. "Yeni senaryo" "Senaryo 1"i ekleyip seçti; ardışık hızlı iki edge tıklaması da kaydedildi (çalışma kopyası storage'dan gelen ara sürümle ezilmedi). İkinci senaryo B'ye, üçüncüsü A başlangıçlı kuruldu; liste "2/3 edge · 1 koşu" gibi kapsamaları gösterdi. Satırlar arasında geçince koşular ve başlangıç geri geldi. Satırda yeniden adlandırma ("Dal B") ve aynı ada adlandırma ("Senaryo 1 (2)") çalıştı, seçili senaryonun adı çalışma kopyasında da güncellendi. Panel yeniden açılınca son seçilen senaryo seçili geldi. "Senaryo indir" `Ana-DalB.json` indirdi. B'ye giden edge silinince "Dal B" ⚠ "yürünemiyor" oldu, indirme ve oynatma kapandı, senaryo silinmedi; Geri al işareti kaldırdı. İndirilen dosya "Yükle…" ile "Dal B (2)" olarak eklendi; silme onayı koşu sayısını söyledi, silince seçim kalktı. Graph satırı "3 senaryo" gösterdi; yeni graph'ta liste boştu; graph yedeği senaryolarla geri yüklendi; ilk graph'a dönülünce son seçilen senaryo geldi. Eski testler artık önce bir senaryo oluşturuyor; bunlarla birlikte graph, bekleyen aksiyon, başlangıca dön (saucedemo dahil), başlangıç ve boyut, panelde oynatma, senaryo ve runner, sekme, bekleme, üzerine gelme, pencere boyutu, yakınlaştırma ve karşılaştırma testleri tekrar koşuldu ve geçti.

**Birden fazla graph.** İki yerel sitede 38 kontrolün hepsi geçti. İlk açılışta tek bir "Yeni graph" vardı; A sitesinde ilk node oluşunca adı "Site A" oldu. Bekleyen bir aksiyon varken "Yeni graph" onay sordu, Vazgeç geçmedi; onaylayınca boş graph açıldı, A'nın node'ları kaldı, bekleyen aksiyonları ve sekme bağı silindi. B sitesinin graph'ı "Site B" adını aldı. A'nın satırına tıklayınca (B'de bekleyen gezinme için yine onay) node'lar geri geldi, aktif sekme için "Kayıt sekmesi yok (kapandı ya da graph değişti)" sorusu çıktı, "Evet" kaydı A'nın şu anki node'undan sürdürdü. "Aynı node mu?" sorusu beklerken geçiş reddedildi, satırlar ve "Yeni graph" kilitliydi. Satırda yeniden adlandırma ("Banka") otomatik adı kapattı. "Dışa aktar" `Banka.graph.json` indirdi (ekran görüntüleri dahil, bekleyen aksiyon yok); "Yükle…" onu "Banka (2)" olarak ekledi, node, edge ve görüntüler birebir aynıydı; ucu olmayan edge'li yedek ve GraphWalker modeli açıklamayla reddedildi. Yüklenen graph'tan dışa aktarılan model (`Banka2`) runner'da geçti. Panel yeniden açılınca liste ve aktif graph aynıydı. Aktif graph silinince en son değişene geçildi, son graph silinince boş "Yeni graph" açıldı. Eski sürümün tek `state` anahtarı ilk açılışta "Site A" adıyla listeye taşındı, eski anahtar silindi. İlk denemede satırdaki ad kutusu hiç çizilmiyordu (yazılan adı korumak için konan kontrol kutunun kendisini de engelliyordu); düzeltildi. Ardından bekleyen aksiyon, başlangıca dön (saucedemo dahil), başlangıç ve boyut, panelde oynatma, senaryo, sekme, bekleme, üzerine gelme, pencere boyutu, yakınlaştırma ve karşılaştırma testleri yeni storage biçimiyle tekrar koşuldu ve geçti.

**Başlangıç node'una dön.** Giriş isteyen yerel bir sitede (çerez yoksa uygulama sayfası giriş sayfasına yönlendirir) 17 kontrolün hepsi geçti. Sekme başka bir sitedeyken (farklı origin, pencere 1000×720, yakınlaştırma %125) kart "Başlangıç node'una dön (adres ve boyut 1184×749)" gösterdi; basınca sekme giriş sayfasına gitti, görünen alan tam 1184×749 @1x oldu (yeni sitenin yakınlaştırması %100'dü, yalnızca pencere ayarlandı), kartta yalnızca "silinecek" uyarısı kaldı, gezinme `GoTo 127.0.0.1` olarak kayda girdi, oynatma 2/2 geçti. Çerezler silinip uygulama başlangıçlı senaryoda buton yönlendirmeyi söyledi, kart kaldı. `about:blank`'te kart "sayfa okunamadı" dedi, "Yine de oynat" gizliydi; dönünce sayfa okundu ve buton geri geldi. Yalnızca boyut farklıyken buton "(boyut 1184×749)" dedi, gezinme olmadı. Gerçek saucedemo'da (state panele doğrudan verildi) çıkış yapılmışken `inventory.html`'e dönmek, sitenin ara adreslerden geçip istemci tarafında giriş sayfasına yönlendirmesine rağmen dört denemede de "başka bir adrese yönlendirdi" dedi. Ardından başlangıç seçimi ve boyut (küçük sanal ekran dahil), panelde oynatma, sekme ve bekleyen aksiyon testleri tekrar koşuldu ve geçti.

**Bekleyen aksiyonları silme.** Yerel bir sayfada 19 kontrolün hepsi geçti. B, X, A tıklamaları "değiştirmedi, değiştirmedi, değiştirdi" işaretlendi; ortadaki X uyarısız silindi, liste ve sayaç güncellendi; A'nın ✕'i gerekçeli uyarı açtı, Vazgeç silmedi. Alana "ab" yazılıp çıkılınca oluşan input silindi; alana dönüp "cd" yazılınca tek bir `input = "abcd"` oluştu, silinen geri gelmedi. Bayat bir istek (zamanı tutmayan) reddedildi. Edge kalan beş aksiyonla oluştu; runner'da ve panelde oynatma geçti. Sayfa yeniden yüklenip "aynı node mu?" sorusu beklerken yapılan tıklamanın satırında ✕ yoktu, background da isteği reddetti; karardan sonra ✕ döndü. Ardından bekleme, panelde oynatma ve senaryo testleri tekrar koşuldu ve geçti.

**Sayılı küme (multiset) ölçümleri.** Mock testlerde: aynı butondan 5 ile 4 olan ekran soru sorulmadan ayrı node; aynı sayılar (sıra farklı) aday; aynı anahtarın farklı tür grupları toplanıyor; Ayarlar filtresi tür bazında uygulanıyor; önceki sürümün biçimiyle kaydedilmiş node çökme yapmadan aday dışı kalıyor. Gerçek Chrome'da 20 satırlık kaydırılabilir listeyle ve canlı saucedemo.com'da ölçüm sonuçları: [03 > Edge hedefi](03-state-eslestirme.md#edge-hedefi-state-ile-aynı-düzeyde-türün-ncisi).

Proje "build adımı yok, bağımlılık yok" ilkesini korusun diye bu test betikleri projeye eklenmedi.

---

## Yol haritası

Önem sırasına göre önerilen sonraki adımlar:

1. ~~**Replay**~~: yapıldı. Runner, modeldeki bir yolu tarayıcıda oynatıp her adımı kayıttaki state tanımıyla doğruluyor ([runner/README.md](../runner/README.md)). Sonraki adımlar: `select` ve `clipboard` aksiyonlarını oynatmak, yeni sekme açan akışlar, JSON/HTML rapor.
2. **GraphWalker test kodu iskeleti:** `properties.uiActions`'tan her edge için test metodu üretmek ([04](04-veri-modeli.md#sonraki-adım-test-kodu-iskeleti)). Runner aynı işi kod üretmeden yapıyor; kod üretimi GraphWalker'ın kendi koşucusuyla (online mod, guard'lar) çalışmak için gerekir.
3. **JSON içe aktarma:** Yarım kalan bir modele daha sonra devam edebilmek için.
4. **Klavye kısayolu:** `chrome.commands` ile örneğin `Alt+N` = Node oluştur. Kullanıcı farenin panele gitmesine gerek kalmadan çalışır.
5. ~~**Node birleştirme**~~: yapıldı ([01 > Node birleştirme](01-mimari.md#node-birleştirme)). Sonraki adım olabilir: tekrar eden edge'leri tek tıkla birleştirmek için isteğe bağlı bir araç (şu an yönetimi tamamen kullanıcıda).
6. **Element anahtarı normalizasyonu ve kullanıcı kararlarından öğrenme:** Node sayısını kuralı bozmadan azaltmak ([03 > Geliştirme fikirleri](03-state-eslestirme.md#geliştirme-fikirleri-tez-için))
7. **Kapsam genişletme:** iframe, Shadow DOM ve çoklu sekme desteği
8. **Kod büyürse:** WXT + TypeScript'e geçiş ([02 > Vanilla JS](02-teknolojiler.md#4-vanilla-javascript-build-adımı-yok))
