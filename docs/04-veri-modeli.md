# 04: Veri Modeli

Bu doküman eklentinin sakladığı ve dışa aktardığı verinin tam şemasını ve bu verinin GraphWalker'a nasıl aktarılacağını anlatır.

## İçindekiler

- [State (storage'daki tek kayıt)](#state-storagedaki-tek-kayıt)
- [Node](#node)
- [Edge](#edge)
- [Aksiyon](#aksiyon)
- [Bekleyen karar (pending)](#bekleyen-karar-pending)
- [Dışa aktarılan JSON](#dışa-aktarılan-json)
- [GraphWalker'a aktarım](#graphwalkera-aktarım)

---

## State (storage'daki tek kayıt)

Tüm veri `chrome.storage.local` içinde **`state`** anahtarı altında, tek bir nesne olarak durur. Şekli `background.js > emptyState()` fonksiyonunda tanımlıdır.

| Alan | Tip | Açıklama |
|---|---|---|
| `tabId` | `number \| null` | Kaydın bağlı olduğu sekme. `null` ise kayıt henüz başlamamış ya da sekme kapatılmış demektir. |
| `nextId` | `number` | Yeni id üretmek için sayaç. Node ve edge'ler aynı sayacı paylaşır: `n1`, `n2`, `e3`, `n4`... |
| `startNodeId` | `string \| null` | İlk oluşturulan node. Graph çiziminde en üste yerleşir. |
| `currentNodeId` | `string \| null` | Kullanıcının şu an bulunduğu node. Bir sonraki edge buradan çıkar. Panelde yeşil çerçeveyle gösterilir. |
| `nodes` | `Node[]` | Tüm node'lar |
| `edges` | `Edge[]` | Tüm edge'ler |
| `buffer` | `Action[]` | Son node'dan beri yapılan, henüz bir edge'e dönüşmemiş aksiyonlar. Panelde "Bekleyen aksiyonlar" listesi. |
| `pending` | `Pending \| null` | Benzer node bulunduğunda kullanıcının cevabını bekleyen karar |

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
| `elements` | `string[]` | `["a", "button:react-burger-menu-btn", ...]` | Yapısal parmak izi ([03](03-state-eslestirme.md#aşama-2-yapısal-parmak-izi-ve-jaccard-benzerliği)) |
| `screenshot` | `string` | `"data:image/jpeg;base64,..."` | Sayfanın görünen kısmının JPEG görüntüsü |

---

## Edge

Bir node'dan diğerine (ya da kendisine) geçişi temsil eder.

| Alan | Tip | Örnek | Açıklama |
|---|---|---|---|
| `id` | `string` | `"e3"` | Tekil kimlik |
| `name` | `string` | `"e_Login"` | Görünen isim. Son aksiyonun etiketinden türetilir. |
| `source` | `string` | `"n1"` | Çıkış node'unun id'si |
| `target` | `string` | `"n2"` | Varış node'unun id'si. `source` ile aynıysa self-loop'tur. |
| `actions` | `Action[]` | (aşağıda) | Bu geçişi oluşturan aksiyonlar, **gerçekleşme sırasıyla** |

---

## Aksiyon

Kullanıcının tek bir hareketi. Ortak alanlar:

| Alan | Tip | Açıklama |
|---|---|---|
| `type` | `string` | Aksiyon tipi (aşağıdaki tablo) |
| `selector` | `string \| null` | Elementi bulan CSS selector. Tarayıcı seviyesindeki gezinmelerde `null`. |
| `label` | `string` | İnsan tarafından okunabilir açıklama. Edge isimleri buradan türetilir. |
| `url` | `string` | Aksiyonun yapıldığı sayfanın adresi |
| `time` | `number` | Unix zaman damgası (ms) |

Tipler:

| `type` | Kaynağı | Ek alan | `label` örneği | Tekrar oynatırken (replay) karşılığı |
|---|---|---|---|---|
| `click` | content.js | | `"Login"`, `"Add to cart"` | `click(selector)` |
| `input` | content.js | `value` (`string` ya da checkbox için `boolean`) | `"Fill Username"`, `"Select Sort"`, `"Check Remember me"` | `fill(selector, value)` / `selectOption` / `check` |
| `enter` | content.js | | `"Submit Username"` | `press(selector, "Enter")` |
| `navigate` | background.js | | `"GoTo cart"` | `goto(url)` |
| `history` | background.js | | `"Back"` | `goBack()` ya da `goto(url)` |
| `reload` | background.js | | `"Reload"` | `reload()` |

Şifre alanlarında `value` her zaman `"******"` olarak saklanır.

---

## Bekleyen karar (pending)

"Node oluştur"a basıldığında benzer bir node bulunursa, karar verilene kadar bilgiler burada bekler:

| Alan | Tip | Açıklama |
|---|---|---|
| `capture` | `object` | Sayfanın o anki `url`, `urlKey`, `title`, `elements`, `screenshot` bilgileri. "Hayır" denirse bunlardan yeni node oluşturulur. |
| `actions` | `Action[]` | Buffer'dan kesilen aksiyonlar. Oluşacak edge'e konacak. |
| `candidateId` | `string` | Önerilen mevcut node |
| `similarity` | `number` | 0..1 arası Jaccard benzerliği |

---

## Dışa aktarılan JSON

Panelde **JSON indir** butonu `graph-YYYY-MM-DDTHH-MM-SS.json` dosyası üretir. Bu dosyada yalnızca kalıcı veri bulunur; `buffer`, `pending` ve `tabId` gibi oturuma ait alanlar yer almaz.

```json
{
  "format": "graph-recorder/v1",
  "exportedAt": "2026-10-02T12:00:00.000Z",
  "startNodeId": "n1",
  "nodes": [
    {
      "id": "n1",
      "name": "v_SwagLabs",
      "url": "https://www.saucedemo.com/",
      "urlKey": "https://www.saucedemo.com/",
      "title": "Swag Labs",
      "elements": ["input:login-button", "input:password", "input:user-name"],
      "screenshot": "data:image/jpeg;base64,/9j/4AAQ..."
    },
    {
      "id": "n2",
      "name": "v_Inventory",
      "url": "https://www.saucedemo.com/inventory.html",
      "urlKey": "https://www.saucedemo.com/inventory.html",
      "title": "Swag Labs",
      "elements": ["a", "a:shopping-cart-link", "button:add-to-cart-sauce-labs-backpack", "..."],
      "screenshot": "data:image/jpeg;base64,/9j/4AAQ..."
    }
  ],
  "edges": [
    {
      "id": "e3",
      "name": "e_Login",
      "source": "n1",
      "target": "n2",
      "actions": [
        { "type": "input", "selector": "#user-name", "value": "standard_user", "label": "Fill Username", "url": "https://www.saucedemo.com/", "time": 1790000000000 },
        { "type": "input", "selector": "#password",  "value": "******",        "label": "Fill Password", "url": "https://www.saucedemo.com/", "time": 1790000001000 },
        { "type": "click", "selector": "#login-button",                         "label": "Login",         "url": "https://www.saucedemo.com/", "time": 1790000002000 }
      ]
    }
  ]
}
```

`format` alanı, ileride şema değişirse eski dosyaları tanıyabilmek içindir.

---

## GraphWalker'a aktarım

Bu demo GraphWalker'dan bağımsızdır, ancak veri modeli aktarımı kolaylaştıracak şekilde tasarlandı. Aktarım **sonraki adım** olarak planlanıyor.

### Kavram eşlemesi

| Bizim modelimiz | GraphWalker JSON modeli | Not |
|---|---|---|
| `node` | `vertex` | |
| `node.name` (`v_...`) | `vertex.name` | `v_` öneki GraphWalker geleneğidir. |
| `edge` | `edge` | |
| `edge.name` (`e_...`) | `edge.name` | `e_` öneki GraphWalker geleneğidir. |
| `edge.source` / `edge.target` | `sourceVertexId` / `targetVertexId` | Sadece alan adı değişir. |
| `startNodeId` | `startElementId` | |
| `edge.actions` (kaydedilen UI aksiyonları) | **`edge.actions` DEĞİL!** (aşağıya bakın) | `properties` içinde taşınabilir. |
| Cytoscape'teki konumlar | `vertex.properties.x / y` | GraphWalker Studio'da düzgün görünmesi için |

### Dikkat: "actions" iki farklı anlama geliyor

GraphWalker'da `edge.actions`, **modelin kendi değişkenlerini** güncelleyen JavaScript ifadeleridir (ör. `"loggedIn = true;"`). Bu ifadeler `guard` koşullarıyla birlikte, hangi yolların mümkün olduğunu belirlemek için kullanılır.

Bizim kaydettiğimiz aksiyonlar ise **tarayıcıda yapılacak işlemlerdir** (tıkla, yaz). GraphWalker'da bunların yeri model dosyası değil, **test kodudur.** GraphWalker, her `v_` ve `e_` ismi için test kodunda aynı isimli bir metot çağırır.

Bu yüzden önerilen aktarım iki çıktı üretir:

**1. GraphWalker model dosyası (yapı):**

```json
{
  "models": [
    {
      "name": "SwagLabs",
      "generator": "random(edge_coverage(100))",
      "startElementId": "n1",
      "vertices": [
        { "id": "n1", "name": "v_SwagLabs",  "properties": { "x": 0, "y": 0 } },
        { "id": "n2", "name": "v_Inventory", "properties": { "x": 0, "y": 150 } }
      ],
      "edges": [
        { "id": "e3", "name": "e_Login", "sourceVertexId": "n1", "targetVertexId": "n2" }
      ]
    }
  ]
}
```

> Alan adları GraphWalker 4.x JSON formatına göredir. Aktarım yazılırken kullanılan GraphWalker sürümünün örnek modelleriyle doğrulanmalıdır.

**2. Test kodu iskeleti (davranış):** Kaydedilen aksiyonlardan her edge için bir metot gövdesi, her node için bir doğrulama üretilebilir. Örnek (Java + Selenium):

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
