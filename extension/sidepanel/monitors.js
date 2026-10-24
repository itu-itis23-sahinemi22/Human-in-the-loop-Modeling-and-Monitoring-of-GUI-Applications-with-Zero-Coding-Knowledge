// =============================================================================
// monitors.js — MONİTÖR MENÜSÜ (yan panel; run-time monitoring, Ceren'in kısmı)
// -----------------------------------------------------------------------------
// Kullanıcı, kayıt sırasında test için "monitör" tanımlar: her adımdan sonra kontrol
// edilecek bir kural (test oracle'ı); oynatmada yeşil (bozulmadı) ya da kırmızı (bozuldu) yanar.
// Üç kapsam vardır:
//   - "Tüm model": kural her node'da kontrol edilir (ör. 4 pt'den küçük yazı yok).
//   - Tek node  : kural yalnızca o node'a varılınca kontrol edilir (ör. "Telefon" ekranında
//                 telefon alanı 5 ile başlamalı).
//   - Tek edge  : kural yalnızca o aksiyondan sonra kontrol edilir (aksiyon tabanlı
//                 monitörler: girilen değer, adım süresi, tıklama aralığı).
// Türler ve parametreleri monitor-types.js'tedir; tür kartları ve form oradaki tanımdan
// üretilir. Kontrolün kendisi monitor-probe.js (sayfada) + monitor-run.js'tedir (panelde oynatma
// ve "şimdi kontrol et"); runner tarafı sonraki adım.
//
// Bu dosya panel.js'ten SONRA yüklenir ve onun global'lerini okur (state, graphs,
// activeGraph, scenarioView, selectedId, cy, nodeById, showMessage, graphWalkerModel,
// graphBackup). panel.js'i değiştirmez:
//   - Kendi bölümünü ("Monitörler") Senaryo bölümünün altına, node / edge detay kartına da
//     "Bu öğenin monitörleri" alt bölümünü kendisi ekler; graph'ta sağ tık menüsü kurar.
//   - Monitörler graph'a aittir ama graph state'inden AYRI bir anahtarda durur:
//     chrome.storage.local > 'monitors:<graph id>'. Graph'ın tek yazarı background.js'tir;
//     monitörlerin tek yazarı bu dosyadır. Graph değişince o graph'ın monitörleri yüklenir;
//     graph silinince anahtarı da silinir. "Sıfırla" graph'ı boşaltır, monitörlere dokunmaz
//     (node / edge monitörleri "sahipsiz" kalır; kullanıcı taşır ya da siler).
//   - Dışa aktarımda graphWalkerModel() sarmalanır: monitörler modelin
//     properties.graphRecorder.monitors alanına, node / edge monitörleri ayrıca ilgili
//     vertex'in / edge'in properties.monitors alanına yazılır (GraphWalker bu alanları yok sayar).
//   - Graph yedeğinde (Graph'lar > Dışa aktar, graphBackup() sarmalanır) monitörler de
//     yazılır; yedek yüklenince yeni graph'a geri gelir (node ve edge id'leri yedekte korunur).
//   - Senaryo görünümü salt okunurdur (panel.js > GÖRÜNÜM): öğenin monitörleri gösterilir,
//     ekleme ana graph görünümünde yapılır. Senaryo kopyasındaki node ve edge'lerin
//     'monitors' alanı (scenario.js) senaryoya özel monitörler için ayrılmıştır, buradaki
//     model monitörlerinden ayrıdır; bu dosya ona dokunmaz.
// Detay: docs/07-monitorler.md
// =============================================================================

const MONITORS_KEY_PREFIX = 'monitors:';            // chrome.storage.local > monitors:<graph id>
const MONITORS_FORMAT = 'graph-recorder-monitors/v1';

let monitors = emptyMonitors();  // aktif graph'ın monitörleri: { format, nextId, items: [{ id, type, scope, params, severity, enabled, name, createdAt }] }
let monitorsGraphId = null;      // monitörleri yüklü graph (storage > activeGraph)
let monitorFilter = 'all';       // listede gösterilen kapsam: 'all' | 'global' | 'selected' (seçili node / edge)
let monitorUndo = [];            // silinen monitörler, eski yerleriyle (en yenisi sonda); graph'a özel
let clearArmed = false;          // "Tümünü sil" iki adımlı onay
const monitorVerdicts = new Map(); // son kontrol sonuçları: monitör id -> { status: ok | fail | warn | skip, text } (monitor-run.js yazar)

function monitorsKey(graphId = monitorsGraphId) {
  return MONITORS_KEY_PREFIX + graphId;
}

function emptyMonitors() {
  return { format: MONITORS_FORMAT, nextId: 1, items: [] };
}

// Storage'dan gelen veriyi beklenen şekle getirir (eksik alanlar tamamlanır, bozuk kayıt atılır).
function normalizeMonitors(raw) {
  const data = raw && typeof raw === 'object' ? raw : emptyMonitors();
  const items = Array.isArray(data.items) ? data.items : [];
  const severities = new Set(MONITOR_SEVERITIES.map((s) => s.id));
  return {
    format: MONITORS_FORMAT,
    nextId: Number.isInteger(data.nextId) && data.nextId > 0 ? data.nextId : 1,
    items: items.filter((m) => m && typeof m.id === 'string' && typeof m.type === 'string').map((m) => ({
      id: m.id,
      type: m.type,
      scope: m.scope === 'global' ? 'global' : String(m.scope ?? 'global'),
      params: m.params && typeof m.params === 'object' ? m.params : {},
      severity: severities.has(m.severity) ? m.severity : 'error',
      enabled: m.enabled !== false,
      name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : null,
      createdAt: m.createdAt ?? null,
    })),
  };
}

function saveMonitors() {
  if (!monitorsGraphId) return Promise.resolve(); // henüz graph yok
  return chrome.storage.local.set({ [monitorsKey()]: monitors });
}

function monitorById(id) {
  return monitors.items.find((m) => m.id === id);
}

function edgeById(id) {
  return state.edges.find((e) => e.id === id);
}

// Listede görünen ad: kullanıcı ad vermediyse tür + belirleyici parametre (monitor-types.js).
function monitorName(m) {
  const type = monitorType(m.type);
  return m.name ?? (type ? monitorAutoName(type, m.params) : m.type);
}

// Kapsamın bugünkü anlamı: tüm model, node, edge ya da sahipsiz (öğe silinmiş, birleştirilmiş,
// graph sıfırlanmış).
function scopeKind(scope) {
  if (scope === 'global') return 'global';
  if (nodeById(scope)) return 'node';
  if (edgeById(scope)) return 'edge';
  return 'orphan';
}

function isOrphan(m) {
  return scopeKind(m.scope) === 'orphan';
}

// "e_Login (v_Login → v_Telefon)"
function edgeLabel(edge) {
  return `${edge.name} (${nodeById(edge.source)?.name ?? edge.source} → ${nodeById(edge.target)?.name ?? edge.target})`;
}

function scopeText(m) {
  switch (scopeKind(m.scope)) {
    case 'global': return 'Tüm model';
    case 'node': return `Node: ${nodeById(m.scope).name}`;
    case 'edge': return `Aksiyon: ${edgeById(m.scope).name}`;
    default: return `Sahipsiz: öğe (${m.scope}) artık yok`;
  }
}

