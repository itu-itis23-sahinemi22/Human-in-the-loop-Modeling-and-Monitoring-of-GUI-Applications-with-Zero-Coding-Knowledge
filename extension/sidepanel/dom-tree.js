// =============================================================================
// sidepanel/dom-tree.js — EKRANDAKİ ELEMENTLER kartı
// -----------------------------------------------------------------------------
// Açık sekmenin şu an ekranda görünen kısmını sade bir DOM ağacı olarak gösterir; satırın üzerine
// gelince element sayfada çerçevelenir. Ağacı ve çerçeveyi sayfadaki ../dom-tree.js hazırlar
// (sadeleştirme kuralları orada). Kart yalnızca açıkken çalışır. Açıkken şu durumlarda yenilenir:
//   - her aksiyondan sonra: content.js sayfa durulunca background'a SCREEN gönderir; aynı mesaj
//     panele de gelir (chrome.runtime.sendMessage eklentinin bütün sayfalarına gider),
//   - sekme değişince ve sayfa yüklenince, Yenile'ye basınca.
// Satıra sağ tık: elemente tıkla / çoklu tıkla (SAĞ TIK MENÜSÜ). Tıklamayı ve kaydı sayfa yapar
// (content.js > clickFromPanel); bu dosya graph state'ine yazmaz. panel.js'ten sonra yüklenir, onun
// $'ını, state'ini, replay'ini ve showMessage'ını kullanır.
// =============================================================================

const DOM_TREE_REFRESH_MS = 150; // art arda gelen bildirimler tek yenilemede toplanır

let treeTabId = null;            // ağacın okunduğu sekme
let treeRequest = 0;             // son isteğin sırası: geç gelen eski cevap yenisinin üstüne çizilmesin
let treeTimer = null;
const closedTreePaths = new Set(); // kullanıcının kapattığı dallar: ağaç yenilenince de kapalı kalır
const ownTab = chrome.tabs.getCurrent(); // panel bir sekmede açıksa (testler) o sekme; yan panelde undefined

$('dom-tree').addEventListener('toggle', () => {
  if ($('dom-tree').open) return refreshTree();
  highlightElement(null);
  $('dom-tree-count').textContent = ''; // kapalıyken sayı eskir
});

$('btn-dom-tree-refresh').onclick = () => refreshTree();
$('dom-tree-list').onmouseleave = () => highlightElement(null);

// Sayfa bir aksiyondan sonra duruldu ya da yüklendi. Dinleyici cevap vermez (undefined döner);
// SCREEN'in cevabını background verir.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'SCREEN' && sender.tab?.id === treeTabId) scheduleTreeRefresh();
});
chrome.tabs.onActivated.addListener(() => scheduleTreeRefresh());
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === treeTabId && change.status === 'complete') scheduleTreeRefresh();
});

function scheduleTreeRefresh() {
  if (!$('dom-tree').open) return;
  clearTimeout(treeTimer);
  treeTimer = setTimeout(refreshTree, DOM_TREE_REFRESH_MS);
}

async function refreshTree() {
  clearTimeout(treeTimer);
  const request = ++treeRequest;
  const tab = await treeTab();
  const page = tab ? await chrome.tabs.sendMessage(tab.id, { type: 'DOM_TREE' }, { frameId: 0 }).catch(() => null) : null;
  if (request !== treeRequest) return; // bu arada yeni bir istek başladı
  treeTabId = tab?.id ?? null;
  if (!tab) return showTree(null, 'Açık sekme bulunamadı.');
  if (!page || page.error) return showTree(null, 'Bu sekmenin sayfası okunamadı. Sayfayı yenileyip (F5) tekrar deneyin. (chrome:// sayfaları desteklenmez.)');
  showTree(page);
}

// Ağacın okunduğu sekme: panelin penceresindeki aktif sekme ("Node oluştur" gibi). Panel bir
// sekmede açıksa (testler) aktif sekme panelin kendisi olabilir; o zaman son okunan sekme kalır.
async function treeTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const own = await ownTab;
  if (active && active.id !== own?.id) return active;
  return treeTabId === null ? null : chrome.tabs.get(treeTabId).catch(() => null);
}

