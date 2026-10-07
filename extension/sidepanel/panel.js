// =============================================================================
// panel.js — ARAYÜZ (yan panel)
// -----------------------------------------------------------------------------
// Bu dosya state'i ve ayarları ASLA kendisi değiştirmez. Sadece:
//   - chrome.storage.local'daki state'i ve ayarları okuyup ekrana çizer,
//   - kullanıcı bir butona / ayara basınca background.js'e istek (mesaj) gönderir.
//
// Veri akışı tek yönlüdür:
//   buton -> mesaj -> background state'i değiştirir -> storage'a yazar
//         -> storage.onChanged tetiklenir -> render()
// =============================================================================

const $ = (id) => document.getElementById(id);

const EMPTY_STATE = { tabId: null, currentNodeId: null, startNodeId: null, nodes: [], edges: [], buffer: [], pending: null };

let state = EMPTY_STATE;
let settings = DEFAULT_SETTINGS; // settings.js
let selectedId = null;   // graph'ta tıklanan node/edge
let busy = false;        // "Node oluştur" isteği sürerken butonu kilitlemek için
let lastGraphKey = '';   // graph değişmediyse yeniden çizmemek için

// Aksiyon tiplerinin ekranda görünen adları (settings.js)
const ACTION_TEXT = Object.fromEntries(ACTION_TYPES.map((a) => [a.type, a.text]));


// -----------------------------------------------------------------------------
// GRAPH ÇİZİMİ (Cytoscape.js)
// -----------------------------------------------------------------------------

const cy = cytoscape({
  container: $('graph'),
  minZoom: 0.2,
  maxZoom: 2,
  style: [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        width: 96,
        height: 60,
        'background-color': '#e2e8f0',
        'background-image': 'data(screenshot)', // node'un içinde sayfanın küçük ekran görüntüsü
        'background-fit': 'cover',
        'border-width': 2,
        'border-color': '#94a3b8',
        label: 'data(label)',
        'font-size': 11,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.9,
        'text-background-padding': 2,
      },
    },
    { selector: 'node.current', style: { 'border-color': '#16a34a', 'border-width': 4 } },
    {
      selector: 'edge',
      style: {
        width: 2,
        'line-color': '#64748b',
        'target-arrow-color': '#64748b',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier', // paralel edge'leri ve self-loop'ları ayrı ayrı çizer
        label: 'data(label)',
        'font-size': 9,
        'text-rotation': 'autorotate',
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.9,
        'text-background-padding': 1,
      },
    },
    // Self-loop (aynı node'a dönen edge): node'un sağına, okunabilir büyüklükte çiz
    { selector: 'edge:loop', style: { 'loop-direction': '90deg', 'loop-sweep': '-50deg', 'control-point-step-size': 70 } },
    { selector: 'node:selected', style: { 'border-color': '#2563eb', 'border-width': 4 } },
    { selector: 'edge:selected', style: { 'line-color': '#2563eb', 'target-arrow-color': '#2563eb', width: 3 } },
  ],
});

cy.on('tap', (event) => {
  selectedId = event.target === cy ? null : event.target.id(); // boşluğa tıklayınca seçimi kaldır
  renderDetails();
});

function renderGraph() {
  // Her aksiyonda storage değişir ama graph değişmeyebilir; gereksiz yeniden çizimden kaçın.
  const key = JSON.stringify([
    state.currentNodeId,
    state.nodes.map((n) => [n.id, n.name]),
    state.edges.map((e) => [e.id, e.name, e.source, e.target]),
  ]);
  if (key === lastGraphKey) return;
  lastGraphKey = key;

  cy.elements().remove();
  cy.add([
    ...state.nodes.map((n) => ({
      data: { id: n.id, label: n.name, screenshot: n.screenshot },
      classes: n.id === state.currentNodeId ? 'current' : '',
    })),
    ...state.edges.map((e) => ({ data: { id: e.id, label: e.name, source: e.source, target: e.target } })),
  ]);

  // 'breadthfirst': başlangıç node'u en üstte, ondan ulaşılanlar alt satırlarda.
  cy.layout({
    name: 'breadthfirst',
    directed: true,
    roots: state.startNodeId ? '#' + state.startNodeId : undefined,
    spacingFactor: 1.1,
    padding: 24,
    animate: false,
  }).run();

  if (selectedId) cy.getElementById(selectedId).select();
}