// Parametrelerin kısa özeti: "Aksiyon tabanlı · Alan: input:phone · Desen (regex): ^0?5"
function paramsText(m) {
  const type = monitorType(m.type);
  if (!type) return `Bilinmeyen tür: ${m.type}`;
  const parts = type.params
    .filter((p) => m.params[p.key] !== '' && m.params[p.key] !== null && m.params[p.key] !== undefined && m.params[p.key] !== false)
    .map((p) => `${p.text}: ${p.kind === 'select' ? p.options.find((o) => o.value === m.params[p.key])?.text ?? m.params[p.key] : p.kind === 'checkbox' ? 'evet' : m.params[p.key]}`);
  return [MONITOR_WHEN[type.when]?.text, ...parts].filter(Boolean).join(' · ');
}

// Grup ikonu (Feather, MIT): kartlarda, form başlığında ve listede
function iconElement(group, small = false) {
  const span = document.createElement('span');
  span.className = 'type-icon' + (small ? ' small' : '');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${MONITOR_ICON[group.icon]}</svg>`;
  return span;
}


// -----------------------------------------------------------------------------
// ARAYÜZ: bölüm, detay kartındaki alt bölüm, pencereler ve sağ tık menüsü (panel.html'e
// eklenmez, buradan kurulur)
// -----------------------------------------------------------------------------

const MONITORS_SECTION_HTML = `
  <summary>Monitörler <span id="monitors-badge" class="badge"></span></summary>
  <p class="hint">Monitör: test her adımdan sonra kontrol edilen bir kural. Koşu oynatılırken her monitör yeşil (kural bozulmadı) ya da kırmızı (bozuldu: adım numarası ve ekran görüntüsüyle) yanar. "Tüm model" monitörleri her node'da, node monitörleri o node'a varılınca, aksiyon monitörleri o edge oynatılınca kontrol edilir. Graph'ta bir node'a ya da edge'e sağ tıklayıp "Monitör ekle" diyebilirsiniz.</p>
  <div id="monitors-filter" class="segmented" role="group" aria-label="Kapsam">
    <button data-filter="all">Tümü</button>
    <button data-filter="global">Tüm model</button>
    <button data-filter="selected">Seçili öğe</button>
  </div>
  <ul id="monitors-list" class="monitor-list"></ul>
  <p id="monitors-empty" class="hint"></p>
  <p id="monitors-orphans" class="hint warn" hidden></p>
  <div class="toolbar">
    <button id="btn-monitor-add" class="primary">Monitör ekle</button>
    <button id="btn-monitor-check" title="Oynatma yapmadan, açık sekmedeki ekranda tüm model ve seçili öğenin monitörlerini hemen kontrol eder (olay ve süre monitörleri hariç)">Bu ekranda şimdi kontrol et</button>
    <button id="btn-monitor-undo" disabled>Silmeyi geri al</button>
    <button id="btn-monitor-load" title="Daha önce dışa aktarılmış bir GraphWalker JSON'undaki monitörleri yükler">Yükle…</button>
    <button id="btn-monitor-orphans" class="danger" hidden>Sahipsizleri sil</button>
    <button id="btn-monitor-clear" class="danger">Tümünü sil</button>
  </div>
  <input type="file" id="monitor-file" accept=".json,application/json" hidden>`;

const DETAILS_MONITORS_HTML = `
  <h3 id="details-monitors-title">Bu node'un monitörleri <span id="details-monitors-badge" class="badge"></span></h3>
  <ul id="details-monitors-list" class="monitor-list"></ul>
  <p id="details-monitors-hint" class="hint"></p>
  <div class="toolbar">
    <button id="btn-node-monitor-add">Bu node'a monitör ekle</button>
  </div>`;

// Form penceresi iki adımdır: 1) tür seçimi (aranabilir kartlar) 2) kapsam, parametreler, alarm.
// Düzenlemede doğrudan 2. adım açılır; tür değişmez.
const MONITOR_DIALOG_HTML = `
  <div class="dialog-body">
    <div class="title-row">
      <h2 id="monitor-title">Monitör ekle</h2>
      <button id="btn-monitor-close" class="icon" title="Kapat" aria-label="Kapat">✕</button>
    </div>
    <div id="monitor-step-type">
      <p class="hint">Ne kontrol edilsin? Bir tür seçin; ayrıntılar sonraki adımda. Etiket, kontrol biçimini söyler: state tabanlı (ekrana varınca) ya da aksiyon tabanlı (aksiyondan sonra).</p>
      <input id="monitor-search" type="search" placeholder="Ara: hata, yazı, desen, süre…" autocomplete="off" spellcheck="false" aria-label="Tür ara">
      <div id="monitor-cards"></div>
      <p id="monitor-cards-empty" class="hint" hidden>Aramaya uyan tür yok.</p>
      <div class="toolbar">
        <button id="btn-monitor-cancel-type">Vazgeç</button>
      </div>
    </div>
    <div id="monitor-step-params" hidden>
      <div id="monitor-type-head" class="type-head">
        <div class="type-text"><b id="monitor-type-name"></b><small id="monitor-type-hint"></small></div>
        <button id="btn-monitor-change-type" class="small-btn">Türü değiştir</button>
      </div>
      <fieldset id="monitor-scope-set">
        <legend>Kapsam</legend>
        <label class="option"><input type="radio" name="monitor-scope" value="global"> <span>Tüm model: her node'da kontrol edilir</span></label>
        <label class="option"><input type="radio" name="monitor-scope" value="node"> <span>Yalnızca bu node:</span> <select id="monitor-node" aria-label="Node"></select></label>
        <label class="option"><input type="radio" name="monitor-scope" value="edge"> <span>Yalnızca bu aksiyon:</span> <select id="monitor-edge" aria-label="Edge"></select></label>
        <p id="monitor-scope-hint" class="hint" hidden></p>
      </fieldset>
      <fieldset id="monitor-params-set">
        <legend>Parametreler</legend>
        <div id="monitor-params"></div>
      </fieldset>
      <fieldset>
        <legend>Diğer</legend>
        <div class="alarm-row">
          <label class="switch" title="Kapalıysa monitör tanımlı kalır, kontrol edilmez"><input type="checkbox" id="monitor-enabled" role="switch" checked><span class="track" aria-hidden="true"></span><span>Etkin</span></label>
        </div>
        <label class="field"><span>İsim</span> <input id="monitor-name" spellcheck="false" placeholder="boş bırakılırsa kendiliğinden"></label>
      </fieldset>
      <p id="monitor-summary" class="summary" aria-live="polite"></p>
      <p id="monitor-error" class="message error" hidden></p>
      <div class="toolbar">
        <button id="btn-monitor-save" class="primary">Kaydet</button>
        <button id="btn-monitor-cancel">Vazgeç</button>
      </div>
    </div>
  </div>`;

const MONITOR_UNSAVED_HTML = `
  <div class="dialog-body">
    <p id="monitor-unsaved-text">Monitör kaydedilmedi. Kaydetmeden çıkılsın mı?</p>
    <div class="toolbar">
      <button id="btn-monitor-unsaved-discard" class="danger">Kaydetmeden çık</button>
      <button id="btn-monitor-unsaved-back">Geri dön</button>
    </div>
  </div>`;

(function mountMonitorsUi() {
  const section = document.createElement('details');
  section.id = 'monitors';
  section.className = 'card monitors';
  section.innerHTML = MONITORS_SECTION_HTML;
  $('scenario').after(section); // Senaryo bölümünün hemen altı

  const details = document.createElement('div');
  details.id = 'details-monitors';
  details.className = 'details-monitors';
  details.hidden = true;
  details.innerHTML = DETAILS_MONITORS_HTML;
  $('details').append(details); // node / edge detay kartının sonu

  const dialog = document.createElement('dialog');
  dialog.id = 'monitor-dialog';
  dialog.className = 'settings monitor-dialog';
  dialog.setAttribute('aria-labelledby', 'monitor-title');
  dialog.innerHTML = MONITOR_DIALOG_HTML;
  document.body.append(dialog);

  const unsaved = document.createElement('dialog');
  unsaved.id = 'monitor-unsaved-dialog';
  unsaved.className = 'alert';
  unsaved.setAttribute('aria-labelledby', 'monitor-unsaved-text');
  unsaved.innerHTML = MONITOR_UNSAVED_HTML;
  document.body.append(unsaved);

  const menu = document.createElement('div');
  menu.id = 'monitor-context-menu';
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.append(menu);
})();


// -----------------------------------------------------------------------------
// LİSTELER
// -----------------------------------------------------------------------------

// panel.js aktif graph'ı kendi okumasıyla alır; graph değişince o okuma bitene kadar `state`
// eski graph'tır. Monitörler yüklü graph ile state aynı graph değilse kısa süre sonra denenir.
let renderRetries = 0;
let renderRetryTimer = null;

function renderMonitors() {
  clearTimeout(renderRetryTimer);
  renderRetries = 0;
  renderMonitorsNow();
}

// Graph'ta seçili öğe (node ya da edge) ve türü; yoksa null.
function selectedItem() {
  const node = nodeById(selectedId);
  if (node) return { kind: 'node', item: node };
  const edge = edgeById(selectedId);
  if (edge) return { kind: 'edge', item: edge };
  return null;
}

function renderMonitorsNow() {
  if (state.id !== monitorsGraphId) {
    if (renderRetries++ < 50) renderRetryTimer = setTimeout(renderMonitorsNow, 100);
    return;
  }
  applyPendingBackup();
  const selected = selectedItem();
  const items = monitors.items;
  const orphans = items.filter(isOrphan);
  $('monitors-badge').textContent = items.length || '';
  $('btn-monitor-add').disabled = !monitorsGraphId;

  // Kapsam filtresi: "Seçili öğe" yalnızca graph'ta bir node ya da edge seçiliyken
  if (monitorFilter === 'selected' && !selected) monitorFilter = 'all';
  for (const button of $('monitors-filter').querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.filter === monitorFilter);
    if (button.dataset.filter === 'selected') {
      button.disabled = !selected;
      button.title = selected ? '' : 'Önce graph\'ta bir node ya da edge seçin';
      button.textContent = selected ? `Seçili ${selected.kind === 'node' ? 'node' : 'aksiyon'} (${selected.item.name})` : 'Seçili öğe';
    }
  }
  const shown = items.filter((m) => monitorFilter === 'all' || (monitorFilter === 'global' ? m.scope === 'global' : m.scope === selected?.item.id));
  $('monitors-list').replaceChildren(...shown.map((m) => monitorItem(m)));
  $('monitors-empty').textContent = shown.length ? '' : items.length
    ? 'Bu kapsamda monitör yok.'
    : 'Henüz monitör yok. "Monitör ekle" ile tüm model için; graph\'ta bir node\'a ya da edge\'e sağ tıklayıp "Monitör ekle" ile tek öğe için kural tanımlayın.';
  $('monitors-orphans').hidden = !orphans.length;
  $('monitors-orphans').textContent = orphans.length
    ? `${orphans.length} monitör sahipsiz: node'u ya da edge'i artık yok (silinmiş, birleştirilmiş ya da graph sıfırlanmış). "Düzenle" ile başka bir öğeye taşıyın ya da silin. Sahipsiz monitörler dışa aktarılmaz.`
    : '';
  $('btn-monitor-orphans').hidden = !orphans.length;
  $('btn-monitor-undo').disabled = !monitorUndo.length;
  $('btn-monitor-clear').disabled = !items.length;
  if (!items.length) disarmClear();

  renderDetailsMonitors(selected);
  markGraph();
}

// Detay kartındaki alt bölüm: yalnızca bir node ya da edge seçiliyken. Senaryo görünümünde
// (panel.js > GÖRÜNÜM; kopya salt okunur) öğenin monitörleri gösterilir ama eklenmez.
function renderDetailsMonitors(selected) {
  $('details-monitors').hidden = !selected;
  if (!selected) return;
  const { kind, item } = selected;
  const readOnly = Boolean(scenarioView);
  const own = monitors.items.filter((m) => m.scope === item.id);
  const global = monitors.items.filter((m) => m.scope === 'global' && m.enabled).length;
  $('details-monitors-title').firstChild.textContent = kind === 'node' ? 'Bu node\'un monitörleri ' : 'Bu aksiyonun monitörleri ';
  $('details-monitors-badge').textContent = own.length || '';
  $('details-monitors-list').replaceChildren(...own.map((m) => monitorItem(m)));
  $('details-monitors-hint').textContent = (own.length ? '' : `Bu ${kind === 'node' ? 'node' : 'aksiyon'}a özel monitör yok. `)
    + (global && kind === 'node' ? `Tüm model için tanımlı ${global} etkin monitör bu node'da da kontrol edilir. ` : '')
    + (readOnly ? 'Monitörler ana graph görünümünde eklenir ve düzenlenir.' : '');
  $('btn-node-monitor-add').textContent = kind === 'node' ? 'Bu node\'a monitör ekle' : 'Bu aksiyona monitör ekle';
  $('btn-node-monitor-add').hidden = readOnly;
  for (const button of $('details-monitors-list').querySelectorAll('button, input')) button.disabled = readOnly;
}

