// =============================================================================
// panel.js — ARAYÜZ (yan panel)
// -----------------------------------------------------------------------------
// Bu dosya state'i ve ayarları ASLA kendisi değiştirmez. Sadece:
//   - chrome.storage.local'daki aktif graph'ı (state), graph listesini ve ayarları okuyup ekrana çizer,
//   - kullanıcı bir butona / ayara basınca background.js'e istek (mesaj) gönderir.
//
// Veri akışı tek yönlüdür:
//   buton -> mesaj -> background state'i değiştirir -> storage'a yazar
//         -> storage.onChanged tetiklenir -> render()
// =============================================================================

const $ = (id) => document.getElementById(id);

const EMPTY_STATE = { id: null, tabId: null, tabs: [], tabPrompt: null, currentNodeId: null, startNodeId: null, nodes: [], edges: [], buffer: [], pending: null, undo: [], scenarios: [] };

let state = EMPTY_STATE;  // aktif graph (storage > graph:<id>)
let graphs = [];         // graph listesi (storage > graphs; background.js > GRAPH'LAR)
let activeGraphId = null;
let settings = DEFAULT_SETTINGS; // settings.js
let selectedId = null;   // graph'ta tıklanan node/edge
let busy = false;        // "Node oluştur" isteği sürerken butonu kilitlemek için
let lastGraphKey = '';   // graph değişmediyse yeniden çizmemek için

// Aksiyon tiplerinin ekranda görünen adları (settings.js). Bekleme listede yok: Ayarlar'da
// ayrı bir seçenektir ("Beklemeleri kaydet").
const ACTION_TEXT = { ...Object.fromEntries(ACTION_TYPES.map((a) => [a.type, a.text])), wait: 'Bekle' };


// -----------------------------------------------------------------------------
// GRAPH ÇİZİMİ (Cytoscape.js)
// -----------------------------------------------------------------------------

// Graph stili. Renkler panel.css'teki tema değişkenlerinden okunur; tema değişince
// (theme.js > 'themechange') stil yeniden kurulur.
function graphStyle() {
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  return [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        width: 96,
        height: 60,
        'background-color': color('--graph-node'),
        'background-image': 'data(screenshot)', // node'un içinde sayfanın küçük ekran görüntüsü
        'background-fit': 'cover',
        'border-width': 2,
        'border-color': color('--graph-node-border'),
        label: 'data(label)',
        color: color('--text'),
        'font-size': 11,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'text-background-color': color('--graph-label-bg'),
        'text-background-opacity': 0.9,
        'text-background-padding': 2,
      },
    },
    { selector: 'node.current', style: { 'border-color': color('--graph-current'), 'border-width': 4 } },
    {
      selector: 'edge',
      style: {
        width: 2,
        'line-color': color('--graph-edge'),
        'target-arrow-color': color('--graph-edge'),
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier', // paralel edge'leri ve self-loop'ları ayrı ayrı çizer
        label: 'data(label)',
        color: color('--text'),
        'font-size': 9,
        'text-rotation': 'autorotate',
        'text-background-color': color('--graph-label-bg'),
        'text-background-opacity': 0.9,
        'text-background-padding': 1,
      },
    },
    // Self-loop (aynı node'a dönen edge): node'un sağına, okunabilir büyüklükte çiz
    { selector: 'edge:loop', style: { 'loop-direction': '90deg', 'loop-sweep': '-50deg', 'control-point-step-size': 70 } },
    { selector: 'node:selected', style: { 'border-color': color('--primary'), 'border-width': 4 } },
    { selector: 'edge:selected', style: { 'line-color': color('--primary'), 'target-arrow-color': color('--primary'), width: 3 } },
    // Senaryo önizlemesi: seçili koşunun edge'leri (sıra numarasıyla), vardığı node ve elle
    // yolda oradan gidilebilecek edge'ler; diğer her şey soluk (bkz. renderScenario).
    { selector: '.faded', style: { opacity: 0.25 } },
    {
      selector: 'edge.run-edge',
      style: { width: 4, 'line-color': color('--graph-run'), 'target-arrow-color': color('--graph-run'), label: (e) => `${e.data('label')} · ${e.data('order')}` },
    },
    { selector: 'edge.run-next', style: { 'line-style': 'dashed', 'line-color': color('--graph-run'), 'target-arrow-color': color('--graph-run') } },
    { selector: 'node.run-end', style: { 'border-color': color('--graph-run'), 'border-width': 4 } },
    { selector: 'node.run-start', style: { 'border-color': color('--graph-run'), 'border-width': 6, 'border-style': 'double' } },
    // Panelde oynatma: geçen edge'ler ve varılan node'lar yeşil, oynatılan edge kesik çizgili,
    // kalınan edge ve beklenen node kırmızı (bkz. renderReplay).
    { selector: 'edge.replay-passed', style: { 'line-color': color('--graph-pass'), 'target-arrow-color': color('--graph-pass') } },
    { selector: 'node.replay-passed', style: { 'border-color': color('--graph-pass'), 'border-width': 4 } },
    { selector: 'edge.replay-running', style: { 'line-style': 'dashed', width: 5 } },
    { selector: 'edge.replay-failed', style: { 'line-color': color('--graph-fail'), 'target-arrow-color': color('--graph-fail'), width: 5 } },
    { selector: 'node.replay-failed', style: { 'border-color': color('--graph-fail'), 'border-width': 4 } },
  ];
}

const cy = cytoscape({
  container: $('graph'),
  minZoom: 0.2,
  maxZoom: 2,
  style: graphStyle(),
});

// Tema: sağ üstteki ay/güneş butonu. Seçim localStorage'a yazılır (theme.js).
function renderThemeButton() {
  const label = document.documentElement.dataset.theme === 'dark' ? 'Aydınlık moda geç' : 'Karanlık moda geç';
  $('btn-theme').title = label;
  $('btn-theme').setAttribute('aria-label', label);
}

$('btn-theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // depolama kapalıysa seçim sadece bu oturumda geçerli
  }
  applyTheme(next);
};

document.addEventListener('themechange', () => {
  cy.style(graphStyle());
  renderThemeButton();
});
renderThemeButton();

cy.on('tap', (event) => {
  if (scenarioEditing() && !replay && event.target !== cy && event.target.isEdge()) return addScenarioEdge(event.target.id());
  selectedId = event.target === cy ? null : event.target.id(); // boşluğa tıklayınca seçimi kaldır
  renderDetails();
});

// Çizilen graph: ana graph ya da senaryo görünümünde seçili senaryonun graph'ı (kopya; bkz.
// GÖRÜNÜM). Kopyada ekran görüntüsü yoktur, node id'siyle ana graph'tan okunur.
function viewGraph() {
  if (scenarioView && scenario.id) {
    const copy = scenario.graph ?? scenarioSnapshot(scenarioGraph(), scenario.runs);
    return { key: `scenario:${scenario.id}`, start: copy.start, current: null, nodes: copy.nodes, edges: copy.edges };
  }
  return { key: 'main', start: state.startNodeId, current: state.currentNodeId, nodes: state.nodes, edges: state.edges };
}

