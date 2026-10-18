# Runner: Kaydedilen Yolu Tekrar Oynatmak

Eklentinin **GraphWalker JSON** butonuyla indirdiği modeldeki bir yolu (edge dizisi) gerçek bir tarayıcıda tekrar oynatır ve her edge'den sonra varılan ekranın beklenen node olduğunu doğrular. İlk başarısız adımda durur; çünkü sonraki edge'ler o adımın node'undan çıkar.

Runner, eklentinin parmak izi kodunu (`extension/settings.js`, `extension/fingerprint.js`) olduğu gibi kullanır. Kayıt ile test aynı state tanımını kullanır: "varılan ekran beklenen node mu?" sorusu, kayıttaki "bu sayfa zaten bir node mu?" sorusuyla aynı kuralla cevaplanır ([docs/03](../docs/03-state-eslestirme.md)).

## İçindekiler

- [Kurulum](#kurulum)
- [Kullanım](#kullanım)
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
node run.js SwagLabs.json --path e_Login,e_AddToCart,e_Cart1Items --secrets secrets.json
```

Gerçek bir çalıştırmanın çıktısı (saucedemo.com, eklentiyle kaydedilmiş model):

```
Model: SwagLabs · graph-recorder/v5 · görünen alan 1264×749
Yol: v_SwagLabs → e_Login → e_AddToCart → e_Cart1Items → e_ZoomIn → e_ZoomOut → e_ContinueShopping → e_Resize → e_Resize (8 edge)

✓ v_SwagLabs                           başlangıç    0,8 sn
✓ e_Login → v_Inventory                3 aksiyon    2,0 sn
✓ e_AddToCart → v_Inventory_2          1 aksiyon    0,7 sn
✓ e_Cart1Items → v_Cart                1 aksiyon    0,8 sn
✓ e_ZoomIn → v_Cart_2                  1 aksiyon    0,6 sn
✓ e_ZoomOut → v_Cart                   1 aksiyon    0,6 sn
✓ e_ContinueShopping → v_Inventory_2   1 aksiyon    0,9 sn
✓ e_Resize → v_Inventory_3             1 aksiyon    0,6 sn
✓ e_Resize → v_Inventory_2             1 aksiyon    0,6 sn

Sonuç: GEÇTİ · 8/8 edge · 8,5 sn
```

Bir adım başarısız olursa beklenen node ile ekranın farkı ve ekran görüntüsü yazılır:

```
✗ e_AddToCart → v_Inventory            1 aksiyon    10,5 sn
    Beklenen ekrana (v_Inventory) varılmadı:
      button:add-to-cart-sauce-labs-backpack: beklenen 1, ekranda 0
      button:remove-sauce-labs-backpack: beklenen 0, ekranda 1
    Ekran görüntüsü: runner/out/2026-10-14T19-40-25-853Z-e_AddToCart.png
```

**Çıkış kodu:** `0` yol geçti, `1` bir adım başarısız, `2` kullanım ya da model hatası (ör. yolda olmayan bir edge).

### Yol

- **Virgülle ayrılmış edge adları ya da id'leri:** `--path e_Login,e_Cart1Items` ya da `--path e3,e7`. İki edge aynı adı alabilir (ör. iki `e_Resize`); runner hangisinin kastedildiğini o an bulunulan node'dan anlar. Aynı node'dan aynı adla birden fazla edge çıkıyorsa id ister.
- **Dosya:** JSON dizi (`["e3", "e5"]`) ya da GraphWalker'ın `offline` çıktısı. Böylece yolu GraphWalker'ın generator'ları üretir:

  ```
  java -jar graphwalker-cli-4.3.3.jar offline -m SwagLabs.json "random(edge_coverage(100))" > yol.txt
  node run.js SwagLabs.json --path yol.txt --secrets secrets.json
  ```

  Çıktının düz biçimi (`currentElementName`) de `--verbose` biçimi (`currentElementID`) de okunur. Yoldaki node'lar yalnızca tutarlılık için kontrol edilir. GraphWalker 4.3.3, Java 17 ya da 21 ister ([docs/04 > GraphWalker ile doğrulama](../docs/04-veri-modeli.md#graphwalker-ile-doğrulama)).

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
| `--out <klasör>` | Başarısız adımın ekran görüntüsü (varsayılan `runner/out`, git'e girmez) |

---

## Nasıl çalışır?

1. Model okunur, biçimi kontrol edilir (`graph-recorder/v4` ya da `v5`). Yol başlangıç node'undan itibaren edge'lere çözülür.
2. Tarayıcı, başlangıç node'unun görünen alanıyla açılır: CSS piksel boyutu ve piksel oranı. Her yeni sayfaya, sayfanın kendi kodundan önce eklentinin parmak izi kodu eklenir (`window.__graphRecorder`; sayfanın global adlarıyla çakışmasın diye bir fonksiyonun içinde).
3. Başlangıç adresine gidilir ve ekranın başlangıç node'u olduğu doğrulanır.
4. Her edge için aksiyonlar sırayla oynatılır. Her aksiyondan sonra sayfanın durulması beklenir; tanım kayıttakiyle aynıdır (300 ms DOM değişmez, en fazla 3 sn; `fingerprint.js > SETTLE_QUIET_MS`). Kayıtta da her aksiyon, öncekinin etkisi durulduktan sonraki ekranda yapılmıştı.
5. Edge bitince varılan ekran hedef node'la karşılaştırılır. İlk başarısız adımda durulur.

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
- **Temiz oturum.** Her çalıştırma boş bir tarayıcı bağlamında başlar. Kayıt giriş yapılmış bir sayfada başladıysa başlangıç doğrulaması başarısız olur; kaydı giriş sayfasından başlatın.
- **Değerini yalnızca `change` olayıyla işleyen alanlar.** `fill()` `input` olaylarını üretir; `change` ise odak alandan çıkınca gelir. Edge'in son aksiyonu böyle bir alandaysa doğrulama, değer işlenmeden önceki ekranı görebilir.
- **Gecikmeli gezinmeler.** Sayfanın zamanlayıcıyla yaptığı yönlendirmeler doğrulamadaki tekrar denemeyle yakalanır; daha uzun sürüyorsa `--timeout` artırılır.
- **Otomasyon tespiti.** Bazı siteler otomasyonla açılan tarayıcıyı engeller ya da farklı içerik gösterir.

---

## Dosyalar

| Dosya | Görevi |
|---|---|
| `run.js` | Komut satırı, akış, çıktı |
| `lib/model.js` | Modeli okumak, yolu edge'lere çözmek |
| `lib/page.js` | Sayfaya eklenen kod, durulmayı beklemek, parmak izi, görünen alan |
| `lib/actions.js` | Aksiyonları oynatmak, elementi bulmak |
| `lib/oracle.js` | Varılan ekranı doğrulamak |
| `lib/state.js` | Eklentinin `settings.js`'ini Node'da yüklemek (`urlKey`, `stateCounts`, `diffCounts`) |