// Tek monitör satırı: etkin kutusu, ikon + ad / kapsam / parametreler, son kontrol sonucu (LED),
// Düzenle / Sil
function monitorItem(m) {
  const li = document.createElement('li');
  const orphan = isOrphan(m);
  const type = monitorType(m.type);
  li.className = 'monitor' + (m.enabled ? '' : ' disabled') + (orphan ? ' orphan' : '');
  li.innerHTML = '<input type="checkbox" class="toggle" title="Etkin">'
    + '<div class="body"><b></b><small class="scope"></small><small class="params"></small><small class="verdict" hidden></small></div>'
    + '<span class="buttons"><button class="edit">Düzenle</button><button class="icon delete" title="Sil" aria-label="Sil">✕</button></span>';
  const toggle = li.querySelector('.toggle');
  toggle.checked = m.enabled;
  toggle.setAttribute('aria-label', `${monitorName(m)} etkin`);
  toggle.onchange = async () => {
    m.enabled = toggle.checked;
    await saveMonitors();
    renderMonitors();
  };
  if (type) li.querySelector('b').append(iconElement(monitorGroup(type), true));
  li.querySelector('b').append(monitorName(m));
  li.querySelector('.scope').textContent = scopeText(m);
  li.querySelector('.scope').classList.toggle('orphan', orphan);
  li.querySelector('.params').textContent = paramsText(m);
  const verdict = monitorVerdicts.get(m.id);
  if (verdict) {
    const line = li.querySelector('.verdict');
    line.hidden = false;
    line.innerHTML = '<span class="led"></span> ';
    line.querySelector('.led').classList.add(verdict.status);
    line.append(`Son kontrol: ${verdict.text}`);
  }
  li.querySelector('.edit').disabled = !type;
  li.querySelector('.edit').title = type ? '' : 'Bu tür artık tanımlı değil; yalnızca silinebilir.';
  li.querySelector('.edit').onclick = () => openMonitorDialog({ id: m.id });
  li.querySelector('.delete').onclick = () => deleteMonitors([m]);
  return li;
}