function renderGraph() {
  // Her aksiyonda storage değişir ama graph değişmeyebilir; gereksiz yeniden çizimden kaçın.
  const graph = viewGraph();
  const key = JSON.stringify([
    state.id,
    graph.key,
    graph.current,
    graph.nodes.map((n) => [n.id, n.name, Boolean(nodeById(n.id)?.screenshot)]),
    graph.edges.map((e) => [e.id, e.name, e.source, e.target]),
  ]);
  if (key === lastGraphKey) return;
  lastGraphKey = key;

  $('graph').classList.toggle('scenario-view', graph.key !== 'main');
  cy.elements().remove();
  cy.add([
    ...graph.nodes.map((n) => ({
      data: { id: n.id, label: n.name, screenshot: nodeById(n.id)?.screenshot ?? 'none' },
      classes: n.id === graph.current ? 'current' : '',
    })),
    ...graph.edges.map((e) => ({ data: { id: e.id, label: e.name, source: e.source, target: e.target } })),
  ]);

  // 'breadthfirst': başlangıç node'u en üstte, ondan ulaşılanlar alt satırlarda.
  cy.layout({
    name: 'breadthfirst',
    directed: true,
    roots: graph.start && cy.getElementById(graph.start).nonempty() ? '#' + graph.start : undefined,
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
  renderGraphs();
  renderStatus();
  renderTabPrompt();
  renderConfirm();
  renderViewTabs();
  renderGraph();
  renderScenario();
  renderDetails();
  renderBuffer();
  renderUndo();
}

function renderStatus() {
  const current = nodeById(state.currentNodeId);
  if (state.nodes.length === 0) {
    $('status').textContent = 'Kayıt başlamadı. Graph\'ını çıkarmak istediğin sayfaya git ve "Node oluştur"a bas.';
  } else {
    $('status').textContent = `${state.nodes.length} node · ${state.edges.length} edge · Şu an: `
      + (current ? current.name : 'seçili değil (bir node seçip "Buradan devam et"e bas)')
      + (state.tabs.length > 1 ? ` · ${state.tabs.length} sekme` : '')
      + (state.tabId === null ? ' · Kayıt sekmesi kapandı: şu anki node\'un ekranındaki bir sekmede soruya "Evet" de ya da bir node seçip "Buradan devam et"e bas.' : '');
  }
  if (settings.recordWaits) $('status').textContent += ` · Beklemeler kaydediliyor (en az ${seconds(settings.minWaitSeconds * 1000)})`;
  // İlk node dışında, bekleyen aksiyon yoksa node oluşturulamaz (aksiyonsuz edge tekrar oynatılamaz).
  // Beklemeler kaydediliyorsa ekran beklerken değişmiş olabilir; karar background'ındır.
  const noActions = state.nodes.length > 0 && state.buffer.length === 0 && !settings.recordWaits;
  $('btn-node').disabled = busy || Boolean(state.pending) || noActions || Boolean(replay);
  $('btn-node').title = replay ? 'Panelde oynatma sürüyor.' : noActions ? 'Bekleyen aksiyon yok: önce sayfada bir aksiyon yap.' : '';
}

// Kayda katılmamış sekme sorusu (background.js > SEKMELER). Sekmeyi kayıt sekmesi açtıysa
// (link, popup) akışın devamı olması muhtemeldir; metin bunu söyler.
function renderTabPrompt() {
  const prompt = state.tabPrompt;
  $('tab-prompt').hidden = !prompt;
  if (!prompt) return;
  $('tab-prompt-text').textContent = state.tabId === null
    ? `Kayıt sekmesi yok (kapandı ya da graph değişti). Bu sekme şu anki node'un${nodeById(state.currentNodeId) ? ` ("${nodeById(state.currentNodeId).name}")` : ''} ekranındaysa kayıt burada sürsün mü?`
    : prompt.openedByPage
      ? 'Kayıt sekmesinin açtığı bir sekmedesiniz. Grafa bu sekmede devam edilsin mi?'
      : 'Farklı bir sekmedesiniz. Grafa bu sekmede devam edilsin mi? "Hayır" derseniz bu sekmedeki aksiyonlar kaydedilmez, kayıt eski sekmeye dönünce sürer.';
  $('tab-prompt-url').textContent = [prompt.title, prompt.url].filter(Boolean).join(' · ');
}

$('btn-tab-follow').onclick = () => send({ type: 'RESOLVE_TAB', follow: true });
$('btn-tab-decline').onclick = () => send({ type: 'RESOLVE_TAB', follow: false });

// Eşleşen her node bir seçenek: ekran görüntüsü, ismi ve "Evet, bu node" butonu.
// Kart her storage değişikliğinde (ör. gelen aksiyon) yeniden kurulmasın diye anahtar tutulur.
let lastConfirmKey = '';

function renderConfirm() {
  const pending = state.pending;
  $('confirm').hidden = !pending;
  if (!pending) {
    lastConfirmKey = '';
    diffCache.clear();
    if ($('compare-dialog').open) $('compare-dialog').close(); // soru başka yoldan cevaplandı
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
  figure.innerHTML = '<img alt=""><figcaption></figcaption><small class="diff-ratio"></small>'
    + '<button class="primary">Evet, bu node</button><button class="compare">Karşılaştır</button>';
  figure.querySelector('img').src = node.screenshot;
  figure.querySelector('figcaption').textContent = node.name + (node.id === state.currentNodeId ? ' (şu anki node)' : '');
  figure.querySelector('.primary').onclick = () => chooseCandidate(node);
  figure.querySelector('.compare').onclick = () => openCompareDialog(node.id);
  visualDiff(node).then((result) => {
    figure.querySelector('.diff-ratio').textContent = result ? `Görsel fark: ${percent(result.ratio)}` : '';
  });
  return figure;
}

// Şu anki node seçilirse edge kendine döner; önce bunun mu yoksa hiç kaydetmemenin mi
// istendiği sorulur. Diğer adaylarda edge doğrudan o node'a çizilir.
function chooseCandidate(node) {
  if (node.id === state.currentNodeId) openLoopDialog(node);
  else send({ type: 'RESOLVE', targetId: node.id });
}


// -----------------------------------------------------------------------------
// GÖRSEL KARŞILAŞTIRMA: şu anki sayfa ↔ aday node (compare.js)
// -----------------------------------------------------------------------------
// Adayların edge set'i şu anki sayfayla zaten aynıdır; kullanıcı etkileşimli olmayan farka
// bakarak karar verir. Karttaki her adayın altında görsel fark oranı, "Karşılaştır" ile geniş
// pencere: Fark (farklı pikseller ve bölgeler), Perde (sürgüyle iki görüntü), Yan yana.

// Sonuçlar soru değişene kadar saklanır (kart her storage değişikliğinde yeniden çizilebilir).
const diffCache = new Map();

function visualDiff(node) {
  const capture = state.pending?.capture;
  if (!capture?.screenshot || !node.screenshot) return Promise.resolve(null);
  const key = `${capture.url}|${capture.screenshot.length}|${node.id}`;
  if (!diffCache.has(key)) diffCache.set(key, compareScreenshots(capture.screenshot, node.screenshot).catch(() => null));
  return diffCache.get(key);
}

// "%2,3"; sıfır değil ama %0,1'den küçükse "<%0,1" (küçük bir fark "fark yok" gibi okunmasın)
function percent(ratio) {
  if (ratio > 0 && ratio < 0.001) return '<%0,1';
  return `%${(ratio * 100).toFixed(1).replace('.', ',')}`;
}

let compareNodeId = null;
let compareMode = 'diff';

function openCompareDialog(nodeId) {
  compareNodeId = nodeId;
  renderCompare();
  $('compare-dialog').showModal();
}

async function renderCompare() {
  const pending = state.pending;
  const node = nodeById(compareNodeId);
  if (!pending || !node) return $('compare-dialog').close();
  const candidates = pending.candidateIds.map(nodeById).filter(Boolean);
  $('compare-candidates').replaceChildren(...candidates.map((candidate) => {
    const button = document.createElement('button');
    button.textContent = candidate.name;
    button.classList.toggle('active', candidate.id === node.id);
    button.onclick = () => { compareNodeId = candidate.id; renderCompare(); };
    visualDiff(candidate).then((result) => { if (result) button.textContent = `${candidate.name} · ${percent(result.ratio)}`; });
    return button;
  }));
  for (const button of $('compare-modes').querySelectorAll('button')) button.classList.toggle('active', button.dataset.mode === compareMode);
  $('btn-compare-yes').textContent = node.id === state.currentNodeId ? 'Evet, bu node (şu anki node)' : 'Evet, bu node';

  const [result, current, other] = await Promise.all([visualDiff(node), loadImage(pending.capture.screenshot), loadImage(node.screenshot)]);
  if (compareNodeId !== node.id || state.pending !== pending) return; // bu arada başka aday seçildi
  $('compare-info').textContent = result
    ? `Görsel fark: ${percent(result.ratio)} · ${result.boxes.length ? `${result.boxes.length} farklı bölge` : 'farklı bölge yok'}`
    : 'Görsel fark hesaplanamadı.';
  $('compare-warnings').replaceChildren(...compareWarnings(pending.capture, node, result).map((text) =>
    Object.assign(document.createElement('li'), { textContent: text })));
  $('compare-view').replaceChildren(...compareView(current, other, node, result));
}

// Görsel farka girmeyen ama karar için önemli farklar ve karşılaştırmayı yanıltabilecek durumlar.
function compareWarnings(capture, node, result) {
  const warnings = [];
  if (capture.url !== node.url) warnings.push(`Adres farklı: ${capture.url} ↔ ${node.url}`);
  if (capture.title !== node.title) warnings.push(`Sayfa başlığı farklı: "${capture.title}" ↔ "${node.title}"`);
  if (capture.viewport && node.viewport && viewportText(capture.viewport) !== viewportText(node.viewport)) {
    warnings.push(`Görünen alanlar farklı (${viewportText(capture.viewport)} ↔ ${viewportText(node.viewport)}): aynı içerik farklı yerde durabilir, görsel fark yanıltıcı olabilir.`);
  } else if (result && !result.sameSize) {
    warnings.push('Ekran görüntülerinin boyutu farklı: görsel fark yanıltıcı olabilir.');
  }
  return warnings;
}

function compareView(current, other, node, result) {
  if (compareMode === 'slider') {
    const curtain = document.createElement('div');
    curtain.className = 'curtain';
    const under = Object.assign(document.createElement('img'), { src: other.src, alt: node.name });
    const over = Object.assign(document.createElement('img'), { src: current.src, alt: 'Şu anki sayfa', className: 'over' });
    const range = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 100, value: 50 });
    range.setAttribute('aria-label', 'Perde');
    const clip = () => { over.style.clipPath = `inset(0 ${100 - range.value}% 0 0)`; };
    range.oninput = clip;
    clip();
    curtain.append(under, over);
    const labels = document.createElement('div');
    labels.className = 'curtain-labels';
    labels.innerHTML = '<span>← Şu anki sayfa</span><span></span>';
    labels.lastChild.textContent = `${node.name} →`;
    return [curtain, range, labels];
  }
  if (!result) return [Object.assign(document.createElement('img'), { src: current.src, alt: '' })];
  if (compareMode === 'side') {
    const grid = document.createElement('div');
    grid.className = 'compare-side';
    for (const [img, caption] of [[current, 'Şu anki sayfa'], [other, node.name]]) {
      const figure = document.createElement('figure');
      const canvas = document.createElement('canvas');
      drawWithBoxes(canvas, img, result);
      figure.append(canvas, Object.assign(document.createElement('figcaption'), { textContent: caption }));
      grid.append(figure);
    }
    return [grid];
  }
  const figure = document.createElement('figure');
  const canvas = document.createElement('canvas');
  drawDifference(canvas, current, result);
  figure.append(canvas, Object.assign(document.createElement('figcaption'), {
    textContent: `Şu anki sayfa, ${node.name} ile farkı: kırmızı farklı pikseller, turuncu kutu farklı bölgeler.`,
  }));
  return [figure];
}

for (const button of $('compare-modes').querySelectorAll('button')) {
  button.onclick = () => { compareMode = button.dataset.mode; renderCompare(); };
}
$('btn-compare-yes').onclick = () => {
  const node = nodeById(compareNodeId);
  $('compare-dialog').close();
  if (node) chooseCandidate(node);
};
$('btn-compare-close').onclick = () => $('compare-dialog').close();
$('btn-compare-cancel').onclick = () => $('compare-dialog').close();

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

// Seçili node / edge'in detayı. Senaryo görünümünde kopyadan, salt okunur: ad değişmez, aksiyon
// silinmez; "Ana graph'ta göster" aynı öğeyi ana graph'ta açar. Ana graph görünümünde öğeyi
// koşularında kullanan senaryolar listelenir.
function renderDetails() {
  const graph = viewGraph();
  const readOnly = graph.key !== 'main';
  const node = graph.nodes.find((n) => n.id === selectedId);
  const edge = graph.edges.find((e) => e.id === selectedId);
  const item = node || edge;
  $('details').hidden = !item;
  if (!item) return;
  const nameOf = (id) => graph.nodes.find((n) => n.id === id)?.name ?? id;

  $('details-title').textContent = (node ? 'Node' : 'Edge') + (readOnly ? ` · "${scenario.name}" senaryosunda` : '');
  $('details-subtitle').textContent = node
    ? node.url + (node.viewport ? ' · ' + viewportText(node.viewport) : '')
    : `${nameOf(edge.source)} → ${nameOf(edge.target)} · ${edge.actions.length} aksiyon`
    + (edge.recordedActions ? ` · düzenlendi (kayıtta ${edge.recordedActions.length})` : '');
  // Kullanıcı o an yazıyorsa input'u ezme
  if (document.activeElement !== $('details-name')) $('details-name').value = item.name;
  $('details-name').readOnly = readOnly;

  const shot = node && nodeById(node.id)?.screenshot;
  $('details-shot').hidden = !shot;
  if (shot) $('details-shot').src = shot;
  $('details-noshot').hidden = !node || Boolean(shot);
  $('details-actions').replaceChildren(...(edge ? (readOnly ? edge.actions.map(actionItem) : editableActionItems(edge)) : []));
  $('details-actions-head').hidden = !edge;
  if (edge) applyActionFilter($('details-actions'), edge.actions, 'details', renderDetails);
  renderDetailsScenarios(item, readOnly);
  $('btn-show-main').hidden = !readOnly;
  for (const id of ['btn-save', 'btn-delete']) $(id).hidden = readOnly;
  $('btn-continue').hidden = !node || readOnly;
  $('btn-merge').hidden = !node || readOnly;
  $('btn-merge').disabled = state.nodes.length < 2 || Boolean(state.pending);
  $('btn-merge').title = state.pending ? 'Önce bekleyen "aynı node mu?" sorusunu cevaplayın' : 'Bu node\'u aynı edge set\'e sahip başka bir node ile birleştir';
}


// -----------------------------------------------------------------------------
// NODE BİRLEŞTİRME
// -----------------------------------------------------------------------------
// Uygunluk, background'daki kuralla aynıdır: URL şablonu ve edge set'i (şu anki ayarlarla)
// birebir aynı olmalı. Background isteği ayrıca doğrular. Tekrar eden edge'lere dokunulmaz.

let mergeSourceId = null;

function mergeIssue(a, b) {
  if (a.urlKey !== b.urlKey) return 'URL şablonu farklı';
  const ca = stateCounts(a.elements, settings);
  const cb = stateCounts(b.elements, settings);
  if (!ca || !cb) return 'eski kayıt biçimi: karşılaştırılamaz';
  return sameCounts(ca, cb) ? null : "edge set farklı: " + countMismatch(ca, cb);
}

// İki sayılı kümenin farkı, en fazla 3 tür: "button:Sil 5 ≠ 4, a:menu 1 ≠ 0" (settings.js > diffCounts)
function countMismatch(a, b) {
  const diff = diffCounts(a, b);
  return diff.slice(0, 3).map(({ key, a: n, b: m }) => `${key} ${n} ≠ ${m}`).join(', ')
    + (diff.length > 3 ? ` (+${diff.length - 3})` : '');
}

function openMergeDialog(node) {
  mergeSourceId = node.id;
  $('merge-title').textContent = `"${node.name}" node'unu birleştir`;
  $('merge-options').replaceChildren(...state.nodes.filter((n) => n.id !== node.id).map((other) => {
    const issue = mergeIssue(node, other);
    const label = document.createElement('label');
    label.className = 'merge-option' + (issue ? ' disabled' : '');
    label.innerHTML = '<input type="radio" name="merge-with"> <img alt=""> <span><b></b><small></small></span>';
    label.querySelector('input').value = other.id;
    label.querySelector('input').disabled = Boolean(issue);
    label.querySelector('img').src = other.screenshot;
    label.querySelector('b').textContent = other.name;
    label.querySelector('small').textContent = issue ?? 'birleştirilebilir';
    return label;
  }));
  $('merge-keep').hidden = true;
  $('merge-warnings').replaceChildren();
  $('btn-merge-confirm').disabled = true;
  $('merge-dialog').showModal();
}

// Aday seçilince: hangi node kalsın (varsayılan önce oluşturulan) ve uyarılar
$('merge-options').onchange = () => {
  const node = nodeById(mergeSourceId);
  const other = nodeById($('merge-options').querySelector('input:checked')?.value);
  if (!node || !other) return;
  const ordered = state.nodes.indexOf(node) < state.nodes.indexOf(other) ? [node, other] : [other, node];
  $('merge-keep-options').replaceChildren(...ordered.map((n, i) => {
    const label = document.createElement('label');
    label.innerHTML = '<input type="radio" name="merge-keep"> <span></span>';
    label.querySelector('input').value = n.id;
    label.querySelector('input').checked = i === 0;
    label.querySelector('span').textContent = n.name + (i === 0 ? ' (önce oluşturulan)' : '');
    return label;
  }));
  $('merge-keep').hidden = false;

  // Edge set'ler yalnızca Ayarlar'da kapalı türler yüzünden mi eşit? (tüm türlerle karşılaştır)
  const all = [stateCounts(node.elements, DEFAULT_SETTINGS), stateCounts(other.elements, DEFAULT_SETTINGS)];
  const hidden = all.every(Boolean) && !sameCounts(...all) ? countMismatch(...all) : null;
  $('merge-warnings').replaceChildren(...(hidden ? [Object.assign(document.createElement('li'), {
    textContent: `Edge set'ler yalnızca Ayarlar'da kapalı türler yüzünden eşit (${hidden}). O türler tekrar açılırsa fark geri gelir ama node tek kalır.`,
  })] : []));
  $('btn-merge-confirm').disabled = false;
};

$('btn-merge').onclick = () => openMergeDialog(nodeById(selectedId));
$('btn-merge-cancel').onclick = () => $('merge-dialog').close();
$('btn-merge-close').onclick = () => $('merge-dialog').close();
$('btn-merge-confirm').onclick = () => {
  const keepId = $('merge-keep-options').querySelector('input:checked').value;
  const otherId = $('merge-options').querySelector('input:checked').value;
  const removeId = keepId === mergeSourceId ? otherId : mergeSourceId;
  $('merge-dialog').close();
  if (selectedId === removeId) selectedId = keepId; // detay kartı kalan node'u göstersin
  send({ type: 'MERGE_NODES', keepId, removeId });
};


// -----------------------------------------------------------------------------
// EDGE DÜZENLEME: aksiyon silme (en az bir aksiyon kalır) ve geri alma
// -----------------------------------------------------------------------------
// Her aksiyon kayıt sırasında "state'i değiştirdi mi?" diye işaretlenir (changed; bkz.
// background.js > observeScreen). İşaret yoksa (bu özellikten önce kaydedilmiş edge) ya da
// aksiyonun sonrası görülemediyse (null) etki "bilinmiyor"dur. Otomatik eklenen bekleme
// (background.js > withAutoWaits) ölçülmez, "otomatik eklendi" diye ayrı gösterilir.

const EFFECT_TEXT = { changed: 'ekranı değiştirdi', unchanged: 'ekranı değiştirmedi', unknown: 'etkisi bilinmiyor', waiting: 'etkisi bekleniyor', auto: 'otomatik eklendi' };

function effectOf(action) {
  if (action.auto) return 'auto';
  return action.changed === true ? 'changed' : action.changed === false ? 'unchanged' : 'unknown';
}

// Aksiyon satırına etki işaretini ekler: "ekranı değiştirdi" gibi
function addEffectBadge(li, effect) {
  const badge = document.createElement('span');
  badge.className = 'effect ' + effect;
  badge.textContent = EFFECT_TEXT[effect];
  li.querySelector('span').after(badge);
}

function editableActionItems(edge) {
  return edge.actions.map((action, i) => {
    const li = actionItem(action);
    li.classList.add('editable');
    addEffectBadge(li, effectOf(action));
    if (action.type === 'wait') {
      addWaitEdit(li, action, `edge:${edge.id}:${i}`, renderDetails, (ms) => send({ type: 'SET_WAIT', edgeId: edge.id, index: i, ms }));
    }

    const remove = document.createElement('button');
    remove.className = 'icon delete-action';
    remove.textContent = '✕';
    remove.disabled = edge.actions.length === 1;
    remove.title = remove.disabled ? "Edge'de en az bir aksiyon kalmalı" : 'Aksiyonu sil';
    remove.setAttribute('aria-label', remove.title);
    remove.onclick = () => requestRemoveAction(edge, i);
    li.append(remove);
    return li;
  });
}

// BEKLEME SÜRESİ (bekleyen aksiyonlarda ve edge'de; background.js > setWait): ✎ süreyi satırda
// saniye kutusuna çevirir; Enter ya da odaktan çıkmak kaydeder, Esc vazgeçer. Liste düzenleme
// sürerken yeniden çizilebilir (yeni aksiyon, ekran bildirimi): düzenlenen bekleme (key) ve
// yazılan değer waitEdit'te durur, kutu yeniden çizilince kaldığı yerden sürer.
let waitEdit = null; // { key, value }

function addWaitEdit(li, action, key, redraw, save) {
  const span = li.querySelector('span');
  if (waitEdit?.key !== key) {
    const edit = iconButton('✎', 'Bekleme süresini değiştir', () => {
      waitEdit = { key, value: String(action.ms / 1000) }; // yuvarlanmasın: 10 ms '0.0' olup 0'a kaydedilmesin
      redraw();
    });
    edit.classList.add('edit-wait');
    span.after(edit);
    return;
  }
  const input = Object.assign(document.createElement('input'), { type: 'number', min: '0', max: '3600', step: '0.001', value: waitEdit.value, className: 'wait-input' });
  input.setAttribute('aria-label', 'Bekleme süresi (sn)');
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    waitEdit = null;
    const ms = Math.round(Number(input.value) * 1000);
    if (keep && input.value !== '' && ms !== action.ms) save(ms);
    redraw();
  };
  input.oninput = () => { if (waitEdit?.key === key) waitEdit.value = input.value; };
  input.onkeydown = (event) => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  };
  input.onblur = () => input.isConnected && finish(true); // yeniden çizilirken kaldırılan kutu kaydetmez
  span.replaceChildren(`${action.label} → `, input, ' sn');
  queueMicrotask(() => input.focus());
}