// page null ise ağaç boşalır ve problem yazılır.
function showTree(page, problem = '') {
  closeTreeMenu(); // menü eski ağacın satırı içindi: id'ler yenilendi, başka bir elemente tıklamasın
  $('dom-tree-list').replaceChildren(...(page?.tree ?? []).map((node, i) => treeItem(node, `${i}:${node.tag}`)));
  $('dom-tree-count').textContent = page ? page.count : '';
  $('dom-tree-status').textContent = problem || treeStatus(page);
}

function treeStatus(page) {
  if (!page.count) return 'Ekranda gösterilecek element yok.';
  let host = '';
  try { host = new URL(page.url).host; } catch { /* about: vb. */ }
  const where = [page.title, host].filter(Boolean).join(' · ');
  return `${where}${page.truncated ? ' · sayfa çok büyük, yalnızca bir kısmı gezildi' : ''}`;
}

// Ağacın bir satırı ve altındakiler. Çocuğu olan satır açılıp kapanır (<details>). path,
// satırın ağaçtaki yeridir ("0:main/2:ul"): ağaç yenilenince kullanıcının kapattığı dal bulunur.
function treeItem(node, path) {
  const li = document.createElement('li');
  const row = document.createElement(node.children.length ? 'summary' : 'div');
  row.className = node.interactive ? 'dom-row interactive' : 'dom-row';
  row.innerHTML = '<span class="dom-tag"></span> <span class="dom-text"></span> <code></code>';
  row.querySelector('.dom-tag').textContent = node.tag;
  row.querySelector('.dom-text').textContent = node.text ? `"${node.text}"` : '';
  row.querySelector('code').textContent = node.key ?? '';
  row.title = [node.tag, node.text, node.key].filter(Boolean).join(' · ') + (node.interactive ? ' · etkileşimli (edge set\'inde)' : '') + ' · sağ tık: tıkla';
  row.onmouseenter = () => highlightElement(node.id);
  row.oncontextmenu = (event) => {
    event.preventDefault();
    openTreeMenu(node, event);
  };
  if (!node.children.length) {
    li.append(row);
    return li;
  }
  const details = document.createElement('details');
  details.open = !closedTreePaths.has(path);
  details.ontoggle = () => {
    if (details.open) closedTreePaths.delete(path);
    else closedTreePaths.add(path);
  };
  const list = document.createElement('ul');
  list.append(...node.children.map((child, i) => treeItem(child, `${path}/${i}:${child.tag}`)));
  details.append(row, list);
  li.append(details);
  return li;
}

// -----------------------------------------------------------------------------
// SAĞ TIK MENÜSÜ: satırın elementine tıkla (kaydedilir)
// -----------------------------------------------------------------------------
// Tıkla, Çift tıkla, Üçlü tıkla ya da "N kez tıkla"; Bot işaretliyse çoklu tıklama bir anda yapılır.
// Tıklamayı sayfa yapar ve kullanıcının kendi tıklaması gibi kaydeder (content.js > clickFromPanel):
// aksiyon "Bekleyen aksiyonlar"a düşer, sayfa da değişir. Yalnızca kaydın sürdüğü sekmede ve
// oynatma yokken; değilse menü nedenini söyler, butonlar kapalıdır. Menünün görünümü graph'taki
// sağ tık menüsüyle aynıdır (monitors.css > .context-menu).
const TREE_MENU_MAX_CLICKS = 20;

const treeMenu = document.createElement('div');
treeMenu.id = 'dom-tree-menu';
treeMenu.className = 'context-menu dom-tree-menu';
treeMenu.setAttribute('role', 'menu');
treeMenu.hidden = true;
document.body.append(treeMenu);