$('monitors-filter').onclick = (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  monitorFilter = button.dataset.filter;
  renderMonitors();
};

// Node'a / edge'e tıklanınca (panel.js'in kendi tap dinleyicisinden sonra çalışır: selectedId güncel)
cy.on('tap', () => renderMonitors());

$('monitors').ontoggle = () => { if ($('monitors').open) renderMonitors(); };


// -----------------------------------------------------------------------------
// GRAPH: monitörü olan node ve edge'ler mor haleyle işaretlenir; sağ tık menüsü
// -----------------------------------------------------------------------------
// panel.js graph'ı yeniden kurunca (elementler silinip eklenince) ve tema değişince
// (stil baştan yüklenince) işaret kaybolur; ikisinde de yeniden uygulanır.

function graphMonitorStyle() {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--monitor').trim();
  return [
    { selector: 'node.monitored', style: { 'underlay-color': color, 'underlay-opacity': 0.35, 'underlay-padding': 7, 'underlay-shape': 'round-rectangle' } },
    { selector: 'edge.monitored', style: { 'underlay-color': color, 'underlay-opacity': 0.45, 'underlay-padding': 6 } },
  ];
}

function applyGraphMonitorStyle() {
  let sheet = cy.style();
  for (const { selector, style } of graphMonitorStyle()) sheet = sheet.selector(selector).style(style);
  sheet.update();
}

function markGraph() {
  const monitored = new Set(monitors.items.filter((m) => m.enabled && m.scope !== 'global').map((m) => m.scope));
  cy.elements().forEach((el) => el.toggleClass('monitored', monitored.has(el.id())));
}

applyGraphMonitorStyle();
document.addEventListener('themechange', applyGraphMonitorStyle); // panel.js'in dinleyicisinden sonra

let graphMarkTimer = null;
cy.on('add', () => { // graph yeniden kuruldu: adlar ve işaretler yenilensin
  clearTimeout(graphMarkTimer);
  graphMarkTimer = setTimeout(renderMonitors, 0);
});