// Silme isteği: ekranı değiştirmemiş aksiyon doğrudan silinir (geri alınabilir). Ekranı
// değiştirmiş ya da etkisi bilinmeyen aksiyon için önce gerekçeli uyarı gösterilir.
function requestRemoveAction(edge, i) {
  confirmRemoval(`"${edge.actions[i].label}" aksiyonu silinirse edge tekrar oynatılamayabilir:`, removalRisks(edge, i),
    () => send({ type: 'REMOVE_ACTION', edgeId: edge.id, index: i }));
}

function confirmRemoval(text, reasons, remove) {
  if (!reasons.length) return remove();
  $('delete-action-text').textContent = text;
  $('delete-action-reasons').replaceChildren(...reasons.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  $('btn-delete-action-confirm').onclick = () => {
    $('delete-action-dialog').close();
    remove();
  };
  $('delete-action-dialog').showModal();
}

function removalRisks(edge, i) {
  const effect = effectOf(edge.actions[i]);
  if (effect === 'unchanged' || effect === 'auto') return [];
  if (effect === 'unknown') {
    return ['Bu aksiyonun ekrana etkisi bilinmiyor (eski bir kayıt ya da aksiyonun sonrası görülmeden başka bir aksiyon yapıldı).'];
  }

  const reasons = ['Bu aksiyon ekranı (etkileşimli element kümesini) değiştirmişti.'];
  if (i === edge.actions.findLastIndex((a) => !a.auto)) { // otomatik bekleme sonda olsa da
    reasons.push(`Edge'in son aksiyonu: edge'i hedef node'un (${nodeById(edge.target)?.name}) ekranına götüren aksiyon bu. Silinirse edge o ekrana varmaz.`);
  }
  return reasons;
}

$('btn-delete-action-cancel').onclick = () => $('delete-action-dialog').close();


// -----------------------------------------------------------------------------
// GERİ AL: son silme (node, edge ya da edge'den aksiyon). Buton ya da Ctrl+Z.
// -----------------------------------------------------------------------------

function undoText(entry) {
  if (entry.kind === 'node') return `"${entry.node.name}" node'unun silinmesini geri al`;
  if (entry.kind === 'edge') return `"${entry.edge.name}" edge'inin silinmesini geri al`;
  if (entry.kind === 'merge') return `"${entry.node.name}" node'unun birleştirilmesini geri al`;
  if (entry.kind === 'wait') return `Bekleme süresinin değişmesini geri al (${seconds(entry.action.ms)})`;
  return `"${entry.action.label}" aksiyonunun silinmesini geri al`;
}

function renderUndo() {
  const last = state.undo?.at(-1);
  $('btn-undo').disabled = !last;
  $('btn-undo').title = last ? `${undoText(last)} (Ctrl+Z)` : 'Geri alınacak bir silme yok';
}

$('btn-undo').onclick = () => send({ type: 'UNDO' });

// Ctrl+Z (Mac'te Cmd+Z). Bir metin alanında (ör. isim) yazarken tarayıcının kendi geri
// alması çalışsın; açık bir pencere (dialog) varken de graph geri alınmasın.
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
  if (event.target.closest('input, textarea') || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  if (state.undo?.length) send({ type: 'UNDO' });
});

// Bekleyen aksiyon node oluşturulmadan silinebilir (yalnızca silme; geri alınmaz). Karar
// beklerken ve oynatma sürerken silinmez (background.js > removeBuffered).
// Etki işareti edge'dekiyle aynıdır; sayfa henüz durulmadıysa (changed yok) "etkisi bekleniyor".
function renderBuffer() {
  $('buffer-count').textContent = state.buffer.length;
  const locked = Boolean(state.pending) || Boolean(replay);
  $('buffer').replaceChildren(...state.buffer.map((action, i) => {
    const li = actionItem(action);
    addEffectBadge(li, action.changed === undefined ? 'waiting' : effectOf(action));
    if (locked) return li;
    li.classList.add('editable');
    if (action.type === 'wait') {
      addWaitEdit(li, action, `buffer:${action.time}`, renderBuffer, (ms) => send({ type: 'SET_BUFFERED_WAIT', index: i, time: action.time, ms }));
    }
    const remove = document.createElement('button');
    remove.className = 'icon delete-action';
    remove.textContent = '✕';
    remove.title = 'Aksiyonu sil';
    remove.setAttribute('aria-label', remove.title);
    remove.onclick = () => confirmRemoval(`"${action.label}" aksiyonu silinirse oluşturulacak edge tekrar oynatılamayabilir:`,
      bufferRemovalRisks(action), () => send({ type: 'REMOVE_BUFFERED', index: i, time: action.time }));
    li.append(remove);
    return li;
  }));
  applyActionFilter($('buffer'), state.buffer, 'buffer', renderBuffer);
}

// -----------------------------------------------------------------------------
// AKSİYON FİLTRESİ: edge detayında ve "Bekleyen aksiyonlar"da işaretlenen türler gizlenir
// -----------------------------------------------------------------------------
// Yalnızca gösterimdir: aksiyon silinmez, oynatma ve dışa aktarma etkilenmez. Görünen satırlar
// listedeki asıl sıra numarasını korur (1, 4, 5). Otomatik bekleme kaydedilen beklemeden ayrı
// bir türdür. İki listenin ayrı filtresi vardır; edge filtresi bütün edge'lerde geçerlidir.
// Seçim bu tarayıcıda hatırlanır (localStorage).
const ACTION_FILTER_KEY = 'actionFilters';
const actionFilters = loadActionFilters(); // { details: Set, buffer: Set } — gizlenen türler

function loadActionFilters() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(ACTION_FILTER_KEY)) ?? {};
  } catch {
    // depolama kapalı ya da bozuk: filtre boş başlar
  }
  return { details: new Set(saved.details ?? []), buffer: new Set(saved.buffer ?? []) };
}

function saveActionFilters() {
  try {
    localStorage.setItem(ACTION_FILTER_KEY, JSON.stringify({ details: [...actionFilters.details], buffer: [...actionFilters.buffer] }));
  } catch {
    // depolama kapalıysa seçim sadece bu oturumda geçerli
  }
}

function filterKey(action) {
  return action.type === 'wait' && action.auto ? 'wait:auto' : action.type;
}

function filterText(key) {
  return key === 'wait:auto' ? 'Bekle (otomatik)' : ACTION_TEXT[key] ?? key;
}

// list: çizilmiş liste (her aksiyona bir satır, aynı sırada); name: 'details' | 'buffer' (kutunun
// id'si name-filter); redraw: işaret değişince listeyi yeniden çizer. Kutuda yalnızca listede
// bulunan türler çıkar.
function applyActionFilter(list, actions, name, redraw) {
  const hidden = actionFilters[name];
  [...list.children].forEach((li, i) => {
    li.value = i + 1;
    li.hidden = hidden.has(filterKey(actions[i]));
  });
  const count = actions.filter((a) => hidden.has(filterKey(a))).length;
  const box = $(name + '-filter');
  box.classList.toggle('active', count > 0);
  box.querySelector('summary').textContent = count ? `Filtrele · ${count} gizli` : 'Filtrele';
  const keys = [...new Set(actions.map(filterKey))];
  const options = keys.map((key) => {
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: hidden.has(key), value: key });
    input.onchange = () => {
      if (input.checked) hidden.add(key);
      else hidden.delete(key);
      saveActionFilters();
      redraw();
    };
    const label = document.createElement('label');
    label.append(input, filterText(key));
    return label;
  });
  const hint = Object.assign(document.createElement('p'), { className: 'muted small', textContent: keys.length ? 'İşaretlenenler gizlenir:' : 'Listede aksiyon yok.' });
  box.querySelector('.filter-menu').replaceChildren(hint, ...options);
}

// Kutu dışına tıklayınca kapanır. İşaret değişince kutu yeniden çizildiği için tıklanan satır
// artık sayfada değildir; yol olayın başındaki haliyle (composedPath) kontrol edilir.
document.addEventListener('click', (event) => {
  for (const box of document.querySelectorAll('.action-filter[open]')) {
    if (!event.composedPath().includes(box)) box.open = false;
  }
});

// Ekranı değiştirmemiş aksiyon doğrudan silinir; diğerlerinde gerekçeli uyarı (edge düzenleme gibi).
function bufferRemovalRisks(action) {
  const reasons = [];
  if (action.changed === true) reasons.push("Bu aksiyon ekranı (etkileşimli element kümesini) değiştirmişti. Silinirse edge tekrar oynatılınca oluşturulacak node'un ekranına varmayabilir.");
  else if (action.changed === undefined) reasons.push('Bu aksiyonun ekrana etkisi henüz görülmedi (sayfa durulmadı).');
  else if (action.changed === null) reasons.push('Bu aksiyonun ekrana etkisi bilinmiyor (aksiyonun sonrası görülmeden başka bir aksiyon yapıldı).');
  if (action.type === 'tab') reasons.push('Sekme aksiyonu: silinirse oynatma sonraki aksiyonları başka bir sekmede yapabilir.');
  return reasons;
}

