// =============================================================================
// panel.js — ARAYÜZ (yan panel)
// -----------------------------------------------------------------------------
// Bu dosya state'i ASLA kendisi değiştirmez. Sadece:
//   - chrome.storage.local'daki state'i okuyup ekrana çizer,
//   - kullanıcı bir butona basınca background.js'e istek (mesaj) gönderir.
//
// Veri akışı tek yönlüdür:
//   buton -> mesaj -> background state'i değiştirir -> storage'a yazar
//         -> storage.onChanged tetiklenir -> render()
// =============================================================================

const $ = (id) => document.getElementById(id);

const EMPTY_STATE = { tabId: null, currentNodeId: null, startNodeId: null, nodes: [], edges: [], buffer: [], pending: null };

let state = EMPTY_STATE;
let selectedId = null;   // graph'ta tıklanan node/edge
let busy = false;        // "Node oluştur" isteği sürerken butonu kilitlemek için
let lastGraphKey = '';   // graph değişmediyse yeniden çizmemek için

// Aksiyon tiplerinin ekranda görünen adları
const ACTION_TEXT = { click: 'Tıkla', input: 'Yaz', enter: 'Enter', navigate: 'Git', history: 'Geri/İleri', reload: 'Yenile' };


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
      + (current ? current.name : 'seçili değil (bir node seçip "Buradan devam et"e bas)');
  }
  $('btn-node').disabled = busy || Boolean(state.pending);
}

function renderConfirm() {
  const pending = state.pending;
  $('confirm').hidden = !pending;
  if (!pending) return;
  const candidate = nodeById(pending.candidateId);
  $('confirm-text').textContent = `Bu sayfa mevcut "${candidate?.name}" node'una %${Math.round(pending.similarity * 100)} benziyor. Aynı state mi?`;
  $('confirm-old').src = candidate?.screenshot ?? '';
  $('confirm-new').src = pending.capture.screenshot;
}

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
  const value = action.type === 'input' ? ` = "${action.value}"` : '';
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

$('btn-same').onclick = () => send({ type: 'RESOLVE', useExisting: true });
$('btn-new').onclick = () => send({ type: 'RESOLVE', useExisting: false });

$('btn-save').onclick = () => send({ type: 'RENAME', id: selectedId, name: $('details-name').value });
$('details-name').onkeydown = (e) => { if (e.key === 'Enter') $('btn-save').click(); };
$('btn-continue').onclick = () => send({ type: 'SET_CURRENT', id: selectedId });
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
  const data = {
    format: 'graph-recorder/v1',
    exportedAt: new Date().toISOString(),
    startNodeId: state.startNodeId,
    nodes: state.nodes,
    edges: state.edges,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `graph-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};


// -----------------------------------------------------------------------------
// BAŞLANGIÇ: state'i oku, sonra her değişiklikte yeniden çiz
// -----------------------------------------------------------------------------

chrome.storage.local.get('state').then((r) => {
  state = r.state ?? EMPTY_STATE;
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.state) return;
  state = changes.state.newValue ?? EMPTY_STATE;
  render();
});
