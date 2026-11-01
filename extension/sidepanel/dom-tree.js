// =============================================================================
// sidepanel/dom-tree.js — EKRANDAKİ ELEMENTLER kartı
// -----------------------------------------------------------------------------
// Açık sekmenin şu an ekranda görünen kısmını sade bir DOM ağacı olarak gösterir; satırın üzerine
// gelince element sayfada çerçevelenir. Ağacı ve çerçeveyi sayfadaki ../dom-tree.js hazırlar
// (sadeleştirme kuralları orada). Kart yalnızca açıkken çalışır. Açıkken şu durumlarda yenilenir:
//   - her aksiyondan sonra: content.js sayfa durulunca background'a SCREEN gönderir; aynı mesaj
//     panele de gelir (chrome.runtime.sendMessage eklentinin bütün sayfalarına gider),
//   - sekme değişince ve sayfa yüklenince, Yenile'ye basınca.
// Kayda dokunmaz, graph state'ine yazmaz. panel.js'ten sonra yüklenir, onun $'ını kullanır.
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
  row.title = [node.tag, node.text, node.key].filter(Boolean).join(' · ') + (node.interactive ? ' · etkileşimli (edge set\'inde)' : '');
  row.onmouseenter = () => highlightElement(node.id);
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

// Satırın elementini sayfada çerçeveler (id null: çerçeve kalkar). Element sayfadan gittiyse
// ağaç yenilenir.
function highlightElement(id) {
  if (treeTabId === null) return;
  chrome.tabs.sendMessage(treeTabId, { type: 'DOM_TREE_HIGHLIGHT', id }, { frameId: 0 })
    .then((response) => { if (response?.gone) scheduleTreeRefresh(); }, () => { });
}
