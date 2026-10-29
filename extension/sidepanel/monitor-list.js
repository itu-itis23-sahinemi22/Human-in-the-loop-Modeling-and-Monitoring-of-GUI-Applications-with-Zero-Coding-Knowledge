// =============================================================================
// monitor-list.js — MONİTÖRLER BÖLÜMÜ: liste, detay alt bölümü, sağ tık menüsü, hale, uyarı pencereleri
// -----------------------------------------------------------------------------
// Monitör modülünün arayüz parçası (dosya düzeni: monitor-store.js başlığı). panel.html'e eklenmez;
// bölümünü Senaryo bölümünün altına, "Bu öğenin monitörleri" alt bölümünü node / edge detay
// kartına, sağ tık menüsünü ve pencereleri gövdeye kendisi kurar. Senaryo görünümü salt okunurdur
// (panel.js > GÖRÜNÜM): öğenin monitörleri gösterilir, ekleme ana graph görünümünde yapılır.
// Senaryo kopyasındaki node ve edge'lerin 'monitors' alanı (scenario.js) senaryoya özel monitörler
// için ayrılmıştır; bu modül ona dokunmaz.
// Detay: docs/07-monitorler.md
// =============================================================================

let monitorFilter = 'all'; // listede gösterilen kapsam: 'all' | 'global' | 'selected' (seçili node / edge)
let monitorUndo = [];      // silinen monitörler, eski yerleriyle (en yenisi sonda); graph'a özel
let clearArmed = false;    // "Tümünü sil" iki adımlı onay

// Graph değişince (monitor-store.js > loadMonitors) liste durumu sıfırlanır
function resetMonitorListState() {
  monitorFilter = 'all';
  monitorUndo = [];
}

// Tıklanabilir ama düğme olmayan öğe (küçük görüntü, adım karesi): klavyeyle de açılsın
function activatable(el, onActivate, label) {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  if (label) el.setAttribute('aria-label', label);
  el.onclick = onActivate;
  el.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate(); } };
}

