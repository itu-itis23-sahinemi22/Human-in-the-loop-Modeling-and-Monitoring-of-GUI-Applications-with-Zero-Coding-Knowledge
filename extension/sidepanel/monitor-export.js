// =============================================================================
// monitor-export.js — DIŞA / İÇE AKTARMA ve GRAPH YEDEĞİ
// -----------------------------------------------------------------------------
// Monitör modülünün dışa aktarma parçası (dosya düzeni: monitor-store.js başlığı).
//   - GraphWalker JSON: panel.js > graphWalkerModel() sarmalanır; monitörler modelin
//     properties.graphRecorder.monitors alanına, node / edge monitörleri ayrıca ilgili vertex'in /
//     edge'in properties.monitors alanına yazılır (GraphWalker bu alanları yok sayar).
//   - "Yükle…": dışa aktarılmış bir JSON'daki monitörler mevcut listeye eklenir.
//   - Graph yedeği (Graph'lar > Dışa aktar / Yükle…): graphBackup() sarmalanır; yedek yüklenince
//     monitörler yeni graph'a geri gelir (node ve edge id'leri yedekte korunur). Senaryoya özel
//     monitörler de yedektedir (scenarioMonitors; senaryo id'leri de korunur).
//   - "Senaryo indir" (panel.js > SENARYO): downloadJson() sarmalanır; senaryo dosyasında kopyadaki
//     node / edge'lerin boş 'monitors: []' yuvaları o senaryonun monitörleriyle dolar, tamamı
//     dosyanın 'monitors' alanında listelenir. Senaryo kartındaki "Yükle…" bu monitörleri yeni
//     senaryoya geri ekler (createScenario sarmalanır).
// Detay: docs/07-monitorler.md > Veri modeli
// =============================================================================

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
  return { id: m.id, type: m.type, name: monitorName(m), scope: m.scope, ...(m.action ? { action: m.action } : {}), params: m.params, severity: m.severity, enabled: m.enabled };
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
// Dosyadan gelen parametreler de formdaki gibi doğrulanır (monitorParamProblem): "min": "abc" gibi
// bir kayıt yeşil yanan boş bir monitör olmasın diye atlanır (invalid sayılır).
// scenarioId verilirse liste o senaryonun monitörleri olur (yedekten geri yükleme).
function importMonitorItems(list, scenarioId = null) {
  const severities = new Set(MONITOR_SEVERITIES.map((s) => s.id));
  let unknown = 0;
  let invalid = 0;
  const added = [];
  for (const raw of list) {
    const type = monitorType(raw?.type);
    if (!type) { unknown++; continue; }
    const params = { ...monitorDefaults(type), ...(raw.params && typeof raw.params === 'object' ? raw.params : {}) };
    if (type.params.some((p) => monitorParamProblem(p, params[p.key]))) { invalid++; continue; }
    const name = typeof raw.name === 'string' && raw.name.trim() && raw.name.trim() !== monitorAutoName(type, params) ? raw.name.trim() : null;
    added.push({
      id: newMonitorId(scenarioId), type: type.id, scope: raw.scope === 'global' ? 'global' : String(raw.scope ?? 'global'),
      action: normalizeActionRef(raw.action), params, severity: severities.has(raw.severity) ? raw.severity : 'error', enabled: raw.enabled !== false, name,
      ...(scenarioId ? { scenarioId } : {}), createdAt: new Date().toISOString(),
    });
  }
  (scenarioId ? scenarioMonitorList(scenarioId, true) : monitors).items.push(...added);
  return { added, unknown, invalid };
}

