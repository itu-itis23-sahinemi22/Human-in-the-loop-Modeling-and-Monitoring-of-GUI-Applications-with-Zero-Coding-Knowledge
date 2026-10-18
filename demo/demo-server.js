// Elle test için yerel demo sayfaları: zaman aşımı, hover menü, görsel karşılaştırma, sekmeler.
// Kullanım: node demo\demo-server.js   ->  http://localhost:8765/  (bkz. demo/README.md)
const http = require('http');

const page = (title, body, script = '') => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font: 16px system-ui, sans-serif; margin: 24px; }
  nav a, button { margin-right: 8px; }
  .menu { display: inline-block; position: relative; padding: 6px 10px; background: #eef; }
  .sub { display: none; position: absolute; left: 0; top: 100%; background: #dde; padding: 6px; }
  .menu:hover .sub { display: block; }
  #card { width: 260px; height: 110px; margin-top: 40px; padding: 10px; background: #eee; border-radius: 8px; }
  #buy { display: none; }
  #banner { height: 220px; margin: 16px 0; border-radius: 8px; }
</style></head><body>${body}<script>${script}</script></body></html>`;

const PAGES = {
  '/': () => page('Demo', `<h1>Graph Recorder demo sayfaları</h1>
    <ul>
      <li><a href="/banka">Banka: 20 sn hareketsiz kalınca oturum kapanır (beklemeler)</a></li>
      <li><a href="/menu">Menü: fareyle üzerine gelince açılan menü ve kart (üzerine gelme)</a></li>
      <li><a href="/sepet?n=1&img=tomato">Sepet: aynı butonlar, farklı sayaç ve afiş (görsel karşılaştırma)</a></li>
      <li><a href="/sekme">Sekme: yeni sekmede açılan link ve popup (sekmeler)</a></li>
    </ul>`),

  // Beklemeler: son tıklama ya da tuştan 20 sn sonra ekran kendiliğinden değişir. Geri sayım
  // her saniye değişir ama etkileşimli değildir: ekranı (edge set'i) değiştirmez.
  '/banka': () => page('Banka', `<h1>Hesabım</h1>
    <p>Oturumun kapanmasına: <b id="left">20</b> sn</p>
    <button id="balance">Bakiyeyi göster</button> <button id="transfer">Havale</button>
    <p id="info"></p>`, `
    let left = 20;
    const reset = () => { left = 20; document.getElementById('left') && (document.getElementById('left').textContent = left); };
    addEventListener('click', reset, true); addEventListener('keydown', reset, true);
    document.getElementById('balance').onclick = () => { document.getElementById('info').innerHTML = 'Bakiye: 1.250 TL <button id="hide">Gizle</button>'; document.getElementById('hide').onclick = () => { document.getElementById('info').textContent = ''; }; };
    const timer = setInterval(() => {
      left--;
      if (left > 0) return void (document.getElementById('left').textContent = left);
      clearInterval(timer);
      document.body.innerHTML = '<h1>Oturumunuz zaman aşımına uğradı</h1><a id="login" href="/banka">Tekrar giriş</a>';
    }, 1000);`),

  // Üzerine gelme: CSS ile açılan menü (DOM değişmez) ve JavaScript ile buton çıkaran kart.
  '/menu': () => page('Menü', `<nav>
      <div class="menu"><a id="products" href="#urunler">Ürünler</a>
        <div class="sub"><a id="phones" href="#telefon">Telefonlar</a><br><a id="laptops" href="#bilgisayar">Bilgisayarlar</a></div>
      </div>
      <button id="plain">Etkisiz buton</button>
    </nav>
    <div id="card">Kart: fareyi üzerine getirin <button id="buy">Sepete ekle</button></div>`, `
    const card = document.getElementById('card'), buy = document.getElementById('buy');
    card.onmouseenter = () => { buy.style.display = 'inline-block'; };
    card.onmouseleave = () => { buy.style.display = 'none'; };`),

  // Görsel karşılaştırma: link ve buton her sayfada aynı (edge set aynı); sayaç ve afiş rengi farklı.
  '/sepet': (q) => {
    const n = q.get('n') ?? '1';
    const img = q.get('img') ?? 'tomato';
    const next = { '1-tomato': '2-steelblue', '2-steelblue': '2-tomato', '2-tomato': '1-tomato' }[`${n}-${img}`] ?? '1-tomato';
    const [nn, ni] = next.split('-');
    return page('Sepet', `<p>Sepet (<span id="count">${n}</span>)</p><div id="banner" style="background:${img}"></div>
      <a id="next" href="/sepet?n=${nn}&img=${ni}">İleri</a> <button id="pay">Ödeme</button>`);
  },

  // Sekmeler: yeni sekmede açılan link ve popup penceresi.
  '/sekme': () => page('Sekme', `<h1>Sekme</h1>
    <a id="docs" href="/sekme/yeni" target="_blank">Dokümanlar (yeni sekme)</a>
    <button id="popup">Popup aç</button>`, `
    document.getElementById('popup').onclick = () => window.open('/sekme/popup', 'popup', 'width=500,height=400');`),
  '/sekme/yeni': () => page('Dokümanlar', `<h1>Dokümanlar</h1><button id="read">Okudum</button>`),
  '/sekme/popup': () => page('Popup', `<h1>Popup</h1><button id="ok">Onayla</button>`),
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const render = PAGES[url.pathname];
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.statusCode = render ? 200 : 404;
  res.end(render ? render(url.searchParams) : 'Sayfa yok');
}).listen(8765, () => console.log('Demo sayfaları: http://localhost:8765/'));
