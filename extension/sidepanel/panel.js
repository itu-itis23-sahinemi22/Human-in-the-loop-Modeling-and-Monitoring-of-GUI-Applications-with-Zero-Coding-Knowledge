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

const EMPTY_STATE = { tabId: null, tabs: [], tabPrompt: null, currentNodeId: null, startNodeId: null, nodes: [], edges: [], buffer: [], pending: null, undo: [] };

let state = EMPTY_STATE;
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
  renderTabPrompt();
  renderConfirm();
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
    ? 'Kayıt sekmesi kapandı. Bu sekme şu anki node\'un ekranındaysa kayıt burada sürsün mü?'
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

function renderDetails() {
  const node = nodeById(selectedId);
  const edge = state.edges.find((e) => e.id === selectedId);
  const item = node || edge;
  $('details').hidden = !item;
  if (!item) return;

  $('details-title').textContent = node ? 'Node' : 'Edge';
  $('details-subtitle').textContent = node
    ? node.url + (node.viewport ? ' · ' + viewportText(node.viewport) : '')
    : `${nodeById(edge.source)?.name} → ${nodeById(edge.target)?.name} · ${edge.actions.length} aksiyon`
      + (edge.recordedActions ? ` · düzenlendi (kayıtta ${edge.recordedActions.length})` : '');
  // Kullanıcı o an yazıyorsa input'u ezme
  if (document.activeElement !== $('details-name')) $('details-name').value = item.name;

  $('details-shot').hidden = !node;
  if (node) $('details-shot').src = node.screenshot;
  $('details-actions').replaceChildren(...(edge ? editableActionItems(edge) : []));
  $('btn-continue').hidden = !node;
  $('btn-merge').hidden = !node;
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
// aksiyonun sonrası görülemediyse (null) etki "bilinmiyor"dur.

const EFFECT_TEXT = { changed: 'ekranı değiştirdi', unchanged: 'ekranı değiştirmedi', unknown: 'etkisi bilinmiyor' };

function effectOf(action) {
  return action.changed === true ? 'changed' : action.changed === false ? 'unchanged' : 'unknown';
}

function editableActionItems(edge) {
  return edge.actions.map((action, i) => {
    const li = actionItem(action);
    li.classList.add('editable');
    const badge = document.createElement('span');
    const effect = effectOf(action);
    badge.className = 'effect ' + effect;
    badge.textContent = EFFECT_TEXT[effect];
    li.querySelector('span').after(badge);

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
  if (effect === 'unchanged') return [];
  if (effect === 'unknown') {
    return ['Bu aksiyonun ekrana etkisi bilinmiyor (eski bir kayıt ya da aksiyonun sonrası görülmeden başka bir aksiyon yapıldı).'];
  }

  const reasons = ['Bu aksiyon ekranı (etkileşimli element kümesini) değiştirmişti.'];
  if (i === edge.actions.length - 1) {
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
function renderBuffer() {
  $('buffer-count').textContent = state.buffer.length;
  const locked = Boolean(state.pending) || Boolean(replay);
  $('buffer').replaceChildren(...state.buffer.map((action, i) => {
    const li = actionItem(action);
    if (locked) return li;
    li.classList.add('editable');
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
}

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

// Süre: "3,2 sn"
function seconds(ms) {
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

// Dışa aktarılan modelin adı: başlangıç node'unun adı, "v_" öneki olmadan.
function modelName() {
  return nodeById(state.startNodeId)?.name.replace(/^v_/, '') || 'GraphRecorder';
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

// Dışa aktarılan aksiyon: "state'i değiştirdi mi?" işareti (changed) yalnızca paneldeki silme
// uyarısı içindir, dışarı çıkmaz. screenBefore/screenAfter önceki sürümlerle kaydedilmiş
// aksiyonlarda kalmış olabilir.
function replayAction({ changed, screenBefore, screenAfter, ...action }) {
  return action;
}


// -----------------------------------------------------------------------------
// SENARYO: test yolları (koşular); önizleme, elle yol, indirme / yükleme (scenario.js)
// -----------------------------------------------------------------------------
// Senaryo: başlangıç node'undan başlayan bir ya da birden fazla koşu. Runner her koşuyu temiz
// bir oturumla baştan oynatır; yol çıkmaz bir node'a varırsa kalan edge'ler yeni koşuyla
// kapsanır. Senaryo panelin kendi durumudur (graph state'i değil, storage'a yazılmaz): panel
// kapanınca gider, "Senaryo indir" ile dosyaya alınır.
//
// Stratejiler: "Elle seç" kullanıcı graph'ta edge'lere tıklayarak koşuları kurar. Bir
// planlayıcı stratejisi koşuları kendisi hesaplar: { id, text, plan(graph) } ve plan,
// { runs, planner } döndüren bir Promise'tir.
//
// Başlangıç: koşular varsayılan olarak graph'ın başlangıcından başlar; "Başlangıç" listesinden
// başka bir node seçilebilir (scenario.start; null = graph'ın başlangıcı). Böyle bir senaryo
// yalnızca panelde oynatılır, runner reddeder (extension/scenario.js).
const STRATEGIES = [{ id: 'manual', text: "Elle seç (graph'ta edge'lere tıklayın)" }];

let scenario = emptyScenario();
let scenarioRun = 0; // seçili koşu

function emptyScenario() {
  return { name: null, planner: { engine: 'manual' }, start: null, runs: [[]] };
}

// Senaryonun graph'ı; start, senaryonun başlangıç node'u (seçilen node silindiyse graph'ın başlangıcı).
function scenarioGraph() {
  const start = nodeById(scenario.start) ? scenario.start : state.startNodeId;
  return { start, nodes: state.nodes, edges: state.edges };
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

// Elle yol, bölüm açıkken ve "Elle seç" stratejisindeyken kurulur: edge'e tıklamak onu koşuya ekler.
function scenarioEditing() {
  return $('scenario').open && $('scenario-strategy').value === 'manual';
}

$('scenario-strategy').replaceChildren(...STRATEGIES.map(({ id, text }) => Object.assign(document.createElement('option'), { value: id, textContent: text })));

function renderScenario() {
  const graph = scenarioGraph();
  const runs = scenario.runs;
  const run = runs[scenarioRun] ?? [];
  const filled = runs.filter((r) => r.length);
  const coverage = coverageOf(graph, filled);
  const problem = runProblem(graph, runs);
  const locked = Boolean(replay); // oynatma sürerken senaryo değişmez
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
      + (scenario.name ? ` · ${scenario.name}` : '');
  const end = runEnd(graph, run);
  const next = problem ? [] : graph.edges.filter((e) => e.source === end);
  $('scenario-hint').textContent = !scenarioEditing() ? ''
    : !graph.start ? 'Önce graph kaydedin.'
      : next.length ? `"${nodeById(end)?.name}" node'undan çıkan bir edge'e tıklayın (kesik çizgili).`
        : `Koşu çıkmaz bir node'da (${nodeById(end)?.name}) bitti. Kalan edge'ler için "Yeni koşu".`;
  $('btn-scenario-undo').disabled = locked || (!run.length && runs.length === 1);
  $('btn-scenario-new-run').disabled = locked || !run.length;
  $('btn-scenario-clear').disabled = locked || !filled.length;
  $('btn-scenario-load').disabled = locked;
  $('scenario-strategy').disabled = locked;
  $('btn-scenario-download').disabled = !filled.length || Boolean(problem);
  renderScenarioStart(graph, locked);
  renderReplay();

  // Graph'ta önizleme: yalnızca bölüm açıkken
  cy.elements().removeClass('faded run-edge run-next run-end run-start replay-passed replay-running replay-failed');
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
  scenario.name = null;
  showMessage(null);
  renderScenario();
}

$('scenario').ontoggle = renderScenario;

// Başlangıç değişince mevcut koşular yeni başlangıçtan yürünemiyorsa temizlenir.
$('scenario-start').onchange = () => {
  const start = $('scenario-start').value;
  scenario.start = start === state.startNodeId ? null : start;
  if (scenario.runs.some((r) => r.length) && runProblem(scenarioGraph(), scenario.runs)) {
    scenario = { ...emptyScenario(), start: scenario.start };
    scenarioRun = 0;
    showMessage({ notice: `Koşular "${nodeById(scenarioGraph().start)?.name}" node'undan yürünemediği için temizlendi.` });
  } else {
    showMessage(null);
  }
  renderScenario();
};

$('scenario-strategy').onchange = async () => {
  const strategy = STRATEGIES.find((s) => s.id === $('scenario-strategy').value);
  if (strategy?.plan) {
    try {
      const { runs, planner } = await strategy.plan(scenarioGraph());
      scenario = { name: `${modelName()} · ${strategy.text}`, planner, runs: runs.length ? runs : [[]] };
      scenarioRun = 0;
      showMessage(null);
    } catch (error) {
      showMessage({ error: error.message });
    }
  }
  renderScenario();
};

$('btn-scenario-undo').onclick = () => {
  const run = scenario.runs[scenarioRun];
  if (run.length) run.pop();
  else if (scenario.runs.length > 1) {
    scenario.runs.splice(scenarioRun, 1);
    scenarioRun = Math.max(0, scenarioRun - 1);
  }
  scenario.planner = { engine: 'manual' };
  renderScenario();
};

$('btn-scenario-new-run').onclick = () => {
  scenario.runs.push([]);
  scenarioRun = scenario.runs.length - 1;
  renderScenario();
};

$('btn-scenario-clear').onclick = () => {
  scenario = { ...emptyScenario(), start: scenario.start }; // başlangıç seçimi kalır
  scenarioRun = 0;
  renderScenario();
};

// Senaryo dosyası: model dosyasıyla aynı klasöre indirilmesi beklenir (runner model yolunu
// senaryoya göre çözer). Elle kurulan senaryonun adı modelden gelir. start yalnızca graph'ın
// başlangıcı dışında bir node seçildiyse yazılır.
$('btn-scenario-download').onclick = () => {
  const runs = scenario.runs.filter((r) => r.length);
  const graph = scenarioGraph();
  const name = modelName();
  downloadJson(`${name}-senaryo.json`, {
    format: SCENARIO_FORMAT,
    name: scenario.name ?? `${name} · elle seçilen yol`,
    model: `${name}.json`,
    ...(graph.start !== state.startNodeId && { start: graph.start }),
    planner: scenario.planner,
    runs,
    coverage: coverageOf(graph, runs),
  });
};

// Bir senaryo dosyasını önizlemek için yükler (ör. komut satırında üretilmiş). Bu graph'la
// yürünemiyorsa (edge silinmiş, başka model) reddedilir.
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
    scenario = { name: json.name ?? file.name, planner: json.planner ?? { engine: 'manual' }, start, runs: json.runs.map((run) => [...run]) };
    scenarioRun = 0;
    showMessage({ notice: `"${scenario.name}" yüklendi: ${json.runs.length} koşu.` });
  } catch (error) {
    showMessage({ error: `Senaryo yüklenemedi: ${error.message}` });
  }
  renderScenario();
};


// -----------------------------------------------------------------------------
// PANELDE OYNATMA: seçili koşu bu tarayıcıda, açık sekmede (replay.js)
// -----------------------------------------------------------------------------
// Başlangıç sayfası kullanıcının sorumluluğudur: oynatma sayfaya kendisi gitmez. Önce ekran
// koşunun ilk node'uyla (senaryonun başlangıcı) karşılaştırılır; farklıysa uyarı çıkar,
// kullanıcı yine de oynatabilir. Oynatma sürerken background kaydı durdurur; bitince koşu geçtiyse kayıt
// vardığı node'dan sürer, geçmediyse şu anki node bilinmez (background.js > PANELDE OYNATMA).
// Graph'ta ilerleme canlı görünür; kalınan adımda fark listesi ve beklenen ekranla görsel
// karşılaştırma.

let replay = null;        // sürüyorsa oynatma (replay.js > startReplay)
let replayResult = null;  // son oynatmanın sonucu ve hangi koşu için olduğu (runKey)
let replayStart = null;   // uyarı kartı açıkken başlatılmayı bekleyen oynatma { tab, edges }
const replaySecrets = {}; // maskeli alanların değerleri: yalnızca panel açıkken bellekte, saklanmaz

function replayEdges() {
  return (scenario.runs[scenarioRun] ?? []).map((id) => state.edges.find((e) => e.id === id)).filter(Boolean);
}

// Panelde gösterilen oynatma: süren ya da seçili koşu için en son biten.
function shownReplay() {
  if (replay) return replay;
  return replayResult?.runKey === JSON.stringify(scenario.runs[scenarioRun]) ? replayResult : null;
}

function renderReplay() {
  const edges = replayEdges();
  const running = Boolean(replay);
  const problem = runProblem(scenarioGraph(), scenario.runs);
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
  $('replay-diff').replaceChildren(...(broken?.mismatch ? mismatchLines(broken.mismatch, nodeById(broken.target)) : [])
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
    const actions = state.edges.find((e) => e.id === step.edgeId)?.actions.length ?? 0;
    return `Oynatılıyor · adım ${shown.step + 1}/${total}: ${step.name}`
      + (shown.actionLabel ? ` · aksiyon ${shown.action + 1}/${actions}: ${shown.actionLabel}` : ` · ekran "${nodeById(step.target)?.name}" mi?`);
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
  li.querySelector('.name').textContent = `${step.name} → ${nodeById(step.target)?.name ?? step.target}`;
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

// Oynatmadan önceki kontroller: ekran senaryonun başlangıç node'u mu, görünen alan kayıttakiyle
// aynı mı, bekleyen aksiyonlar silinecek mi. Sorun yoksa oynatma başlar (startIfClear); varsa
// kart açılır. Görünen alan, başlangıç node'unun kaydedildiği andakinden farklıysa kartta
// "Başlangıç node'unun boyutuna getir" çıkar (replay.js > fitViewport).
async function checkReplay(tab, edges, { startIfClear = true } = {}) {
  const page = await chrome.tabs.sendMessage(tab.id, { type: 'GET_FINGERPRINT' }, { frameId: 0 }).catch(() => null);
  if (!page) return showMessage({ error: 'Bu sekmeye erişilemedi. Sayfayı yenileyip (F5) tekrar deneyin. (chrome:// sayfaları desteklenmez.)' });
  const start = nodeById(scenarioGraph().start);
  const check = compareScreen(start, page, settings);
  const viewportDiffers = Boolean(start.viewport) && viewportText(start.viewport) !== viewportText(page.viewport);
  const reasons = [
    ...(check.ok ? [] : mismatchLines(check, start)),
    ...(check.ok && viewportDiffers ? [`Görünen alan farklı: başlangıç node'u ("${start.name}") ${viewportText(start.viewport)} boyutunda kaydedildi, sekme şu an ${viewportText(page.viewport)}. State ekrana sığan elementlerden oluştuğu için sonraki ekranlar tutmayabilir.`] : []),
    ...(state.buffer.length ? [`"Bekleyen aksiyonlar"daki ${state.buffer.length} aksiyon silinecek: oynatma kaydı durdurur.`] : []),
  ];
  if (!reasons.length) {
    closeReplayCheck();
    return startIfClear ? runReplay(tab, edges) : showMessage({ notice: `Ekran "${start.name}" node'unun ekranı ve görünen alan kayıttakiyle aynı. "Koşuyu oynat"a basın.` });
  }
  replayStart = { tab, edges, viewport: viewportDiffers ? start.viewport : null, startName: start.name };
  $('replay-check-text').textContent = check.ok
    ? 'Oynatmadan önce:'
    : `Başlangıç node'ları aynı değil: bu sekme koşunun ilk node'unun ("${start.name}") ekranında değil. Koşu doğru sonuç vermeyecektir.`;
  $('replay-check-reasons').replaceChildren(...reasons.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  $('btn-replay-fit').hidden = !viewportDiffers || Boolean(fitGuide); // yönlendirme sürerken buton bir şey değiştiremez
  if (viewportDiffers) $('btn-replay-fit').textContent = `Başlangıç node'unun boyutuna getir (${viewportText(start.viewport)})`;
  $('btn-replay-fit').classList.toggle('primary', viewportDiffers);
  $('btn-replay-anyway').classList.toggle('primary', !viewportDiffers);
  $('replay-check').hidden = false;
  renderReplay();
}

// Sekmenin yakınlaştırması ve pencere boyutu başlangıç node'unun kaydedildiği andakine getirilir,
// kontrol yeniden yapılır. Pencere büyüyemediği için görünen alan küçük kaldıysa yönlendirme başlar.
$('btn-replay-fit').onclick = async () => {
  const pending = replayStart;
  if (!pending?.viewport) return;
  $('btn-replay-fit').disabled = true;
  try {
    const { viewport: reached, short } = await fitViewport(pending.tab.id, pending.viewport);
    await checkReplay(pending.tab, pending.edges, { startIfClear: false });
    if (short && (short.width > 0 || short.height > 0)) {
      fitGuide = { tab: pending.tab, edges: pending.edges, target: pending.viewport };
      renderFitGuide(fitGuide, reached, await chrome.tabs.getZoom(pending.tab.id));
    } else if (viewportText(reached) !== viewportText(pending.viewport)) {
      showMessage({ error: `Görünen alan tam tutturulamadı: "${pending.startName}" ${viewportText(pending.viewport)} boyutunda kaydedildi, ulaşılan ${viewportText(reached)}.` });
    }
  } catch (error) {
    showMessage({ error: `Görünen alan ayarlanamadı: ${error.message}` });
  } finally {
    $('btn-replay-fit').disabled = false;
  }
};

// YÖNLENDİRME: pencere büyüyemediği için görünen alan küçük kaldı (pencere ekranı kaplıyor ya da
// ekran yetmiyor). Genişlik çoğu zaman yan paneli daraltarak kazanılır; eklenti panelin genişliğini
// değiştiremediği için kullanıcı sürükler. Panelin genişliği değiştikçe ('resize') sekmenin
// görünen alanı yeniden ölçülür ve kalan miktar yazılır; tutunca kontrol yenilenir.
let fitGuide = null; // { tab, edges, target }
let fitGuideTimer = null;

addEventListener('resize', () => {
  if (!fitGuide) return;
  clearTimeout(fitGuideTimer);
  fitGuideTimer = setTimeout(updateFitGuide, 250);
});

async function updateFitGuide() {
  const guide = fitGuide;
  const page = guide && await chrome.tabs.sendMessage(guide.tab.id, { type: 'GET_FINGERPRINT' }, { frameId: 0 }).catch(() => null);
  if (!page || fitGuide !== guide) return;
  if (viewportText(page.viewport) === viewportText(guide.target)) {
    stopFitGuide();
    return checkReplay(guide.tab, guide.edges, { startIfClear: false });
  }
  renderFitGuide(guide, page.viewport, await chrome.tabs.getZoom(guide.tab.id));
}

// Kalan miktar ekran pikseliyle (CSS pikseli × yakınlaştırma): kullanıcının sürüklediği birim.
function renderFitGuide(guide, now, zoom) {
  const width = Math.round((guide.target.width - now.width) * zoom);
  const height = Math.round((guide.target.height - now.height) * zoom);
  const steps = [
    ...(width > 0 ? [`Yan paneli kenarından sürükleyerek yaklaşık ${width} piksel daraltın.`] : []),
    ...(width < 0 ? [`${-width} piksel fazla daralttınız; yan paneli biraz genişletin.`] : []),
    ...(height > 0 ? [`Yükseklik ${height} piksel eksik: yer imleri çubuğunu ya da altta açık DevTools'u kapatın ya da pencereyi daha büyük bir ekrana taşıyın.`] : []),
    ...(height < 0 ? [`Yükseklik ${-height} piksel fazla.`] : []),
  ];
  $('replay-fit-guide').textContent = `Pencere bu ekranda daha fazla büyüyemiyor. ${steps.join(' ')} Şu an ${viewportText(now)}, hedef ${viewportText(guide.target)}.`;
  $('replay-fit-guide').hidden = false;
  $('btn-replay-fit').hidden = true;
}

function stopFitGuide() {
  fitGuide = null;
  clearTimeout(fitGuideTimer);
  $('replay-fit-guide').hidden = true;
}

$('btn-replay-anyway').onclick = () => {
  const start = replayStart;
  closeReplayCheck();
  if (start) runReplay(start.tab, start.edges);
};
$('btn-replay-cancel').onclick = closeReplayCheck;
$('btn-replay-stop').onclick = () => replay?.stop();

function closeReplayCheck() {
  replayStart = null;
  stopFitGuide();
  $('replay-check').hidden = true;
  renderReplay();
}

async function runReplay(tab, edges) {
  const runKey = JSON.stringify(scenario.runs[scenarioRun]);
  await send({ type: 'REPLAY', active: true });
  replay = startReplay({
    tabId: tab.id, edges, settings, secrets: replaySecrets, slow: $('replay-slow').checked,
    nodes: new Map(state.nodes.map((n) => [n.id, n])),
    onUpdate: renderScenario,
  });
  renderStatus();
  renderScenario();
  const result = await replay.done;
  replay = null;
  replayResult = { runKey, ...result };
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

// İsteğe bağlı aksiyon tipleri (settings.js > ACTION_TYPES > optional): işaretlenenler saklanır.
const OPTIONAL_ACTIONS = new Set(ACTION_TYPES.filter((a) => a.optional).map((a) => a.type));

// Taslak: kutuların o anki hali ve bekleme seçenekleri. Listelerde işareti kaldırılanlar,
// isteğe bağlı aksiyonlarda işaretlenenler saklanır. Geçersiz alt sınır (boş, negatif)
// varsayılana döner.
function draftSettings() {
  const minWait = Number($('settings-min-wait').value);
  const boxes = (id) => [...$(id).querySelectorAll('input')];
  return {
    disabledActions: boxes('settings-actions').filter((b) => !b.checked && !OPTIONAL_ACTIONS.has(b.value)).map((b) => b.value),
    enabledActions: boxes('settings-actions').filter((b) => b.checked && OPTIONAL_ACTIONS.has(b.value)).map((b) => b.value),
    disabledInteractables: boxes('settings-interactables').filter((b) => !b.checked).map((b) => b.value),
    recordWaits: $('settings-record-waits').checked,
    minWaitSeconds: $('settings-min-wait').value !== '' && minWait >= 0 ? minWait : DEFAULT_SETTINGS.minWaitSeconds,
  };
}

function isDirty() {
  const draft = draftSettings();
  const same = (a, b) => [...a].sort().join('\n') === [...b].sort().join('\n');
  return ['disabledActions', 'enabledActions', 'disabledInteractables'].some((key) => !same(draft[key], settings[key]))
    || draft.recordWaits !== settings.recordWaits || draft.minWaitSeconds !== settings.minWaitSeconds;
}

// Kutuları kaydedilmiş ayarlara eşitler (taslağı atar).
function loadDraft() {
  for (const box of $('settings-actions').querySelectorAll('input')) box.checked = isActionEnabled(settings, box.value);
  for (const box of $('settings-interactables').querySelectorAll('input')) box.checked = !settings.disabledInteractables.includes(box.value);
  $('settings-record-waits').checked = settings.recordWaits;
  $('settings-min-wait').value = settings.minWaitSeconds;
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

chrome.storage.local.get(['state', 'settings']).then((r) => {
  state = r.state ? normalizeState(r.state) : EMPTY_STATE;
  settings = { ...DEFAULT_SETTINGS, ...r.settings };
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.state) {
    state = changes.state.newValue ? normalizeState(changes.state.newValue) : EMPTY_STATE;
    render();
  }
  if (changes.settings) {
    // Kaydedilmiş ayarlar değişti. Açık pencerede taslak korunur, sadece buton güncellenir.
    settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    renderSaveButton();
    renderStatus(); // "Beklemeler kaydediliyor" ve "Node oluştur" kilidi ayara bağlı
  }
});