// "3 monitör yüklendi, 1 tanesi sahipsiz…; 1 bilinmeyen tür, 2 geçersiz parametre atlandı."
function importSummary({ added, unknown, invalid }, prefix) {
  const skipped = [unknown ? `${unknown} bilinmeyen tür` : '', invalid ? `${invalid} geçersiz parametreli kayıt` : ''].filter(Boolean).join(', ');
  const orphans = added.filter(isOrphan).length;
  return `${prefix}${added.length} monitör ${prefix ? 'de ' : ''}yüklendi` + (orphans ? `, ${orphans} tanesi sahipsiz (öğesi bu graph'ta yok)` : '') + (skipped ? `; ${skipped} atlandı` : '') + '.';
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
    const result = importMonitorItems(list);
    await saveMonitors();
    showMessage({ notice: importSummary(result, '') });
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

// Yedekte senaryoya özel monitörler senaryo id'sine göre: scenarioMonitors.scenarios[senaryo id] = [monitör, ...]
const graphBackupWithoutMonitors = graphBackup; // panel.js
graphBackup = () => ({
  ...graphBackupWithoutMonitors(),
  monitors: { format: MONITORS_FORMAT, items: monitors.items.map(exportMonitor) },
  scenarioMonitors: { format: SCENARIO_MONITORS_FORMAT, scenarios: Object.fromEntries(Object.entries(scenarioMonitors.scenarios).filter(([, list]) => list.items.length).map(([id, list]) => [id, list.items.map(exportMonitor)])) },
});

let pendingBackup = null; // { at, nodeIds, items, scenarios }: yüklenmeyi bekleyen yedeğin monitörleri (genel + senaryo id -> liste)
const PENDING_BACKUP_MS = 2 * 60 * 1000;

document.addEventListener('change', async (event) => {
  if (event.target !== $('graph-file')) return;
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const items = Array.isArray(data?.monitors?.items) ? data.monitors.items : [];
    const raw = data?.scenarioMonitors?.scenarios;
    const scenarios = Object.fromEntries(Object.entries(raw && typeof raw === 'object' ? raw : {}).filter(([, list]) => Array.isArray(list) && list.length));
    pendingBackup = (items.length || Object.keys(scenarios).length) && Array.isArray(data.nodes)
      ? { at: Date.now(), nodeIds: data.nodes.map((n) => n?.id), items, scenarios }
      : null;
  } catch {
    pendingBackup = null; // bozuk dosyayı panel.js kendisi bildirir
  }
  if (pendingBackup) renderMonitors(); // uygulanması bir çizime bağlı; yeni graph'a geçiş onu zaten tetikler, burası emniyet
}, true);

// Yedekteki senaryo monitörleri yalnızca yeni graph'ta aynı id'yle var olan senaryolara yazılır
// (background yedekteki senaryoları id'leriyle alır); senaryosu olmayanlar atlanır.
function applyPendingBackup() {
  if (!pendingBackup) return;
  if (Date.now() - pendingBackup.at > PENDING_BACKUP_MS) { pendingBackup = null; return; }
  const entry = activeGraph();
  const fresh = entry && entry.created >= pendingBackup.at - 1000 && !monitors.items.length && !allScenarioMonitors().length;
  const sameNodes = pendingBackup.nodeIds.length > 0 && pendingBackup.nodeIds.every((id) => nodeById(id)); // boş yedek herhangi bir graph'a yapışmasın
  if (!fresh || !sameNodes) return;
  const result = importMonitorItems(pendingBackup.items);
  const scenarioResult = { added: [], unknown: 0, invalid: 0, missing: 0 };
  for (const [id, list] of Object.entries(pendingBackup.scenarios)) {
    if (!state.scenarios.some((sc) => sc.id === id)) { scenarioResult.missing += list.length; continue; }
    const r = importMonitorItems(list, id);
    scenarioResult.added.push(...r.added);
    scenarioResult.unknown += r.unknown;
    scenarioResult.invalid += r.invalid;
  }
  pendingBackup = null;
  Promise.all([saveMonitors(), scenarioResult.added.length ? saveScenarioMonitors() : null]).then(() => {
    const scenarioNote = scenarioResult.added.length || scenarioResult.missing
      ? ` Senaryolara özel ${scenarioResult.added.length} monitör yüklendi` + (scenarioResult.missing ? `, ${scenarioResult.missing} tanesi senaryosu olmadığı için atlandı` : '') + '.'
      : '';
    showMessage({ notice: importSummary(result, 'Yedekteki ') + scenarioNote });
    renderMonitors();
  });
}


