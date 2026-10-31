# Uçtan uca testler

Eklenti gerçek bir Chromium'a yüklenir, yerel test sayfalarında kayıt yapılır, panel ve background mesajlarla sürülür; gerekirse dışa aktarılan model runner'da oynatılır. Her test kendi sayfalarını kendi sunucusunda açar (yalnızca `saucedemo-return` gerçek siteye gider).

## Kurulum

Ayrı bir kurulum yoktur: testler Playwright'ı ve Chromium'u runner'ın kurulu paketinden alır ([runner/README.md](../runner/README.md)).

```
cd runner
npm install
npx playwright install chromium
```

## Çalıştırma

```
node tests/e2e/run-all.js              # hepsi (yaklaşık 10 dakika)
node tests/e2e/run-all.js --offline    # internet isteyenler hariç
node tests/e2e/run-all.js graphs scenarios
node tests/e2e/graphs.test.js --headed # tek test, pencere görünür
```

Her test kontrollerini `PASS` / `FAIL` satırlarıyla yazar, sorun varsa çıkış kodu 0 değildir; çıkış kodu 3 "atlandı" demektir (ör. planlayıcı kurulu değil). `run-all.js` her testin çıktısını `tests/out/<ad>.log`'a, testlerin ürettiği dosyaları (dışa aktarılan model, senaryo, rapor) `tests/out/<ad>/`'ye yazar; bu klasör repoya girmez.

## Testler

| Test | Ne dener |
|---|---|
| `viewport` | Node'da görünen alan, pencere boyutu (`resize`) ve yakınlaştırma aksiyonları, dışa aktarımda görünen alan |
| `wait` | Beklemeleri kaydetme: Ayarlar, aksiyonlar arası bekleme, alt sınır, ekranı değiştiren bekleme (oturum zaman aşımı), runner'da oynatma |
| `hover` | Fareyle üzerine gelme: varsayılan kapalı, CSS ve JS menüleri, runner'da oynatma |
| `tabs` | Yeni sekmede ve başka sitede devam: sekme sorusu, sekme aksiyonları, runner'da çok sekme |
| `compare` | "Aynı node mu?" kartındaki görsel karşılaştırma |
| `zoom-replay` | Yakınlaştırma ve pencere boyutunun runner'da aynı ekranı kurması |
| `scenario-run` | Elle senaryo, indirme / yükleme, runner'da çoklu koşu, JSON / HTML / JUnit raporları, bozuk modelde atlanan adımlar |
| `replay` | Panelde oynatma: şifre, başlangıç uyarısı, geçen ve kalan koşu, durdurma (`--zoom=1.5` ile yakınlaştırmada) |
| `replay-start` | Senaryonun başlangıç node'u, runner'ın reddi, oynatmanın görünen alanı kayıttakine getirmesi (`--small-screen` ile pencere büyüyemezken) |
| `scenario-replay` | Senaryonun kendi graph'ından oynatma: ana graph değişince kopyanın oynatılması, oynatma kartında fark ve "Ana graph'tan yenile", `startReplay`'e verilen senaryo bilgisi |
| `filter` | Aksiyon filtresi: bekleyen ve edge listelerinde türleri gizleme, korunan sıra numaraları, ayrı filtreler, otomatik beklemenin ayrı türü, hatırlama |
| `buffer` | Bekleyen aksiyonları silme: uyarı, bayat liste, karar beklerken kilit, runner ve panelde oynatma |
| `return-to-start` | "Başlangıç node'una dön": adres, boyutu oynatmanın kurması, gezinmenin kayda girmesi, yönlendirme, okunamayan sayfa |
| `saucedemo-return` | Gerçek saucedemo'da istemci tarafı yönlendirmenin söylenmesi (internet ister) |
| `graphs` | Birden fazla graph: otomatik ad, geçiş onayı, sekme sorusu, yeniden adlandırma, yedek ve yükleme, silme, eski kaydın taşınması |
| `planner` | GraphWalker ile üretim: tüm edge'ler (çıkmaz node'da birden fazla koşu), tüm node'lar, bir node'a ulaş, aynı tohum aynı koşular, runner'da oynatma. Planlayıcı kurulu olmalı (`runner\install-planner.cmd`); değilse atlanır |
| `scenario-graphs` | Senaryo graph'ları: kopyanın içeriği, sekmeler ve listeyle eşlik, salt okunur detay, "Ana graph'ta göster", "Kullanan senaryolar", senaryo görünümünde kayıt, değişiklik uyarısı ve yenileme |
| `scenarios` | Senaryo listesi: önce "Yeni senaryo", kendiliğinden kayıt, seçim ve hatırlama, yürünemeyen senaryo, silme, yedekte senaryolar |
| `monitors` | Monitör menüsü ([docs/07](../docs/07-monitorler.md)): tür kartları, node / edge / tüm model monitörü, graph'ta sağ tık menüsü, form yardımcıları, graph'ta hale, GraphWalker JSON'una yazılma ve runner'ın okuması, graph başına saklama, yedekle geri yükleme, sahipsizlik, senaryo görünümü, kalıcılık |
| `monitor-run` | Monitörlerin kontrolü ([docs/07](../docs/07-monitorler.md#oynatmada-kontrol)): kuralları bozan sayfalarda panelde oynatma, ışık listesi (yeşil / kırmızı, adım izi, ekran görüntüsü), aksiyon tabanlı Input Validation, edge'in aksiyonuna bağlı monitörler, bozulma anındaki görüntülü uyarılar, "Bu ekranda şimdi kontrol et" |
| `monitor-unit` | Monitör yardımcılarının birim testi (tarayıcısız): parametre doğrulama, ağır desen uyarısı, otomatik ad ve özet cümlesi, aksiyon eşleştirme, storage verisinin normalize edilmesi, görüntü eşleme (`findImage`) |
| `monitor-wait` | Bekleme aksiyonuna bağlı monitörler ve "olmamalı" kuralı ([docs/07](../docs/07-monitorler.md#bekleme-aksiyonuna-monitör)): "Bekleyiniz" mesajı çıkan sayfada ekranı değiştiren bekleme, bekleme bitince metin / görüntü yok (ya da var) kontrolü, hızlı ve yavaş sayfa, bekleme süresi değişince bağ |
| `monitor-expect` | Expected Text ve Expected Image monitörleri ([docs/07](../docs/07-monitorler.md#monitör-türleri)): node'a bağlı metin ve görüntü beklentileri, formdan PNG yükleme ve "Ekrandan seç" ile fareyle kesme, "Bu ekranda şimdi kontrol et", oynatmada yeşil / kırmızı ve uyarı görüntüsü, 2× parçanın ölçekle bulunması, dışa aktarımda görüntü |

## Yeni test

`tests/e2e/<ad>.test.js` olarak ekleyin; `run-all.js` kendiliğinden bulur. Ortak ortam `env.js`'tedir (`REPO`, `EXT`, `CHROME`, `outDir(ad)`). Mevcut testlerdeki desen: yerel `http` sunucusu, `chromium.launchPersistentContext` ile eklentiyi yükleme, panel sayfasını sekmede açıp `chrome.runtime.sendMessage` ile background'a mesaj gönderme, storage'dan state okuma (`graph:<aktif id>`).
