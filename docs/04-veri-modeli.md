# 04: Veri Modeli

Bu doküman eklentinin sakladığı ve dışa aktardığı verinin tam şemasını ve bu verinin GraphWalker'a nasıl aktarılacağını anlatır.

## İçindekiler

- [State (storage'daki tek kayıt)](#state-storagedaki-tek-kayıt)
- [Node](#node)
- [Edge](#edge)
- [Aksiyon](#aksiyon)
- [Bekleyen karar (pending)](#bekleyen-karar-pending)
- [Ayarlar (settings)](#ayarlar-settings)
- [Dışa aktarılan JSON](#dışa-aktarılan-json)
- [GraphWalker'a aktarım](#graphwalkera-aktarım)

---

## State (storage'daki tek kayıt)

Tüm veri `chrome.storage.local` içinde **`state`** anahtarı altında, tek bir nesne olarak durur. Şekli `background.js > emptyState()` fonksiyonunda tanımlıdır.

| Alan | Tip | Açıklama |
|---|---|---|
| `tabId` | `number \| null` | Kaydın bağlı olduğu sekme. `null` ise kayıt henüz başlamamış ya da sekme kapatılmış demektir; kapandıysa kayıt "Buradan devam et" ile başka sekmeye bağlanır. |
| `nextId` | `number` | Yeni id üretmek için sayaç. Node ve edge'ler aynı sayacı paylaşır: `n1`, `n2`, `e3`, `n4`... |
| `startNodeId` | `string \| null` | İlk oluşturulan node. Graph çiziminde en üste yerleşir. |
| `currentNodeId` | `string \| null` | Kullanıcının şu an bulunduğu node. Bir sonraki edge buradan çıkar. Panelde yeşil çerçeveyle gösterilir. |
| `nodes` | `Node[]` | Tüm node'lar |
| `edges` | `Edge[]` | Tüm edge'ler |
| `buffer` | `Action[]` | Son node'dan beri yapılan, henüz bir edge'e dönüşmemiş aksiyonlar. Panelde "Bekleyen aksiyonlar" listesi. |
| `pending` | `Pending \| null` | Element kümesi birebir aynı bir node bulunduğunda kullanıcının cevabını bekleyen karar |
| `screen` | `{ key, types, count }[] \| null` | Hemen önceki state: en son görülen ekranın edge set'i (node `elements` ile aynı biçim). Sıradaki aksiyonun öncesidir; aksiyonun `changed` işareti bununla bulunur. Bkz. [01 > Edge düzenleme](01-mimari.md#edge-düzenleme) |
| `undo` | `Silme[]` | Geri al yığını, en yenisi sonda, en fazla 20. Her kayıt silineni ve eski yerini tutar: `{ kind: 'node', node, index, edges: [{ edge, index }], startNodeId, currentNodeId }`, `{ kind: 'edge', edge, index }`, `{ kind: 'action', edgeId, index, action }` ya da `{ kind: 'merge', keepId, node, index, edges: [{ id, source, target }], startNodeId, currentNodeId }` (birleştirmede taşınan edge'lerin eski uçları). Bkz. [01 > Geri al](01-mimari.md#geri-al) |

---

## Node

Bir durumu (sayfa / ekran) temsil eder.

| Alan | Tip | Örnek | Açıklama |
|---|---|---|---|
| `id` | `string` | `"n2"` | Tekil kimlik |
| `name` | `string` | `"v_Inventory"` | Görünen isim. Otomatik verilir, panelden değiştirilebilir. |
| `url` | `string` | `"https://www.saucedemo.com/inventory.html"` | Node oluşturulurken sayfanın tam adresi |
| `urlKey` | `string` | `"https://www.saucedemo.com/inventory.html"` | Normalleştirilmiş URL şablonu ([03](03-state-eslestirme.md#aşama-1-url-şablonu)) |
| `title` | `string` | `"Swag Labs"` | Sayfa başlığı (`document.title`) |
| `elements` | `{ key, types, count }[]` | `[{ "key": "button:Sil", "types": ["button"], "count": 5 }]` | Yapısal parmak izi: node oluşturulduğu anda ekranda tıklanabilen elementlerin **sayılı kümesi**. `key` elementin türü (`elementKey()`), `types` uyduğu etkileşimli türler (`settings.js > INTERACTABLE_TYPES`, Ayarlar filtresi için), `count` ekranda kaç tane olduğu. Node'un **edge set**'i, Ayarlar'da işaretli türlere uyan girdilerin sayımıdır ([03](03-state-eslestirme.md#ayarlar-hangi-türler-statee-girer)). Türleri ya da sayıları farklı olan bir sayfa bu node'la asla eşleşmez. |
| `screenshot` | `string` | `"data:image/jpeg;base64,..."` | Sayfanın görünen kısmının JPEG görüntüsü |

---

## Edge

Bir node'dan diğerine (ya da kendisine) geçişi temsil eder.

| Alan | Tip | Örnek | Açıklama |
|---|---|---|---|
| `id` | `string` | `"e3"` | Tekil kimlik |
| `name` | `string` | `"e_Login"` | Görünen isim. Kaydırma olmayan son aksiyonun etiketinden türetilir; edge yalnızca kaydırmaysa `"e_ScrollDown"` gibi. |
| `source` | `string` | `"n1"` | Çıkış node'unun id'si |
| `target` | `string` | `"n2"` | Varış node'unun id'si. `source` ile aynıysa self-loop'tur. |
| `actions` | `Action[]` | (aşağıda) | Bu geçişi oluşturan aksiyonlar, **gerçekleşme sırasıyla** |
| `recordedActions` | `Action[]` (opsiyonel) | | Edge panelde düzenlendiyse (aksiyon silindiyse) kayıttaki orijinal liste. Tüm silmeler geri alınınca kaldırılır. Bkz. [01 > Edge düzenleme](01-mimari.md#edge-düzenleme) |

---

## Aksiyon

Kullanıcının tek bir hareketi. Ortak alanlar:

| Alan | Tip | Açıklama |
|---|---|---|
| `type` | `string` | Aksiyon tipi (aşağıdaki tablo) |
| `target` | `{ key, index }` | Sadece `click`, `input`, `enter`: hedef element, state ile aynı düzeyde. `key` elementin türü, `index` ekranda görünen aynı türdekiler arasındaki DOM sırası (1'den). Örnek: `{ "key": "button:Sil", "index": 2 }` = "ekrandaki 2. Sil". Element o an ekranda tıklanabilir değilse `index` `null`. Tekrar oynatırken önce bu kullanılır ([03](03-state-eslestirme.md#edge-hedefi-state-ile-aynı-düzeyde-türün-ncisi)). |
| `changed` | `boolean \| null` | Aksiyon state'i (edge set'i) değiştirdi mi: hemen önceki state ile aksiyondan sonra sayfa durulunca görülen state karşılaştırılır. `null` ya da yok: bilinmiyor. Yalnızca edge düzenlemedeki silme uyarısı için; GraphWalker çıktısına girmez. Bkz. [01 > Edge düzenleme](01-mimari.md#edge-düzenleme) |
| `selector` | `string \| null` | Elementi bulan CSS selector (yedek; `target` bulunamazsa). Tarayıcı seviyesindeki gezinmelerde, yakınlaştırmada ve sayfanın kendisi kaydırıldığında `null`. |
| `label` | `string` | İnsan tarafından okunabilir açıklama. Edge isimleri buradan türetilir. |
| `url` | `string` | Aksiyonun yapıldığı sayfanın adresi |
| `time` | `number` | Unix zaman damgası (ms) |

Tipler:

| `type` | Kaynağı | Ek alan | `label` örneği | Tekrar oynatırken (replay) karşılığı |
|---|---|---|---|---|
| `click` | content.js | | `"Login"`, `"Add to cart"` | `click(selector)` |
| `input` | content.js | `value` (`string` ya da checkbox için `boolean`) | `"Fill Username"`, `"Select Sort"`, `"Check Remember me"` | `fill(selector, value)` / `selectOption` / `check` |
| `enter` | content.js | | `"Submit Username"` | `press(selector, "Enter")` |
| `scroll` | content.js | `x`, `y` (`number`): kaydırmanın vardığı konum (px) | `"Scroll down"`, `"Scroll up"` | `selector` varsa o kutuda, `null` ise sayfada `scrollTo(x, y)` |
| `zoom` | background.js | `zoom` (`number`): tarayıcı yakınlaştırmasının vardığı oran (`1` = %100); `fromZoom` (`number`): başladığı oran | `"Zoom in"`, `"Zoom out"` | Sekmeyi `zoom` oranına ayarla (ör. `chrome.tabs.setZoom`) |
| `navigate` | background.js | | `"GoTo cart"` | `goto(url)` |
| `history` | background.js | | `"Back"` | `goBack()` ya da `goto(url)` |
| `reload` | background.js | | `"Reload"` | `reload()` |

Şifre alanlarında `value` her zaman `"******"` olarak saklanır.

---

## Bekleyen karar (pending)

"Node oluştur"a basıldığında URL şablonu ve element kümesi birebir aynı bir node bulunursa, karar verilene kadar bilgiler burada bekler. Element kümesi farklıysa `pending` hiç oluşmaz; yeni node doğrudan eklenir.

| Alan | Tip | Açıklama |
|---|---|---|
| `capture` | `object` | Sayfanın o anki `url`, `urlKey`, `title`, `elements`, `screenshot` bilgileri. "Hayır" denirse bunlardan yeni node oluşturulur. |
| `actions` | `Action[]` | Buffer'dan kesilen aksiyonlar. Oluşacak edge'e konacak. |
| `candidateIds` | `string[]` | Element kümesi sayfayla birebir aynı olan TÜM node'lar. Sıra: şu anki node önce, sonra oluşturulma sırası. Onay kartında her biri bir seçenektir. Karar beklerken silinen node listeden çıkar. |

Kullanıcı şu anki node'u seçip "Node oluşturma, aksiyonlara devam et" derse `pending` silinir, `capture` atılır ve `actions` buffer'ın başına geri konur.

---

## Ayarlar (settings)

Panelin **Ayarlar** bölümündeki seçim, `chrome.storage.local` içinde state'ten ayrı olarak **`settings`** anahtarında durur. "Sıfırla" ayarlara dokunmaz. Varsayılan ve listeler `settings.js`'te tanımlıdır.

| Alan | Tip | Açıklama |
|---|---|---|
| `disabledActions` | `string[]` | İşareti kaldırılmış aksiyon tipleri (ör. `["scroll"]`). Bu tipteki aksiyonlar buffer'a eklenmez. |
| `disabledInteractables` | `string[]` | İşareti kaldırılmış etkileşimli element türleri (ör. `["a", "label"]`). Bu türlerin anahtarları state karşılaştırmasına girmez. |

İşaretli olanlar değil işareti **kaldırılanlar** saklanır: listelere ileride eklenen yeni bir tip kendiliğinden işaretli gelir.

---

## Dışa aktarılan JSON

Panelde **GraphWalker JSON** butonu, graph'ı **GraphWalker JSON model formatında** indirir (`sidepanel/panel.js > graphWalkerModel()`). Dosya adı model adıdır (başlangıç node'unun adı, `v_` öneki olmadan): `SwagLabs.json`. Format, GraphWalker Studio'nun kaydettiği dosyayla aynı iskelete sahiptir ve GraphWalker CLI tarafından doğrudan okunur.

Kayda özel bilgiler (URL, parmak izi, ekran görüntüsü, kaydedilen tarayıcı aksiyonları) GraphWalker'ın her vertex, edge ve modelde bulunan serbest **`properties`** alanında taşınır. GraphWalker bu alanı yorumlamaz, olduğu gibi saklar. Oturuma ait alanlar (`buffer`, `pending`, `tabId`) dosyaya girmez.

```json
{
  "name": "SwagLabs",
  "models": [
    {
      "id": "2b1f0c9e-...",
      "name": "SwagLabs",
      "generator": "random(edge_coverage(100))",
      "startElementId": "n1",
      "properties": {
        "graphRecorder": {
          "format": "graph-recorder/v4",
          "exportedAt": "2026-10-07T12:00:00.000Z",
          "settings": { "disabledActions": [], "disabledInteractables": ["label"] }
        }
      },
      "vertices": [
        {
          "id": "n1",
          "name": "v_SwagLabs",
          "properties": {
            "x": 120, "y": 40,
            "description": "Swag Labs (https://www.saucedemo.com/)",
            "url": "https://www.saucedemo.com/",
            "urlKey": "https://www.saucedemo.com/",
            "title": "Swag Labs",
            "elements": [
              { "key": "input:login-button", "types": ["input"], "count": 1 },
              { "key": "input:password",     "types": ["input"], "count": 1 },
              { "key": "input:user-name",    "types": ["input"], "count": 1 }
            ],
            "screenshot": "data:image/jpeg;base64,/9j/4AAQ..."
          }
        },
        {
          "id": "n2",
          "name": "v_Inventory",
          "properties": { "x": 120, "y": 200, "...": "..." }
        }
      ],
      "edges": [
        {
          "id": "e3",
          "name": "e_Login",
          "sourceVertexId": "n1",
          "targetVertexId": "n2",
          "properties": {
            "description": "Fill Username → Fill Password → Login",
            "uiActions": [
              { "type": "input", "target": { "key": "input:user-name", "index": 1 }, "selector": "#user-name", "value": "standard_user", "label": "Fill Username", "url": "https://www.saucedemo.com/", "time": 1790000000000 },
              { "type": "input", "target": { "key": "input:password", "index": 1 }, "selector": "#password",  "value": "******",        "label": "Fill Password", "url": "https://www.saucedemo.com/", "time": 1790000001000 },
              { "type": "click", "target": { "key": "input:login-button", "index": 1 }, "selector": "#login-button",                         "label": "Login",         "url": "https://www.saucedemo.com/", "time": 1790000002000 }
            ]
          }
        }
      ]
    }
  ],
  "selectedModelIndex": 0,
  "selectedElementId": null
}
```

- `selectedModelIndex` / `selectedElementId`: GraphWalker Studio'nun kendi dosyalarında bulunan alanlar. CLI bunları yok sayar.
- `properties.graphRecorder.format`: şema değişince eski dosyaları tanımak için. `v4` = GraphWalker formatı, `elements` sayılı küme, aksiyonlarda `target`. (`v3`: GraphWalker formatı, sayısız küme; `v2` ve öncesi eklentiye özel formattı.)
- `properties.graphRecorder.settings`: `elements`'ın hangi türlerinin state'i oluşturduğunu gösterir.
- Edge panelde düzenlendiyse `properties` ayrıca `edited: true` ve kayıttaki orijinal aksiyonları (`recordedActions`) taşır. `uiActions` ve `recordedActions` içinde `changed` işareti bulunmaz; o yalnızca paneldeki silme uyarısı içindir.
- Chrome storage nesne anahtarlarını alfabetik sıraladığı için `elements` içindeki türlerin sırası `settings.js`'teki sıradan farklı olabilir.

### GraphWalker ile doğrulama

Çıktı, GraphWalker CLI 4.3.3 ile denendi: `check` *"No issues found with the model(s)"* der, `offline` modelde edge kapsamasına kadar yol üretir.

```
java -jar graphwalker-cli-4.3.3.jar check   -m SwagLabs.json "random(edge_coverage(100))"
java -jar graphwalker-cli-4.3.3.jar offline -m SwagLabs.json "random(edge_coverage(100))"
```

> GraphWalker 4.3.3, Java 25 ile `NoSuchMethodError: sun.misc.Unsafe.ensureClassInitialized` hatası verir. Java 17 (ya da 21) ile çalıştırın.

Model kurulurken dikkat:

- **Başlangıç elementi:** `startElementId` ilk node'dur. Boşsa GraphWalker *"The model has neither a start element or a defined shared state"* der.
- **Çıkmaz node'lar:** Çıkış edge'i olmayan bir node'a (genelde en son kaydedilen) varan yol orada biter, edge kapsaması %100'e ulaşamayabilir. Kayıtta bu node'lardan bilinen bir duruma dönüşü de kaydedin.
- **Aynı isimli edge'ler:** GraphWalker aynı isimli her edge için test kodunda aynı metodu çağırır. Otomatik isim son aksiyondan geldiği için farklı aksiyonlu iki edge aynı ismi alabilir (ör. iki ayrı `e_Login`). Test kodu isme göre yazılacaksa bu edge'leri panelden farklı isimlerle yeniden adlandırın ya da tarayıcı aksiyonlarını o anki edge'in `properties.uiActions`'ından okuyun.

---

## GraphWalker'a aktarım

### Kavram eşlemesi

| Bizim modelimiz | GraphWalker JSON modeli | Not |
|---|---|---|
| `node` | `vertex` | |
| `node.name` (`v_...`) | `vertex.name` | `v_` öneki GraphWalker geleneğidir. |
| `node.url`, `urlKey`, `title`, `elements`, `screenshot` | `vertex.properties` | Konumla birlikte (`x`, `y`) |
| `edge` | `edge` | |
| `edge.name` (`e_...`) | `edge.name` | `e_` öneki GraphWalker geleneğidir. |
| `edge.source` / `edge.target` | `sourceVertexId` / `targetVertexId` | Sadece alan adı değişir. |
| `startNodeId` | `startElementId` | |
| `edge.actions` (kaydedilen UI aksiyonları) | `edge.properties.uiActions` | **`edge.actions` DEĞİL!** (aşağıya bakın) |
| Cytoscape'teki konumlar | `vertex.properties.x / y` | GraphWalker Studio'da aynı yerleşim için |
| Ayarlar | `model.properties.graphRecorder.settings` | |

### Dikkat: "actions" iki farklı anlama geliyor

GraphWalker'da `edge.actions`, **modelin kendi değişkenlerini** güncelleyen JavaScript ifadeleridir (ör. `"loggedIn = true;"`). Bu ifadeler `guard` koşullarıyla birlikte, hangi yolların mümkün olduğunu belirlemek için kullanılır. Bu yüzden dışa aktarımda bu alan hiç yazılmaz; kullanıcı Studio'da kendisi ekleyebilir.

Bizim kaydettiğimiz aksiyonlar ise **tarayıcıda yapılacak işlemlerdir** (tıkla, yaz, kaydır). GraphWalker'da bunları yapan şey model dosyası değil, **test kodudur.** GraphWalker, her `v_` ve `e_` ismi için test kodunda aynı isimli bir metot çağırır.

### Sonraki adım: test kodu iskeleti

**Test kodu iskeleti (davranış):** Kaydedilen aksiyonlardan (`properties.uiActions`) her edge için bir metot gövdesi, her node için bir doğrulama üretilebilir. Henüz yapılmadı. Örnek (Java + Selenium):

```java
// e_Login: kaydedilen 3 aksiyondan üretildi
public void e_Login() {
    driver.findElement(By.cssSelector("#user-name")).sendKeys("standard_user");
    driver.findElement(By.cssSelector("#password")).sendKeys(PASSWORD); // maskelenmiş değer
    driver.findElement(By.cssSelector("#login-button")).click();
}

// v_Inventory: parmak izindeki kararlı bir elementten üretildi
public void v_Inventory() {
    assertTrue(driver.findElement(By.cssSelector("[data-test='shopping-cart-link']")).isDisplayed());
}
```

Böylece kullanıcının tarayıcıda gezerek ürettiği graph, doğrudan çalıştırılabilir bir GraphWalker test projesine dönüşür. Bu, projenin uçtan uca hedefidir.

> **Pencere boyutu:** State'ler yalnızca ekranda görünen elementlerden çıkarıldığı için testler, kayıttaki pencere boyutuyla çalıştırılmalıdır (ör. `driver.manage().window().setSize(...)`). Aksi halde ekrana sığan elementler ve dolayısıyla state'ler değişir. Bkz. [03 > Kaydırma ve state](03-state-eslestirme.md#kaydırma-ve-state)
