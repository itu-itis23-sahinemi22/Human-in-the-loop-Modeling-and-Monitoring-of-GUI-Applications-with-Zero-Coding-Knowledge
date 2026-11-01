# 04: Veri Modeli

Bu doküman eklentinin sakladığı ve dışa aktardığı verinin tam şemasını ve bu verinin GraphWalker'a nasıl aktarılacağını anlatır.

## İçindekiler

- [Storage: graph'lar](#storage-graphlar)
- [State (bir graph)](#state-bir-graph)
- [Node](#node)
- [Edge](#edge)
- [Aksiyon](#aksiyon)
- [Bekleyen karar (pending)](#bekleyen-karar-pending)
- [Ayarlar (settings)](#ayarlar-settings)
- [Dışa aktarılan JSON](#dışa-aktarılan-json)
- [Graph yedeği](#graph-yedeği)
- [Senaryo dosyası](#senaryo-dosyası)
- [GraphWalker'a aktarım](#graphwalkera-aktarım)

---

## Storage: graph'lar

Birden fazla graph saklanır; kayıt her zaman **aktif** olana yapılır ([01 > Graph'lar](01-mimari.md#graphlar)). `chrome.storage.local` anahtarları:

| Anahtar | Tip | Açıklama |
|---|---|---|
| `graphs` | `{ id, name, auto, created, updated, nodes, edges, scenarios }[]` | Graph listesi (paneldeki "Graph'lar" kartı). `auto`: ad kullanıcı tarafından verilmedi, başlangıç node'unun sayfasından gelir (başlık, yoksa alan adı). `nodes` / `edges` / `scenarios` sayılar; liste yalnızca sayılar ya da ad değişince yazılır. `created` / `updated` zaman damgası (ms). |
| `activeGraph` | `string` | Aktif graph'ın id'si. |
| `graph:<id>` | `State` | Bir graph'ın state'i (aşağıda). |
| `settings` | `Settings` | Ayarlar; graph'lardan bağımsız ([Ayarlar](#ayarlar-settings)). |

Önceki sürümler tek bir **`state`** anahtarı kullanıyordu. Eklenti güncellenince ilk açılışta bu anahtar bir graph'a taşınır (yeni anahtar yazılıp okunduktan sonra eskisi silinir). Hiç graph yoksa boş bir "Yeni graph" açılır: her zaman bir aktif graph vardır.

## State (bir graph)

Bir graph'ın verisi `graph:<id>` anahtarı altında tek bir nesne olarak durur. Şekli `background.js > emptyState()` fonksiyonunda tanımlıdır.

| Alan | Tip | Açıklama |
|---|---|---|
| `id` | `string` | Graph'ın id'si (anahtardaki ile aynı). Nesne kendi id'sini taşıdığı için yazılırken doğru anahtara gider; silinmiş bir graph'a yazılmaz. |
| `tabId` | `number \| null` | Kaydın bağlı olduğu sekme. `null` ise kayıt henüz başlamamış ya da sekme kapatılmış demektir; kapandıysa kayıt "Buradan devam et" ile başka sekmeye bağlanır. |
| `nextId` | `number` | Yeni id üretmek için sayaç. Node ve edge'ler aynı sayacı paylaşır: `n1`, `n2`, `e3`, `n4`... |
| `startNodeId` | `string \| null` | İlk oluşturulan node. Graph çiziminde en üste yerleşir. |
| `currentNodeId` | `string \| null` | Kullanıcının şu an bulunduğu node. Bir sonraki edge buradan çıkar. Panelde yeşil çerçeveyle gösterilir. |
| `nodes` | `Node[]` | Tüm node'lar |
| `edges` | `Edge[]` | Tüm edge'ler |
| `buffer` | `Action[]` | Son node'dan beri yapılan, henüz bir edge'e dönüşmemiş aksiyonlar. Panelde "Bekleyen aksiyonlar" listesi. |
| `pending` | `Pending \| null` | Element kümesi birebir aynı bir node bulunduğunda kullanıcının cevabını bekleyen karar |
| `screen` | `{ key, types, count }[] \| null` | Hemen önceki state: en son görülen ekranın edge set'i (node `elements` ile aynı biçim). Sıradaki aksiyonun öncesidir; aksiyonun `changed` işareti bununla bulunur. Bkz. [01 > Edge düzenleme](01-mimari.md#edge-düzenleme) |
| `tabs` | `{ id, url, title }[]` | Kayda katılan sekmeler (Chrome sekme id'si, son bilinen adres ve başlık). `tabId` bunlardan aktif olanıdır. Bkz. [01 > Kayıt hangi sekmede?](01-mimari.md#kayıt-hangi-sekmede) |
| `declinedTabs` | `number[]` | "Bu sekmede devam edilsin mi?" sorusuna "Hayır" denen sekmeler; bir daha sorulmaz. |
| `pageOpenedTabs` | `number[]` | Kayıt sekmelerinin açtığı sekmeler (link, popup). Kayda katılırlarsa açılış önceki aksiyonun sonucudur. |
| `tabPrompt` | `{ tabId, url, title, openedByPage } \| null` | Bekleyen soru: kayda katılmamış bir sekme aktif oldu. |
| `viewport` | `{ width, height, devicePixelRatio } \| null` | Aktif kayıt sekmesinin son bilinen görünen alanı; sekme değişince fark varsa `resize` eklenir. |
| `idleSince` | `number \| null` | Ekranın son aksiyondan (ya da node'dan) sonra durulduğu an (ms). O andan beri aksiyon yok; beklemeler bununla ölçülür. Aksiyon yapılınca `null` olur. Bkz. [01 > Beklemeler](01-mimari.md#beklemeler) |
| `undo` | `Silme[]` | Geri al yığını, en yenisi sonda, en fazla 20. Her kayıt silineni ve eski yerini tutar: `{ kind: 'node', node, index, edges: [{ edge, index }], startNodeId, currentNodeId }`, `{ kind: 'edge', edge, index }`, `{ kind: 'action', edgeId, index, action }` ya da `{ kind: 'merge', keepId, node, index, edges: [{ id, source, target }], startNodeId, currentNodeId }` (birleştirmede taşınan edge'lerin eski uçları). Bkz. [01 > Geri al](01-mimari.md#geri-al) |
| `scenarios` | `Senaryo[]` | Graph'ın test yolları: `{ id, name, start, planner, runs, cleanup, graph, created, updated }`. `cleanup`: panelde oynatmadan önce silinecek site verileri ([08 > Site verileri](08-site-verileri.md)). `graph`: senaryo graph'ı, koşuların geçtiği kısmın kopyası (aşağıda, [Senaryo dosyası](#senaryo-dosyası)). Alanlar [senaryo dosyasıyla](#senaryo-dosyası) aynıdır; id'yi panel verir, ad graph içinde tekildir. Yürünebilirlik saklanmaz: graph değişince panel yürünemeyen senaryoyu işaretler. "Sıfırla" senaryoları da siler. Bkz. [01 > Senaryolar](01-mimari.md#senaryolar) |

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
| `viewport` | `{ width, height, devicePixelRatio }` | `{ "width": 1280, "height": 720, "devicePixelRatio": 1 }` | `elements`'ın alındığı görünen alan: sayfanın CSS piksel boyutu (`innerWidth × innerHeight`) ve piksel oranı (`devicePixelRatio`; yakınlaştırmayı da içerir). Küme bu alana sığan elementlerden oluştuğu için test aynı boyutta çalıştırılır ([03 > Pencere boyutu ve state](03-state-eslestirme.md#pencere-boyutu-ve-state)). Bu alan eklenmeden önce kaydedilmiş node'larda yoktur. |
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
| `target` | `{ key, index }` | Sadece `click`, `multiclick`, `input`, `enter`, odakta bir element varken `key`, etkileşimli elementteki `contextmenu` / `focus` ve form alanındaki `select` / `clipboard`: hedef element, state ile aynı düzeyde. `key` elementin türü, `index` ekranda görünen aynı türdekiler arasındaki DOM sırası (1'den). Örnek: `{ "key": "button:Sil", "index": 2 }` = "ekrandaki 2. Sil". Element o an ekranda tıklanabilir değilse `index` `null`. Tekrar oynatırken önce bu kullanılır ([03](03-state-eslestirme.md#edge-hedefi-state-ile-aynı-düzeyde-türün-ncisi)). |
| `changed` | `boolean \| null` | Aksiyon state'i (edge set'i) değiştirdi mi: hemen önceki state ile aksiyondan sonra sayfa durulunca görülen state karşılaştırılır. `null` ya da yok: bilinmiyor. Edge düzenlemedeki silme uyarısı ve runner'ın aksiyon izi (adım kalınca her aksiyonun oynatmadaki etkisi kayıttakiyle karşılaştırılır) için; GraphWalker çıktısında da vardır. Bkz. [01 > Edge düzenleme](01-mimari.md#edge-düzenleme) |
| `selector` | `string \| null` | Elementi bulan CSS selector (yedek; `target` bulunamazsa). Tarayıcı seviyesindeki gezinmelerde, yakınlaştırmada, pencere boyutu değişiminde ve sayfanın kendisi kaydırıldığında `null`. |
| `label` | `string` | İnsan tarafından okunabilir açıklama. Edge isimleri buradan türetilir. |
| `url` | `string` | Aksiyonun yapıldığı sayfanın adresi |
| `time` | `number` | Unix zaman damgası (ms) |

Tipler:

| `type` | Kaynağı | Ek alan | `label` örneği | Tekrar oynatırken (replay) karşılığı |
|---|---|---|---|---|
| `click` | content.js | | `"Login"`, `"Add to cart"` | `click(selector)` |
| `multiclick` | content.js | `count` (`number`): hızlı art arda kaç tıklama (2 ya da fazla) | `"Double click Login"`, `"Triple click Satır"`, `"Click Logo ×5"` | `click(selector, { clickCount: count })`: basıp bırakmalar arada beklemeden, artan `clickCount`'la; sayfa `dblclick`'i de görür. Ayarlar'da Çoklu tıklama kapalıysa kaydedilmez, tıklamalar ayrı `click` olur ([01 > Aksiyonlar](01-mimari.md#sayfa-içi-olaylar-contentjs)). |
| `input` | content.js | `value` (`string` ya da checkbox için `boolean`; düzenlenebilir alanda metni) | `"Fill Username"`, `"Select Sort"`, `"Check Remember me"` | `fill(selector, value)` / `selectOption` / `check` |
| `enter` | content.js | | `"Submit Username"` | `press(selector, "Enter")` |
| `key` | content.js | `key` (`string`): Playwright biçiminde tuş (`"Escape"`, `"Control+Enter"`, `"/"`); `count` (`number`): art arda kaç kez basıldığı | `"Press Escape"`, `"Press ArrowDown ×3"` | `selector` varsa `press(selector, key)`, `null` ise `keyboard.press(key)`; `count` kez |
| `select` | content.js | `text` (`string`): seçilen metin; metin alanında `start`, `end` (`number`): seçim aralığı. `selector` seçimi içeren element ya da alan | `"Select \"Merhaba dunya\""` | Alanda `setSelectionRange(start, end)`; sayfada `selector` içinde `text`'i bulup `Range` ile seçmek |
| `contextmenu` | content.js | `blocked` (`boolean`): sayfa tarayıcının menüsünü engelledi, kendi menüsünü açtı | `"Right click Dosya.pdf"` | `click(selector, { button: "right" })` |
| `hover` | content.js | `target` yalnızca etkileşimli bir elementteyse | `"Hover Ürünler"` | `hover(selector)`. Yalnızca state'i değiştiren ve Ayarlar'da işaretliyse (varsayılan kapalı) kaydedilir ([01 > Fareyle üzerine gelme](01-mimari.md#fareyle-üzerine-gelme)). |
| `focus` | content.js | | `"Focus İçeriğe atla"` | `focus(selector)`. Yalnızca state'i değiştiren odaklar kaydedilir. |
| `clipboard` | content.js | `operation`: `"copy"`, `"cut"` ya da `"paste"`; `text` (`string`): kopyalanan / yapıştırılan metin (şifre alanında `"******"`); `blocked` (`boolean`): sayfa işlemi engelledi ya da panoya kendi içeriğini koydu | `"Copy \"Merhaba\""`, `"Paste (boş)"` | Kopyala/kes: `press("Control+C")` / `"Control+X"`; yapıştır: panoya `text` yazılır, `press("Control+V")`. `blocked` testin beklediği sonuçtur. |
| `scroll` | content.js | `x`, `y` (`number`): kaydırmanın vardığı konum (px) | `"Scroll down"`, `"Scroll up"` | `selector` varsa o kutuda, `null` ise sayfada `scrollTo(x, y)` |
| `zoom` | background.js | `zoom` (`number`): tarayıcı yakınlaştırmasının vardığı oran (`1` = %100); `fromZoom` (`number`): başladığı oran; `viewport`: varılan görünen alan (node'daki biçim; yakınlaştırma CSS piksel boyutunu ve piksel oranını değiştirir). `viewport`, aksiyon sayfanın bildirimi gelmeden bir gezinmeyle kapanırsa yoktur. | `"Zoom in"`, `"Zoom out"` | Sekmeyi `zoom` oranına ayarla (ör. `chrome.tabs.setZoom`). Tarayıcı yakınlaştırması olmayan araçta (Playwright) viewport'u `viewport` boyutuna ve piksel oranına ayarla. |
| `resize` | content.js | `viewport`: varılan görünen alan (node'daki biçim) | `"Resize"` | Viewport'u `viewport` boyutuna ayarla (`page.setViewportSize({ width, height })`) |
| `navigate` | background.js | | `"GoTo cart"` | `goto(url)` |
| `history` | background.js | | `"Back"` | `goBack()` ya da `goto(url)` |
| `reload` | background.js | | `"Reload"` | `reload()` |
| `tab` | background.js | `operation`: `"open"`, `"switch"` ya da `"close"`; `url`: sekmenin adresi (açılan, geçilen ya da kapanan). `open`'da `by`: `"page"` (kayıt sekmesi açtı, önceki aksiyonun sonucu) ya da `"user"` (kullanıcı açtı). `close`'da `active`: kapanan aktif sekme miydi. | `"Open tab docs"`, `"Switch to tab Mağaza"` | `page`: önceki aksiyonun açtığı sayfaya geç (`context.waitForEvent('page')`); `user`: yeni sayfa aç, `url`'e git. `switch` / `close`: adresi (URL şablonu) tutan sekme. |
| `wait` | background.js | `ms` (`number`): beklemenin süresi. `time` beklemenin başladığı andır. `changed` işaretini kayıt anında alır: `true` ekran beklerken kendiliğinden değişti (ör. oturum zaman aşımı), `false` değişmedi. Yalnızca Ayarlar'da "Beklemeleri kaydet" açıkken kaydedilir ([01 > Beklemeler](01-mimari.md#beklemeler)). | `"Wait"` | `waitForTimeout(ms)` |

Şifre alanlarında `value` her zaman `"******"` olarak saklanır.

Runner bu karşılıkları uygular; maskeli değerleri bir secrets dosyasından alır. `select` ve `clipboard` henüz oynatılmıyor ([runner/README.md > Aksiyonların karşılığı](../runner/README.md#aksiyonların-karşılığı)).

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
| `enabledActions` | `string[]` | İşaretlenmiş **isteğe bağlı** aksiyon tipleri (ör. `["hover"]`). İsteğe bağlı tipler (`ACTION_TYPES > optional`) varsayılan kapalıdır; yalnızca burada listelenince kaydedilir. |
| `disabledActions` | `string[]` | İşareti kaldırılmış aksiyon tipleri (ör. `["scroll"]`). Bu tipteki aksiyonlar buffer'a eklenmez. Bağlı bir tip (`ACTION_TYPES > requires`, ör. `multiclick` → `click`), bağlı olduğu tip burada listelenince listede olmasa da kapalı sayılır. |
| `disabledInteractables` | `string[]` | İşareti kaldırılmış etkileşimli element türleri (ör. `["a", "label"]`). Bu türlerin anahtarları state karşılaştırmasına girmez. |
| `recordWaits` | `boolean` | "Beklemeleri kaydet": aksiyonlar arasındaki boşluklar ve ekranın kendiliğinden değişmesi `wait` aksiyonu olarak kaydedilir; kayıt sekmesinin ekranı sürekli izlenir. Varsayılan `false`. |
| `minWaitSeconds` | `number` | Ekranı değiştirmeyen bir beklemenin kaydedilmesi için en kısa süre (saniye). Varsayılan `1`. Ekranı değiştiren bekleme her zaman kaydedilir. |

İsteğe bağlı tipler dışında işaretli olanlar değil işareti **kaldırılanlar** saklanır: listelere ileride eklenen yeni bir tip kendiliğinden işaretli gelir.

---

## Dışa aktarılan JSON

Panelde **GraphWalker JSON** butonu, graph'ı **GraphWalker JSON model formatında** indirir (`sidepanel/panel.js > graphWalkerModel()`). Dosya adı model adıdır: graph'ın adı, node adları gibi yalnızca harf ve rakam ("Swag Labs" → `SwagLabs.json`; ad boşsa başlangıç node'unun adı, `v_` öneki olmadan). GraphWalker model adından kod ürettiği ve senaryo dosyası modeli dosya adıyla bulduğu için boşluk ve özel karakter atılır. Format, GraphWalker Studio'nun kaydettiği dosyayla aynı iskelete sahiptir ve GraphWalker CLI tarafından doğrudan okunur.

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
          "format": "graph-recorder/v5",
          "exportedAt": "2026-10-07T12:00:00.000Z",
          "settings": { "disabledActions": [], "disabledInteractables": ["label"], "recordWaits": false, "minWaitSeconds": 1 }
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
            "viewport": { "width": 1280, "height": 720, "devicePixelRatio": 1 },
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
- `properties.graphRecorder.format`: şema değişince eski dosyaları tanımak için. `v5` = GraphWalker formatı, `elements` sayılı küme, aksiyonlarda `target`, vertex'lerde `viewport`. (`v4`: viewport'suz; `v3`: sayısız küme; `v2` ve öncesi eklentiye özel formattı.) `v5` dosyasında `viewport`'u olmayan vertex, bu alan eklenmeden önce kaydedilmiştir.
- `properties.graphRecorder.settings`: `elements`'ın hangi türlerinin state'i oluşturduğunu gösterir.
- Edge panelde düzenlendiyse `properties` ayrıca `edited: true` ve kayıttaki orijinal aksiyonları (`recordedActions`) taşır. `uiActions` ve `recordedActions` içinde `changed` işareti de bulunur: runner bir adım kalınca her aksiyonun oynatmadaki etkisini bununla karşılaştırır ([runner/README.md](../runner/README.md)).
- Chrome storage nesne anahtarlarını alfabetik sıraladığı için `elements` içindeki türlerin sırası `settings.js`'teki sıradan farklı olabilir.

### GraphWalker ile doğrulama

Çıktı, GraphWalker CLI 4.3.3 ile denendi: `check` *"No issues found with the model(s)"* der, `offline` modelde edge kapsamasına kadar yol üretir.

```
java -jar graphwalker-cli-4.3.3.jar check   -m SwagLabs.json "random(edge_coverage(100))"
java -jar graphwalker-cli-4.3.3.jar offline -m SwagLabs.json "random(edge_coverage(100))"
```

> GraphWalker 4.3.3, Java 25 ile `NoSuchMethodError: sun.misc.Unsafe.ensureClassInitialized` hatası verir. Java 17 (ya da 21) ile çalıştırın.

GraphWalker'ın Rust sürümünde ([graphwalker-rs](https://github.com/GraphWalker/graphwalker-rs) 1.0.4) aynı komutlar `graphwalker.exe check -m …` ve `graphwalker.exe offline -m …` şeklindedir. Rust sürümü dışa aktarılan modeli (`properties` alanlarıyla birlikte) okur. `check` Java'yla aynı uyarıları verir; örneğin çıkmaz node'lu bir modelde *"The model has one cul-de-sacs …"*. Uyarı varsa 1 koduyla çıkar. `offline` çıktısında id her zaman vardır (`currentElementId`).

Model kurulurken dikkat:

- **Başlangıç elementi:** `startElementId` ilk node'dur. Boşsa GraphWalker *"The model has neither a start element or a defined shared state"* der.
- **Çıkmaz node'lar:** Çıkış edge'i olmayan bir node'a (genelde en son kaydedilen) varan yol orada biter, edge kapsaması %100'e ulaşamayabilir. Kayıtta bu node'lardan bilinen bir duruma dönüşü de kaydedin.
- **Aynı isimli edge'ler:** GraphWalker aynı isimli her edge için test kodunda aynı metodu çağırır. Otomatik isim son aksiyondan geldiği için farklı aksiyonlu iki edge aynı ismi alabilir (ör. iki ayrı `e_Login`). Test kodu isme göre yazılacaksa bu edge'leri panelden farklı isimlerle yeniden adlandırın ya da tarayıcı aksiyonlarını o anki edge'in `properties.uiActions`'ından okuyun.

---

## Graph yedeği

"Graph'lar" kartındaki **Dışa aktar**, aktif graph'ı **ekran görüntüleriyle birlikte** tek dosyaya indirir (`SwagLabs.graph.json`); **Yükle…** onu yeni bir graph olarak ekler ve ona geçer (mevcut graph'ın üstüne yazmaz). GraphWalker JSON'dan farklıdır: o, test aracı için modeldir; yedek ise eklentinin kendi verisidir ve geri yüklenebilir.

```json
{
  "format": "graph-recorder-graph/v1",
  "name": "Swag Labs",
  "exported": "2026-10-22T14:03:11.000Z",
  "startNodeId": "n1",
  "nextId": 14,
  "nodes": [ /* Node, ekran görüntüsü dahil */ ],
  "edges": [ /* Edge, aksiyonlarıyla */ ],
  "scenarios": [ /* Senaryo */ ]
}
```

- Senaryolar (`scenarios`) dosyaya girer ve yüklenince geri gelir. Kayda ait geçici alanlar (sekmeler, bekleyen aksiyonlar, bekleyen karar, geri al yığını) dosyaya girmez; yüklenen graph'ta şu anki node boştur, kayıt "Buradan devam et" ile sürer.
- Yüklerken denetlenir: biçim, node ve edge id'lerinin varlığı ve tekilliği, her edge'in iki ucunun ve aksiyon listesinin olması, başlangıç node'unun varlığı. Sorun varsa graph eklenmez ve nedeni söylenir. GraphWalker JSON seçilirse bunun yüklenemeyeceği (ekran görüntüsü ve kayıt bilgisi yok) ayrıca söylenir.
- Ad dosyadaki `name`'dir; aynı ad varsa sonuna "(2)" eklenir. Yüklenen graph'ın adı otomatik değişmez.

## Senaryo dosyası

Senaryolar graph'la birlikte saklanır (state'te `scenarios`); paneldeki **Senaryo** bölümünün **Senaryo indir** butonu seçili senaryoyu ayrı bir dosyaya yazar (`<Model>-<Senaryo>.json`, ör. `SwagLabs-GirisAkisi.json`); runner onu oynatır ([runner/README.md](../runner/README.md)). Biçim ve kapsama hesabı `extension/scenario.js`'tedir (panel ve runner ortak kullanır).

```json
{
  "format": "graph-recorder-scenario/v1",
  "name": "Giriş akışı",
  "model": "SwagLabs.json",
  "planner": { "engine": "manual" },
  "runs": [["e13"], ["e3", "e5", "e7"]],
  "coverage": { "edges": [4, 8], "nodes": [5, 6] }
}
```

| Alan | Açıklama |
|---|---|
| `format` | Şema sürümü. |
| `name` | Senaryonun paneldeki adı; rapor başlığı. |
| `model` | Modelin dosya adı, senaryo dosyasına göre (ikisi aynı klasörde durur). |
| `start` | (İsteğe bağlı) Koşuların başladığı node'un id'si; yoksa graph'ın başlangıcı. Panelde "Başlangıç" listesinden seçilir. Graph'ın başlangıcı dışında bir node'dan başlayan senaryo yalnızca panelde oynatılır: runner her koşuyu temiz bir tarayıcıda başlattığı için graph'ın ortasındaki bir ekrana doğrudan gidemez, böyle bir senaryoyu açık bir hatayla reddeder. |
| `planner` | Senaryoyu ne üretti: `{ engine: "manual" }` (panelde elle) ya da `{ engine: "graphwalker", goal, generator, seed, deadEnd?, target? }` (`goal`: `edges`, `nodes`, `node`; `seed`: aynı graph'ta aynı koşuları veren tohum; `deadEnd`: GraphWalker'ın ilk koşuda takıldığı çıkmaz node; `target`: ulaşılan node). Yalnızca bilgi içindir; runner kullanmaz. Bkz. [runner/README.md > Planlayıcı](../runner/README.md#planlayıcı-graphwalker-ile-senaryo) |
| `runs` | Koşular: her biri başlangıç node'undan (`start`) başlayan edge id'leri dizisi; her edge bir öncekinin vardığı node'dan çıkar. Runner her koşuyu temiz bir oturumla baştan oynatır. Yol çıkmaz bir node'a varırsa koşu biter, kalan edge'ler yeni bir koşuyla kapsanır. |
| `coverage` | Koşuların geçtiği farklı edge ve node sayısı / toplam (`[kapsanan, toplam]`). Yalnızca bilgi içindir; runner yeniden hesaplar. |
| `cleanup` | (İsteğe bağlı) Panelde oynatmadan önce silinecek site verileri: `{ "<origin>": ["cookies", "localStorage", …] }`. Anahtar sitenin origin'i (`https://www.saucedemo.com`), değer silinecek türler (`extension/scenario.js > CLEANUP_TYPES`: `cookies`, `cache`, `cacheStorage`, `localStorage`, `indexedDB`, `serviceWorkers`, `fileSystems`; `localStorage` sitenin sessionStorage'ını da siler). Yalnızca bir şey seçildiyse yazılır. Runner kullanmaz: her koşuyu zaten temiz bir tarayıcıda başlatır. Bkz. [08 > Site verileri](08-site-verileri.md) |
| `graph` | (İsteğe bağlı) Senaryo graph'ı: `{ start, nodes, edges, copied }`, koşuların geçtiği node ve edge'lerin ana graph'tan kopyası. Node ve edge ana graph'taki gibidir; node'larda ekran görüntüsü yoktur. Her node ve edge'de `monitors: []` (senaryoya özel monitörlerin yeri; şimdilik boş). `copied`: kopyanın zamanı. Runner kullanmaz; panel yüklerken kopyayı yeniden alır. Bkz. [01 > Senaryo graph'ı](01-mimari.md#senaryo-graphı-ve-görünüm-sekmeleri) |

Senaryo edge id'leriyle modele bağlıdır: graph'ta edge silinir ya da yeniden kaydedilirse senaryo geçersiz olur; panel listede ⚠ ile işaretler (senaryo silinmez, edge geri gelirse işaret kalkar), yüklerken reddeder; runner çalıştırmadan önce söyler. **Yükle…** dosyayı listeye yeni bir senaryo olarak ekler.

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

### Tekrar oynatma: runner

Test kodu yazmadan da model çalıştırılabilir: **runner**, modeldeki bir yolu (elle verilen ya da GraphWalker `offline` çıktısı) gerçek bir tarayıcıda oynatır. Her edge'in `properties.uiActions`'ını oynatır, sonra varılan ekranın parmak izini hedef vertex'in `properties.elements`'ı ve `urlKey`'i ile birebir karşılaştırır. Tarayıcı başlangıç vertex'inin `properties.viewport`'uyla açılır. Böylece GraphWalker'ın `v_` / `e_` metotlarının yaptığı iş (edge'de aksiyon, vertex'te doğrulama) modelin kendi verisinden yapılır. Bkz. [runner/README.md](../runner/README.md)

```
java -jar graphwalker-cli-4.3.3.jar offline -m SwagLabs.json "random(edge_coverage(100))" > yol.txt
node runner/run.js SwagLabs.json --path yol.txt --secrets secrets.json
```

### Sonraki adım: test kodu iskeleti

**Test kodu iskeleti (davranış):** Kaydedilen aksiyonlardan (`properties.uiActions`) her edge için bir metot gövdesi, her node için bir doğrulama üretilebilir. Henüz yapılmadı; runner aynı işi kod üretmeden yapıyor. Kod üretimi, GraphWalker'ın kendi test koşucusuyla (online mod, guard'lar) çalışmak istenirse gerekir. Örnek (Java + Selenium):

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

> **Pencere boyutu:** State'ler yalnızca ekranda görünen elementlerden çıkarıldığı için testler kayıttaki görünen alanla çalıştırılmalıdır. Başlangıç boyutu, başlangıç vertex'inin `properties.viewport`'udur (Playwright: `browser.newContext({ viewport: { width, height }, deviceScaleFactor: devicePixelRatio })`; Selenium'da pencere, sayfanın iç boyutu bu değer olacak şekilde ayarlanır). Edge'lerdeki `resize` ve `zoom` aksiyonları boyutu değiştirir. Aksi halde ekrana sığan elementler ve dolayısıyla state'ler değişir. Bkz. [03 > Pencere boyutu ve state](03-state-eslestirme.md#pencere-boyutu-ve-state)