// -----------------------------------------------------------------------------
// EKRANIN DİĞER PARÇALARI
// -----------------------------------------------------------------------------

function render() {
  renderStatus();
  renderConfirm();
  renderGraph();
  renderDetails();
  renderBuffer();
}

function renderStatus() {
  const current = nodeById(state.currentNodeId);
  if (state.nodes.length === 0) {
    $('status').textContent = 'Kayıt başlamadı. Graph\'ını çıkarmak istediğin sayfaya git ve "Node oluştur"a bas.';
  } else {
    $('status').textContent = `${state.nodes.length} node · ${state.edges.length} edge · Şu an: `
      + (current ? current.name : 'seçili değil (bir node seçip "Buradan devam et"e bas)')
      + (state.tabId === null ? ' · Kayıt sekmesi kapandı: devam edeceğin sekmede bir node seçip "Buradan devam et"e bas.' : '');
  }
  // İlk node dışında, bekleyen aksiyon yoksa node oluşturulamaz (aksiyonsuz edge tekrar oynatılamaz).
  const noActions = state.nodes.length > 0 && state.buffer.length === 0;
  $('btn-node').disabled = busy || Boolean(state.pending) || noActions;
  $('btn-node').title = noActions ? 'Bekleyen aksiyon yok: önce sayfada bir aksiyon yap.' : '';
}

// Eşleşen her node bir seçenek: ekran görüntüsü, ismi ve "Evet, bu node" butonu.
// Kart her storage değişikliğinde (ör. gelen aksiyon) yeniden kurulmasın diye anahtar tutulur.
let lastConfirmKey = '';

function renderConfirm() {
  const pending = state.pending;
  $('confirm').hidden = !pending;
  if (!pending) {
    lastConfirmKey = '';
    return;
  }
  const candidates = pending.candidateIds.map(nodeById).filter(Boolean);
  const key = JSON.stringify([state.currentNodeId, candidates.map((n) => [n.id, n.name])]);
  if (key === lastConfirmKey) return;
  lastConfirmKey = key;

  $('confirm-text').textContent = candidates.length === 1
    ? `Bu sayfanın etkileşimli elementleri mevcut "${candidates[0].name}" node'u ile birebir aynı. Aynı state mi?`
    : candidates.length > 1
      ? `Bu sayfanın etkileşimli elementleri ${candidates.length} node ile birebir aynı. Hangisiyle aynı state? Hiçbiri değilse yeni node oluştur.`
      : 'Eşleşen node silindi. Sayfa yeni node olarak eklenebilir.';
  $('confirm-new').src = pending.capture.screenshot;
  $('confirm-candidates').replaceChildren(...candidates.map(candidateFigure));
  $('btn-new').textContent = candidates.length > 1 ? 'Hiçbiri, yeni node' : candidates.length ? 'Hayır, yeni node' : 'Yeni node';
}

function candidateFigure(node) {
  const figure = document.createElement('figure');
  figure.innerHTML = '<img alt=""><figcaption></figcaption><button class="primary">Evet, bu node</button>';
  figure.querySelector('img').src = node.screenshot;
  figure.querySelector('figcaption').textContent = node.name + (node.id === state.currentNodeId ? ' (şu anki node)' : '');
  // Şu anki node seçilirse edge kendine döner; önce bunun mu yoksa hiç kaydetmemenin mi
  // istendiği sorulur. Diğer adaylarda edge doğrudan o node'a çizilir.
  figure.querySelector('button').onclick = () =>
    node.id === state.currentNodeId ? openLoopDialog(node) : send({ type: 'RESOLVE', targetId: node.id });
  return figure;
}