// SAĞ TIK MENÜSÜ: node'a sağ tık → "Bu node'a monitör ekle" ve monitörlerini
// göster; edge'e sağ tık → "Bu aksiyona monitör ekle"; boş alana sağ tık → "Tüm modele monitör
// ekle". Cytoscape'in 'cxttap' olayı (sağ tık; dokunmatikte uzun basma). Tarayıcının kendi menüsü
// graph alanında açılmaz. Senaryo görünümünde (salt okunur) yalnızca "monitörlerini göster".
function openContextMenu(event) {
  const menu = $('monitor-context-menu');
  const target = event.target === cy ? null : event.target;
  const kind = !target ? 'global' : target.isNode() ? 'node' : 'edge';
  const id = target?.id() ?? null;
  const readOnly = Boolean(scenarioView);
  const exists = kind === 'global' || (kind === 'node' ? nodeById(id) : edgeById(id));
  const count = kind === 'global' ? monitors.items.filter((m) => m.scope === 'global').length : monitors.items.filter((m) => m.scope === id).length;
  const name = target?.data('label') ?? '';
  const items = [
    ...(readOnly || !exists ? [] : [{
      text: kind === 'node' ? `"${name}" node'una monitör ekle` : kind === 'edge' ? `"${name}" aksiyonuna monitör ekle` : 'Tüm modele monitör ekle',
      primary: true,
      onclick: () => { if (target) selectInGraph(id); openMonitorDialog({ scope: id ?? 'global' }); },
    }]),
    {
      text: kind === 'global' ? `Tüm model monitörlerini göster (${count})` : `Monitörlerini göster (${count})`,
      onclick: () => {
        if (target) selectInGraph(id);
        monitorFilter = kind === 'global' ? 'global' : 'selected';
        $('monitors').open = true;
        renderMonitors();
        $('monitors').scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
    },
  ];
  menu.replaceChildren(...items.map(({ text, primary, onclick }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.className = primary ? 'primary-item' : '';
    button.textContent = text;
    button.onclick = () => { closeContextMenu(); onclick(); };
    return button;
  }));
  const { x, y } = event.originalEvent ? { x: event.originalEvent.clientX, y: event.originalEvent.clientY } : event.renderedPosition ?? { x: 0, y: 0 };
  menu.hidden = false;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = `${Math.min(x, innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
  menu.querySelector('button')?.focus();
}

function closeContextMenu() {
  $('monitor-context-menu').hidden = true;
}

// Graph'ta öğeyi seçer (panel.js'in tap dinleyicisi gibi: selectedId + detay kartı)
function selectInGraph(id) {
  cy.elements().unselect();
  cy.getElementById(id).select();
  cy.getElementById(id).emit('tap'); // panel.js seçimi ve detay kartını buradan günceller
}

cy.on('cxttap', (event) => {
  if (replay) return; // oynatma sürerken graph'a dokunulmaz
  openContextMenu(event);
});
$('graph').addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('mousedown', (event) => {
  if (!$('monitor-context-menu').hidden && !event.target.closest('#monitor-context-menu')) closeContextMenu();
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeContextMenu(); });
cy.on('tap pan zoom', closeContextMenu);


// -----------------------------------------------------------------------------
// FORM PENCERESİ: ekle / düzenle. Alanlar monitor-types.js'teki tanımdan üretilir.
// -----------------------------------------------------------------------------

let editingId = null;       // düzenlenen monitörün id'si; yeni monitörde null
let editingOrphan = false;  // düzenlenen monitör sahipsiz: kullanıcı yeni öğe seçmeli
let dialogTypeId = null;    // 2. adımdaki tür; 1. adımda null
let dialogScope = 'global'; // 2. adıma geçerken uygulanacak kapsam ('global', node id ya da edge id)
let dialogInitial = null;   // açılıştaki taslak (kaydedilmemiş değişiklik kontrolü için)
let dialogClean = true;     // pencere bilerek kapatılıyor (kaydedildi / vazgeçildi)

// id verilirse o monitör düzenlenir (2. adım); scope verilirse ('global', node id ya da edge id)
// yeni monitör o kapsamla açılır (1. adım: tür seçimi).
function openMonitorDialog({ id = null, scope = null } = {}) {
  const existing = id ? monitorById(id) : null;
  editingId = existing?.id ?? null;
  editingOrphan = Boolean(existing && isOrphan(existing));
  dialogScope = existing?.scope ?? scope ?? (selectedItem() ? selectedId : 'global');
  dialogClean = false;
  $('monitor-title').textContent = existing ? 'Monitörü düzenle' : 'Monitör ekle';
  $('btn-monitor-change-type').hidden = Boolean(existing); // tür değişmez: parametreleri başka türe taşınamaz
  showDialogError(null);
  $('monitor-dialog').showModal();
  if (existing) showParamsStep(existing.type, existing);
  else showTypeStep();
}

// 1. ADIM: tür kartları (gruplu, aranabilir)
function showTypeStep() {
  dialogTypeId = null;
  dialogInitial = null;
  $('monitor-step-type').hidden = false;
  $('monitor-step-params').hidden = true;
  $('monitor-search').value = '';
  renderTypeCards('');
  $('monitor-search').focus();
}

function renderTypeCards(query) {
  const q = query.trim().toLocaleLowerCase('tr');
  const matches = (type) => !q || [type.text, type.hint, type.id, MONITOR_WHEN[type.when]?.text ?? ''].some((s) => s.toLocaleLowerCase('tr').includes(q));
  const groups = MONITOR_GROUPS.map((group) => ({ group, types: MONITOR_TYPES.filter((t) => t.group === group.id && matches(t)) })).filter((g) => g.types.length);
  $('monitor-cards').replaceChildren(...groups.flatMap(({ group, types }) => {
    const title = document.createElement('h4');
    title.className = 'type-group';
    title.append(iconElement(group, true), group.text);
    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.append(...types.map((type) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'type-card';
      card.dataset.type = type.id;
      card.append(iconElement(group));
      card.insertAdjacentHTML('beforeend', '<span class="type-title"></span><span class="type-tags"><span class="when"></span></span><span class="type-desc"></span>');
      card.querySelector('.type-title').textContent = type.text;
      card.querySelector('.when').textContent = MONITOR_WHEN[type.when]?.text ?? '';
      card.querySelector('.when').title = MONITOR_WHEN[type.when]?.hint ?? '';
      card.querySelector('.when').classList.add(type.when);
      card.querySelector('.type-desc').textContent = type.hint;
      card.onclick = () => showParamsStep(type.id);
      return card;
    }));
    return [title, cards];
  }));
  $('monitor-cards-empty').hidden = groups.length > 0;
}

$('monitor-search').oninput = () => renderTypeCards($('monitor-search').value);
$('btn-monitor-change-type').onclick = showTypeStep;

// 2. ADIM: seçilen türün kapsamı, parametreleri ve alarmı (existing verilirse değerleri onunla dolar)
function showParamsStep(typeId, existing = null) {
  const type = monitorType(typeId);
  dialogTypeId = type.id;
  $('monitor-step-type').hidden = true;
  $('monitor-step-params').hidden = false;

  const head = $('monitor-type-head');
  head.querySelector('.type-icon')?.remove();
  head.prepend(iconElement(monitorGroup(type)));
  $('monitor-type-name').textContent = type.text;
  $('monitor-type-hint').textContent = `${type.hint} ${MONITOR_WHEN[type.when]?.hint ?? ''}`;

  // Node ve edge listeleri: graph'taki öğeler oluşturulma sırasıyla; sahipsiz monitörün öğesi listede yok
  $('monitor-node').replaceChildren(...state.nodes.map((n) => new Option(n.name, n.id)));
  $('monitor-edge').replaceChildren(...state.edges.map((e) => new Option(edgeLabel(e), e.id)));
  const kind = scopeKind(dialogScope);
  setScopeRadio(kind === 'node' || kind === 'edge' ? kind : existing && kind === 'orphan' ? 'node' : 'global');
  if (kind === 'node') $('monitor-node').value = dialogScope;
  if (kind === 'edge') $('monitor-edge').value = dialogScope;

  const values = { ...monitorDefaults(type), ...(existing?.params ?? {}) };
  $('monitor-params').replaceChildren(...type.params.map((p) => paramField(p, values[p.key])));
  $('monitor-params-set').hidden = !type.params.length;
  $('monitor-enabled').checked = existing?.enabled ?? true;
  $('monitor-name').value = existing?.name ?? '';
  renderScopeState();
  renderElementPicks();
  renderSummary();
  showDialogError(null);
  dialogInitial = JSON.stringify(draftMonitor());
  ($('monitor-params').querySelector('input:not([type="checkbox"]), select') ?? $('monitor-name')).focus();
}

function scopeRadio() {
  return $('monitor-dialog').querySelector('input[name="monitor-scope"]:checked')?.value ?? 'global';
}

function setScopeRadio(value) {
  for (const radio of $('monitor-dialog').querySelectorAll('input[name="monitor-scope"]')) radio.checked = radio.value === value;
}

// Türün kapsam kısıtı (monitor-types.js > scope): izin vermediği seçenekler kapalı; graph'ta node
// ya da edge yoksa o seçenek de kapalı.
function renderScopeState() {
  const type = monitorType(dialogTypeId);
  const allowed = monitorScopes(type);
  const radios = Object.fromEntries([...$('monitor-dialog').querySelectorAll('input[name="monitor-scope"]')].map((r) => [r.value, r]));
  radios.global.disabled = !allowed.global;
  radios.node.disabled = !allowed.node || !state.nodes.length;
  radios.edge.disabled = !allowed.edge || !state.edges.length;
  if (radios[scopeRadio()].disabled) {
    const open = ['global', 'node', 'edge'].find((value) => !radios[value].disabled);
    if (open) radios[open].checked = true;
  }
  $('monitor-node').disabled = scopeRadio() !== 'node' || radios.node.disabled;
  $('monitor-edge').disabled = scopeRadio() !== 'edge' || radios.edge.disabled;
  const names = { global: 'tüm model', node: 'tek node', edge: 'tek aksiyon' };
  const allowedNames = Object.keys(allowed).filter((k) => allowed[k]).map((k) => names[k]);
  const hint = [
    allowedNames.length < 3 ? `Bu tür yalnızca ${allowedNames.join(' ya da ')} için tanımlanır.` : '',
    !state.nodes.length ? 'Graph\'ta henüz node yok; node ya da aksiyon monitörü için önce kayıt yapın.' : '',
    editingOrphan ? 'Bu monitörün öğesi artık yok (sahipsiz): listeden yeni bir node ya da aksiyon seçin ya da tüm modele alın.' : '',
  ].filter(Boolean).join(' ');
  $('monitor-scope-hint').textContent = hint;
  $('monitor-scope-hint').hidden = !hint;
}

// Bir parametre alanı: etiket + girdi; regex için hazır desen çipleri ve canlı deneme kutusu;
// element için node'un kaydedilmiş elementlerinden seçme listesi. Hata metni alanın altında.
function paramField(param, value) {
  const wrap = document.createElement('div');
  wrap.className = 'monitor-param';
  wrap.dataset.key = param.key;
  const label = document.createElement('label');
  if (param.kind === 'checkbox') {
    label.className = 'option';
    label.innerHTML = '<input type="checkbox"> <span></span>';
    label.querySelector('input').checked = Boolean(value);
  } else if (param.kind === 'select') {
    label.className = 'option';
    label.innerHTML = '<span></span> <select></select>';
    label.querySelector('select').replaceChildren(...param.options.map((o) => new Option(o.text, o.value)));
    label.querySelector('select').value = value;
  } else {
    label.className = 'field';
    label.innerHTML = '<span></span> <input spellcheck="false">';
    const input = label.querySelector('input');
    input.type = param.kind === 'number' ? 'number' : 'text';
    if (param.kind === 'number') {
      if (param.min !== undefined) input.min = param.min;
      if (param.max !== undefined) input.max = param.max;
      if (param.step !== undefined) input.step = param.step;
    }
    input.placeholder = param.placeholder ?? '';
    input.value = value ?? '';
    input.classList.toggle('mono', param.kind === 'regex');
  }
  label.querySelector('span').textContent = param.text + (param.required ? '' : ' (isteğe bağlı)');
  wrap.append(label);

  if (param.element) {
    const pick = document.createElement('select');
    pick.className = 'element-pick';
    pick.setAttribute('aria-label', `${param.text}: sayfadaki elementlerden seç`);
    pick.onchange = () => {
      if (!pick.value) return;
      const input = label.querySelector('input');
      input.value = pick.value;
      pick.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    wrap.append(pick);
  }

  if (param.kind === 'regex') {
    const tools = document.createElement('div');
    tools.className = 'regex-tools';
    if (param.presets?.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.append(...param.presets.map((preset) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = preset.text;
        chip.title = preset.value;
        chip.onclick = () => {
          const input = label.querySelector('input');
          input.value = preset.value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        };
        return chip;
      }));
      tools.append(chips);
    }
    const tester = document.createElement('label');
    tester.className = 'field tester';
    tester.innerHTML = '<span>Dene</span> <input spellcheck="false" placeholder="örnek bir değer yazın"><em class="test-result"></em>';
    tester.querySelector('input').oninput = () => updateTester(wrap);
    tools.append(tester);
    wrap.append(tools);
  }

  const error = document.createElement('p');
  error.className = 'field-error';
  error.hidden = true;
  wrap.append(error);
  wrap.addEventListener('input', () => { error.hidden = true; if (param.kind === 'regex') updateTester(wrap); });
  return wrap;
}

// Canlı deneme: desen ile örnek değer eşleşiyor mu?
function updateTester(wrap) {
  const pattern = wrap.querySelector('.field:not(.tester) input').value;
  const sample = wrap.querySelector('.tester input').value;
  const result = wrap.querySelector('.test-result');
  result.className = 'test-result';
  result.textContent = '';
  if (!pattern || !sample) return;
  try {
    const ok = new RegExp(pattern).test(sample);
    result.classList.add(ok ? 'ok' : 'fail');
    result.textContent = ok ? '✓ uyuyor' : '✗ uymuyor';
  } catch {
    result.classList.add('invalid');
    result.textContent = 'desen geçersiz';
  }
}

// Kapsamdaki ekranlar: node ise o node; aksiyon ise edge'in çıktığı ve vardığı node'lar; tüm
// model ise bütün node'lar.
function scopeNodes() {
  if (scopeRadio() === 'node') return [nodeById($('monitor-node').value)].filter(Boolean);
  if (scopeRadio() === 'edge') {
    const edge = edgeById($('monitor-edge').value);
    return edge ? [...new Set([nodeById(edge.source), nodeById(edge.target)].filter(Boolean))] : [];
  }
  return state.nodes;
}

// Element listeleri: kapsamdaki ekranların kaydedilmiş etkileşimli elementleri (parmak izi
// anahtarları, fingerprint.js > elementKey). 'fields' yalnızca form alanlarını listeler.
function renderElementPicks() {
  const type = monitorType(dialogTypeId);
  const nodes = scopeNodes();
  for (const param of type.params.filter((p) => p.element)) {
    const pick = $('monitor-params').querySelector(`[data-key="${param.key}"] .element-pick`);
    if (!pick) continue;
    const counts = new Map();
    for (const node of nodes) {
      for (const { key, count } of Array.isArray(node.elements) ? node.elements : []) {
        if (typeof key !== 'string') continue;
        if (param.element === 'fields' && !/^(input|textarea|select)\b/.test(key)) continue;
        counts.set(key, (counts.get(key) ?? 0) + count);
      }
    }
    const keys = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'tr'));
    pick.replaceChildren(new Option(keys.length
      ? (nodes.length === 1 ? `${nodes[0].name} ekranındaki elementlerden seç…` : 'Kayıtlı ekranlardaki elementlerden seç…')
      : 'Kayıtlı ekranlarda uygun element yok', ''));
    pick.append(...keys.map((key) => new Option(nodes.length > 1 && counts.get(key) > 1 ? `${key} (${counts.get(key)})` : key, key)));
    pick.disabled = !keys.length;
  }
}

// Formdaki değerler
function draftMonitor() {
  const type = monitorType(dialogTypeId);
  const params = {};
  for (const p of type.params) {
    const field = $('monitor-params').querySelector(`[data-key="${p.key}"] > label input, [data-key="${p.key}"] > label select`);
    params[p.key] = p.kind === 'checkbox' ? field.checked
      : p.kind === 'number' ? (field.value.trim() === '' ? '' : Number(field.value))
        : field.value.trim();
  }
  const radio = scopeRadio();
  return {
    type: type.id,
    scope: radio === 'node' ? $('monitor-node').value : radio === 'edge' ? $('monitor-edge').value : 'global',
    params,
    severity: 'error', // arayüzde önem seçilmez: her bozulma kırmızı (monitor-types.js > MONITOR_SEVERITIES)
    enabled: $('monitor-enabled').checked,
    name: $('monitor-name').value.trim() || null,
  };
}

// Özet cümlesi: "Testte v_Telefon node'una her varıldığında: input:phone alanının değeri /^0?5/ desenine uymalı…"
function renderSummary() {
  if (!dialogTypeId) return;
  const draft = draftMonitor();
  const type = monitorType(draft.type);
  const kind = scopeRadio();
  const scope = kind === 'global' ? { kind: 'global' }
    : kind === 'node' ? { kind: 'node', name: nodeById(draft.scope)?.name ?? '…' }
      : { kind: 'edge', name: edgeById(draft.scope)?.name ?? '…' };
  $('monitor-summary').replaceChildren(...monitorSentence(type, draft.params, scope, draft.enabled).map((part) => {
    if (typeof part === 'string') return part;
    const b = document.createElement('b');
    b.textContent = part.b;
    return b;
  }));
}

// Sorunlar alanların altına yazılır; kapsam sorunu pencerenin altındaki kutuya.
function validateDraft(draft) {
  const type = monitorType(draft.type);
  let problems = 0;
  for (const p of type.params) {
    const problem = monitorParamProblem(p, draft.params[p.key]);
    const error = $('monitor-params').querySelector(`[data-key="${p.key}"] .field-error`);
    error.textContent = problem ?? '';
    error.hidden = !problem;
    if (problem) problems++;
  }
  if (problems) return 'Parametrelerde sorun var; işaretli alanları düzeltin.';
  const kind = scopeKind(draft.scope);
  if (kind === 'orphan') return scopeRadio() === 'edge' ? 'Bir aksiyon (edge) seçin.' : 'Bir node seçin (graph\'ta node yoksa "Tüm model" seçin).';
  if (!monitorScopes(type)[kind]) return `Bu tür ${{ global: 'tüm model', node: 'tek node', edge: 'tek aksiyon' }[kind]} için tanımlanamaz.`;
  return null;
}

function showDialogError(text) {
  $('monitor-error').hidden = !text;
  $('monitor-error').textContent = text ?? '';
}

async function saveMonitor() {
  if (!dialogTypeId) return;
  const draft = draftMonitor();
  const problem = validateDraft(draft);
  showDialogError(problem);
  if (problem) return;
  const existing = editingId ? monitorById(editingId) : null;
  if (existing) {
    Object.assign(existing, draft);
    monitorVerdicts.delete(existing.id); // kural değişti: eski sonuç geçersiz
  } else {
    monitors.items.push({ id: 'm' + monitors.nextId++, ...draft, createdAt: new Date().toISOString() });
  }
  await saveMonitors();
  closeMonitorDialog();
  const saved = existing ?? monitors.items.at(-1);
  showMessage({ notice: `"${monitorName(saved)}" ${existing ? 'güncellendi' : 'eklendi'} (${scopeText(saved)}).` });
  if (!existing) $('monitors').open = true;
  renderMonitors();
}

function isDialogDirty() {
  return Boolean(dialogTypeId) && dialogInitial !== null && JSON.stringify(draftMonitor()) !== dialogInitial;
}

function closeMonitorDialog() {
  dialogClean = true;
  $('monitor-dialog').close();
}

// Kapatma isteği (✕, Vazgeç, Esc, pencere dışı): kaydedilmemiş değişiklik varsa önce sorar
function requestCloseMonitorDialog() {
  if (isDialogDirty()) $('monitor-unsaved-dialog').showModal();
  else closeMonitorDialog();
}

// 2. adımdaki her değişiklik: kapsam kısıtı, element listeleri ve özet cümlesi
$('monitor-step-params').addEventListener('input', renderSummary);
$('monitor-step-params').addEventListener('change', (event) => {
  if (event.target.name === 'monitor-scope' || event.target.id === 'monitor-node' || event.target.id === 'monitor-edge') {
    renderScopeState();
    renderElementPicks();
  }
  renderSummary();
});
$('btn-monitor-save').onclick = saveMonitor;
$('btn-monitor-cancel').onclick = requestCloseMonitorDialog;
$('btn-monitor-cancel-type').onclick = requestCloseMonitorDialog;
$('btn-monitor-close').onclick = requestCloseMonitorDialog;
$('monitor-dialog').onkeydown = (event) => { // metin alanında Enter = Kaydet (deneme kutusu hariç)
  if (event.key === 'Enter' && event.target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="search"])') && !event.target.closest('.tester')) {
    event.preventDefault();
    saveMonitor();
  }
};
$('monitor-dialog').oncancel = (event) => { // Esc
  event.preventDefault();
  requestCloseMonitorDialog();
};
$('monitor-dialog').onclick = (event) => { // karartılmış alana tıklama
  if (event.target === $('monitor-dialog')) requestCloseMonitorDialog();
};
// Chrome, kullanıcı etkileşimi olmadan basılan Esc'te 'cancel'ı iptal ettirmeyebilir ve pencereyi
// doğrudan kapatır (panel.js'teki Ayarlar penceresiyle aynı durum). Kirli kapandıysa geri aç.
$('monitor-dialog').onclose = () => {
  if (dialogClean || $('monitor-dialog').open || !isDialogDirty()) return;
  $('monitor-dialog').showModal();
  $('monitor-unsaved-dialog').showModal();
};
$('btn-monitor-unsaved-discard').onclick = () => {
  $('monitor-unsaved-dialog').close();
  closeMonitorDialog();
};
$('btn-monitor-unsaved-back').onclick = () => $('monitor-unsaved-dialog').close();

$('btn-monitor-add').onclick = () => openMonitorDialog({ scope: selectedItem() ? selectedId : 'global' });
$('btn-node-monitor-add').onclick = () => openMonitorDialog({ scope: selectedId });


// -----------------------------------------------------------------------------
// SİLME ve GERİ ALMA
// -----------------------------------------------------------------------------

async function deleteMonitors(list) {
  const entries = list.map((m) => ({ item: m, index: monitors.items.indexOf(m) })).filter((e) => e.index >= 0);
  if (!entries.length) return;
  monitorUndo.push(entries);
  monitors.items = monitors.items.filter((m) => !list.includes(m));
  await saveMonitors();
  showMessage({ notice: entries.length === 1 ? `"${monitorName(entries[0].item)}" silindi. Geri almak için "Silmeyi geri al".` : `${entries.length} monitör silindi. Geri almak için "Silmeyi geri al".` });
  renderMonitors();
}

$('btn-monitor-undo').onclick = async () => {
  const entries = monitorUndo.pop();
  if (!entries) return;
  for (const { item, index } of [...entries].sort((a, b) => a.index - b.index)) {
    monitors.items.splice(Math.min(index, monitors.items.length), 0, item);
  }
  await saveMonitors();
  showMessage({ notice: entries.length === 1 ? `"${monitorName(entries[0].item)}" geri getirildi.` : `${entries.length} monitör geri getirildi.` });
  renderMonitors();
};

$('btn-monitor-orphans').onclick = () => deleteMonitors(monitors.items.filter(isOrphan));

// "Tümünü sil": panel.js'teki Sıfırla gibi iki adımlı (3 sn içinde ikinci tıklama)
let clearTimer = null;
$('btn-monitor-clear').onclick = () => {
  if (!clearArmed) {
    clearArmed = true;
    $('btn-monitor-clear').textContent = 'Emin misin?';
    clearTimer = setTimeout(disarmClear, 3000);
    return;
  }
  disarmClear();
  deleteMonitors([...monitors.items]);
};

function disarmClear() {
  clearArmed = false;
  clearTimeout(clearTimer);
  $('btn-monitor-clear').textContent = 'Tümünü sil';
}


// -----------------------------------------------------------------------------
// DIŞA / İÇE AKTARMA
// -----------------------------------------------------------------------------
// GraphWalker JSON'una yazılan şekil (GraphWalker kendi bilmediği property'leri yok sayar):
//   models[0].properties.graphRecorder.monitors = { format, items: [...] }   (hepsi)
//   vertices[i].properties.monitors = [...]                                 (o node'unkiler)
//   edges[i].properties.monitors = [...]                                    (o aksiyonunkiler)
// Sahipsiz monitörler yazılmaz. Panel.js'teki graphWalkerModel() burada sarmalanır:
// "GraphWalker JSON" butonu onu adıyla çağırdığı için sarmalanan sürümü kullanır.

function exportMonitor(m) {
  return { id: m.id, type: m.type, name: monitorName(m), scope: m.scope, params: m.params, severity: m.severity, enabled: m.enabled };
}

function withMonitors(data) {
  const model = data.models[0];
  const known = new Set([...model.vertices.map((v) => v.id), ...model.edges.map((e) => e.id)]);
  const items = monitors.items.filter((m) => m.scope === 'global' || known.has(m.scope)).map(exportMonitor);
  model.properties.graphRecorder.monitors = { format: MONITORS_FORMAT, items };
  for (const element of [...model.vertices, ...model.edges]) {
    const own = items.filter((m) => m.scope === element.id);
    if (own.length) element.properties.monitors = own;
  }
  return data;
}

const graphWalkerModelWithoutMonitors = graphWalkerModel; // panel.js
graphWalkerModel = () => withMonitors(graphWalkerModelWithoutMonitors());

// Dışarıdan gelen monitör listesi (dışa aktarılmış model, yedek) mevcut listeye yeni id'lerle
// eklenir; bilinmeyen türler atlanır, öğesi bu graph'ta olmayanlar sahipsiz gelir.
function importMonitorItems(list) {
  const severities = new Set(MONITOR_SEVERITIES.map((s) => s.id));
  let unknown = 0;
  const added = [];
  for (const raw of list) {
    const type = monitorType(raw?.type);
    if (!type) { unknown++; continue; }
    const params = { ...monitorDefaults(type), ...(raw.params && typeof raw.params === 'object' ? raw.params : {}) };
    const name = typeof raw.name === 'string' && raw.name.trim() && raw.name.trim() !== monitorAutoName(type, params) ? raw.name.trim() : null;
    added.push({
      id: 'm' + monitors.nextId++, type: type.id, scope: raw.scope === 'global' ? 'global' : String(raw.scope ?? 'global'),
      params, severity: severities.has(raw.severity) ? raw.severity : 'error', enabled: raw.enabled !== false, name, createdAt: new Date().toISOString(),
    });
  }
  monitors.items.push(...added);
  return { added, unknown };
}

// Yükle: dışa aktarılmış GraphWalker JSON'undaki (ya da yalnızca monitör listesi içeren bir
// dosyadaki) monitörler mevcut listeye eklenir.
$('btn-monitor-load').onclick = () => $('monitor-file').click();
$('monitor-file').onchange = async () => {
  const file = $('monitor-file').files[0];
  $('monitor-file').value = '';
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const list = json.models?.[0]?.properties?.graphRecorder?.monitors?.items ?? (json.format === MONITORS_FORMAT ? json.items : null);
    if (!Array.isArray(list)) throw new Error('Dosyada monitör bulunamadı. Graph Recorder\'ın dışa aktardığı bir GraphWalker JSON\'u seçin.');
    const { added, unknown } = importMonitorItems(list);
    await saveMonitors();
    const orphans = added.filter(isOrphan).length;
    showMessage({ notice: `${added.length} monitör yüklendi` + (orphans ? `, ${orphans} tanesi sahipsiz (öğesi bu graph'ta yok)` : '') + (unknown ? `; ${unknown} bilinmeyen tür atlandı` : '') + '.' });
    $('monitors').open = true;
  } catch (error) {
    showMessage({ error: `Monitörler yüklenemedi: ${error.message}` });
  }
  renderMonitors();
};


// -----------------------------------------------------------------------------
// GRAPH YEDEĞİ: Graph'lar > "Dışa aktar" / "Yükle…" (panel.js > GRAPH'LAR)
// -----------------------------------------------------------------------------
// Yedek eklentinin kendi verisidir ve geri yüklenebilir; monitörler de ona yazılır (graphBackup()
// sarmalanır; background yedeği denetlerken fazladan alanı yok sayar). Yükleme background'da
// yeni bir graph oluşturur ve node / edge id'lerini korur; panel.js'in dosya kutusu capture
// aşamasında okunur, yedekteki monitörler bekletilir ve yeni graph aktif olunca ona yazılır.
// Yükleme vazgeçilirse ya da başka bir graph'a geçilirse bekleyen yedek uygulanmaz: yalnızca
// yedekteki tüm node'ları içeren, yedek seçildikten sonra oluşturulmuş ve henüz monitörü
// olmayan bir graph'a yazılır.

const graphBackupWithoutMonitors = graphBackup; // panel.js
graphBackup = () => ({ ...graphBackupWithoutMonitors(), monitors: { format: MONITORS_FORMAT, items: monitors.items.map(exportMonitor) } });

let pendingBackup = null; // { at, nodeIds, items }: yüklenmeyi bekleyen yedeğin monitörleri
const PENDING_BACKUP_MS = 2 * 60 * 1000;

document.addEventListener('change', async (event) => {
  if (event.target !== $('graph-file')) return;
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const items = data?.monitors?.items;
    pendingBackup = Array.isArray(items) && items.length && Array.isArray(data.nodes)
      ? { at: Date.now(), nodeIds: data.nodes.map((n) => n?.id), items }
      : null;
  } catch {
    pendingBackup = null; // bozuk dosyayı panel.js kendisi bildirir
  }
}, true);

