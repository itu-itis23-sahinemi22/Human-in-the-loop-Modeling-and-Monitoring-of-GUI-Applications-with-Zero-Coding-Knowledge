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
3. `content.js`'i ya da `settings.js`'i değiştirdiyseniz kayıt yaptığınız **sayfayı da yenileyin (F5)**. Eski sayfada eski script çalışmaya devam eder.
4. Yan paneli kapatıp tekrar açın.

Kayıtlı graph, eklenti yenilense de silinmez; `chrome.storage.local`'da durur.

---

## Hata ayıklama: hangi console nerede?

Eklentinin üç parçası üç ayrı ortamda çalıştığı için (bkz. [01-mimari.md](01-mimari.md#neden-üç-parça)) üç ayrı DevTools penceresi vardır:

| Parça | DevTools nasıl açılır |
|---|---|
| `background.js` | `chrome://extensions` → Graph Recorder kartında **"Service worker"** linki |
| `sidepanel/` | Yan panelde sağ tık → **İncele** (Inspect) |
| `content.js` | Kayıt yapılan sayfada F12 → Console sekmesi → üstteki **"top"** açılır menüsünden **"Graph Recorder (Bitirme Demo)"** seçilir |

**State'i görmek** için background ya da panel console'una yazın:

```js
(await chrome.storage.local.get('state')).state
```

**Belirli bir node'un parmak izini görmek:**

```js
(await chrome.storage.local.get('state')).state.nodes.find(n => n.name === 'v_Inventory').elements
```

**Sıfırlamak** için paneldeki **Sıfırla** butonunu kullanın. `chrome.storage.local.clear()` tek başına yetmez: background state'in bir kopyasını bellekte tuttuğu için bir sonraki yazışında eski veriyi geri yazar. Mutlaka `clear()` kullanılacaksa ardından eklentiyi yenileyin.

---

## Sık karşılaşılan sorunlar

| Belirti | Sebep | Çözüm |
|---|---|---|
| *"Bu sayfaya erişilemedi. Sayfayı yenileyip tekrar deneyin."* | Sayfa eklenti yüklenmeden (ya da yenilenmeden) önce açılmıştı, content script yok. | Sayfayı F5 ile yenileyin. |
| Aynı hata, `chrome://` ya da Chrome Web Store sayfasında | Chrome, eklentilerin bu sayfalara kod eklemesine izin vermez. | Normal bir web sitesinde çalışın. |
| *"Kayıt başka bir sekmede sürüyor."* | Kayıt ilk node'un oluşturulduğu sekmeye bağlıdır. | O sekmeye dönün ya da **Sıfırla**'ya basın. |
| "Bekleyen aksiyonlar" listesi dolmuyor | (1) Henüz hiç node oluşturulmadı (kayıt başlamadı). (2) Başka sekmedesiniz. (3) Eklenti yenilendi ama sayfa yenilenmedi. (4) Aksiyon bir iframe içinde. (5) O aksiyon tipinin Ayarlar'da işareti kaldırılmış. (6) Kayıt sekmesi kapatıldı. | Sırasıyla kontrol edin. (6) için: bir node seçip **Buradan devam et**'e basın. |
| "Node oluştur" butonu kilitli | Son node'dan beri bekleyen aksiyon yok (ilk node hariç node oluşturmak için en az bir aksiyon gerekir) ya da bekleyen bir "aynı node mu?" sorusu var. | Sayfada bir aksiyon yapın ya da soruyu cevaplayın. |
| Tıklamalar sayfaya hiç ulaşmıyor (eklentiyle ilgisiz) | Chrome'un "şifre ihlali" ya da "şifreyi kaydet" diyaloğu açık. | Diyaloğu kapatın. |
| Graph'ta "aynı" sayfa iki ayrı node olarak görünüyor | Element kümeleri birebir aynı değil (bilinçli kural). Console'da iki node'un `elements` dizisini karşılaştırın. Sebep genelde (1) farklı kaydırma konumu ya da pencere boyutu: ekrandaki elementler farklı, (2) dinamik ya da veriye bağlı bir id (bkz. [03 > Bilinen zayıflıklar](03-state-eslestirme.md#bilinen-zayıflıklar)). | Fark gerçekten anlamsızsa `content.js > elementKey()` içinde o id'yi normalleştirin. Node'ları elle birleştirmeyin: farklı kümeler edge çakışması üretir. |
| Yan panel açılmıyor | Chrome sürümü 114'ten eski | Chrome'u güncelleyin. |

---

## Nasıl genişletilir? (tarifler)

### State eşleştirme kuralı

Ayarlanacak bir eşik yoktur. `background.js > findSameStateNodes()` yalnızca URL şablonu ve element kümesi birebir aynı olan node'ları döndürür. Bu kuralı gevşetmek (ör. benzerlik eşiğine geri dönmek) farklı edge set'lerin birleşmesine ve edge çakışmasına yol açar. Gerekçe: [03 > Neden birebir eşitlik?](03-state-eslestirme.md#neden-benzerlik-değil-birebir-eşitlik)

Node sayısı fazla geliyorsa kuralı değil, parmak izini değiştirin: `content.js > elementKey()` içinde dinamik ya da veriye bağlı id'leri normalleştirin.

### Yeni bir aksiyon tipi eklemek (örnek: çift tıklama)

1. **`content.js`:** dinleyiciyi ekleyin.
   ```js
   document.addEventListener('dblclick', (event) => {
     if (!event.isTrusted) return;
     const el = event.target.closest(INTERACTIVE) || event.target;
     send({ type: 'dblclick', selector: cssSelector(el), label: 'DoubleClick ' + visibleText(el) });
   }, true);
   ```
2. **`settings.js`:** `ACTION_TYPES` listesine ekleyin: `{ type: 'dblclick', text: 'Çift tıkla' }`. Paneldeki adı ve Ayarlar'daki kutusu buradan gelir.
3. **`docs/04-veri-modeli.md`:** aksiyon tipleri tablosuna yeni satırı ekleyin.

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

1. `content.js > fingerprint()` dönüş nesnesine yeni alanı ekleyin (ör. `h1: document.querySelector('h1')?.innerText`).
2. Alan `capture` nesnesine otomatik kopyalanır (`{ ...page }`), ama node'a kopyalanmaz. `background.js > commit()` içinde node nesnesine elle eklenmeli.
3. `background.js > findSameStateNodes()` içinde eşleşme koşuluna ekleyin. Sinyal eşleşmeyi yalnızca daraltabilir (daha çok yeni node); element kümesi farklı iki sayfayı eşleştirmemeli.

### GraphWalker çıktısına alan eklemek

Dışa aktarım `sidepanel/panel.js > graphWalkerModel()` içindedir. Yeni bir bilgi taşımak için ilgili vertex ya da edge'in `properties` nesnesine ekleyin. GraphWalker'ın kendi alanlarına (`actions`, `guard`, `requirements`, `sharedState`) yalnızca GraphWalker anlamında değer yazın. Değişiklikten sonra çıktıyı GraphWalker CLI ile doğrulayın (bkz. [04 > GraphWalker ile doğrulama](04-veri-modeli.md#graphwalker-ile-doğrulama)).

---

## Test

**Manuel duman testi (smoke test).** Her değişiklikten sonra 3 dakikada yapılabilir. Adımlar [README > Kullanım](../README.md#3-kullanım-örnek-senaryo) bölümündeki saucedemo senaryosudur. Kontrol listesi:

- [ ] İlk node oluşuyor ve içinde ekran görüntüsü var.
- [ ] Login sonrası `e_Login` edge'i 3 aksiyonla oluşuyor, şifre `******`.
- [ ] Sepete ekledikten sonra soru **gelmiyor**; yeni node `v_Inventory_2` ve `e_AddToCart` edge'i oluşuyor.
- [ ] Sepetten **Continue Shopping** ile dönünce "aynı node mu?" sorusu geliyor (aday `v_Inventory_2`). "Evet" denince `v_Cart → v_Inventory_2` edge'i çiziliyor.
- [ ] Ürün listesinde menüyü açıp "Node oluştur"a basınca soru gelmiyor, yeni node oluşuyor.
- [ ] Giriş sayfasında node oluşturduktan sonra kullanıcı adı alanına bir şey yazıp (aksiyon) DevTools'ta Login butonuna `disabled` ekleyince, "Node oluştur"da soru gelmiyor, yeni node oluşuyor. Alanı tekrar değiştirip `disabled`'ı kaldırınca ilk node öneriliyor.
- [ ] Sayfayı kaydırınca "Bekleyen aksiyonlar"da `Kaydır  Scroll down → 0, 600` gibi bir satır çıkıyor.
- [ ] Ürün listesinde aşağı kaydırıp "Node oluştur"a basınca (ekrana başka ürünler geldi) soru gelmiyor; yeni node ve `e_ScrollDown` edge'i oluşuyor. Tekrar en üste kaydırıp basınca, en üstteki ürün listesi node'u için "aynı state mi?" sorusu geliyor.
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

**Sayılı küme (multiset) ölçümleri.** Mock testlerde: aynı butondan 5 ile 4 olan ekran soru sorulmadan ayrı node; aynı sayılar (sıra farklı) aday; aynı anahtarın farklı tür grupları toplanıyor; Ayarlar filtresi tür bazında uygulanıyor; önceki sürümün biçimiyle kaydedilmiş node çökme yapmadan aday dışı kalıyor. Gerçek Chrome'da 20 satırlık kaydırılabilir listeyle ve canlı saucedemo.com'da ölçüm sonuçları: [03 > Edge hedefi](03-state-eslestirme.md#edge-hedefi-state-ile-aynı-düzeyde-türün-ncisi).

Proje "build adımı yok, bağımlılık yok" ilkesini korusun diye bu test betikleri projeye eklenmedi.

---

## Yol haritası

Önem sırasına göre önerilen sonraki adımlar:

1. **GraphWalker test kodu iskeleti:** Model JSON'u artık GraphWalker formatında. Kalan adım, `properties.uiActions`'tan her edge için test metodu üretmek ([04](04-veri-modeli.md#sonraki-adım-test-kodu-iskeleti)). Projeyi uçtan uca tamamlayan adım budur.
2. **Replay:** Bir edge'in aksiyonlarını Playwright/Selenium koduna dönüştürüp çalıştırmak. Böylece kaydın doğruluğu otomatik doğrulanabilir.
3. **JSON içe aktarma:** Yarım kalan bir modele daha sonra devam edebilmek için.
4. **Klavye kısayolu:** `chrome.commands` ile örneğin `Alt+N` = Node oluştur. Kullanıcı farenin panele gitmesine gerek kalmadan çalışır.
5. ~~**Node birleştirme**~~: yapıldı ([01 > Node birleştirme](01-mimari.md#node-birleştirme)). Sonraki adım olabilir: tekrar eden edge'leri tek tıkla birleştirmek için isteğe bağlı bir araç (şu an yönetimi tamamen kullanıcıda).
6. **Element anahtarı normalizasyonu ve kullanıcı kararlarından öğrenme:** Node sayısını kuralı bozmadan azaltmak ([03 > Geliştirme fikirleri](03-state-eslestirme.md#geliştirme-fikirleri-tez-için))
7. **Kapsam genişletme:** iframe, Shadow DOM ve çoklu sekme desteği
8. **Kod büyürse:** WXT + TypeScript'e geçiş ([02 > Vanilla JS](02-teknolojiler.md#4-vanilla-javascript-build-adımı-yok))