function openLoopDialog(node) {
  const count = state.pending.actions.length;
  $('loop-text').textContent = `Sayfa hâlâ şu anki node'un ("${node.name}") durumunda. Son ${count} aksiyon ne olsun?`;
  $('loop-edge-hint').textContent = `Aksiyonlar ${node.name} → ${node.name} edge'i olur. Sayfanın durumunu değiştirmeyen bir işlemi (ör. sıralama, arama) modellemek için.`;
  $('loop-continue-hint').textContent = `Node ve edge oluşmaz. ${count} aksiyon "Bekleyen aksiyonlar"da kalır; yeni aksiyonlar eklenmeye devam eder.`;
  $('btn-loop-edge').onclick = () => {
    $('loop-dialog').close();
    send({ type: 'RESOLVE', targetId: node.id });
  };
  $('loop-dialog').showModal();
}

$('btn-loop-continue').onclick = () => {
  $('loop-dialog').close();
  send({ type: 'CANCEL_PENDING' });
};
$('btn-loop-back').onclick = () => $('loop-dialog').close();

function renderDetails() {
  const node = nodeById(selectedId);
  const edge = state.edges.find((e) => e.id === selectedId);
  const item = node || edge;
  $('details').hidden = !item;
  if (!item) return;

  $('details-title').textContent = node ? 'Node' : 'Edge';
  $('details-subtitle').textContent = node
    ? node.url
    : `${nodeById(edge.source)?.name} → ${nodeById(edge.target)?.name} · ${edge.actions.length} aksiyon`;
  // Kullanıcı o an yazıyorsa input'u ezme
  if (document.activeElement !== $('details-name')) $('details-name').value = item.name;

  $('details-shot').hidden = !node;
  if (node) $('details-shot').src = node.screenshot;
  $('details-actions').replaceChildren(...(edge ? edge.actions.map(actionItem) : []));
  $('btn-continue').hidden = !node;
}

function renderBuffer() {
  $('buffer-count').textContent = state.buffer.length;
  $('buffer').replaceChildren(...state.buffer.map(actionItem));
}

// Tek bir aksiyonu liste satırı olarak gösterir: "Tıkla  Login   #login-button"
function actionItem(action) {
  const li = document.createElement('li');
  const value = action.type === 'input' ? ` = "${action.value}"` : action.type === 'scroll' ? ` → ${action.x}, ${action.y}` : '';
  li.innerHTML = '<b></b> <span></span> <code></code>';
  li.querySelector('b').textContent = ACTION_TEXT[action.type] ?? action.type;
  li.querySelector('span').textContent = action.label + value;
  li.querySelector('code').textContent = action.selector ?? action.url;
  return li;
}

function nodeById(id) {
  return state.nodes.find((n) => n.id === id);
}

// Background cevabındaki { error } kırmızı, { notice } mavi kutuda gösterilir.
function showMessage(response) {
  const text = response?.error ?? response?.notice;
  $('message').hidden = !text;
  $('message').textContent = text ?? '';
  $('message').className = 'message ' + (response?.error ? 'error' : 'notice');
}


// -----------------------------------------------------------------------------
// BUTONLAR -> background.js'e mesaj
// -----------------------------------------------------------------------------

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  showMessage(response);
  return response;
}

$('btn-node').onclick = async () => {
  busy = true;
  renderStatus();
  // Panelin bağlı olduğu penceredeki aktif sekme = kullanıcının gezdiği sayfa
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await send({ type: 'CREATE_NODE', tabId: tab.id, windowId: tab.windowId });
  busy = false;
  renderStatus();
};

$('btn-new').onclick = () => send({ type: 'RESOLVE', targetId: null });

