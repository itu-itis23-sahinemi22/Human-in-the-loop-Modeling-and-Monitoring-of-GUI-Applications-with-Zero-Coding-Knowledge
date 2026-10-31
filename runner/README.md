# Runner: Kaydedilen Yolu Tekrar Oynatmak

Eklentinin dışa aktardığı modeldeki bir senaryoyu (bir ya da birden fazla koşu, her biri bir edge dizisi) gerçek bir tarayıcıda tekrar oynatır ve her edge'den sonra varılan ekranın beklenen node olduğunu doğrular. Bir koşu ilk başarısız adımında durur, çünkü sonraki edge'ler o adımın node'undan çıkar; sonraki koşu yine çalışır. Sonuç HTML, JSON ve JUnit XML raporu olarak yazılır.

Runner, eklentinin parmak izi kodunu (`extension/settings.js`, `extension/fingerprint.js`) olduğu gibi kullanır. Kayıt ile test aynı state tanımını kullanır: "varılan ekran beklenen node mu?" sorusu, kayıttaki "bu sayfa zaten bir node mu?" sorusuyla aynı kuralla cevaplanır ([docs/03](../docs/03-state-eslestirme.md)).

## İçindekiler

- [Kurulum](#kurulum)
- [Kullanım](#kullanım) (senaryo, raporlar)
- [Planlayıcı: GraphWalker ile senaryo](#planlayıcı-graphwalker-ile-senaryo) (kurulum, panel, komut satırı)
- [Nasıl çalışır?](#nasıl-çalışır)
- [Aksiyonların karşılığı](#aksiyonların-karşılığı)
- [Sınırlar](#sınırlar)
- [Dosyalar](#dosyalar)

---

## Kurulum

Node.js 20 ya da sonrası gerekir.

```
cd runner
npm install
npx playwright install chromium
```

Son satır Playwright'ın Chromium'unu bir kez indirir. Onun yerine kurulu Chrome da kullanılabilir: `--channel chrome`.

Eklentiden farklı olarak runner'ın bir npm bağımlılığı (Playwright) vardır; bağımlılık yalnızca bu klasördedir. Eklenti build adımı olmadan çalışmaya devam eder.

---

## Kullanım

```
node run.js SwagLabs-Senaryo1.json --secrets secrets.json
node run.js SwagLabs.json --path e_Login,e_AddToCart,e_Cart1Items --secrets secrets.json
```

Girdi iki biçimde olabilir:

- **Senaryo dosyası:** paneldeki **Senaryo indir**'in (ya da bir planlayıcının) ürettiği dosya. Bir ya da birden fazla koşu içerir. Senaryodaki model yolu senaryo dosyasına göredir; ikisi aynı klasörde durmalıdır (bkz. [Senaryo](#senaryo)).
- **Model ve yol:** eklentinin **GraphWalker JSON** ile indirdiği model ve `--path` ile tek bir yol (tek koşu).

Gerçek bir çalıştırmanın çıktısı (saucedemo.com, eklentiyle kaydedilmiş model, tek koşu):

```
Senaryo: SwagLabs · 1 koşu · kapsama 8/8 edge, 6/6 node
Model: SwagLabs · graph-recorder/v5 · görünen alan 1264×749

Koşu 1/1: v_SwagLabs → e_Login → e_AddToCart → e_Cart1Items → e_ZoomIn → e_ZoomOut → e_ContinueShopping → e_Resize → e_Resize
✓ v_SwagLabs                           başlangıç    0,8 sn
✓ e_Login → v_Inventory                3 aksiyon    2,0 sn
✓ e_AddToCart → v_Inventory_2          1 aksiyon    0,7 sn
✓ e_Cart1Items → v_Cart                1 aksiyon    0,8 sn
✓ e_ZoomIn → v_Cart_2                  1 aksiyon    0,6 sn
✓ e_ZoomOut → v_Cart                   1 aksiyon    0,6 sn
✓ e_ContinueShopping → v_Inventory_2   1 aksiyon    0,9 sn
✓ e_Resize → v_Inventory_3             1 aksiyon    0,6 sn
✓ e_Resize → v_Inventory_2             1 aksiyon    0,6 sn

Sonuç: GEÇTİ · 9/9 adım · 1 koşu · 8,5 sn
Rapor: runner/out/SwagLabs-2026-10-18T15-00-00-000Z/report.html (ayrıca report.json, junit.xml)
```

Bir adım başarısız olursa beklenen node ile ekranın farkı ve edge'in **aksiyon izi** yazılır; o koşunun kalan adımları atlanır, sonraki koşu yine çalışır:

```
✗ e_ScrollDown → v_Liste_2             1 aksiyon    10,8 sn
    Beklenen ekrana (v_Liste_2) varılmadı:
      button:add13: beklenen 1, ekranda 0
      button:add29: beklenen 0, ekranda 1
    Aksiyonlar:
      1/1 ⚠ Scroll down · ekranı değiştirdi · kaydırma 0, 1029 konumunda kaldı, kayıtta 0, 5000 (sayfa en fazla 0, 1029 kayabiliyor)
    İlk sapma: 1. aksiyon "Scroll down"
```

Aksiyon izi: runner her aksiyondan sonra ekrana bakar. Bir aksiyon şu durumlarda ⚠ alır: ekranı kayıttakinden farklı etkiledi (kayıtta "ekranı değiştirdi", oynatmada değiştirmedi ya da tersi; eklentinin dışa aktardığı `changed` işaretiyle), kaydırma kayıttaki konuma varamadı, yakınlaştırma ya da pencere boyutundan sonra görünen alan kayıttakinden farklı. Oynatılamayan aksiyon ✗ alır. Kayıttan ilk sapan aksiyon "İlk sapma" olarak yazılır. Sapma yoksa fark edge'in sonunda ortaya çıkmıştır. İz `report.html`'de, `report.json`'da (`trail`) ve `junit.xml`'de de vardır.

**Çıkış kodu:** `0` bütün adımlar geçti, `1` en az bir adım başarısız, `2` kullanım ya da girdi hatası (ör. yolda olmayan bir edge, modelle uyuşmayan senaryo).

### Senaryo

Senaryo, başlangıç node'undan başlayan bir ya da birden fazla **koşudur** (edge dizisi). Her koşu yeni bir tarayıcı bağlamında, temiz bir oturumla baştan oynatılır. Yol çıkmaz bir node'a varırsa (oradan çıkan edge yoksa) koşu biter; kalan edge'ler yeni bir koşuyla kapsanır. Biçim ([docs/04 > Senaryo dosyası](../docs/04-veri-modeli.md#senaryo-dosyası)):

```json
{
  "format": "graph-recorder-scenario/v1",
  "name": "SwagLabs · elle seçilen yol",
  "model": "SwagLabs.json",
  "planner": { "engine": "manual" },
  "runs": [["e13"], ["e3", "e5", "e7"]],
  "coverage": { "edges": [4, 8], "nodes": [5, 6] }
}
```

Senaryo panelde kurulur (**Senaryo** bölümü: senaryo listesi, elle yol, önizleme, indir; senaryolar graph'la saklanır) ya da GraphWalker üretir ([Planlayıcı](#planlayıcı-graphwalker-ile-senaryo)).

Panelde koşuların başlangıç node'u seçilebilir (dosyada `start`). Runner her koşuyu temiz bir tarayıcıda graph'ın başlangıcından oynatır; graph'ın ortasındaki bir node'dan başlayan senaryoyu (ör. giriş gerektiren `v_Inventory`) çalıştırmadan reddeder (çıkış kodu `2`). Böyle bir senaryo panelde **Koşuyu oynat** ile oynatılır.

**Not (panel ile runner farkı):** Panel koşuyu senaryonun kendi graph'ından (dosyadaki `graph`, ana graph'ın kopyası) oynatır; runner ise dışa aktarılan modelden. Ana graph kopyadan sonra değiştiyse ikisi aynı senaryoyu farklı oynayabilir. Runner şimdilik kopyayı kullanmaz.

### Raporlar

Her çalıştırma `--out` klasörüne (varsayılan `runner/out/<senaryo>-<zaman>/`, git'e girmez) üç rapor yazar:

| Dosya | Kimin için | İçerik |
|---|---|---|
| `report.html` | İnsan | Tek dosya. Sonuç, koşular, adım adım süre ve durum. Başarısız adımda: URL şablonu ve edge set farkı tablosu, beklenen node'un kayıttaki ekran görüntüsü, runner'ın gördüğü ekran ve ikisinin **görsel farkı** (eklentinin `compare.js`'i rapor açılınca tarayıcıda çizer). Görsel fark, doğrulamanın görmediği etkileşimli olmayan farkları (sepet sayacı) da gösterir. |
| `report.json` | Makine | Sonucun tamamı: senaryo, kapsama, koşular, adımlar (durum, süre, uyarılar, hata, fark); ekran görüntüleri dosya adıyla. |
| `junit.xml` | CI | Her koşu bir `testsuite`, her adım bir `testcase`. Kırılan koşunun kalan adımları `skipped` ("Koşu ... adımında kırıldı"). |

Başarısız adımın ekran görüntüsü PNG olarak da aynı klasöre kaydedilir.

### Yol

- **Virgülle ayrılmış edge adları ya da id'leri:** `--path e_Login,e_Cart1Items` ya da `--path e3,e7`. İki edge aynı adı alabilir (ör. iki `e_Resize`); runner hangisinin kastedildiğini o an bulunulan node'dan anlar. Aynı node'dan aynı adla birden fazla edge çıkıyorsa id ister.
- **Dosya:** JSON dizi (`["e3", "e5"]`) ya da GraphWalker'ın `offline` çıktısı. Böylece yolu GraphWalker'ın generator'ları üretir:

  ```
  java -jar graphwalker-cli-4.3.3.jar offline -m SwagLabs.json "random(edge_coverage(100))" > yol.txt
  graphwalker.exe offline -m SwagLabs.json "random(edge_coverage(100))" > yol.txt
  node run.js SwagLabs.json --path yol.txt --secrets secrets.json
  ```

  İlk satır GraphWalker'ın Java sürümü, ikincisi Rust sürümü. Çıktıda id varsa o (Java `--verbose`: `currentElementID`; Rust her zaman: `currentElementId`), yoksa `currentElementName` okunur. Yoldaki node'lar yalnızca tutarlılık için kontrol edilir. Java sürümü (4.3.3) Java 17 ya da 21 ister; Rust sürümü derlenmiş bir `graphwalker.exe`'dir ([Planlayıcı > Kurulum](#kurulum-bir-kez-windows), [docs/04 > GraphWalker ile doğrulama](../docs/04-veri-modeli.md#graphwalker-ile-doğrulama)).

### Gizli değerler

Şifre alanlarının değeri kayıtta `******` olarak saklanır. Gerçek değer bir JSON dosyasından verilir; anahtar hedefin türüdür (panelde aksiyon satırında görünen `input:password`) ya da aksiyonun selector'ı:

```json
{ "input:password": "secret_sauce" }
```

`secrets*.json` adlı dosyalar git'e girmez (`.gitignore`). Değeri verilmeyen maskeli bir alanda adım, hangi anahtarın eksik olduğunu yazarak başarısız olur.

### Seçenekler

| Seçenek | Ne yapar |
|---|---|
| `-p, --path <yol>` | Oynatılacak yol (yukarıda). Zorunlu. |
| `-s, --secrets <dosya>` | Maskeli değerler |
| `--headed` | Tarayıcıyı görünür açar |
| `--slow-mo <ms>` | Her tarayıcı işleminden sonra bekler (izlemek için) |
| `--timeout <ms>` | Element ve doğrulama için en fazla bekleme (varsayılan 10000) |
| `--channel <ad>` | Playwright'ın Chromium'u yerine kurulu tarayıcı: `chrome`, `msedge` |
| `--out <klasör>` | Raporlar ve başarısız adımların ekran görüntüleri (varsayılan `runner/out/<senaryo>-<zaman>/`, git'e girmez) |

---

## Planlayıcı: GraphWalker ile senaryo

Koşuları GraphWalker CLI üretir (`planner/graphwalker.js`). İki sürümden biri kullanılır:

- **Java sürümü:** graphwalker-cli 4.3.3 jar'ı.
- **Rust sürümü:** [graphwalker-rs](https://github.com/GraphWalker/graphwalker-rs) 1.0.4, `graphwalker.exe`.

İki sürümün komutu (`offline --seed N -m <model> <generator>`), generator dili, model JSON'u ve çıktısı aynıdır. Planlayıcı ikisinde de aynı hedefleri aynı yoldan üretir. Hangisinin kullanılacağı kurulumda seçilir. Planlayıcı iki yoldan kullanılır, ikisi aynı senaryoyu üretir:

- **Panelden:** Senaryo bölümünde **Strateji** listesinde "GraphWalker: tüm edge'ler", "tüm node'lar", "bir node'a ulaş"; tohum (boşsa rastgele) ve **Üret**. Eklenti bilgisayarda program çalıştıramaz; Chrome, kayıtlı bir programı (native messaging host, `planner/host.js`) kendisi başlatır ve onunla konuşur. Host bir kez kurulur (aşağıda).
- **Komut satırından:** `node plan.js`. Kurulum gerekmez, `--graphwalker` ya da `--jar` ve `--java` verilmesi yeterli.

### Kurulum (bir kez, Windows)

Gerekenler: Node.js (runner için zaten) ve GraphWalker'ın iki sürümünden biri:

- **Java sürümü:** **Java 17 ya da 21** (GraphWalker 4.3.3, Java 25 ile çalışmaz) ve **GraphWalker CLI jar'ı** ([graphwalker-cli-4.3.3.jar](https://github.com/GraphWalker/graphwalker-project/releases/tag/4.3.3), 47 MB).
- **Rust sürümü:** derlenmiş **`graphwalker.exe`**; Java gerekmez. graphwalker-rs'in GitHub sürümlerinde hazır CLI yoktur, yalnızca `graphwalker-mcp` yayımlanır. CLI kaynaktan derlenir. Bunun için Rust 1.88 ya da sonrası gerekir ([rustup](https://rustup.rs)); Windows'ta ayrıca Visual Studio C++ Build Tools gerekir:

  ```
  git clone https://github.com/GraphWalker/graphwalker-rs.git
  cd graphwalker-rs
  cargo build --release -p graphwalker
  ```

  Çıktı `target\release\graphwalker.exe` olur. `graphwalker.exe --version` komutu `graphwalker 1.0.4 (git …)` yazmalı.

`runner\install-planner.cmd`'ye çift tıklayın. Yolu doğrudan da verebilirsiniz: `install-planner.cmd --jar C:\yol\graphwalker-cli-4.3.3.jar` ya da `install-planner.cmd --graphwalker C:\yol\graphwalker.exe`. Kurulum:

1. GraphWalker'ın yolunu sorar: jar ya da `graphwalker.exe`. Bir önceki kurulumdakini önerir. Sürümü uzantıdan anlar: `.jar` Java, diğeri Rust.
2. Jar verildiyse Java 17 / 21'i bulur: `JAVA_HOME`, `PATH` ve bilinen kurulum klasörlerine bakar (Program Files altında Java, Eclipse Adoptium, Microsoft, Zulu, Amazon Corretto, BellSoft) ve en yenisini seçer. Bulamazsa Temurin 21 bağlantısını verip durur; `--java` ile bir `java.exe` gösterilebilir. Sonra GraphWalker'ı `--version` ile çalıştırıp sürümünü okur.
3. `planner/host.js` ve `planner/graphwalker.js`'i `%LOCALAPPDATA%\GraphRecorder`'a kopyalar. Ayar dosyasını (`config.json`: `cli` (`java` / `rust`), Java ve jar ya da `binary`, Node), `host.cmd`'yi ve host manifestini (`com.graphrecorder.planner.json`) yazar. Manifest yalnızca bu eklentinin kimliğine izin verir; kimlik `extension/manifest.json`'daki `key`'den hesaplanır.
4. Chrome, Chromium ve Edge için `HKCU\Software\...\NativeMessagingHosts\com.graphrecorder.planner` kayıt anahtarını ekler (yönetici yetkisi gerekmez).
5. Host'u bir "ping" isteğiyle dener.

Aynı anda tek sürüm kuruludur; sürüm değiştirmek (Java ↔ Rust) için kurulum yeniden çalıştırılır. Bu değişiklikten önce yapılmış kurulumların ayar dosyasında `cli` alanı yoktur; bunlar Java sayılır.

Host dosyaları kopya olduğu için repo taşınsa da çalışır; `planner/` altındaki kod değişirse kurulum yeniden çalıştırılır. Repo yolunda Türkçe karakter olabileceği için (`Masaüstü`) `host.cmd` yalnızca kendi klasörünü (`%~dp0`) ve Node'un yolunu içerir: `cmd` dosyadaki ASCII olmayan yolları yanlış okur. Kaldırmak: `install-planner.cmd --uninstall`.

### Komut satırı

```
node plan.js SwagLabs.json --seed 42 > SwagLabs-GraphWalker.json
node plan.js SwagLabs.json --goal nodes --out SwagLabs-Nodes.json
node plan.js SwagLabs.json --goal node --target v_Cart --jar C:\yol\graphwalker-cli-4.3.3.jar
node plan.js SwagLabs.json --seed 42 --graphwalker C:\yol\graphwalker.exe > SwagLabs-Rust.json
node run.js SwagLabs-GraphWalker.json --secrets secrets.json
```

Hangi sürümün kullanılacağı şu sırayla belirlenir:
1. Komut satırı: `--graphwalker` (Rust) ya da `--jar` / `--java` (Java). `--graphwalker` ile `--jar` birlikte verilmez.
2. Ortam değişkenleri: `GRAPHWALKER_BIN` (Rust); `GRAPHWALKER_JAR`, `GRAPHWALKER_JAVA` (Java).
3. Kurulumun ayar dosyası.

Özet (koşu sayısı, kapsama, tohum, sürüm, ulaşılamayanlar) standart hataya yazılır.

### Nasıl üretilir?

| Hedef | GraphWalker | Sonuç |
|---|---|---|
| Tüm edge'ler | `random(edge_coverage(100) or length(N))` | Başlangıçtan ulaşılabilen her edge en az bir koşuda |
| Tüm node'lar | `random(vertex_coverage(100) or length(N))` | Ulaşılabilen her node en az bir koşuda |
| Bir node'a ulaş | `a_star(reached_vertex(<node>))` | Başlangıçtan o node'a en kısa yol, tek koşu |

- **Ulaşılabilen kısım.** GraphWalker'a yalnızca başlangıçtan ulaşılabilen node ve edge'ler verilir: ulaşılamayan bir edge'i hiçbir yol kapsayamaz (GraphWalker'ın `a_star`'ı orada bitmez). Ulaşılamayanlar panelde ve komut satırında ayrıca söylenir.
- **Adlar id'dir.** GraphWalker `reached_edge`'i adla arar; kayıtta aynı adlı edge'ler olabilir (iki `e_Resize`). Planlama modelinde her edge'in adı id'sidir; yollar doğrudan id olarak döner.
- **Çıkmaz node.** `random` çıkış edge'i olmayan bir node'a varınca GraphWalker hata verir. Java sürümü `NoPathFoundException ... element: <node>` yazar; Rust sürümü `No path found from vertex '<node>'` yazıp 1 koduyla çıkar. O ana kadarki yol 1. koşu olur (`planner.deadEnd` o node). Kapsanmamış her edge (node) için başlangıçtan `a_star(reached_edge(e))` ile yeni koşu açılır, her koşudan sonra kapsananlar düşer. Başlangıçtan en uzak olanlar önce işlenir: onların en kısa yolu yakındakileri de kapsar, koşu sayısı azalır.
- **Tohum.** `random` tohumla çalışır (`offline --seed`). Tohum verilmezse rastgele seçilir ve senaryoya yazılır (`planner.seed`). Aynı tohum, aynı graph'ta **aynı sürümle** aynı koşuları verir. İki sürümün rastgele sayı üreteci farklı olduğu için hangi sürümün kullanıldığı da senaryoya yazılır (`planner.cli`). Tohum 1 ya da daha büyük olmalı: Rust sürümünde 0 "rastgele" demektir. `a_star` rastgele değildir.
- **Üst sınır.** `length(N)` (N = 20 × edge sayısı + 20), `random`'un bir döngüde uzayıp gitmesine karşıdır; sınıra varılırsa kalanlar `a_star` koşularıyla kapsanır. Her GraphWalker çağrısı 30 sn ile sınırlıdır. Java sürümünde her çağrı, Java'nın açılışı yüzünden yaklaşık 1 sn sürer.
- Senaryo dosyasında `planner`: `{ engine: "graphwalker", cli: "java" | "rust", goal, generator, seed, deadEnd?, target? }`. Rust ile üretilen senaryonun panel özetinde "GraphWalker (Rust)" yazar.

**Sınırlar:**

- `random` uzun koşular üretebilir (tüm node'lar için aynı edge'lerden defalarca geçer). İyileştirme: hedef başına generator seçimi (`quick_random`, `weighted_random`).
- Kurulum yalnızca Windows içindir (kayıt anahtarı); macOS / Linux'ta host manifesti başka bir klasöre yazılır. Komut satırı her yerde çalışır.
- Jar'ı ya da `graphwalker.exe`'yi kullanıcı verir. Rust sürümünü kullanıcı kendisi derler, çünkü hazır CLI sürümü yok. Chrome Web Store dağıtımında kurulumun jar'ı kendisi indirmesi (GitHub sürümü) daha uygun olur; ileride değişebilir.
- Host Node.js ile çalışır; Node'u olmayan kullanıcı için host tek bir `.exe`'ye derlenebilir ya da Java'yla yazılabilir (Java sürümünde Java zaten gerekli).

---

## Nasıl çalışır?

1. Senaryo (ya da model ve yol) okunur, modelin biçimi kontrol edilir (`graph-recorder/v4` ya da `v5`). Her koşu başlangıç node'undan itibaren edge'lere çözülür; modelle uyuşmayan koşu çalıştırmadan reddedilir.
2. Her koşu için yeni bir tarayıcı bağlamı (temiz oturum), başlangıç node'unun görünen alanıyla açılır: CSS piksel boyutu ve piksel oranı. Her yeni sayfaya, sayfanın kendi kodundan önce eklentinin parmak izi kodu eklenir (`window.__graphRecorder`; sayfanın global adlarıyla çakışmasın diye bir fonksiyonun içinde).
3. Başlangıç adresine gidilir ve ekranın başlangıç node'u olduğu doğrulanır.
4. Her edge için aksiyonlar sırayla oynatılır. Her aksiyondan sonra sayfanın durulması beklenir; tanım kayıttakiyle aynıdır (300 ms DOM değişmez, en fazla 3 sn; `fingerprint.js > SETTLE_QUIET_MS`). Kayıtta da her aksiyon, öncekinin etkisi durulduktan sonraki ekranda yapılmıştı.
5. Edge bitince varılan ekran hedef node'la karşılaştırılır. Koşu ilk başarısız adımda durur; kalan adımlar "atlandı" olur, sonraki koşuya geçilir.
6. Sonunda raporlar yazılır.

### Doğrulama

Kayıttaki eşleştirme kuralının aynısıdır: URL şablonu ve edge set'i, dışa aktarımdaki Ayarlar ile birebir aynı olmalıdır (`lib/oracle.js`). Sayfa geç yüklenebilir; eşleşene kadar `--timeout` boyunca tekrar denenir. Eşleşmezse sayısı farklı türler yazılır; görünen alan kayıttakinden farklıysa o da yazılır.

### Elementi bulmak

Önce kayıttaki düzeyde aranır: aksiyonun `target`'ı, yani "bu türün ekrandaki n'incisi" (`fingerprint.js > targetElement()`). State aynı olduğu sürece bu element vardır. Bulunamazsa kayıttaki CSS selector kullanılır ve uyarı yazılır, çünkü selector başka bir elementi gösteriyor olabilir. İkisi de `--timeout` boyunca denenir: element sayfanın durulmasından sonra da gelebilir.

### Görünen alan

Testi çalıştıranın ekranı ne olursa olsun sayfa kayıttaki boyutu görür ([docs/03 > Pencere boyutu ve state](../docs/03-state-eslestirme.md#pencere-boyutu-ve-state)). Playwright'ta tarayıcı yakınlaştırması yoktur. Kayıttaki yakınlaştırma, sayfanın gördüğü CSS piksel boyutu ve piksel oranı aynı kurularak tekrarlanır (DevTools protokolü: `Emulation.setDeviceMetricsOverride`). Ayar sayfa değişse de kalır. Kaydırma çubukları gizlenmez (Playwright görünmez modda onları varsayılan olarak gizler): kayıt yapılan tarayıcıdaki gibi yer kaplarlar, sayfanın düzeni aynı kalır.

---

## Aksiyonların karşılığı

| Aksiyon | Playwright karşılığı |
|---|---|
| `click` | `click()` |
| `input` | Alanın türüne göre `fill()`, `selectOption()` ya da `setChecked()`. `******` değeri secrets dosyasından gelir. |
| `enter` | `press('Enter')` |
| `key` | `press(key)`, `count` kez. Hedef yoksa (odakta element yoktu) `keyboard.press(key)`. |
| `contextmenu` | `click({ button: 'right' })` |
| `hover` | `hover()`: fare elementin ortasına gelir |
| `focus` | `focus()` |
| `scroll` | `scrollTo(x, y)`, sayfada ya da kaydırılan kutuda; sayfa yumuşak kaydırma kullansa da konuma hemen varılır |
| `navigate` | `goto(url)` |
| `history` | Kayıt yönü bilmez (ikisi de "Back"), varılan adresi bilir: önce `goBack()`, adres tutmazsa ileri, o da tutmazsa `goto(url)` |
| `reload` | `reload()` |
| `resize` | Görünen alan `viewport` boyutuna ayarlanır |
| `zoom` | Görünen alan varılan boyuta ve piksel oranına ayarlanır. Eski kayıtlarda varılan boyut yoktur; yakınlaştırma oranlarından hesaplanır. |
| `tab` | `open`: önceki aksiyonun açtığı sayfaya geçilir (`by: page`; sayfa henüz yoksa beklenir) ya da yeni sayfa açılıp adrese gidilir (`by: user`). `switch`: adresi (URL şablonu) tutan, en son kullanılan sekmeye geçilir. `close`: o sekme kapanır; aktif sekme kapandıysa en son kullanılan sekme öne gelir. Yeni sekme aktif sekmenin görünen alanıyla açılır. |
| `wait` | `ms` kadar beklenir. Ekranı değiştiren bekleme (oturum zaman aşımı) biraz geç sonuçlansa da doğrulamadaki tekrar deneme onu yakalar. |
| `select`, `clipboard` | Henüz oynatılmıyor; adım "desteklenmiyor" diye başarısız olur |

---

## Sınırlar

- **Gizli durum.** Aynı edge set, aynı durum için gereklidir ama yeterli değildir. Doğrulama etkileşimli olmayan farkları (sepetteki ürün sayısı, uyarı metni) görmez ([docs/03 > Küme aynıysa neden hâlâ soruluyor?](../docs/03-state-eslestirme.md#küme-aynıysa-neden-hâlâ-soruluyor)).
- **Sekmeyi adresiyle bulmak.** Aynı adreste (URL şablonu) birden fazla açık sekme varsa en son kullanılan seçilir; kayıtta başka biri kastedilmiş olabilir.
- **Temiz oturum.** Her koşu boş bir tarayıcı bağlamında başlar: çerez yok, localStorage yok. Kayıt giriş yapılmış bir sayfada başladıysa başlangıç doğrulaması başarısız olur; kaydı giriş sayfasından başlatın. Site, kayıt yapılan tarayıcıda çıkıştan sonra da kalan bir durum saklıyorsa (saucedemo sepeti localStorage'da tutar) kayıttaki ekranlar o durumla alınmıştır ve runner'da tutmaz: girişten sonraki ilk ekranda sepette ürün beklenir, runner'da sepet boştur. Kayda başlamadan önce sitenin verisini temizleyin (DevTools > Application > Storage > "Clear site data") ya da kaydı boş bir Chrome profilinde yapın.
- **Değerini yalnızca `change` olayıyla işleyen alanlar.** `fill()` `input` olaylarını üretir; `change` ise odak alandan çıkınca gelir. Edge'in son aksiyonu böyle bir alandaysa doğrulama, değer işlenmeden önceki ekranı görebilir.
- **Gecikmeli gezinmeler.** Sayfanın zamanlayıcıyla yaptığı yönlendirmeler doğrulamadaki tekrar denemeyle yakalanır; daha uzun sürüyorsa `--timeout` artırılır.
- **Otomasyon tespiti.** Bazı siteler otomasyonla açılan tarayıcıyı engeller ya da farklı içerik gösterir.

---

## Dosyalar

| Dosya | Görevi |
|---|---|
| `run.js` | Komut satırı, koşular, çıktı |
| `lib/model.js` | Modeli okumak, yolu edge'lere çözmek |
| `lib/page.js` | Sayfaya eklenen kod, durulmayı beklemek, parmak izi, görünen alan |
| `lib/actions.js` | Aksiyonları oynatmak, elementi bulmak |
| `lib/oracle.js` | Varılan ekranı doğrulamak |
| `lib/state.js` | Eklentinin `settings.js`'ini Node'da yüklemek (`urlKey`, `stateCounts`, `diffCounts`) |
| `lib/scenario.js` | Girdi: senaryo dosyası ya da model ve yol; eklentinin `scenario.js`'i (kapsama) |
| `lib/report.js` | Raporlar: `report.json`, `report.html`, `junit.xml` |
| `plan.js` | Planlayıcının komut satırı: modelden GraphWalker ile senaryo |
| `planner/graphwalker.js` | Planlayıcı: ulaşılabilen kısım, GraphWalker `offline` çağrıları (Java ya da Rust sürümü), çıkmaz node, tohum; Java'yı bulmak |
| `planner/host.js` | Native messaging host: panelin isteğini planlayıcıya iletir |
| `planner/install.js`, `install-planner.cmd` | Host kurulumu: GraphWalker (jar ve Java ya da `graphwalker.exe`), dosyalar, kayıt anahtarı, deneme |