// Tek bir aksiyonu liste satırı olarak gösterir: "Tıkla  Login   #login-button"
function actionItem(action) {
  const li = document.createElement('li');
  const value = action.type === 'input' ? ` = "${action.value}"`
    : action.type === 'scroll' ? ` → ${action.x}, ${action.y}`
      : action.type === 'zoom' ? ` → %${Math.round(action.zoom * 100)}`
        : action.type === 'resize' ? ` → ${viewportText(action.viewport)}`
          : action.type === 'wait' ? ` → ${seconds(action.ms)}`
            : action.type === 'tab' && action.by === 'page' ? ' · önceki aksiyon açtı'
              : action.type === 'clipboard' && action.blocked ? ' · sayfa engelledi'
                : action.type === 'contextmenu' && action.blocked ? ' · sayfanın kendi menüsü' : '';
  li.innerHTML = '<b></b> <span></span> <code></code>';
  li.querySelector('b').textContent = ACTION_TEXT[action.type] ?? action.type;
  li.querySelector('span').textContent = action.label + value;
  // Hedef state ile aynı düzeyde ("button:Sil #2" = ekrandaki 2. Sil); selector yedek
  const target = action.target?.index ? `${action.target.key} #${action.target.index} · ` : '';
  li.querySelector('code').textContent = target + (action.selector ?? action.url);
  return li;
}

// Süre: "3,2 sn"; 1 sn'den kısaysa "10 ms" (otomatik bekleme)
function seconds(ms) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} sn`;
}

// Sayfanın görünen alanı, CSS piksel: "1280×720"; piksel oranı 1 değilse "1280×720 @1.25x"
function viewportText({ width, height, devicePixelRatio }) {
  const scale = Math.round(devicePixelRatio * 100) / 100;
  return `${width}×${height}` + (scale !== 1 ? ` @${scale}x` : '');
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
// GRAPH'LAR: birden fazla graph; kayıt aktif olana yapılır (background.js > GRAPH'LAR)
// -----------------------------------------------------------------------------
// Geçiş (yeni graph ve yükleme de geçer) karar beklerken ve oynatma sürerken kapalıdır.
// Bekleyen aksiyon varsa önce sorulur: geçişte bırakılan graph'ın bekleyen aksiyonları silinir.
// Geçilen graph'ta seçim, senaryo ve oynatma sonucu sıfırlanır (önceki graph'ın edge'leriydi).
// Yedek ("Dışa aktar"): ekran görüntüleriyle tam graph; GraphWalker JSON'dan ayrıdır.
let renamingGraphId = null; // satırda adı düzenlenen graph

function activeGraph() {
  return graphs.find((g) => g.id === activeGraphId);
}

function renderGraphs() {
  const active = activeGraph();
  const locked = Boolean(state.pending) || Boolean(replay);
  $('graphs-badge').textContent = graphs.length || '';
  $('graphs-active').textContent = active ? `· ${active.name}` : '';
  for (const id of ['btn-graph-new', 'btn-graph-import']) {
    $(id).disabled = locked;
    $(id).title = locked ? switchLockText() : '';
  }
  $('btn-graph-export').disabled = !state.nodes.length;
  if (renamingGraphId && $('graph-list').querySelector('input')) return; // yazılan ad her aksiyonda silinmesin
  $('graph-list').replaceChildren(...graphs.map((graph) => graphItem(graph, locked)));
}

function switchLockText() {
  return state.pending ? 'Önce bekleyen "aynı node mu?" sorusunu cevaplayın.' : 'Panelde oynatma sürüyor.';
}

// Satır: ad, sayılar, yeniden adlandır (satırda), sil. Satıra tıklamak (ya da Enter) geçer.
function graphItem(graph, locked) {
  const active = graph.id === activeGraphId;
  return listRow({
    name: graph.name,
    meta: `${graph.nodes} node · ${graph.edges} edge` + (graph.scenarios ? ` · ${graph.scenarios} senaryo` : ''),
    title: `Oluşturuldu: ${dateText(graph.created)} · son değişiklik: ${dateText(graph.updated)}`,
    active,
    locked,
    renaming: graph.id === renamingGraphId,
    select: () => requestSwitch(graph),
    rename: {
      start: () => { renamingGraphId = graph.id; renderGraphs(); },
      end: (name) => {
        renamingGraphId = null;
        if (name && name !== graph.name) send({ type: 'RENAME_GRAPH', id: graph.id, name });
        renderGraphs();
      },
    },
    remove: () => requestDeleteGraph(graph),
    removeDisabled: active && locked,
  });
}

// Liste satırı (Graph'lar ve Senaryo kartları): ad, bilgi, ✎ ile satırda yeniden adlandırma
// (Enter ya da odaktan çıkmak kaydeder, Esc vazgeçer; rename.end(ad | null)), ✕. Seçili olmayan
// satıra tıklamak (ya da Enter) select'i çağırır; kilitliyken seçilmez. warning: satırın başında ⚠.
function listRow({ name, meta, title = '', warning = null, active, locked, renaming, select, rename, remove, removeDisabled = false }) {
  const li = document.createElement('li');
  li.classList.toggle('active', active);
  li.classList.toggle('locked', locked && !active);
  if (renaming) {
    const input = Object.assign(document.createElement('input'), { value: name, maxLength: 80 });
    input.setAttribute('aria-label', 'Ad');
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      rename.end(keep ? input.value.trim() : null);
    };
    input.onkeydown = (event) => {
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    };
    input.onblur = () => finish(true);
    li.append(input);
    queueMicrotask(() => input.select());
    return li;
  }
  li.title = warning ?? title;
  if (warning) li.append(Object.assign(document.createElement('span'), { className: 'warn', textContent: '⚠' }));
  li.append(
    Object.assign(document.createElement('span'), { className: 'name', textContent: name }),
    Object.assign(document.createElement('span'), { className: 'meta', textContent: meta }),
    iconButton('✎', 'Yeniden adlandır', rename.start),
    Object.assign(iconButton('✕', 'Sil', remove), { disabled: removeDisabled }),
  );
  if (!active && !locked) {
    li.tabIndex = 0;
    li.onclick = select;
    li.onkeydown = (event) => { if (event.key === 'Enter' && event.target === li) select(); };
  }
  return li;
}

function iconButton(text, label, onclick) {
  const button = Object.assign(document.createElement('button'), { className: 'icon', textContent: text, title: label });
  button.setAttribute('aria-label', label);
  button.onclick = (event) => {
    event.stopPropagation();
    onclick();
  };
  return button;
}

function dateText(time) {
  return new Date(time).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

// Aktif graph'tan ayrılan işlem: bekleyen aksiyonlar silinecekse önce sorulur.
function confirmLeave(text, action) {
  if (!state.buffer.length) return action();
  confirmDialog(`${text} "Bekleyen aksiyonlar"daki ${state.buffer.length} aksiyon silinecek.`, 'Devam et ve sil', action);
}

function requestSwitch(graph) {
  confirmLeave(`"${graph.name}" graph'ına geçilecek.`, () => send({ type: 'SWITCH_GRAPH', id: graph.id }));
}

function requestDeleteGraph(graph) {
  const active = graph.id === activeGraphId;
  const after = !active ? '' : graphs.length > 1 ? ' Kayıt en son değişen diğer graph\'ta sürer.' : ' Yerine boş bir graph açılır.';
  const scenarios = graph.scenarios ? `, ${graph.scenarios} senaryo` : '';
  confirmDialog(`"${graph.name}" graph'ı silinecek (${graph.nodes} node, ${graph.edges} edge${scenarios}). Bu geri alınamaz; saklamak için önce "Dışa aktar" ile indirin.${after}`,
    'Sil', () => send({ type: 'DELETE_GRAPH', id: graph.id }));
}

$('btn-graph-new').onclick = () => confirmLeave('Yeni bir graph açılacak.', () => send({ type: 'NEW_GRAPH' }));

$('btn-graph-export').onclick = () => downloadJson(`${modelName()}.graph.json`, graphBackup());

// Tam yedek: senaryolar dahil; kayda ait geçici alanlar (sekmeler, bekleyen aksiyonlar, geri al) girmez.
function graphBackup() {
  return {
    format: GRAPH_BACKUP_FORMAT, name: activeGraph()?.name ?? modelName(), exported: new Date().toISOString(),
    startNodeId: state.startNodeId, nextId: state.nextId, nodes: state.nodes, edges: state.edges, scenarios: state.scenarios,
  };
}

// Yedek yeni bir graph olarak eklenir ve ona geçilir; denetimi background yapar.
$('btn-graph-import').onclick = () => $('graph-file').click();
$('graph-file').onchange = async () => {
  const file = $('graph-file').files[0];
  $('graph-file').value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return showMessage({ error: 'Graph yüklenemedi: dosya JSON değil.' });
  }
  if (data?.format !== GRAPH_BACKUP_FORMAT) {
    const graphWalker = Array.isArray(data?.models) ? ' Bu bir GraphWalker modeli: ekran görüntüleri ve kayıt bilgileri olmadığı için graph olarak yüklenemez; "Dışa aktar" ile alınan yedeği seçin.' : '';
    return showMessage({ error: `Graph yüklenemedi: bu bir graph yedeği değil.${graphWalker}` });
  }
  const name = data.name || file.name.replace(/(\.graph)?\.json$/i, '');
  confirmLeave(`"${name}" yeni bir graph olarak eklenecek ve ona geçilecek.`, () => send({ type: 'IMPORT_GRAPH', graph: { ...data, name } }));
};

function confirmDialog(text, okText, onConfirm) {
  $('confirm-dialog-text').textContent = text;
  $('btn-confirm-dialog-ok').textContent = okText;
  $('btn-confirm-dialog-ok').onclick = () => {
    $('confirm-dialog').close();
    onConfirm();
  };
  $('confirm-dialog').showModal();
}

$('btn-confirm-dialog-cancel').onclick = () => $('confirm-dialog').close();

// Aktif graph değişti: seçim, senaryo ve oynatma sonucu önceki graph'ındı. Yeni graph'ın en son
// seçilen senaryosu graph okununca geri gelir (restoreScenario).
function onGraphSwitched() {
  selectedId = null;
  scenarioView = false;
  renamingGraphId = null;
  renamingScenarioId = null;
  scenario = emptyScenario();
  scenarioRun = 0;
  replayResult = null;
  closeReplayCheck();
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
  downloadJson(`${data.name}.json`, data);
};

function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Dışa aktarılan modelin adı: graph'ın adı, node adları gibi yalnızca harf ve rakam ("Swag Labs"
// -> "SwagLabs"; settings.js > toPascalCase). Ad boş kalırsa başlangıç node'unun adı, "v_"
// öneki olmadan. Dosya adı da budur: senaryo dosyasındaki model alanı runner'da dosyayı bulur,
// GraphWalker model adından kod üretir; boşluksuz ad komut satırında tırnak istemez.
function modelName() {
  return toPascalCase(activeGraph()?.name ?? '') || nodeById(state.startNodeId)?.name.replace(/^v_/, '') || 'GraphRecorder';
}

// Graph'ı GraphWalker JSON model formatına çevirir (GraphWalker Studio'nun kaydettiği ve
// CLI'ın okuduğu format). Kayda özel veriler GraphWalker'ın serbest "properties"
// alanlarında taşınır. GraphWalker'ın kendi edge "actions" alanına DOKUNULMAZ: o alan
// modelin değişkenlerini güncelleyen JavaScript içindir, tarayıcı aksiyonu değil
// (bkz. docs/04-veri-modeli.md > GraphWalker formatı).
function graphWalkerModel() {
  const name = modelName();
  const position = (id) => cy.getElementById(id).position(); // Studio'da aynı yerleşim için
  return {
    name,
    models: [{
      id: crypto.randomUUID(),
      name,
      generator: 'random(edge_coverage(100))',
      startElementId: state.startNodeId ?? '',
      properties: {
        graphRecorder: { format: 'graph-recorder/v5', exportedAt: new Date().toISOString(), settings },
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
          viewport: n.viewport, // kümenin alındığı sayfa boyutu (CSS piksel); test aynı boyutta çalıştırılır
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
          // tekrar oynatılacak tarayıcı aksiyonları (click, input, scroll...)
          uiActions: e.actions.map(replayAction),
          // edge panelde düzenlendiyse (aksiyon silindiyse) kayıttaki orijinal liste
          ...(e.recordedActions && { edited: true, recordedActions: e.recordedActions.map(replayAction) }),
        },
      })),
    }],
    selectedModelIndex: 0,
    selectedElementId: null,
  };
}

// Dışa aktarılan aksiyon. "State'i değiştirdi mi?" işareti (changed) de çıkar: runner bir adım
// kalınca her aksiyonun oynatmadaki etkisini kayıttakiyle karşılaştırır (runner/run.js >
// traceOf). screenBefore/screenAfter önceki sürümlerle kaydedilmiş aksiyonlarda kalmış olabilir.
function replayAction({ screenBefore, screenAfter, ...action }) {
  return action;
}


