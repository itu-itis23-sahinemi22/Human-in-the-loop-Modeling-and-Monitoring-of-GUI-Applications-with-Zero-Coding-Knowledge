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
3. `content.js`'i değiştirdiyseniz kayıt yaptığınız **sayfayı da yenileyin (F5)**. Eski sayfada eski script çalışmaya devam eder.
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
| "Bekleyen aksiyonlar" listesi dolmuyor | (1) Henüz hiç node oluşturulmadı (kayıt başlamadı). (2) Başka sekmedesiniz. (3) Eklenti yenilendi ama sayfa yenilenmedi. (4) Aksiyon bir iframe içinde. | Sırasıyla kontrol edin. |
| Tıklamalar sayfaya hiç ulaşmıyor (eklentiyle ilgisiz) | Chrome'un "şifre ihlali" ya da "şifreyi kaydet" diyaloğu açık. | Diyaloğu kapatın. |
| Graph'ta aynı durum iki kez görünüyor | Benzerlik eşiğin altında kaldı (bkz. [03 > Bilinen zayıflıklar](03-state-eslestirme.md#bilinen-zayıflıklar)). | Kopyayı silin, doğru node'u seçip **Buradan devam et**'e basın. |
| Yan panel açılmıyor | Chrome sürümü 114'ten eski | Chrome'u güncelleyin. |

---

## Nasıl genişletilir? (tarifler)

### Benzerlik eşiğini değiştirmek

`background.js` başındaki sabit:

```js
const SIMILARITY_THRESHOLD = 0.6;
```

Değeri düşürmek daha çok soru sorulmasına, yükseltmek daha çok kopya node oluşmasına yol açar. Gerekçe: [03 > Eşik değeri](03-state-eslestirme.md#eşik-değeri-neden-06)

### Yeni bir aksiyon tipi eklemek (örnek: çift tıklama)

1. **`content.js`:** dinleyiciyi ekleyin.
   ```js
   document.addEventListener('dblclick', (event) => {
     if (!event.isTrusted) return;
     const el = event.target.closest(INTERACTIVE) || event.target;
     send({ type: 'dblclick', selector: cssSelector(el), label: 'DoubleClick ' + visibleText(el) });
   }, true);
   ```
2. **`sidepanel/panel.js`:** `ACTION_TEXT` sözlüğüne ekranda görünecek adı ekleyin: `dblclick: 'Çift tıkla'`.
3. **`docs/04-veri-modeli.md`:** aksiyon tipleri tablosuna yeni satırı ekleyin.

Background'da değişiklik gerekmez: gelen her aksiyonu tipine bakmadan buffer'a ekler.

### Selector önceliğini değiştirmek

`content.js > cssSelector()` içindeki dizi:

```js
for (const attr of ['data-testid', 'data-test', 'name', 'aria-label']) {
```

Test ettiğiniz site farklı bir test niteliği kullanıyorsa (ör. `data-cy`, `data-qa`) diziye ekleyin. Aynı niteliği `elementKey()` fonksiyonuna da eklemek parmak izini iyileştirir.

### Parmak izine yeni bir sinyal eklemek

1. `content.js > fingerprint()` dönüş nesnesine yeni alanı ekleyin (ör. `h1: document.querySelector('h1')?.innerText`).
2. Alan `capture` nesnesine otomatik kopyalanır (`{ ...page }`), ama node'a kopyalanmaz. `background.js > commit()` içinde node nesnesine elle eklenmeli.
3. `background.js > findSimilarNode()` içinde skora katın.

### GraphWalker export eklemek

1. `panel.html`'e bir buton ekleyin.
2. `panel.js`'te mevcut JSON export'unun yanına bir dönüştürme fonksiyonu yazın. Eşleme tablosu [04-veri-modeli.md](04-veri-modeli.md#graphwalkera-aktarım)'de. Node konumları Cytoscape'ten alınabilir: `cy.getElementById(node.id).position()`.

---

## Test

**Manuel duman testi (smoke test).** Her değişiklikten sonra 3 dakikada yapılabilir. Adımlar [README > Kullanım](../README.md#3-kullanım-örnek-senaryo) bölümündeki saucedemo senaryosudur. Kontrol listesi:

- [ ] İlk node oluşuyor ve içinde ekran görüntüsü var.
- [ ] Login sonrası `e_Login` edge'i 3 aksiyonla oluşuyor, şifre `******`.
- [ ] Sepete ekledikten sonra "aynı node mu?" sorusu geliyor. "Evet" self-loop çiziyor.
- [ ] Başka bir sayfadan bilinen bir sayfaya dönüp "Evet" denince, şu anki node'dan o node'a edge çiziliyor.
- [ ] Hiçbir şey yapmadan tekrar "Node oluştur"a basınca soru gelmiyor, mavi bilgi mesajı çıkıyor, edge eklenmiyor.
- [ ] Ürün detayından tarayıcının geri tuşuyla dönünce edge adı `e_Back` oluyor.
- [ ] Node/edge'e tıklayınca detay kartı açılıyor, isim değiştirilebiliyor.
- [ ] Mevcut node silinince durum satırı "seçili değil" diyor. "Buradan devam et" çalışıyor.
- [ ] Eklenti yenilenince graph kaybolmuyor.
- [ ] JSON indir dosyası açılıyor ve geçerli JSON.

**Otomatik test.** Geliştirme sırasında eklenti Puppeteer ile gerçek Chrome'a yüklenip üç şekilde test edildi:

1. **Background mantığı:** yerel bir test sitesinde 18 kontrol.
2. **Panelin gerçek butonları:** "Node oluştur", "Evet, aynı node" ve "Hayır, yeni node" butonlarına tıklanarak 15 kontrol yapıldı. Bunlar arasında "Evet → şu anki node'dan eşleşen node'a edge" kuralı ve "aksiyon yoksa soru sorulmaz" kuralı da var.
3. **Canlı saucedemo.com:** [03](03-state-eslestirme.md#gerçek-ölçümler-saucedemocom)'teki ölçümler bu çalıştırmadan alınmıştır.

Proje "build adımı yok, bağımlılık yok" ilkesini korusun diye bu test betikleri projeye eklenmedi.

---

## Yol haritası

Önem sırasına göre önerilen sonraki adımlar:

1. **GraphWalker export:** Model JSON'u ve test kodu iskeleti üretmek ([04](04-veri-modeli.md#graphwalkera-aktarım)). Projeyi uçtan uca tamamlayan adım budur.
2. **Replay:** Bir edge'in aksiyonlarını Playwright/Selenium koduna dönüştürüp çalıştırmak. Böylece kaydın doğruluğu otomatik doğrulanabilir.
3. **JSON içe aktarma:** Yarım kalan bir modele daha sonra devam edebilmek için.
4. **Klavye kısayolu:** `chrome.commands` ile örneğin `Alt+N` = Node oluştur. Kullanıcı farenin panele gitmesine gerek kalmadan çalışır.
5. **Node birleştirme:** İki kopya node'u tek node'da birleştirmek (edge'leri taşıyarak).
6. **Kullanıcı kararlarından öğrenen eşik:** ([03 > Geliştirme fikirleri](03-state-eslestirme.md#geliştirme-fikirleri-tez-için))
7. **Kapsam genişletme:** iframe, Shadow DOM ve çoklu sekme desteği
8. **Kod büyürse:** WXT + TypeScript'e geçiş ([02 > Vanilla JS](02-teknolojiler.md#4-vanilla-javascript-build-adımı-yok))
