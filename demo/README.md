# Demo sayfaları

Elle test ve sunum için yerel sayfalar: saucedemo'da gösterilemeyen durumlar. Bağımlılık yok, yalnızca Node.

```powershell
node demo\demo-server.js
```

Terminalde `Demo sayfaları: http://localhost:8765/` yazınca tarayıcıda açın. Sunucu terminal açıkken çalışır, `Ctrl+C` ile durur. Sunucu kapalıyken açılan sekmeleri sunucu başlayınca yenileyin.

| Sayfa | Ne gösterir |
|---|---|
| `/banka` | 20 sn hareketsiz kalınca oturum kapanır: Ayarlar'da **Beklemeleri kaydet** açıkken ekranı değiştiren bekleme (`e_Wait`). |
| `/menu` | CSS ile açılan menü ve JavaScript ile buton çıkaran kart: Ayarlar'da **Üzerine gelme (fare)** açıkken `hover`; "Etkisiz buton" kayıt bırakmaz. |
| `/sepet` | Butonlar aynı, sayaç ve afiş rengi farklı: onay kartında görsel karşılaştırma. |
| `/sekme` | Yeni sekmede açılan link ve popup: "Bu sekmede devam edilsin mi?" kartı. |