function openTreeMenu(node, event) {
  const blocked = replay ? 'Oynatma sürerken tıklanamaz.' // panel.js
    : state.tabId === null ? 'Kayıt başlamadı: önce başlangıç node\'unu oluşturun.'
      : state.tabId !== treeTabId ? 'Bu sekme kaydedilmiyor: kayıt başka bir sekmede.' : '';
  const head = document.createElement('p');
  head.className = 'menu-head';
  head.textContent = [node.tag, node.text && `"${node.text}"`].filter(Boolean).join(' ');
  const item = (text, count) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = text;
    button.disabled = Boolean(blocked);
    button.onclick = () => clickTreeElement(node, count ?? Number(times.value));
    return button;
  };
  const times = Object.assign(document.createElement('input'), { type: 'number', min: '2', max: String(TREE_MENU_MAX_CLICKS), value: '4', disabled: Boolean(blocked) });
  times.setAttribute('aria-label', 'Tıklama sayısı');
  times.onkeydown = (e) => { if (e.key === 'Enter') clickTreeElement(node, Number(times.value)); };
  const many = document.createElement('div');
  many.className = 'menu-row';
  many.append(times, item('kez tıkla'));
  const bot = document.createElement('label');
  bot.className = 'menu-row';
  bot.title = 'Çoklu tıklamada: işaretliyse tıklamalar bot ya da makro gibi bir anda yapılır (oynatmada da öyle oynatılır).';
  bot.innerHTML = '<input type="checkbox" id="dom-tree-bot"> Bot (bir anda)';
  bot.querySelector('input').disabled = Boolean(blocked);
  const note = document.createElement('p');
  note.className = 'menu-note';
  note.textContent = blocked;
  note.hidden = !blocked;
  treeMenu.replaceChildren(head, item('Tıkla', 1), item('Çift tıkla', 2), item('Üçlü tıkla', 3), many, bot, note);
  treeMenu.hidden = false;
  const { offsetWidth: width, offsetHeight: height } = treeMenu;
  treeMenu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - width - 8))}px`;
  treeMenu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - height - 8))}px`;
  (treeMenu.querySelector('button:not(:disabled)') ?? treeMenu.querySelector('button'))?.focus();
}

function closeTreeMenu() {
  treeMenu.hidden = true;
}

document.addEventListener('mousedown', (event) => {
  if (!treeMenu.hidden && !event.target.closest('#dom-tree-menu')) closeTreeMenu();
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeTreeMenu(); });

async function clickTreeElement(node, count) {
  if (!(Number.isInteger(count) && count >= 1 && count <= TREE_MENU_MAX_CLICKS)) {
    return showMessage({ error: `Tıklama sayısı 1 ile ${TREE_MENU_MAX_CLICKS} arasında olmalı.` }); // panel.js
  }
  const bot = count > 1 && $('dom-tree-bot').checked;
  closeTreeMenu();
  highlightElement(null);
  const response = await chrome.tabs.sendMessage(treeTabId, { type: 'DOM_TREE_CLICK', id: node.id, count, bot }, { frameId: 0 }).catch(() => null);
  if (response?.gone) {
    scheduleTreeRefresh();
    return showMessage({ error: 'Element artık sayfada yok; ağaç yenilendi, tekrar seçin.' });
  }
  if (!response || response.error) return showMessage({ error: response?.error ?? 'Sayfaya ulaşılamadı. Sayfayı yenileyip (F5) tekrar deneyin.' });
  showMessage({ notice: `Sayfada yapıldı ve kaydedildi: ${response.label}${bot ? ' (bot)' : ''}.` });
}

// Satırın elementini sayfada çerçeveler (id null: çerçeve kalkar). Element sayfadan gittiyse
// ağaç yenilenir.
function highlightElement(id) {
  if (treeTabId === null) return;
  chrome.tabs.sendMessage(treeTabId, { type: 'DOM_TREE_HIGHLIGHT', id }, { frameId: 0 })
    .then((response) => { if (response?.gone) scheduleTreeRefresh(); }, () => { });
}