function alarmTime(alarm) {
  const d = new Date(alarm.at);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// "Bozulduğu andaki ekran" penceresi: başlık altındaki metin + görüntü. alarmLike: { where, text, screenshot }.
function openMonitorShot(m, alarmLike) {
  $('monitor-shot-text').textContent = `${monitorName(m)} · ${alarmLike.where}${alarmLike.where && alarmLike.text ? ': ' : ''}${alarmLike.text ?? ''}`;
  $('monitor-shot-image').src = alarmLike.screenshot ?? '';
  $('monitor-shot-image').hidden = !alarmLike.screenshot;
  $('monitor-shot-noimage').hidden = Boolean(alarmLike.screenshot);
  $('monitor-shot-dialog').showModal();
}

// Monitörün uyarı listesi penceresi: her uyarı zaman · yer · neden · küçük görüntü (tıklayınca büyür).
let alarmsClearArmed = false;
let alarmsClearTimer = null;
function disarmAlarmsClear() {
  alarmsClearArmed = false;
  clearTimeout(alarmsClearTimer);
  $('btn-monitor-alarms-clear').textContent = 'Uyarıları temizle';
}
function openMonitorAlarms(m) {
  const list = alarmsOf(m.id);
  $('monitor-alarms-title').textContent = `Uyarılar · ${monitorName(m)}`;
  $('monitor-alarms-hint').textContent = list.length
    ? `${list.length} uyarı (en yenisi üstte; graph başına son ${MONITOR_ALARM_LIMIT} uyarı saklanır). Her uyarı, monitörün bozulduğu anda alınan ekran görüntüsüyle.`
    : 'Bu monitör henüz uyarı vermedi.';
  $('monitor-alarms-list').replaceChildren(...list.map((a) => {
    const li = document.createElement('li');
    li.className = 'alarm';
    li.innerHTML = '<img class="shot" alt="Bozulduğu andaki ekran"><div class="alarm-body"><b></b><small class="when"></small><small class="why"></small></div>';
    const img = li.querySelector('img');
    if (a.screenshot) { img.src = a.screenshot; img.title = 'Büyütmek için tıklayın'; activatable(img, () => openMonitorShot(m, a), `Bozulduğu andaki ekranı büyüt (${a.where})`); } else img.remove();
    li.querySelector('b').textContent = a.where || (a.source === 'live' ? 'Şimdi kontrol' : 'Oynatma');
    li.querySelector('.when').textContent = alarmTime(a) + (a.url ? ` · ${a.url}` : '');
    li.querySelector('.why').textContent = a.text;
    return li;
  }));
  disarmAlarmsClear();
  $('btn-monitor-alarms-clear').disabled = !list.length;
  $('btn-monitor-alarms-clear').onclick = async () => { // iki adımlı, 3 sn içinde ikinci tıklama ("Tümünü sil" gibi)
    if (!alarmsClearArmed) {
      alarmsClearArmed = true;
      $('btn-monitor-alarms-clear').textContent = 'Emin misin?';
      alarmsClearTimer = setTimeout(disarmAlarmsClear, 3000);
      return;
    }
    disarmAlarmsClear();
    await clearMonitorAlarms(m.id);
    openMonitorAlarms(m);
  };
  $('monitor-alarms-dialog').showModal();
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
  <p class="hint">Monitör: test her adımdan sonra kontrol edilen bir kural. Koşu oynatılırken her monitör yeşil (kural bozulmadı) ya da kırmızı (bozuldu: adım numarası ve ekran görüntüsüyle) yanar. "Tüm model" monitörleri her node'da, node monitörleri o node'a varılınca, edge monitörleri o edge oynatılınca (istenirse edge'in seçilen aksiyonundan hemen sonra) kontrol edilir. Graph'ta bir node'a ya da edge'e sağ tıklayıp "Monitör ekle" diyebilirsiniz.</p>
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
    <button id="btn-monitor-check" title="Oynatma yapmadan, açık sekmedeki ekranda tüm model ve seçili öğenin monitörlerini hemen kontrol eder">Bu ekranda şimdi kontrol et</button>
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

(function mountMonitorListUi() {
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

  const menu = document.createElement('div');
  menu.id = 'monitor-context-menu';
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.append(menu);

  // "Bozulduğu andaki ekran": bir uyarının ekran görüntüsü (Monitörler listesi, uyarı listesi ve
  // oynatma kartındaki ışık listesi açar)
  const shot = document.createElement('dialog');
  shot.id = 'monitor-shot-dialog';
  shot.className = 'compare monitor-shot';
  shot.setAttribute('aria-labelledby', 'monitor-shot-title');
  shot.innerHTML = `
    <div class="dialog-body">
      <div class="title-row">
        <h2 id="monitor-shot-title">Bozulduğu andaki ekran</h2>
        <button id="btn-monitor-shot-close" class="icon" title="Kapat" aria-label="Kapat">✕</button>
      </div>
      <p id="monitor-shot-text" class="small"></p>
      <img id="monitor-shot-image" alt="Monitörün bozulduğu andaki ekran görüntüsü">
      <p id="monitor-shot-noimage" class="hint" hidden>Bu uyarı için ekran görüntüsü alınamadı.</p>
    </div>`;
  document.body.append(shot);
  $('btn-monitor-shot-close').onclick = () => shot.close();
  shot.onclick = (event) => { if (event.target === shot) shot.close(); };

  // Bir monitörün uyarı listesi
  const alarms = document.createElement('dialog');
  alarms.id = 'monitor-alarms-dialog';
  alarms.className = 'settings monitor-alarms';
  alarms.setAttribute('aria-labelledby', 'monitor-alarms-title');
  alarms.innerHTML = `
    <div class="dialog-body">
      <div class="title-row">
        <h2 id="monitor-alarms-title">Uyarılar</h2>
        <button id="btn-monitor-alarms-close" class="icon" title="Kapat" aria-label="Kapat">✕</button>
      </div>
      <p id="monitor-alarms-hint" class="hint"></p>
      <ul id="monitor-alarms-list" class="alarm-list"></ul>
      <div class="toolbar">
        <button id="btn-monitor-alarms-clear" class="danger">Uyarıları temizle</button>
        <button id="btn-monitor-alarms-done">Kapat</button>
      </div>
    </div>`;
  document.body.append(alarms);
  $('btn-monitor-alarms-close').onclick = () => alarms.close();
  $('btn-monitor-alarms-done').onclick = () => alarms.close();
  alarms.onclick = (event) => { if (event.target === alarms) alarms.close(); };
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
      button.textContent = selected ? `Seçili ${selected.kind === 'node' ? 'node' : 'edge'} (${selected.item.name})` : 'Seçili öğe';
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
  $('details-monitors-title').firstChild.textContent = kind === 'node' ? 'Bu node\'un monitörleri ' : 'Bu edge\'in monitörleri ';
  $('details-monitors-badge').textContent = own.length || '';
  $('details-monitors-list').replaceChildren(...own.map((m) => monitorItem(m)));
  $('details-monitors-hint').textContent = (own.length ? '' : `Bu ${kind === 'node' ? 'node' : 'edge'}'e özel monitör yok. `)
    + (global && kind === 'node' ? `Tüm model için tanımlı ${global} etkin monitör bu node'da da kontrol edilir. ` : '')
    + (readOnly ? 'Monitörler ana graph görünümünde eklenir ve düzenlenir.' : '');
  $('btn-node-monitor-add').textContent = kind === 'node' ? 'Bu node\'a monitör ekle' : 'Bu edge\'e monitör ekle';
  $('btn-node-monitor-add').hidden = readOnly;
  for (const button of $('details-monitors-list').querySelectorAll('button, input')) button.disabled = readOnly && !button.classList.contains('alarms-open'); // uyarılar salt okunur bilgi: görünümde de açılır
}

// Tek monitör satırı: etkin kutusu, ikon + ad / kapsam / parametreler, son kontrol sonucu (LED),
// Düzenle / Sil
function monitorItem(m) {
  const li = document.createElement('li');
  const orphan = isOrphan(m);
  const type = monitorType(m.type);
  li.className = 'monitor' + (m.enabled ? '' : ' disabled') + (orphan ? ' orphan' : '');
  li.innerHTML = '<input type="checkbox" class="toggle" title="Etkin">'
    + '<div class="body"><b></b><small class="scope"></small><small class="params"></small><small class="verdict" hidden></small><div class="alarms" hidden></div></div>'
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
  li.querySelector('.scope').classList.toggle('orphan', orphan || isActionMissing(m));
  li.querySelector('.params').textContent = paramsText(m);
  // Görüntü monitörü: aranan parçanın küçük hali (monitor-types.js > kind: 'image')
  for (const p of type?.params.filter((p) => p.kind === 'image' && m.params[p.key]?.data) ?? []) {
    const img = document.createElement('img');
    img.className = 'needle';
    img.src = m.params[p.key].data;
    img.alt = `Aranan görüntü (${m.params[p.key].width}×${m.params[p.key].height} px)`;
    img.title = img.alt;
    li.querySelector('.params').after(img);
  }
  const verdict = monitorVerdicts.get(m.id);
  if (verdict) {
    const line = li.querySelector('.verdict');
    line.hidden = false;
    line.innerHTML = '<span class="led"></span> ';
    line.querySelector('.led').classList.add(verdict.status);
    line.append(`Son kontrol: ${verdict.text}`);
  }
  // Uyarılar: son uyarının görüntüsü (son kontrol kırmızıysa; uyarı o kontrolde alındı) + liste
  const alarms = alarmsOf(m.id);
  if (alarms.length) {
    const row = li.querySelector('.alarms');
    row.hidden = false;
    const latest = alarms[0];
    if (verdict?.status === 'fail' && latest.screenshot) {
      const img = document.createElement('img');
      img.className = 'shot';
      img.src = latest.screenshot;
      img.alt = 'Bozulduğu andaki ekran';
      img.title = `Bozulduğu andaki ekran (${latest.where}): büyütmek için tıklayın`;
      activatable(img, () => openMonitorShot(m, latest), `Bozulduğu andaki ekranı büyüt (${latest.where})`);
      row.append(img);
    }
    const button = document.createElement('button');
    button.className = 'small-btn alarms-open';
    button.textContent = `Uyarılar (${alarms.length})`;
    button.title = 'Bu monitörün uyarıları: zaman, yer, neden ve bozulduğu andaki ekran görüntüsü';
    button.onclick = () => openMonitorAlarms(m);
    row.append(button);
  }
  li.querySelector('.edit').disabled = !type;
  li.querySelector('.edit').title = type ? '' : 'Bu tür artık tanımlı değil; yalnızca silinebilir.';
  li.querySelector('.edit').onclick = () => openMonitorDialog({ id: m.id });
  li.querySelector('.edit').setAttribute('aria-label', `${monitorName(m)} düzenle`);
  li.querySelector('.delete').onclick = () => deleteMonitors([m]);
  li.querySelector('.delete').setAttribute('aria-label', `${monitorName(m)} sil`);
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
      text: kind === 'node' ? `"${name}" node'una monitör ekle` : kind === 'edge' ? `"${name}" edge'ine monitör ekle` : 'Tüm modele monitör ekle',
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
  const { x, y } = menuPoint(event);
  menu.hidden = false;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`; // pencere içinde kalsın (graph kaydırılmış olabilir)
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
  menu.querySelector('button')?.focus();
}

function closeContextMenu() {
  $('monitor-context-menu').hidden = true;
}

// Menünün açılacağı nokta (pencere koordinatı). Fare: olayın clientX/Y'si. Dokunmatik uzun basma
// ve sahte olaylar: clientX yok; graph'taki çizim konumu kutunun yerine eklenir.
function menuPoint(event) {
  const raw = event.originalEvent;
  const client = raw?.clientX ?? raw?.touches?.[0]?.clientX ?? raw?.changedTouches?.[0]?.clientX;
  if (Number.isFinite(client)) return { x: client, y: raw.clientY ?? raw.touches?.[0]?.clientY ?? raw.changedTouches?.[0]?.clientY ?? 0 };
  const box = $('graph').getBoundingClientRect();
  const pos = event.renderedPosition ?? { x: 0, y: 0 };
  return { x: box.left + (Number.isFinite(pos.x) ? pos.x : 0), y: box.top + (Number.isFinite(pos.y) ? pos.y : 0) };
}

// Graph'ta öğeyi seçer. Seçim doğrudan yapılır (panel.js'in tap dinleyicisindeki iki satır: selectedId + renderDetails).
// Sahte bir 'tap' olayı göndermek YANLIŞ olurdu: Senaryo bölümü açık ve "Elle seç"teyken panel.js
// edge'e tıklamayı "bu edge'i koşuya ekle" sayar (panel.js > cy.on('tap')); sağ tık menüsü koşuyu
// değiştirmemeli.
function selectInGraph(id) {
  cy.elements().unselect();
  cy.getElementById(id).select();
  selectedId = id; // panel.js
  renderDetails(); // panel.js
  renderMonitors();
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