// -----------------------------------------------------------------------------
// SENARYO: test yolları (koşular); liste, önizleme, elle yol, indirme / yükleme (scenario.js)
// -----------------------------------------------------------------------------
// Senaryo: başlangıç node'undan başlayan bir ya da birden fazla koşu. Runner her koşuyu temiz
// bir oturumla baştan oynatır; yol çıkmaz bir node'a varırsa kalan edge'ler yeni koşuyla
// kapsanır.
//
// Senaryolar graph'la saklanır (background.js > SENARYOLAR); kartın başında liste. Panel seçili
// senaryonun çalışma kopyasını tutar (scenario; id null = seçili senaryo yok) ve her değişiklikte
// kaydettirir. Storage'dan gelen değişiklik çalışma kopyasının üstüne yazmaz (hızlı tıklamalarda
// ara bir sürüm geri gelmesin); yalnızca senaryo silindiyse seçim kalkar. Seçili senaryo graph
// başına hatırlanır (localStorage). Senaryo seçili değilken edge tıklaması senaryoya bir şey
// eklemez (edge'in detayı açılır): önce "Yeni senaryo".
//
// Stratejiler: "Elle seç" kullanıcı graph'ta edge'lere tıklayarak koşuları kurar. GraphWalker
// stratejileri koşuları kullanıcının bilgisayarındaki GraphWalker'la üretir (GRAPHWALKER, aşağıda);
// "Üret" seçili senaryonun koşularının yerine yazar. Elle düzeltmek için "Elle seç"e dönülür.
//
// Başlangıç: koşular varsayılan olarak graph'ın başlangıcından başlar; "Başlangıç" listesinden
// başka bir node seçilebilir (scenario.start; null = graph'ın başlangıcı). Böyle bir senaryo
// yalnızca panelde oynatılır, runner reddeder (extension/scenario.js).
const STRATEGIES = [
  { id: 'manual', text: "Elle seç (graph'ta edge'lere tıklayın)" },
  { id: 'gw-edges', goal: 'edges', text: "GraphWalker: tüm edge'ler" },
  { id: 'gw-nodes', goal: 'nodes', text: "GraphWalker: tüm node'lar" },
  { id: 'gw-node', goal: 'node', text: "GraphWalker: bir node'a ulaş" },
];

// Senaryoyu ne ürettiyse strateji listesi onu gösterir (senaryo seçilince).
function strategyOf(sc) {
  return sc.planner?.engine === 'graphwalker' ? `gw-${sc.planner.goal}` : 'manual';
}

let scenario = emptyScenario();
let scenarioRun = 0; // seçili koşu
let renamingScenarioId = null; // satırda adı düzenlenen senaryo

function emptyScenario() {
  return { id: null, name: null, planner: { engine: 'manual' }, start: null, runs: [[]] };
}

// Senaryonun graph'ı; start, senaryonun başlangıç node'u (seçilen node silindiyse graph'ın başlangıcı).
function scenarioGraphOf(sc) {
  const start = nodeById(sc.start) ? sc.start : state.startNodeId;
  return { start, nodes: state.nodes, edges: state.edges };
}

function scenarioGraph() {
  return scenarioGraphOf(scenario);
}

// Listeden seçilen senaryonun çalışma kopyası (bulunamazsa seçim kalkar).
function selectScenario(id) {
  const stored = state.scenarios.find((sc) => sc.id === id);
  scenario = stored ? structuredClone(stored) : emptyScenario();
  if (!scenario.runs.length) scenario.runs = [[]];
  scenarioRun = 0;
  $('scenario-strategy').value = strategyOf(scenario);
  closeReplayCheck();
}

function rememberScenario(id) {
  try {
    localStorage.setItem('scenario:' + state.id, id ?? '');
  } catch { /* hatırlanmaz */ }
}

// Graph açılınca (panel açılışı, graph geçişi) o graph'ta en son seçilen senaryo.
function restoreScenario() {
  let id = null;
  try {
    id = localStorage.getItem('scenario:' + state.id);
  } catch { /* hatırlanmaz */ }
  if (id && state.scenarios.some((sc) => sc.id === id)) selectScenario(id);
}

// Storage'dan yeni state geldi: seçili senaryo silindiyse seçim kalkar.
function noteScenarioRemoval(next) {
  if (!scenario.id) return;
  const before = state.scenarios.some((sc) => sc.id === scenario.id);
  if (before && !next.scenarios.some((sc) => sc.id === scenario.id)) {
    scenario = emptyScenario();
    scenarioRun = 0;
    scenarioView = false;
  }
}

// Çalışma kopyası background'a yazılır. Yalnızca hata gösterilir (bilgi mesajları kalsın).
// copy: koşular değişti (ya da "Ana graph'tan yenile"): senaryo graph'ı yeniden alınır; panel
// anında göstermek için aynısını kendisi de alır (scenario.js > scenarioSnapshot). Yeniden
// adlandırmada alınmaz.
async function persistScenario({ copy = true } = {}) {
  if (!scenario.id) return;
  if (copy) scenario.graph = scenarioSnapshot(scenarioGraph(), scenario.runs, scenario.graph);
  const { id, name, start, planner, runs } = scenario;
  const sent = JSON.stringify(runs); // koşular yerinde değişir: gönderilen hâli
  const response = await chrome.runtime.sendMessage({ type: 'SAVE_SCENARIO', scenario: { id, name, start, planner, runs, copy } });
  if (response?.error) return showMessage(response);
  if (scenario.id !== id) return;
  const renamed = response?.name && scenario.name !== response.name;
  if (renamed) scenario.name = response.name;
  // Bu arada koşular yine değiştiyse (hızlı tıklamalar) cevaptaki kopya eskidir; yerel kopya kalır.
  if (response?.graph && JSON.stringify(scenario.runs) === sent) scenario.graph = response.graph;
  if (renamed || copy) render();
}

// Yeni senaryo listeye eklenir ve seçilir (Yeni senaryo, Yükle…, planlayıcılar).
async function createScenario(fields, notice = null) {
  const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const response = await chrome.runtime.sendMessage({ type: 'NEW_SCENARIO', scenario: { id, ...fields } });
  if (response?.error) return showMessage(response);
  scenario = { id, ...structuredClone(fields), name: response.name, graph: response.graph };
  if (!scenario.runs.length) scenario.runs = [[]];
  scenarioRun = 0;
  $('scenario-strategy').value = strategyOf(scenario);
  rememberScenario(id);
  closeReplayCheck();
  $('scenario').open = true;
  showMessage(notice);
  render();
}

function nextScenarioName() {
  let n = state.scenarios.length + 1;
  while (state.scenarios.some((sc) => sc.name === `Senaryo ${n}`)) n++;
  return `Senaryo ${n}`;
}

// "Başlangıç" listesi: node'lar değişince yeniden kurulur. İlk seçenek graph'ın başlangıcı.
let scenarioStartKey = '';

function renderScenarioStart(graph, locked) {
  const key = JSON.stringify([state.startNodeId, state.nodes.map((n) => [n.id, n.name])]);
  if (key !== scenarioStartKey) {
    scenarioStartKey = key;
    const ordered = [...state.nodes].sort((a, b) => (b.id === state.startNodeId) - (a.id === state.startNodeId));
    $('scenario-start').replaceChildren(...ordered.map((n) => Object.assign(document.createElement('option'), {
      value: n.id, textContent: n.id === state.startNodeId ? `${n.name} (graph'ın başlangıcı)` : n.name,
    })));
  }
  if (graph.start) $('scenario-start').value = graph.start;
  $('scenario-start').disabled = locked || !state.nodes.length;
  $('scenario-start-hint').hidden = !graph.start || graph.start === state.startNodeId;
}

// Elle yol: bölüm açık, bir senaryo seçili ve "Elle seç" stratejisindeyken edge'e tıklamak onu koşuya ekler.
function scenarioEditing() {
  return $('scenario').open && Boolean(scenario.id) && !scenarioView && $('scenario-strategy').value === 'manual';
}

$('scenario-strategy').replaceChildren(...STRATEGIES.map(({ id, text }) => Object.assign(document.createElement('option'), { value: id, textContent: text })));

// Liste: ad, kapsama ya da yürünemiyorsa ⚠. Seçili satır çalışma kopyasından çizilir.
function renderScenarioList(locked) {
  $('scenario-empty').hidden = state.scenarios.length > 0;
  $('scenario-active').textContent = scenario.id ? `· ${scenario.name}` : '';
  $('btn-scenario-new').disabled = locked;
  $('btn-scenario-load').disabled = locked;
  if (renamingScenarioId && $('scenario-list').querySelector('input')) return; // yazılan ad silinmesin
  $('scenario-list').replaceChildren(...state.scenarios.map((sc) => scenarioItem(sc.id === scenario.id ? scenario : sc, locked)));
}

function scenarioItem(sc, locked) {
  const graph = scenarioGraphOf(sc);
  const filled = sc.runs.filter((r) => r.length);
  const problem = runProblem(graph, sc.runs);
  const coverage = coverageOf(graph, filled);
  return listRow({
    name: sc.name,
    meta: problem ? 'yürünemiyor' : `${coverage.edges[0]}/${coverage.edges[1]} edge · ${filled.length} koşu`,
    warning: problem,
    active: sc.id === scenario.id,
    locked,
    renaming: sc.id === renamingScenarioId,
    select: () => {
      selectScenario(sc.id);
      rememberScenario(sc.id);
      showMessage(null);
      render(); // senaryo görünümündeyse graph da değişir
    },
    rename: {
      start: () => { renamingScenarioId = sc.id; renderScenario(); },
      end: (name) => {
        renamingScenarioId = null;
        if (name && name !== sc.name) renameScenario(sc, name);
        renderScenario();
      },
    },
    remove: () => requestDeleteScenario(sc),
    removeDisabled: locked && sc.id === scenario.id,
  });
}

async function renameScenario(sc, name) {
  if (sc.id === scenario.id) {
    scenario.name = name;
    return persistScenario({ copy: false });
  }
  const { id, start, planner, runs } = sc;
  const response = await chrome.runtime.sendMessage({ type: 'SAVE_SCENARIO', scenario: { id, name, start, planner, runs } });
  if (response?.error) showMessage(response);
}

function requestDeleteScenario(sc) {
  const runs = sc.runs.filter((r) => r.length).length;
  confirmDialog(`"${sc.name}" senaryosu silinecek (${runs} koşu). Bu geri alınamaz; saklamak için önce seçip "Senaryo indir".`, 'Sil', () => {
    if (sc.id === scenario.id) {
      scenario = emptyScenario();
      scenarioRun = 0;
      scenarioView = false;
      rememberScenario(null);
      closeReplayCheck();
    }
    send({ type: 'DELETE_SCENARIO', id: sc.id });
    render();
  });
}

$('btn-scenario-new').onclick = () => createScenario({ name: nextScenarioName(), start: null, planner: { engine: 'manual' }, runs: [[]] });

function renderScenario() {
  const locked = Boolean(replay); // oynatma sürerken senaryo değişmez
  renderScenarioList(locked);
  $('scenario-editor').hidden = !scenario.id;
  cy.elements().removeClass('faded run-edge run-next run-end run-start replay-passed replay-running replay-failed');
  if (!scenario.id) {
    $('scenario-badge').textContent = '';
    return;
  }
  const graph = scenarioGraph();
  const runs = scenario.runs;
  const run = runs[scenarioRun] ?? [];
  const filled = runs.filter((r) => r.length);
  const coverage = coverageOf(graph, filled);
  const problem = runProblem(graph, runs);
  $('scenario-badge').textContent = filled.length ? `${coverage.edges[0]}/${coverage.edges[1]}` : '';
  $('scenario-runs').replaceChildren(...runs.map((r, i) => {
    const button = Object.assign(document.createElement('button'), { textContent: `Koşu ${i + 1} (${r.length})`, disabled: locked });
    button.classList.toggle('active', i === scenarioRun);
    button.onclick = () => { scenarioRun = i; renderScenario(); };
    return button;
  }));
  $('scenario-summary').textContent = problem
    ? `Senaryo graph'la uyuşmuyor: ${problem}`
    : `Kapsama: ${coverage.edges[0]}/${coverage.edges[1]} edge · ${coverage.nodes[0]}/${coverage.nodes[1]} node · ${filled.length} koşu`
    + (scenario.planner?.engine === 'graphwalker' ? ` · ${plannerText(scenario.planner)}` : '');
  renderPlanner(graph, locked);
  const end = runEnd(graph, run);
  const next = problem ? [] : graph.edges.filter((e) => e.source === end);
  $('scenario-hint').textContent = !scenarioEditing()
    ? (scenarioView && $('scenario-strategy').value === 'manual' ? 'Koşuları düzenlemek için "Ana graph" sekmesine geçin.' : '')
    : !graph.start ? 'Önce graph kaydedin.'
      : next.length ? `"${nodeById(end)?.name}" node'undan çıkan bir edge'e tıklayın (kesik çizgili).`
        : `Koşu çıkmaz bir node'da (${nodeById(end)?.name}) bitti. Kalan edge'ler için "Yeni koşu".`;
  $('btn-scenario-undo').disabled = locked || (!run.length && runs.length === 1);
  $('btn-scenario-new-run').disabled = locked || !run.length;
  $('btn-scenario-clear').disabled = locked || !filled.length;
  $('scenario-strategy').disabled = locked;
  $('btn-scenario-download').disabled = !filled.length || Boolean(problem);
  renderScenarioStart(graph, locked);
  renderReplay();

  // Graph'ta önizleme: yalnızca bölüm açıkken
  if (!$('scenario').open || !graph.start) return;
  cy.elements().addClass('faded');
  const orders = new Map();
  run.forEach((id, i) => orders.set(id, [...(orders.get(id) ?? []), i + 1]));
  for (const [id, order] of orders) cy.getElementById(id).removeClass('faded').addClass('run-edge').data('order', order.join(', '));
  const visited = [graph.start, ...run.map((id) => graph.edges.find((e) => e.id === id)?.target)];
  for (const id of visited) if (id) cy.getElementById(id).removeClass('faded');
  cy.getElementById(end).addClass('run-end');
  cy.getElementById(graph.start).addClass('run-start');
  if (scenarioEditing() && !locked) for (const edge of next) cy.getElementById(edge.id).removeClass('faded').addClass('run-next');
  markReplay();
}