$('btn-save').onclick = () => send({ type: 'RENAME', id: selectedId, name: $('details-name').value });
$('details-name').onkeydown = (e) => { if (e.key === 'Enter') $('btn-save').click(); };
$('btn-continue').onclick = async () => {
  // Kayıt sekmesi kapatılmışsa kayıt bu sekmede sürer (bkz. background.js > setCurrent).
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  send({ type: 'SET_CURRENT', id: selectedId, tabId: tab?.id });
};
$('btn-delete').onclick = () => {
  send({ type: 'DELETE', id: selectedId });
  selectedId = null;
};

// Yanlışlıkla silmeyi önlemek için iki adımlı onay: ilk tıklama sorar, 3 sn içinde ikincisi siler.
let resetArmed = false;
$('btn-reset').onclick = () => {
  if (!resetArmed) {
    resetArmed = true;
    $('btn-reset').textContent = 'Emin misin?';
    setTimeout(() => { resetArmed = false; $('btn-reset').textContent = 'Sıfırla'; }, 3000);
    return;
  }
  send({ type: 'RESET' });
  selectedId = null;
};

$('btn-export').onclick = () => {
  const data = graphWalkerModel();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${data.name}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

// Graph'ı GraphWalker JSON model formatına çevirir (GraphWalker Studio'nun kaydettiği ve
// CLI'ın okuduğu format). Kayda özel veriler GraphWalker'ın serbest "properties"
// alanlarında taşınır. GraphWalker'ın kendi edge "actions" alanına DOKUNULMAZ: o alan
// modelin değişkenlerini güncelleyen JavaScript içindir, tarayıcı aksiyonu değil
// (bkz. docs/04-veri-modeli.md > GraphWalker formatı).
function graphWalkerModel() {
  const name = nodeById(state.startNodeId)?.name.replace(/^v_/, '') || 'GraphRecorder';
  const position = (id) => cy.getElementById(id).position(); // Studio'da aynı yerleşim için
  return {
    name,
    models: [{
      id: crypto.randomUUID(),
      name,
      generator: 'random(edge_coverage(100))',
      startElementId: state.startNodeId ?? '',
      properties: {
        graphRecorder: { format: 'graph-recorder/v4', exportedAt: new Date().toISOString(), settings },
      },
      vertices: state.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        properties: {
          x: Math.round(position(n.id).x),
          y: Math.round(position(n.id).y),
          description: n.title ? `${n.title} (${n.url})` : n.url,
          url: n.url,
          urlKey: n.urlKey,
          title: n.title,
          elements: n.elements, // sayılı küme ({ key, types, count }); state = settings'te işaretli türler
          screenshot: n.screenshot,
        },
      })),
      edges: state.edges.map((e) => ({
        id: e.id,
        name: e.name,
        sourceVertexId: e.source,
        targetVertexId: e.target,
        properties: {
          description: e.actions.map((a) => a.label).join(' → '),
          uiActions: e.actions, // tekrar oynatılacak tarayıcı aksiyonları (click, input, scroll...)
        },
      })),
    }],
    selectedModelIndex: 0,
    selectedElementId: null,
  };
}


// -----------------------------------------------------------------------------
// AYARLAR PENCERESİ: iki checklist (settings.js'teki listelerden)
// -----------------------------------------------------------------------------
// Kutular bir TASLAK'tır: işaretlemek hiçbir şeyi değiştirmez. "Kaydet" taslağı
// background'a gönderir; taslak kaydedilmiş ayarlardan farklıysa (kirliyse) buton
// aktiftir. Kirli taslakla pencere kapatılmak istenirse uyarı penceresi açılır.

const CHECKLISTS = [
  { id: 'settings-actions', key: 'disabledActions', items: ACTION_TYPES.map((a) => [a.type, a.text]) },
  { id: 'settings-interactables', key: 'disabledInteractables', items: INTERACTABLE_TYPES.map((t) => [t.selector, t.text]) },
];

