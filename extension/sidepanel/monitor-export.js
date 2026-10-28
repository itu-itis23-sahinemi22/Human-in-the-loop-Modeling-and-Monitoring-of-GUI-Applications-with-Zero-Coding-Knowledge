// =============================================================================
// monitor-export.js — DIŞA / İÇE AKTARMA ve GRAPH YEDEĞİ
// -----------------------------------------------------------------------------
// Monitör modülünün dışa aktarma parçası (dosya düzeni: monitor-store.js başlığı).
//   - GraphWalker JSON: panel.js > graphWalkerModel() sarmalanır; monitörler modelin
//     properties.graphRecorder.monitors alanına, node / edge monitörleri ayrıca ilgili vertex'in /
//     edge'in properties.monitors alanına yazılır (GraphWalker bu alanları yok sayar).
//   - "Yükle…": dışa aktarılmış bir JSON'daki monitörler mevcut listeye eklenir.
//   - Graph yedeği (Graph'lar > Dışa aktar / Yükle…): graphBackup() sarmalanır; yedek yüklenince
//     monitörler yeni graph'a geri gelir (node ve edge id'leri yedekte korunur).
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
function importMonitorItems(list) {
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
      id: 'm' + monitors.nextId++, type: type.id, scope: raw.scope === 'global' ? 'global' : String(raw.scope ?? 'global'),
      action: normalizeActionRef(raw.action), params, severity: severities.has(raw.severity) ? raw.severity : 'error', enabled: raw.enabled !== false, name, createdAt: new Date().toISOString(),
    });
  }
  monitors.items.push(...added);
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
  if (pendingBackup) renderMonitors(); // uygulanması bir çizime bağlı; yeni graph'a geçiş onu zaten tetikler, burası emniyet
}, true);

function applyPendingBackup() {
  if (!pendingBackup) return;
  if (Date.now() - pendingBackup.at > PENDING_BACKUP_MS) { pendingBackup = null; return; }
  const entry = activeGraph();
  const fresh = entry && entry.created >= pendingBackup.at - 1000 && !monitors.items.length;
  const sameNodes = pendingBackup.nodeIds.length > 0 && pendingBackup.nodeIds.every((id) => nodeById(id)); // boş yedek herhangi bir graph'a yapışmasın
  if (!fresh || !sameNodes) return;
  const result = importMonitorItems(pendingBackup.items);
  pendingBackup = null;
  saveMonitors().then(() => {
    showMessage({ notice: importSummary(result, 'Yedekteki ') });
    renderMonitors();
  });
}