function addScenarioEdge(id) {
  const graph = scenarioGraph();
  const run = scenario.runs[scenarioRun];
  const edge = state.edges.find((e) => e.id === id);
  const end = runEnd(graph, run);
  if (edge.source !== end) {
    return showMessage({ error: `"${edge.name}", koşunun vardığı "${nodeById(end)?.name}" node'undan çıkmıyor. Koşu orada bittiyse "Yeni koşu" ile baştan başlayın.` });
  }
  run.push(id);
  scenario.planner = { engine: 'manual' };
  showMessage(null);
  renderScenario();
  persistScenario();
}

$('scenario').ontoggle = renderScenario;

// Başlangıç değişince mevcut koşular yeni başlangıçtan yürünemiyorsa temizlenir.
$('scenario-start').onchange = () => {
  const start = $('scenario-start').value;
  scenario.start = start === state.startNodeId ? null : start;
  if (scenario.runs.some((r) => r.length) && runProblem(scenarioGraph(), scenario.runs)) {
    scenario.runs = [[]];
    scenarioRun = 0;
    showMessage({ notice: `Koşular "${nodeById(scenarioGraph().start)?.name}" node'undan yürünemediği için temizlendi.` });
  } else {
    showMessage(null);
  }
  renderScenario();
  persistScenario();
};

$('scenario-strategy').onchange = () => {
  showMessage(null);
  renderScenario();
};

// -----------------------------------------------------------------------------
// GRAPHWALKER: kullanıcının bilgisayarındaki GraphWalker ile koşu üretimi
// -----------------------------------------------------------------------------
// Eklenti program çalıştıramaz; Chrome kayıtlı bir programı (native messaging host) kendisi
// başlatır. Host bir kez kurulur (runner\install-planner.cmd) ve GraphWalker CLI'ı çalıştırır
// (runner/planner/graphwalker.js): çıkmaz node'da yol bölünür, kalan edge'ler yeni koşularla
// kapsanır. Panel graph'ı ekran görüntüsüz gönderir; senaryonun başlangıcı yolların başlangıcıdır.
// Tohum boşsa host rastgele seçer ve senaryoya yazar: aynı tohum aynı senaryoyu verir.
const PLANNER_HOST = 'com.graphrecorder.planner';
let planning = false; // GraphWalker çalışıyor

function plannerText(planner) {
  const goal = { edges: "tüm edge'ler", nodes: "tüm node'lar", node: `"${nodeById(planner.target)?.name ?? planner.target}" node'una ulaş` }[planner.goal];
  return `GraphWalker: ${goal}` + (planner.seed !== undefined ? ` (tohum ${planner.seed})` : '');
}

let plannerTargetKey = '';

function renderPlanner(graph, locked) {
  const strategy = STRATEGIES.find((s) => s.id === $('scenario-strategy').value);
  $('scenario-planner').hidden = !strategy?.goal;
  if (!strategy?.goal) return;
  $('scenario-target-label').hidden = strategy.goal !== 'node';
  const targets = state.nodes.filter((n) => n.id !== graph.start);
  const key = JSON.stringify([graph.start, targets.map((n) => [n.id, n.name])]);
  if (key !== plannerTargetKey) {
    plannerTargetKey = key;
    const selected = $('scenario-target').value || (scenario.planner?.goal === 'node' ? scenario.planner.target : '');
    $('scenario-target').replaceChildren(...targets.map((n) => Object.assign(document.createElement('option'), { value: n.id, textContent: n.name })));
    if (targets.some((n) => n.id === selected)) $('scenario-target').value = selected;
  }
  $('btn-scenario-generate').disabled = locked || planning || !graph.start || (strategy.goal === 'node' && !targets.length);
  $('scenario-seed').disabled = locked || planning || strategy.goal === 'node'; // a_star rastgele değil
  $('scenario-planner-status').textContent = planning ? 'GraphWalker çalışıyor…' : '';
}

$('btn-scenario-generate').onclick = () => {
  const strategy = STRATEGIES.find((s) => s.id === $('scenario-strategy').value);
  if (!strategy?.goal || !scenario.id) return;
  const seedText = $('scenario-seed').value.trim();
  const seed = seedText === '' || strategy.goal === 'node' ? null : Number(seedText);
  if (seed !== null && !(Number.isInteger(seed) && seed >= 0)) return showMessage({ error: 'Tohum 0 ya da pozitif bir tam sayı olmalı (boş: rastgele).' });
  const target = strategy.goal === 'node' ? $('scenario-target').value : null;
  const generate = () => generateRuns(strategy.goal, target, seed);
  if (!scenario.runs.some((r) => r.length)) return generate();
  confirmDialog(`"${scenario.name}" senaryosunun koşuları GraphWalker'ın ürettikleriyle değişecek.`, 'Üret', generate);
};

async function generateRuns(goal, target, seed) {
  const id = scenario.id;
  const graph = scenarioGraph();
  planning = true;
  showMessage(null);
  renderScenario();
  let response;
  try {
    response = await chrome.runtime.sendNativeMessage(PLANNER_HOST, {
      type: 'plan', goal, target, seed,
      graph: {
        start: graph.start,
        nodes: state.nodes.map(({ id: nodeId, name }) => ({ id: nodeId, name })),
        edges: state.edges.map(({ id: edgeId, name, source, target: to }) => ({ id: edgeId, name, source, target: to })),
      },
    });
  } catch (error) {
    response = { error: plannerHostError(error.message) };
  }
  planning = false;
  if (response?.error || scenario.id !== id) {
    if (response?.error) showMessage({ error: `GraphWalker: ${response.error}` });
    return renderScenario();
  }
  scenario.runs = response.runs.length ? response.runs : [[]];
  scenario.planner = response.planner;
  scenarioRun = 0;
  const coverage = coverageOf(graph, response.runs);
  const unreachable = response.unreachable?.length ? ` Başlangıçtan ulaşılamayan: ${response.unreachable.map((x) => x.name).join(', ')}.` : '';
  showMessage({ notice: `GraphWalker ${response.runs.length} koşu üretti: ${coverage.edges[0]}/${coverage.edges[1]} edge, ${coverage.nodes[0]}/${coverage.nodes[1]} node.${unreachable}` });
  renderScenario();
  persistScenario();
}

// Chrome'un native messaging hataları kullanıcının yapabileceği şeye çevrilir.
function plannerHostError(message) {
  if (/not found/i.test(message)) {
    return 'planlayıcı kurulu değil. Bir kez runner\\install-planner.cmd\'yi çalıştırın (Java 17 ya da 21 ve GraphWalker CLI jar\'ı gerekir). '
      + `Panel olmadan aynı senaryo: node runner/plan.js ${modelName()}.json`;
  }
  if (/forbidden/i.test(message)) return 'planlayıcı bu eklenti kimliği için kurulmamış. runner\\install-planner.cmd\'yi yeniden çalıştırın.';
  return `planlayıcı çalışmadı (${message}). Node.js kaldırıldı ya da kurulum eksik olabilir; runner\\install-planner.cmd'yi yeniden çalıştırın.`;
}

$('btn-scenario-undo').onclick = () => {
  const run = scenario.runs[scenarioRun];
  if (run.length) run.pop();
  else if (scenario.runs.length > 1) {
    scenario.runs.splice(scenarioRun, 1);
    scenarioRun = Math.max(0, scenarioRun - 1);
  }
  scenario.planner = { engine: 'manual' };
  renderScenario();
  persistScenario();
};

$('btn-scenario-new-run').onclick = () => {
  scenario.runs.push([]);
  scenarioRun = scenario.runs.length - 1;
  renderScenario();
  persistScenario();
};

$('btn-scenario-clear').onclick = () => {
  scenario.runs = [[]]; // ad ve başlangıç seçimi kalır
  scenario.planner = { engine: 'manual' };
  scenarioRun = 0;
  renderScenario();
  persistScenario();
};

// Senaryo dosyası: model dosyasıyla aynı klasöre indirilmesi beklenir (runner model yolunu
// senaryoya göre çözer). Dosya adı model ve senaryo adından: SwagLabs-GirisAkisi.json. start
// yalnızca graph'ın başlangıcı dışında bir node seçildiyse yazılır.
$('btn-scenario-download').onclick = () => {
  const runs = scenario.runs.filter((r) => r.length);
  const graph = scenarioGraph();
  const model = modelName();
  downloadJson(`${model}-${toPascalCase(scenario.name ?? '') || 'Senaryo'}.json`, {
    format: SCENARIO_FORMAT,
    name: scenario.name,
    model: `${model}.json`,
    ...(graph.start !== state.startNodeId && { start: graph.start }),
    planner: scenario.planner,
    runs,
    coverage: coverageOf(graph, runs),
    graph: scenario.graph, // senaryo graph'ı (runner kullanmaz)
  });
};

// Bir senaryo dosyası listeye yeni senaryo olarak eklenir (ör. komut satırında üretilmiş). Bu
// graph'la yürünemiyorsa (edge silinmiş, başka model) reddedilir.
$('btn-scenario-load').onclick = () => $('scenario-file').click();
$('scenario-file').onchange = async () => {
  const file = $('scenario-file').files[0];
  $('scenario-file').value = '';
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    if (json.format !== SCENARIO_FORMAT) throw new Error('Bu bir senaryo dosyası değil.');
    if (json.start && !nodeById(json.start)) throw new Error(`Senaryonun başlangıç node'u ("${json.start}") bu graph'ta yok.`);
    const start = json.start && json.start !== state.startNodeId ? json.start : null;
    const problem = runProblem({ ...scenarioGraph(), start: start ?? state.startNodeId }, json.runs);
    if (problem) throw new Error(`Senaryo bu graph'la uyuşmuyor: ${problem}`);
    const name = json.name ?? file.name.replace(/\.json$/i, '');
    await createScenario({ name, start, planner: json.planner ?? { engine: 'manual' }, runs: json.runs.map((run) => [...run]) },
      { notice: `"${name}" yüklendi: ${json.runs.length} koşu.` });
  } catch (error) {
    showMessage({ error: `Senaryo yüklenemedi: ${error.message}` });
  }
  renderScenario();
};


// -----------------------------------------------------------------------------
// GÖRÜNÜM: ana graph ya da seçili senaryonun graph'ı (sekme şeridi)
// -----------------------------------------------------------------------------
// Her senaryonun graph'ı, koşularının geçtiği kısmın ana graph'tan kopyasıdır (scenario.graph;
// scenario.js > scenarioSnapshot): ileride senaryoya özel monitörler buraya bağlanır. Sekme
// şeridi Senaryo kartındaki listeyle eştir: senaryo sekmesine geçmek o senaryoyu seçer;
// senaryo görünümündeyken listede başka senaryo seçmek görünümü ona geçirir. Senaryo görünümü
// salt okunurdur: kayıt ana graph'a sürer, koşular ana graph görünümünde düzenlenir. Kopyadan
// sonra ana graph değiştiyse (scenario.js > snapshotDrift) uyarı ve "Ana graph'tan yenile".
let scenarioView = false;

function renderViewTabs() {
  if (scenarioView && (!scenario.id || replay)) scenarioView = false;
  const scenarios = state.scenarios;
  $('view-tabs').hidden = !scenarios.length;
  const tab = (text, active, onclick, title = '') => {
    const button = Object.assign(document.createElement('button'), { textContent: text, title, disabled: Boolean(replay) });
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(active));
    button.classList.toggle('active', active);
    button.onclick = onclick;
    return button;
  };
  $('view-tabs').replaceChildren(
    tab("Ana graph", !scenarioView, () => showView(null)),
    ...scenarios.map((stored) => {
      const sc = stored.id === scenario.id ? scenario : stored;
      const drift = snapshotDrift(state, sc.graph, sc.runs).length;
      return tab(sc.name + (drift ? ' •' : ''), scenarioView && sc.id === scenario.id, () => showView(sc.id),
        drift ? 'Ana graph bu senaryonun kopyasından sonra değişti' : `"${sc.name}" senaryosunun graph'ı`);
    }),
  );
  renderViewNote();
}

// Görünüm değişir; id null = ana graph. Seçili öğe görünümde de varsa seçili kalır.
function showView(id, select = selectedId) {
  if (id && id !== scenario.id) {
    selectScenario(id);
    rememberScenario(id);
  }
  scenarioView = Boolean(id);
  selectedId = select;
  showMessage(null);
  render();
  if (selectedId) cy.getElementById(selectedId).select();
}