for (const { id, items } of CHECKLISTS) {
  $(id).replaceChildren(...items.map(([value, text]) => {
    const label = document.createElement('label');
    label.innerHTML = '<input type="checkbox"> <span><b></b> <code></code></span>';
    label.querySelector('input').value = value;
    label.querySelector('b').textContent = text;
    label.querySelector('code').textContent = value;
    return label;
  }));
  $(id).onchange = renderSaveButton;
}

// Taslak: kutuların o anki hali (işareti kaldırılanlar).
function settingsFromChecklists() {
  return Object.fromEntries(CHECKLISTS.map(({ id, key }) =>
    [key, [...$(id).querySelectorAll('input:not(:checked)')].map((box) => box.value)]));
}

function isDirty() {
  const draft = settingsFromChecklists();
  const same = (a, b) => [...a].sort().join('\n') === [...b].sort().join('\n');
  return CHECKLISTS.some(({ key }) => !same(draft[key], settings[key]));
}

// Kutuları kaydedilmiş ayarlara eşitler (taslağı atar).
function loadDraft() {
  for (const { id, key } of CHECKLISTS) {
    for (const box of $(id).querySelectorAll('input')) box.checked = !settings[key].includes(box.value);
  }
  renderSaveButton();
}

function renderSaveButton() {
  const dirty = isDirty();
  $('btn-settings-save').disabled = !dirty;
  if (dirty) $('settings-saved').hidden = true;
}

async function saveSettings() {
  await send({ type: 'SET_SETTINGS', settings: settingsFromChecklists() });
  settings = { ...DEFAULT_SETTINGS, ...settingsFromChecklists() }; // storage bildirimi gelmeden buton doğru görünsün
  renderSaveButton();
  $('settings-saved').hidden = false;
}

// Kapatma isteği (✕, Esc, pencere dışına tıklama): taslak kirliyse önce uyarı.
function requestCloseSettings() {
  if (isDirty()) $('unsaved-dialog').showModal();
  else $('settings-dialog').close();
}

$('btn-settings').onclick = () => {
  loadDraft();
  $('settings-saved').hidden = true;
  $('settings-dialog').showModal();
};
$('btn-settings-save').onclick = saveSettings;
$('btn-settings-close').onclick = requestCloseSettings;
$('settings-dialog').oncancel = (event) => { // Esc
  event.preventDefault();
  requestCloseSettings();
};
$('settings-dialog').onclick = (event) => { // pencere dışı (karartılmış alan) tıklanınca hedef dialog'un kendisidir
  if (event.target === $('settings-dialog')) requestCloseSettings();
};
// Chrome, kullanıcı etkileşimi olmadan basılan Esc'te 'cancel'ı iptal ettirmeyebilir ve
// pencereyi doğrudan kapatır. Taslak kirliyken kapandıysa pencereyi uyarıyla geri aç.
$('settings-dialog').onclose = () => {
  if (!isDirty()) return;
  $('settings-dialog').showModal();
  $('unsaved-dialog').showModal();
};

$('btn-unsaved-save').onclick = async () => {
  await saveSettings();
  $('unsaved-dialog').close();
  $('settings-dialog').close();
};
$('btn-unsaved-discard').onclick = () => {
  loadDraft();
  $('unsaved-dialog').close();
  $('settings-dialog').close();
};
$('btn-unsaved-back').onclick = () => $('unsaved-dialog').close();


// -----------------------------------------------------------------------------
// BAŞLANGIÇ: state'i ve ayarları oku, sonra her değişiklikte yeniden çiz
// -----------------------------------------------------------------------------

chrome.storage.local.get(['state', 'settings']).then((r) => {
  state = r.state ?? EMPTY_STATE;
  settings = { ...DEFAULT_SETTINGS, ...r.settings };
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.state) {
    state = changes.state.newValue ?? EMPTY_STATE;
    render();
  }
  if (changes.settings) {
    // Kaydedilmiş ayarlar değişti. Açık pencerede taslak korunur, sadece buton güncellenir.
    settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    renderSaveButton();
  }
});