// -----------------------------------------------------------------------------
// SENARYO DOSYASI: Senaryo > "Senaryo indir" / "Yükle…" (panel.js > SENARYO)
// -----------------------------------------------------------------------------
// Senaryo dosyası senaryonun graph'ını (kopya) taşır; kopyadaki her node ve edge'in 'monitors: []'
// yuvası (scenario.js > scenarioSnapshot) senaryoya özel monitörler için ayrılmıştır. Storage'daki
// kopya boş kalır (graph state'ini yalnızca background yazar); dosyada yuvalar o senaryonun
// monitörleriyle dolar ve tamamı (senaryonun tamamı kapsamlılar dahil) dosyanın 'monitors'
// alanında listelenir (GraphWalker JSON'undaki düzenle aynı: liste tek doğruluk kaynağı, yuvalar
// kopya). panel.js'in downloadJson'ı sarmalanır; yalnızca senaryo dosyasına dokunulur, graph yedeği
// ve GraphWalker JSON'u olduğu gibi geçer. Kopya nesnesi değişmez (panelin çalışma kopyası).

function withScenarioMonitors(data) {
  if (data?.format !== SCENARIO_FORMAT || !data.graph?.nodes || !scenario.id) return data;
  const graph = data.graph;
  const items = scenarioMonitorItems(scenario.id).filter((m) => m.scope === 'global' || nodeIn(graph, m.scope) || edgeIn(graph, m.scope)).map(exportMonitor);
  const slot = (item) => ({ ...item, monitors: items.filter((m) => m.scope === item.id) });
  return { ...data, graph: { ...graph, nodes: graph.nodes.map(slot), edges: (graph.edges ?? []).map(slot) }, monitors: { format: MONITORS_FORMAT, items } };
}

const downloadJsonWithoutMonitors = downloadJson; // panel.js
downloadJson = (name, data) => downloadJsonWithoutMonitors(name, withScenarioMonitors(data));

// "Yükle…" dosyayı yeni bir senaryo olarak ekler (yeni senaryo id'si verilir); dosyanın 'monitors'
// alanındaki monitörler o senaryonun listesine yeni id'lerle eklenir (öğesi bu graph'ta olmayan
// sahipsiz gelir). panel.js'in dosya kutusu capture aşamasında okunur (graph yedeğindeki gibi) ve
// createScenario sarmalanır: dosyadan gelen senaryo oluşunca (koşuları dosyadakiyle aynıysa)
// monitörler yazılır. Dosya bu graph'la yürünemediği için reddedilirse senaryo oluşmaz; bekleyen
// monitörler bir sonraki createScenario'da koşular tutmadığı için atılır.
let pendingScenarioFile = null; // Promise<{ runs, items } | null>: seçilen senaryo dosyasının monitörleri

document.addEventListener('change', (event) => {
  if (event.target !== $('scenario-file')) return;
  const file = event.target.files[0];
  pendingScenarioFile = file ? file.text().then((text) => {
    const json = JSON.parse(text);
    const items = json?.format === SCENARIO_FORMAT && Array.isArray(json.monitors?.items) ? json.monitors.items : [];
    return items.length ? { runs: JSON.stringify(json.runs), items } : null;
  }).catch(() => null) : null; // bozuk dosyayı panel.js kendisi bildirir
}, true);

const createScenarioWithoutMonitors = createScenario; // panel.js
createScenario = async (fields, notice = null) => {
  const pending = pendingScenarioFile;
  pendingScenarioFile = null;
  const id = await createScenarioWithoutMonitors(fields, notice);
  const file = await pending;
  if (!id || !file || file.runs !== JSON.stringify(fields.runs)) return id;
  const result = importMonitorItems(file.items, id);
  await saveScenarioMonitors();
  showMessage({ notice: [notice?.notice, importSummary(result, 'Dosyadaki ')].filter(Boolean).join(' ') });
  renderMonitors();
  return id;
};