function renderViewNote() {
  $('view-note').hidden = !scenarioView;
  if (!scenarioView) return;
  const copy = viewGraph();
  const drift = snapshotDrift(state, scenario.graph, scenario.runs);
  $('view-note-text').textContent = `"${scenario.name}" senaryosunun graph'ı: ${copy.nodes.length} node · ${copy.edges.length} edge`
    + (scenario.graph?.copied ? ` · ana graph'tan kopya (${dateText(scenario.graph.copied)})` : '')
    + ' · salt okunur; koşular "Ana graph" sekmesinde düzenlenir.';
  $('view-drift').hidden = !drift.length;
  $('btn-view-refresh').hidden = !drift.length;
  if (drift.length) $('view-drift').textContent = driftText(drift) + ' Senaryo graph\'ı olduğu gibi duruyor.';
}

// "Kopyadan sonra ana graph değişti: e_Login değişti, v_Home silindi (+2)."
function driftText(drift) {
  const LIMIT = 5;
  return 'Kopyadan sonra ana graph değişti: '
    + drift.slice(0, LIMIT).map((d) => `${d.name} ${d.change}`).join(', ')
    + (drift.length > LIMIT ? ` (+${drift.length - LIMIT})` : '') + '.';
}

// Kopya ana graph'tan yeniden alınır (monitörler id'yle korunur). Silinen edge'ler kopyadan
// düşer; koşular onları hâlâ kullanıyorsa senaryo listede yürünemez görünür.
$('btn-view-refresh').onclick = () => persistScenario();

// Senaryo görünümündeki öğe ana graph'ta açılır.
$('btn-show-main').onclick = () => {
  const id = selectedId;
  if (!nodeById(id) && !state.edges.some((e) => e.id === id)) {
    return showMessage({ error: 'Bu öğe ana graph\'ta yok: kopyadan sonra silinmiş.' });
  }
  showView(null, id);
};

// Ana graph görünümünde: öğeyi koşularında kullanan senaryolar; tıklayınca o senaryonun graph'ı.
function renderDetailsScenarios(item, readOnly) {
  const users = readOnly ? [] : state.scenarios.filter((stored) => {
    const sc = stored.id === scenario.id ? scenario : stored;
    const copy = sc.graph ?? scenarioSnapshot(scenarioGraphOf(sc), sc.runs);
    return copy.nodes.some((n) => n.id === item.id) || copy.edges.some((e) => e.id === item.id);
  });
  $('details-scenarios').hidden = !users.length;
  $('details-scenarios').replaceChildren(...(users.length ? [
    document.createTextNode('Kullanan senaryolar: '),
    ...users.flatMap((sc, i) => [
      ...(i ? [document.createTextNode(', ')] : []),
      Object.assign(document.createElement('a'), { href: '#', textContent: sc.name, onclick: (event) => { event.preventDefault(); showView(sc.id, item.id); } }),
    ]),
  ] : []));
}


// -----------------------------------------------------------------------------
// PANELDE OYNATMA: seçili koşu bu tarayıcıda, açık sekmede (replay.js)
// -----------------------------------------------------------------------------
// Başlangıç sayfası kullanıcının sorumluluğudur: oynatma sayfaya kendisi gitmez. Önce ekran
// koşunun ilk node'uyla (senaryonun başlangıcı) karşılaştırılır; farklıysa uyarı çıkar,
// kullanıcı yine de oynatabilir. Oynatma sürerken background kaydı durdurur; bitince koşu geçtiyse kayıt
// vardığı node'dan sürer, geçmediyse şu anki node bilinmez (background.js > PANELDE OYNATMA).
// Graph'ta ilerleme canlı görünür; kalınan adımda fark listesi ve beklenen ekranla görsel
// karşılaştırma. Koşu senaryonun kendi graph'ından oynatılır (replayGraph).

let replay = null;       // sürüyorsa oynatma (replay.js > startReplay)
let replayResult = null;  // son oynatmanın sonucu ve hangi koşu için olduğu (runKey)
let replayStart = null;   // uyarı kartı açıkken başlatılmayı bekleyen oynatma { tab, edges }
const replaySecrets = {}; // maskeli alanların değerleri: yalnızca panel açıkken bellekte, saklanmaz

// Oynatılan graph senaryonun kendi graph'ıdır (kopya; scenario.js > scenarioSnapshot), ana graph
// değil: ana graph kopyadan sonra değiştiyse kopya oynatılır, fark oynatmadan önce söylenir
// (checkReplay). Ekran görüntüleri kopyada yoktur, node id'siyle ana graph'tan okunur.
function replayGraph() {
  return scenario.graph ?? scenarioSnapshot(scenarioGraph(), scenario.runs);
}

function replayEdges() {
  const { edges } = replayGraph();
  return (scenario.runs[scenarioRun] ?? []).map((id) => edges.find((e) => e.id === id)).filter(Boolean);
}

// Oynatılan graph'taki node (adı, ekranı); kopyada yoksa ana graph'taki.
function replayNode(id) {
  return replayGraph().nodes.find((n) => n.id === id) ?? nodeById(id);
}

// Panelde gösterilen oynatma: süren ya da seçili koşu için en son biten.
function shownReplay() {
  if (replay) return replay;
  return replayResult?.runKey === runKey() ? replayResult : null;
}

function renderReplay() {
  const edges = replayEdges();
  const running = Boolean(replay);
  const problem = runProblem(replayGraph(), scenario.runs);
  $('btn-replay').hidden = running;
  $('btn-replay-stop').hidden = !running;
  $('btn-replay').disabled = !edges.length || Boolean(problem) || Boolean(state.pending) || Boolean(replayStart);
  $('btn-replay').title = state.pending ? 'Önce bekleyen "aynı node mu?" sorusunu cevaplayın.' : edges.length ? '' : 'Önce koşuya edge ekleyin.';
  $('replay-slow').disabled = running;
  renderReplaySecrets(edges, running);

  const shown = shownReplay();
  $('replay-status').hidden = !shown;
  $('replay-steps').replaceChildren(...(shown?.steps ?? []).map(replayStepItem));
  const broken = !running && shown?.steps.find((s) => s.status === 'failed');
  $('replay-diff').replaceChildren(...(broken?.mismatch ? mismatchLines(broken.mismatch, replayNode(broken.target)) : [])
    .map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  $('replay-result-actions').hidden = !(broken?.screenshot && nodeById(broken.target)?.screenshot);
  if (shown) $('replay-status').textContent = replayStatusText(shown, running);
}

function replayStatusText(shown, running) {
  const total = shown.steps.length;
  const passed = shown.steps.filter((s) => s.status === 'passed').length;
  if (running) {
    const step = shown.steps[shown.step];
    if (!step) return 'Oynatma başlıyor…';
    const actions = replayGraph().edges.find((e) => e.id === step.edgeId)?.actions.length ?? 0;
    return `Oynatılıyor · adım ${shown.step + 1}/${total}: ${step.name}`
      + (shown.actionLabel ? ` · aksiyon ${shown.action + 1}/${actions}: ${shown.actionLabel}` : ` · ekran "${replayNode(step.target)?.name}" mi?`);
  }
  const time = seconds(shown.steps.reduce((sum, s) => sum + (s.duration ?? 0), 0));
  if (shown.status === 'passed') return `Geçti · ${total}/${total} edge · ${time}`;
  return `${shown.status === 'stopped' ? 'Durduruldu' : 'Kaldı'} · ${passed}/${total} edge geçti · ${time}`;
}

function replayStepItem(step) {
  const li = document.createElement('li');
  li.className = step.status;
  li.innerHTML = '<span class="mark"></span><span class="name"></span><span class="time"></span>';
  li.querySelector('.mark').textContent = { passed: '✓', failed: '✗', stopped: '■', running: '▶', skipped: '–', pending: '·' }[step.status];
  li.querySelector('.name').textContent = `${step.name} → ${replayNode(step.target)?.name ?? step.target}`;
  for (const note of [step.error, ...step.warnings].filter(Boolean)) {
    li.querySelector('.name').append(Object.assign(document.createElement('small'), { textContent: note }));
  }
  if (step.duration !== undefined && step.status !== 'skipped') li.querySelector('.time').textContent = seconds(step.duration);
  return li;
}

// Beklenen node ile ekranın farkı: URL şablonu, sayısı farklı türler, görünen alan.
function mismatchLines(m, node) {
  const LIMIT = 12;
  const viewport = m.screen.viewport && node?.viewport && viewportText(m.screen.viewport) !== viewportText(node.viewport);
  return [
    ...(m.url !== m.expectedUrl ? [`URL şablonu: beklenen ${m.expectedUrl}, ekranda ${m.url}`] : []),
    ...m.diff.slice(0, LIMIT).map(({ key, expected, actual }) => `${key}: beklenen ${expected}, ekranda ${actual}`),
    ...(m.diff.length > LIMIT ? [`(+${m.diff.length - LIMIT} tür daha)`] : []),
    ...(viewport ? [`Görünen alan: "${node.name}" ${viewportText(node.viewport)} boyutunda kaydedildi, ekran ${viewportText(m.screen.viewport)}`] : []),
  ];
}

// Graph'ta ilerleme: aynı edge koşuda iki kez geçiyorsa son durumu görünür.
function markReplay() {
  const shown = shownReplay();
  if (!shown) return;
  const MARK = { passed: 'replay-passed', running: 'replay-running', failed: 'replay-failed', stopped: 'replay-failed' };
  for (const step of shown.steps) {
    if (!MARK[step.status]) continue;
    cy.getElementById(step.edgeId).removeClass('replay-passed replay-running replay-failed').addClass(MARK[step.status]);
    if (step.status === 'passed') cy.getElementById(step.target).removeClass('replay-failed').addClass('replay-passed');
    if (step.status === 'failed' && step.mismatch) cy.getElementById(step.target).removeClass('replay-passed').addClass('replay-failed');
  }
}

// Koşudaki maskeli (******) alanlar için şifre kutuları. Kutular yalnızca anahtarlar değişince
// yeniden kurulur (yazılan kaybolmasın).
let replaySecretKeys = null;

function renderReplaySecrets(edges, running) {
  const keys = maskedKeys(edges);
  if (keys.join('\n') !== replaySecretKeys) {
    replaySecretKeys = keys.join('\n');
    $('replay-secrets').replaceChildren(...keys.map((key) => {
      const label = document.createElement('label');
      label.className = 'field';
      label.innerHTML = '<span></span> <input type="password" autocomplete="off">';
      label.querySelector('span').textContent = `Maskeli değer (${key})`;
      const input = label.querySelector('input');
      input.value = replaySecrets[key] ?? '';
      input.oninput = () => { replaySecrets[key] = input.value; };
      return label;
    }));
  }
  for (const input of $('replay-secrets').querySelectorAll('input')) input.disabled = running;
}

// "Koşuyu oynat": önce kontroller. Uyarı varsa kart açılır, kullanıcı karar verir.
$('btn-replay').onclick = async () => {
  const edges = replayEdges();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !edges.length) return;
  const missing = maskedKeys(edges).filter((key) => !replaySecrets[key]);
  if (missing.length) return showMessage({ error: `Koşuda maskeli (******) alanlar var. Oynatmadan önce değerlerini girin: ${missing.join(', ')}` });
  showMessage(null);
  checkReplay(tab, edges);
};