function applyPendingBackup() {
  if (!pendingBackup) return;
  if (Date.now() - pendingBackup.at > PENDING_BACKUP_MS) { pendingBackup = null; return; }
  const entry = activeGraph();
  const fresh = entry && entry.created >= pendingBackup.at - 1000 && !monitors.items.length;
  const sameNodes = pendingBackup.nodeIds.every((id) => nodeById(id));
  if (!fresh || !sameNodes) return;
  const { added, unknown } = importMonitorItems(pendingBackup.items);
  pendingBackup = null;
  saveMonitors().then(() => {
    showMessage({ notice: `Yedekteki ${added.length} monitör de yüklendi` + (unknown ? ` (${unknown} bilinmeyen tür atlandı)` : '') + '.' });
    renderMonitors();
  });
}

// Silinen graph'ın monitörleri de silinir (graph listesi değişince: panel.js > GRAPH'LAR).
async function dropMonitorsOfDeletedGraphs(list) {
  const alive = new Set(list.map((g) => g.id));
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((key) => key.startsWith(MONITORS_KEY_PREFIX) && !alive.has(key.slice(MONITORS_KEY_PREFIX.length)));
  if (stale.length) await chrome.storage.local.remove(stale);
}


// -----------------------------------------------------------------------------
// BAŞLANGIÇ: aktif graph'ın monitörlerini oku, graph ve monitör değişince yeniden çiz
// -----------------------------------------------------------------------------
// panel.js graph listesini background'dan (SYNC) alıp aktif graph'ı kendi okumasıyla yükler;
// ilk açılışta aktif graph henüz yoksa 'activeGraph' değişince yüklenir. renderMonitors(),
// panel.js'in state'i bu graph'a geçene kadar bekler.

async function loadMonitors(graphId) {
  monitorsGraphId = graphId ?? null;
  monitorUndo = [];
  monitorVerdicts.clear();
  const stored = graphId ? (await chrome.storage.local.get(monitorsKey(graphId)))[monitorsKey(graphId)] : null;
  if (graphId !== monitorsGraphId) return; // bu arada yine değişti
  monitors = normalizeMonitors(stored);
  monitorFilter = 'all';
  renderMonitors();
}

chrome.storage.local.get('activeGraph').then(({ activeGraph: id }) => loadMonitors(id ?? null));

chrome.storage.onChanged.addListener((changes, area) => { // panel.js'in dinleyicisinden sonra
  if (area !== 'local') return;
  if (changes.activeGraph && (changes.activeGraph.newValue ?? null) !== monitorsGraphId) {
    loadMonitors(changes.activeGraph.newValue ?? null);
    return;
  }
  if (monitorsGraphId && changes[monitorsKey()]) monitors = normalizeMonitors(changes[monitorsKey()].newValue);
  if (monitorsGraphId && (changes[monitorsKey()] || changes['graph:' + monitorsGraphId])) renderMonitors();
  if (changes.graphs) dropMonitorsOfDeletedGraphs(changes.graphs.newValue ?? []);
});