// Oynatmadan önceki kontroller: ekran senaryonun başlangıç node'u mu, bekleyen aksiyonlar
// silinecek mi. Sorun yoksa oynatma başlar (startIfClear); varsa kart açılır. Sekme başlangıç
// node'unun adresinde (URL şablonu) değilse kartta "Başlangıç node'una dön" çıkar. Sayfa
// okunamıyorsa (tarayıcının kendi sayfası, eklentiden önce açılmış sayfa) adres farklıysa yine
// kart açılır: başlangıca dönmek sayfayı da okunur yapar.
// Görünen alan sorun değildir: oynatma onu başlangıç node'unun boyutuna kendisi getirir
// (replay.js > fitStart). Boyut farklıysa ekran burada karşılaştırılmaz (state ekrana sığan
// elementlerden oluşur, yanlış boyutta tutmayabilir); karşılaştırmayı oynatma boyutu kurduktan
// sonra yapar.
// Ana graph senaryonun kopyasından sonra değiştiyse kartta söylenir: oynatılan kopyadır,
// değişiklikleri almak için "Ana graph'tan yenile".
async function checkReplay(tab, edges, { startIfClear = true } = {}) {
  const start = replayNode(replayGraph().start);
  const drift = snapshotDrift(state, scenario.graph, scenario.runs);
  const page = await chrome.tabs.sendMessage(tab.id, { type: 'GET_FINGERPRINT' }, { frameId: 0 }).catch(() => null);
  const address = page?.url ?? (await chrome.tabs.get(tab.id).catch(() => null))?.url ?? '';
  const addressDiffers = !sameAddress(address, start.url);
  if (!page && !addressDiffers) return showMessage({ error: 'Bu sekmeye erişilemedi. Sayfayı yenileyip (F5) tekrar deneyin. (chrome:// sayfaları desteklenmez.)' });
  const viewportDiffers = Boolean(page && start.viewport) && viewportText(start.viewport) !== viewportText(page.viewport);
  const check = page && !viewportDiffers && compareScreen(start, page, settings);
  const reasons = [
    ...(page ? [] : ['Bu sekmedeki sayfa okunamadı (tarayıcının kendi sayfası ya da eklenti yüklenmeden önce açılmış bir sayfa).']),
    ...(page && addressDiffers && viewportDiffers ? [`Sekme başlangıç node'unun ("${start.name}") adresinde değil.`] : []),
    ...(check && !check.ok ? mismatchLines(check, start) : []),
    ...(state.buffer.length ? [`"Bekleyen aksiyonlar"daki ${state.buffer.length} aksiyon silinecek: oynatma kaydı durdurur.`] : []),
    ...(drift.length ? [`${driftText(drift)} Oynatma senaryonun graph'ını (kopyayı) oynatır; değişiklikleri almak için "Ana graph'tan yenile".`] : []),
  ];
  if (!reasons.length) {
    closeReplayCheck();
    return startIfClear ? runReplay(tab, edges) : showMessage({ notice: `Ekran "${start.name}" node'unun adresinde. "Koşuyu oynat"a basın.` });
  }
  replayStart = { tab, edges, start };
  $('replay-check-text').textContent = (check && !check.ok) || addressDiffers
    ? `Başlangıç node'ları aynı değil: bu sekme koşunun ilk node'unun ("${start.name}") ekranında değil. Koşu doğru sonuç vermeyecektir.`
    : 'Oynatmadan önce:';
  $('replay-check-reasons').replaceChildren(...reasons.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  $('btn-replay-refresh').hidden = !drift.length;
  $('btn-replay-fit').hidden = !addressDiffers;
  $('btn-replay-fit').title = addressDiffers ? `${start.url} adresine gider` : '';
  $('btn-replay-fit').classList.toggle('primary', addressDiffers);
  $('btn-replay-anyway').classList.toggle('primary', !addressDiffers);
  $('btn-replay-anyway').hidden = !page; // okunamayan sayfada oynatma ilk adımda kalır
  $('replay-check').hidden = false;
  renderReplay();
}

// "Başlangıç node'una dön": sekme başlangıç node'unun adresine gider. Site başka bir adrese
// yönlendirdiyse (giriş gerektiren sayfa) uyarı kalır. Sonunda kontrol yeniden yapılır.
$('btn-replay-fit').onclick = async () => {
  const pending = replayStart;
  if (!pending) return;
  const { tab, edges, start } = pending;
  $('btn-replay-fit').disabled = true;
  try {
    const screen = await goToAddress(tab.id, start.url).catch((error) => { throw new Error(`Adrese gidilemedi: ${error.message}`); });
    await checkReplay(tab, edges, { startIfClear: false });
    if (!sameAddress(screen.url, start.url)) {
      showMessage({ error: `Site başka bir adrese yönlendirdi: ${screen.url}. Başlangıç ekranına ("${start.name}") elle ulaşın (örneğin önce giriş yapın), sonra "Koşuyu oynat"a basın.` });
    }
  } catch (error) {
    showMessage({ error: error.message });
  } finally {
    $('btn-replay-fit').disabled = false;
  }
};

// "Ana graph'tan yenile" (kartta): kopya yeniden alınır, kontrol yenilenmiş koşuyla tekrarlanır.
$('btn-replay-refresh').onclick = async () => {
  const pending = replayStart;
  if (!pending) return;
  await persistScenario();
  const edges = replayEdges();
  if (!edges.length) return closeReplayCheck();
  await checkReplay(pending.tab, edges, { startIfClear: false });
};

$('btn-replay-anyway').onclick = () => {
  const start = replayStart;
  closeReplayCheck();
  if (start) runReplay(start.tab, start.edges);
};
$('btn-replay-cancel').onclick = closeReplayCheck;
$('btn-replay-stop').onclick = () => replay?.stop();

function closeReplayCheck() {
  replayStart = null;
  $('replay-check').hidden = true;
  renderReplay();
}

// Oynatma sonucu hangi senaryonun hangi koşusunun (o anki edge'leriyle).
function runKey() {
  return JSON.stringify([scenario.id, scenario.runs[scenarioRun]]);
}

async function runReplay(tab, edges) {
  const key = runKey();
  await send({ type: 'REPLAY', active: true });
  const graph = replayGraph();
  replay = startReplay({
    tabId: tab.id, edges, settings, secrets: replaySecrets, slow: $('replay-slow').checked,
    nodes: new Map(graph.nodes.map((n) => [n.id, n])),
    scenario: { id: scenario.id, graph },
    onUpdate: renderScenario,
  });
  renderStatus();
  renderScenario();
  const result = await replay.done;
  replay = null;
  replayResult = { runKey: key, ...result };
  await send({ type: 'REPLAY', active: false, endNodeId: result.endNodeId, tabId: result.tabId });
  const broken = result.steps.find((s) => s.status === 'failed' || s.status === 'stopped');
  const end = nodeById(result.endNodeId);
  showMessage(broken
    ? { error: `Koşu ${broken.status === 'stopped' ? 'durduruldu' : `"${broken.name}" adımında kaldı`}. Kayda devam etmek için bulunduğunuz ekranın node'unu seçip "Buradan devam et"e basın.` }
    : { notice: `Koşu geçti: ${result.steps.length}/${result.steps.length} edge. Kayıt "${end?.name}" node'undan sürüyor.` });
  renderStatus();
  renderScenario();
}

// Kalınan ekran ↔ beklenen node'un kayıttaki ekranı (onay kartındaki karşılaştırmanın görünümleri).
$('btn-replay-compare').onclick = () => {
  renderReplayCompare();
  $('replay-compare-dialog').showModal();
};
$('btn-replay-compare-close').onclick = () => $('replay-compare-dialog').close();
for (const button of $('replay-compare-modes').querySelectorAll('button')) {
  button.onclick = () => { compareMode = button.dataset.mode; renderReplayCompare(); };
}

async function renderReplayCompare() {
  const step = replayResult?.steps.find((s) => s.status === 'failed');
  const node = nodeById(step?.target);
  if (!step?.screenshot || !node?.screenshot) return $('replay-compare-dialog').close();
  for (const button of $('replay-compare-modes').querySelectorAll('button')) button.classList.toggle('active', button.dataset.mode === compareMode);
  step.visualDiff ??= compareScreenshots(step.screenshot, node.screenshot).catch(() => null);
  const [result, current, other] = await Promise.all([step.visualDiff, loadImage(step.screenshot), loadImage(node.screenshot)]);
  $('replay-compare-info').textContent = (result
    ? `Görsel fark: ${percent(result.ratio)} · ${result.boxes.length ? `${result.boxes.length} farklı bölge` : 'farklı bölge yok'}`
    : 'Görsel fark hesaplanamadı.') + ` · Şu anki sayfa: oynatmanın kaldığı ekran; beklenen: ${node.name}.`;
  const screen = step.mismatch?.screen ?? {};
  $('replay-compare-warnings').replaceChildren(...compareWarnings({ url: screen.url ?? node.url, title: screen.title ?? node.title, viewport: screen.viewport }, node, result)
    .map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  $('replay-compare-view').replaceChildren(...compareView(current, other, node, result));
}

// Panel, oynatma sürerken kapandıysa kayıt durmuş kalmasın: bayrak temizlenir, eklentinin
// sekmelere bağlantısı kesilir.
chrome.storage.session.get('replay').then((r) => {
  if (!r.replay) return;
  chrome.debugger.getTargets().then((targets) => {
    for (const t of targets) if (t.attached && t.tabId) chrome.debugger.detach({ tabId: t.tabId }).catch(() => { });
  });
  send({ type: 'REPLAY', active: false });
});


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
$('settings-record-waits').onchange = renderSaveButton;
$('settings-min-wait').oninput = renderSaveButton;
$('settings-auto-wait').oninput = renderSaveButton;

// İsteğe bağlı aksiyon tipleri (settings.js > ACTION_TYPES > optional): işaretlenenler saklanır.
const OPTIONAL_ACTIONS = new Set(ACTION_TYPES.filter((a) => a.optional).map((a) => a.type));

// Taslak: kutuların o anki hali ve bekleme seçenekleri. Listelerde işareti kaldırılanlar,
// isteğe bağlı aksiyonlarda işaretlenenler saklanır. Geçersiz alt sınır (boş, negatif) ve
// geçersiz otomatik bekleme (boş, kesirli, 0-60000 dışı) varsayılana döner.
function draftSettings() {
  const minWait = Number($('settings-min-wait').value);
  const autoWait = Number($('settings-auto-wait').value);
  const boxes = (id) => [...$(id).querySelectorAll('input')];
  return {
    disabledActions: boxes('settings-actions').filter((b) => !b.checked && !OPTIONAL_ACTIONS.has(b.value)).map((b) => b.value),
    enabledActions: boxes('settings-actions').filter((b) => b.checked && OPTIONAL_ACTIONS.has(b.value)).map((b) => b.value),
    disabledInteractables: boxes('settings-interactables').filter((b) => !b.checked).map((b) => b.value),
    recordWaits: $('settings-record-waits').checked,
    minWaitSeconds: $('settings-min-wait').value !== '' && minWait >= 0 ? minWait : DEFAULT_SETTINGS.minWaitSeconds,
    autoWaitMs: $('settings-auto-wait').value !== '' && Number.isInteger(autoWait) && autoWait >= 0 && autoWait <= 60000 ? autoWait : DEFAULT_SETTINGS.autoWaitMs,
  };
}

function isDirty() {
  const draft = draftSettings();
  const same = (a, b) => [...a].sort().join('\n') === [...b].sort().join('\n');
  return ['disabledActions', 'enabledActions', 'disabledInteractables'].some((key) => !same(draft[key], settings[key]))
    || draft.recordWaits !== settings.recordWaits || draft.minWaitSeconds !== settings.minWaitSeconds
    || draft.autoWaitMs !== settings.autoWaitMs;
}

// Kutuları kaydedilmiş ayarlara eşitler (taslağı atar).
function loadDraft() {
  for (const box of $('settings-actions').querySelectorAll('input')) box.checked = isActionEnabled(settings, box.value);
  for (const box of $('settings-interactables').querySelectorAll('input')) box.checked = !settings.disabledInteractables.includes(box.value);
  $('settings-record-waits').checked = settings.recordWaits;
  $('settings-min-wait').value = settings.minWaitSeconds;
  $('settings-auto-wait').value = settings.autoWaitMs;
  renderSaveButton();
}

function renderSaveButton() {
  const dirty = isDirty();
  $('btn-settings-save').disabled = !dirty;
  if (dirty) $('settings-saved').hidden = true;
  $('settings-min-wait').disabled = !$('settings-record-waits').checked; // alt sınır yalnızca beklemeler kaydedilirken anlamlı
}

async function saveSettings() {
  const draft = draftSettings();
  await send({ type: 'SET_SETTINGS', settings: draft });
  settings = { ...DEFAULT_SETTINGS, ...draft }; // storage bildirimi gelmeden buton doğru görünsün
  $('settings-min-wait').value = settings.minWaitSeconds;
  $('settings-auto-wait').value = settings.autoWaitMs;
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
// 'close' olayı kapatmadan sonra ayrı bir görevde gelir; pencere o arada yeniden
// açıldıysa olay eskidir, yok sayılır.
$('settings-dialog').onclose = () => {
  if ($('settings-dialog').open || !isDirty()) return;
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

// Background ilk mesajda graph listesini kurar (eski sürümün tek 'state' anahtarını taşır);
// ardından aktif graph okunur.
chrome.runtime.sendMessage({ type: 'SYNC' }).catch(() => null).then(async () => {
  const r = await chrome.storage.local.get(['graphs', 'activeGraph', 'settings']);
  graphs = r.graphs ?? [];
  activeGraphId = r.activeGraph ?? null;
  settings = { ...DEFAULT_SETTINGS, ...r.settings };
  await showGraph(activeGraphId);
});

async function showGraph(id) {
  const key = 'graph:' + id;
  const stored = id ? (await chrome.storage.local.get(key))[key] : null;
  if (id !== activeGraphId) return; // bu arada yine değişti
  state = stored ? normalizeState(stored) : { ...EMPTY_STATE, id };
  if (!scenario.id) restoreScenario();
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.graphs) {
    graphs = changes.graphs.newValue ?? [];
    renderGraphs();
  }
  if (changes.activeGraph && changes.activeGraph.newValue !== activeGraphId) {
    activeGraphId = changes.activeGraph.newValue;
    onGraphSwitched();
    showGraph(activeGraphId);
  } else if (changes['graph:' + activeGraphId]?.newValue) {
    const next = normalizeState(changes['graph:' + activeGraphId].newValue);
    noteScenarioRemoval(next);
    state = next;
    render();
  }
  if (changes.settings) {
    // Kaydedilmiş ayarlar değişti. Açık pencerede taslak korunur, sadece buton güncellenir.
    settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    renderSaveButton();
    renderStatus(); // "Beklemeler kaydediliyor" ve "Node oluştur" kilidi ayara bağlı
  }
});
