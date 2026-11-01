// =============================================================================
// monitor-store.js — MONİTÖR VERİSİ (yan panel; run-time monitoring, Ceren'in kısmı)
// -----------------------------------------------------------------------------
// Kullanıcı, kayıt sırasında test için "monitör" tanımlar: her adımdan sonra kontrol edilecek bir
// kural (test oracle'ı); oynatmada yeşil (bozulmadı) ya da kırmızı (bozuldu) yanar. Üç kapsam:
//   - "Tüm model": kural her node'da kontrol edilir (ör. 4 pt'den küçük yazı yok).
//   - Tek node  : kural yalnızca o node'a varılınca kontrol edilir.
//   - Tek edge  : kural o edge oynatılırken kontrol edilir. Edge birden fazla aksiyondan oluşur;
//                 monitör edge'in SEÇİLEN aksiyonuna bağlanabilir (m.action: o aksiyondan hemen
//                 sonra kontrol) ya da edge'in tamamına (action = null: her aksiyondan sonra).
//
// Monitör modülü yedi dosyadır (panel.html'de bu sırayla, panel.js'ten SONRA yüklenir):
//   monitor-types.js   tür kataloğu (parametreler, doğrulama, ad ve özet cümlesi)
//   monitor-store.js   BU DOSYA: veri — storage, normalize, uyarılar, kapsam ve aksiyon yardımcıları
//   monitor-list.js    Monitörler bölümü, detay alt bölümü, sağ tık menüsü, hale, uyarı pencereleri
//   monitor-dialog.js  ekle / düzenle formu
//   monitor-export.js  GraphWalker JSON'una yazma, "Yükle…", graph yedeği
//   monitor-image.js   görüntü monitörü: parçayı sekmenin ekran görüntüsünde arama (panelde kontrol edilen tek tür)
//   monitor-run.js     oynatmada kontrol ve ışık listesi, "Bu ekranda şimdi kontrol et"
// Dosyalar klasik script'tir; birbirlerinin global fonksiyonlarını çağırırlar (modül yok: Emir'in
// paneli de öyle). panel.js'in global'leri okunur / sarmalanır (state, activeGraph, scenarioView,
// scenario, scenarioGraphOf, selectedId, renderDetails, cy, nodeById, showMessage, ACTION_TEXT,
// graphWalkerModel, graphBackup, downloadJson; scenario.js'ten scenarioSnapshot, SCENARIO_FORMAT);
// panel.js değişmez.
//
// Veri:
//   - Monitörler graph'a aittir ama graph state'inden AYRI bir anahtarda durur:
//     chrome.storage.local > 'monitors:<graph id>'. Graph'ın tek yazarı background.js'tir;
//     monitörlerin tek yazarı bu dosyadır. Graph değişince o graph'ın monitörleri yüklenir;
//     graph silinince anahtarı da silinir. "Sıfırla" graph'ı boşaltır, monitörlere dokunmaz
//     (node / edge monitörleri "sahipsiz" kalır; kullanıcı taşır ya da siler).
//   - Monitörlerin UYARILARI da graph'tan ayrı, kendi anahtarındadır: 'monitor-alarms:<graph id>'.
//     Bir monitör bozulduğunda o anın ekran görüntüsü uyarıyla birlikte burada saklanır; graph'ın
//     node ekran görüntülerine dokunulmaz, modele yazılmaz. Graph başına son MONITOR_ALARM_LIMIT
//     uyarı tutulur (bkz. UYARILAR).
//   - Ana graph'ın monitörleri GENEL kurallardır (her senaryoda kontrol edilir). Bir senaryoya özel
//     monitörler ayrı anahtardadır: 'scenario-monitors:<graph id>' (bkz. SENARYOYA ÖZEL MONİTÖRLER).
// Detay: docs/07-monitorler.md
// =============================================================================

const MONITORS_KEY_PREFIX = 'monitors:';            // chrome.storage.local > monitors:<graph id>
const MONITORS_FORMAT = 'graph-recorder-monitors/v1';
const MONITOR_ALARMS_KEY_PREFIX = 'monitor-alarms:'; // chrome.storage.local > monitor-alarms:<graph id> (bkz. UYARILAR)
const MONITOR_ALARMS_FORMAT = 'graph-recorder-monitor-alarms/v1';
const MONITOR_ALARM_LIMIT = 20;                     // graph başına saklanan son uyarı sayısı (her biri ekran görüntülü)
const SCENARIO_MONITORS_KEY_PREFIX = 'scenario-monitors:'; // chrome.storage.local > scenario-monitors:<graph id> (bkz. SENARYOYA ÖZEL MONİTÖRLER)
const SCENARIO_MONITORS_FORMAT = 'graph-recorder-scenario-monitors/v1';

let monitors = emptyMonitors();  // aktif graph'ın monitörleri: { format, nextId, items: [{ id, type, scope, params, severity, enabled, name, createdAt }] }
let monitorAlarms = emptyAlarms(); // aktif graph'ın monitör uyarıları (ekran görüntüleriyle), bkz. UYARILAR
let scenarioMonitors = emptyScenarioMonitors(); // aktif graph'ın senaryoya özel monitörleri: { format, scenarios: { senaryo id -> { nextId, items } } }
let monitorsGraphId = null;      // monitörleri yüklü graph (storage > activeGraph)
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
      action: normalizeActionRef(m.action),
      createdAt: m.createdAt ?? null,
    })),
  };
}

// Kaydetme hatası (kota, storage kapalı) sessiz kalmaz: kullanıcıya söylenir, çağıran devam eder.
async function saveMonitors() {
  if (!monitorsGraphId) return; // henüz graph yok
  try {
    await chrome.storage.local.set({ [monitorsKey()]: monitors });
  } catch (error) {
    showMessage({ error: `Monitörler kaydedilemedi: ${error.message}` });
  }
}


// -----------------------------------------------------------------------------
// UYARILAR: monitörün kendi ekran görüntüsü yapısı
// -----------------------------------------------------------------------------
// Bir monitör bozulduğu anda (kontrolü yapan monitor-run.js) addMonitorAlarms() çağrılır: uyarı,
// tam o anda alınan ekran görüntüsüyle birlikte buraya yazılır. Önemli olan AN'dır: aksiyon tabanlı
// bir monitör (Input Validation) alana yazıldıktan hemen sonra bozulur; adımın sonunda ekran
// çoktan değişmiş olur (Login'e basılmış, ürün sayfası açılmış). Bu yüzden görüntü adımın sonunda
// değil, bozulma anında alınır ve uyarıda saklanır. Graph'ın node görüntüleriyle ilgisi yoktur.
//   uyarı: { id, monitorId, at, source: 'replay' | 'live', where, text, url, screenshot,
//            step: { index, edgeId, target } | null, action: { index, count, label } | null }
//   where: "Adım 1 (e_Login → v_Inventory) · aksiyon 1/3: Fill Username" gibi, uyarı anında
//          hesaplanmış metin (graph sonradan değişse de okunur kalsın).
// Graph başına son MONITOR_ALARM_LIMIT uyarı kalır (eskisi silinir); silinmiş monitörlerin
// uyarıları bir sonraki yazımda atılır. Graph silinince anahtar da silinir.

function alarmsKey(graphId = monitorsGraphId) {
  return MONITOR_ALARMS_KEY_PREFIX + graphId;
}

function emptyAlarms() {
  return { format: MONITOR_ALARMS_FORMAT, nextId: 1, items: [] };
}

function normalizeAlarms(raw) {
  const data = raw && typeof raw === 'object' ? raw : emptyAlarms();
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    format: MONITOR_ALARMS_FORMAT,
    nextId: Number.isInteger(data.nextId) && data.nextId > 0 ? data.nextId : 1,
    items: items.filter((a) => a && typeof a.id === 'string' && typeof a.monitorId === 'string').map((a) => ({
      id: a.id,
      monitorId: a.monitorId,
      at: Number.isFinite(a.at) ? a.at : 0,
      source: a.source === 'live' ? 'live' : 'replay',
      where: String(a.where ?? ''),
      text: String(a.text ?? ''),
      url: typeof a.url === 'string' ? a.url : '',
      screenshot: typeof a.screenshot === 'string' && a.screenshot.startsWith('data:image/') ? a.screenshot : null,
      step: a.step && typeof a.step === 'object' ? a.step : null,
      action: a.action && typeof a.action === 'object' ? a.action : null,
    })),
  };
}

async function loadMonitorAlarms(graphId) {
  const stored = graphId ? (await chrome.storage.local.get(alarmsKey(graphId)))[alarmsKey(graphId)] : null;
  return normalizeAlarms(stored);
}

async function saveMonitorAlarms() {
  if (!monitorsGraphId) return;
  try {
    await chrome.storage.local.set({ [alarmsKey()]: monitorAlarms });
  } catch (error) {
    showMessage({ error: `Monitör uyarıları kaydedilemedi: ${error.message}` });
  }
}

// Yeni uyarılar (monitor-run.js çağırır; ekran görüntüsü çağıran tarafından o anda alınmıştır).
// Aynı anda bozulan monitörlerin uyarıları TEK yazımla kaydedilir (her uyarı birkaç yüz KB görüntü
// taşır; yazım başına bütün liste yazılır). Döner: kaydedilen uyarılar (id'leriyle). Graph yoksa
// kaydedilmez, yine de uyarı nesneleri döner.
async function addMonitorAlarms(list) {
  const alarms = list.map(({ monitorId, source = 'replay', where = '', text = '', url = '', screenshot = null, step = null, action = null }) => ({
    id: 'a' + monitorAlarms.nextId++, monitorId, at: Date.now(), source, where, text, url, screenshot, step, action,
  }));
  if (!alarms.length) return alarms;
  const alive = new Set([...monitors.items, ...allScenarioMonitors()].map((m) => m.id));
  monitorAlarms.items = [...monitorAlarms.items.filter((a) => alive.has(a.monitorId)), ...alarms].slice(-MONITOR_ALARM_LIMIT);
  await saveMonitorAlarms();
  renderMonitors();
  return alarms;
}

// Monitörün uyarıları, en yenisi önce.
function alarmsOf(monitorId) {
  return monitorAlarms.items.filter((a) => a.monitorId === monitorId).reverse();
}

async function clearMonitorAlarms(monitorId) {
  monitorAlarms.items = monitorAlarms.items.filter((a) => a.monitorId !== monitorId);
  await saveMonitorAlarms();
  renderMonitors();
}


// -----------------------------------------------------------------------------
// SENARYOYA ÖZEL MONİTÖRLER
// -----------------------------------------------------------------------------
// Ana graph'ın monitörleri (monitors) GENEL kurallardır: her senaryoda ve "şimdi kontrol et"te
// kontrol edilir ("hiçbir ekranda 500 hatası olmasın"). Bir senaryonun kendi monitörleri yalnızca o
// senaryo oynatılırken kontrol edilir: aynı login edge'inden geçen iki senaryo ("geçerli kullanıcı →
// ürünler görünmeli", "geçersiz kullanıcı → hata mesajı görünmeli") farklı beklenti taşıyabilir.
// Senaryo monitörü senaryonun kendi graph'ına bağlıdır (kopya; scenario.js > scenarioSnapshot):
// kapsamdaki node / edge kopyada aranır, aksiyon bağı kopyanın aksiyonlarıyla çözülür; ana graph
// kopyadan sonra değişse de monitör yerinde kalır (oynatma da kopyayı oynatır).
//   chrome.storage.local > 'scenario-monitors:<graph id>' =
//     { format, scenarios: { '<senaryo id>': { nextId, items: [monitör, ...] } } }
// Monitör kayıtları genel monitörlerle aynı şekildedir; ayrıca scenarioId taşır ve id'leri senaryo
// id'siyle başlar ("s1abc.m1"): uyarılar (monitor-alarms) ve kontrol sonuçları (monitorVerdicts)
// aynı yapıda, genel monitörlerle çakışmadan durur. Kopyadaki node / edge'lerin 'monitors: []'
// yuvaları (scenario.js) storage'da boş kalır (graph state'ini yalnızca background yazar); "Senaryo
// indir" dosyasında doldurulur (monitor-export.js). Senaryo silinince monitörleri de silinir
// (dropMonitorsOfDeletedScenarios); graph silinince anahtar silinir. Boşalan liste silinmez:
// nextId sayması sürer, silinmiş bir monitörün id'si (ve uyarıları) yenisine geçmez.

function scenarioMonitorsKey(graphId = monitorsGraphId) {
  return SCENARIO_MONITORS_KEY_PREFIX + graphId;
}

function emptyScenarioMonitors() {
  return { format: SCENARIO_MONITORS_FORMAT, scenarios: {} };
}

function normalizeScenarioMonitors(raw) {
  const data = raw && typeof raw === 'object' && raw.scenarios && typeof raw.scenarios === 'object' ? raw : emptyScenarioMonitors();
  const scenarios = {};
  for (const [id, list] of Object.entries(data.scenarios)) {
    if (!id) continue;
    const { nextId, items } = normalizeMonitors(list);
    scenarios[id] = { nextId, items: items.map((m) => ({ ...m, scenarioId: id })) };
  }
  return { format: SCENARIO_MONITORS_FORMAT, scenarios };
}

async function saveScenarioMonitors() {
  if (!monitorsGraphId) return;
  try {
    await chrome.storage.local.set({ [scenarioMonitorsKey()]: scenarioMonitors });
  } catch (error) {
    showMessage({ error: `Senaryo monitörleri kaydedilemedi: ${error.message}` });
  }
}

// Monitörün listesi kaydedilir: genel (monitors:<graph>) ya da senaryolarınki (scenario-monitors:<graph>).
function saveMonitorList(scenarioId = null) {
  return scenarioId ? saveScenarioMonitors() : saveMonitors();
}

// Senaryonun listesi { nextId, items }; yoksa null (create: true ise boş liste açılır).
function scenarioMonitorList(scenarioId, create = false) {
  if (!scenarioId) return null;
  let list = scenarioMonitors.scenarios[scenarioId];
  if (!list && create) list = scenarioMonitors.scenarios[scenarioId] = { nextId: 1, items: [] };
  return list ?? null;
}

function scenarioMonitorItems(scenarioId) {
  return scenarioMonitorList(scenarioId)?.items ?? [];
}

// Bütün senaryoların monitörleri (uyarı temizliği, id arama, yedek)
function allScenarioMonitors() {
  return Object.values(scenarioMonitors.scenarios).flatMap((list) => list.items);
}

// Monitörün durduğu liste: genel liste ya da senaryosunun listesi (ekleme, silme, geri alma)
function monitorListOf(m) {
  return m.scenarioId ? scenarioMonitorList(m.scenarioId, true) : monitors;
}

// Yeni monitörün id'si: genel listede "m7", senaryoda "<senaryo id>.m3" (sayaç listenindir)
function newMonitorId(scenarioId = null) {
  const list = scenarioId ? scenarioMonitorList(scenarioId, true) : monitors;
  return (scenarioId ? `${scenarioId}.m` : 'm') + list.nextId++;
}

// Senaryo görünümündeyse (panel.js > GÖRÜNÜM) seçili senaryonun id'si; ana graph görünümünde null.
// Senaryo görünümünde liste o senaryonun monitörlerini (+ genel kuralları) gösterir, ekleme o
// senaryoya yapılır, "şimdi kontrol et" ikisini birlikte kontrol eder.
function monitorScenarioView() {
  return scenarioView && scenario.id ? scenario.id : null;
}

// Senaryonun graph'ı (kopya): seçili senaryoda panelin çalışma kopyası (kayıttakinden yeni olabilir),
// değilse kayıttaki; kopyası henüz yoksa (eski kayıt) anında alınır (panel.js > viewGraph ile aynı
// kural). Senaryo yoksa (silinmiş) null.
function scenarioCopy(scenarioId) {
  if (!scenarioId) return null;
  const sc = scenario.id === scenarioId ? scenario : state.scenarios.find((s) => s.id === scenarioId);
  if (!sc) return null;
  return sc.graph ?? scenarioSnapshot(scenarioGraphOf(sc));
}

// Monitörün node / edge'lerinin bakıldığı graph: genel monitörde ana graph (state), senaryo
// monitöründe senaryonun kopyası (senaryo silinmişse null: monitör sahipsizdir).
function monitorGraphOf(m) {
  return m?.scenarioId ? scenarioCopy(m.scenarioId) : state;
}

// Görünümün graph'ı: senaryo görünümünde kopya, ana graph görünümünde state (seçili öğe, sağ tık menüsü).
function monitorViewGraph() {
  const scenarioId = monitorScenarioView();
  return (scenarioId && scenarioCopy(scenarioId)) || state;
}

function nodeIn(graph, id) {
  return graph?.nodes.find((n) => n.id === id);
}

function edgeIn(graph, id) {
  return graph?.edges.find((e) => e.id === id);
}

// Silinen senaryoların monitörleri de silinir. Senaryo listesi graph state'indedir (background
// yazar; panel.js > SENARYO); storage'daki graph değişince eski ve yeni listeler karşılaştırılır,
// yalnızca listeden düşen id'lere bakılır ("Sıfırla" hepsini düşürür). Uyarıları bir sonraki uyarı
// yazımında atılır (addMonitorAlarms). Döner: silinen senaryo id'leri.
async function dropMonitorsOfDeletedScenarios(before, after) {
  const alive = new Set((after?.scenarios ?? []).map((sc) => sc?.id));
  const gone = (before?.scenarios ?? []).map((sc) => sc?.id).filter((id) => id && !alive.has(id) && scenarioMonitors.scenarios[id]);
  if (!gone.length) return gone;
  for (const id of gone) delete scenarioMonitors.scenarios[id];
  dropMonitorUndo(gone); // monitor-list.js
  await saveScenarioMonitors();
  return gone;
}


function monitorById(id) {
  return monitors.items.find((m) => m.id === id) ?? allScenarioMonitors().find((m) => m.id === id);
}

// Edge, verilen graph'ta (varsayılan ana graph; senaryo monitörü için kopya: monitorGraphOf)
function edgeById(id, graph = state) {
  return edgeIn(graph, id);
}

// Listede görünen ad: kullanıcı ad vermediyse tür + belirleyici parametre (monitor-types.js).
function monitorName(m) {
  const type = monitorType(m.type);
  return m.name ?? (type ? monitorAutoName(type, m.params) : m.type);
}

// Kapsamın bugünkü anlamı: tüm model, node, edge ya da sahipsiz (öğe silinmiş, birleştirilmiş,
// graph sıfırlanmış). graph: öğenin arandığı graph (senaryo monitöründe kopya; null = senaryo yok).
function scopeKind(scope, graph = state) {
  if (scope === 'global') return 'global';
  if (nodeIn(graph, scope)) return 'node';
  if (edgeIn(graph, scope)) return 'edge';
  return 'orphan';
}

function isOrphan(m) {
  return scopeKind(m.scope, monitorGraphOf(m)) === 'orphan';
}

// "e_Login (v_Login → v_Telefon)"
function edgeLabel(edge, graph = state) {
  return `${edge.name} (${nodeIn(graph, edge.source)?.name ?? edge.source} → ${nodeIn(graph, edge.target)?.name ?? edge.target})`;
}

// EDGE'DEKİ AKSİYON (m.action): edge'in bir aksiyonuna bağlı monitör. Aksiyon, kayıttaki
// sırasıyla (index) değil, yeniden bulunabilecek bilgiyle saklanır: tür + hedef anahtarı
// ("input:user-name") + etiket ("Fill Username"); Emir aksiyon silince sıra kayar, eşleştirme
// resolveMonitorAction ile yapılır. Hedef (alan) her kademede karşılaştırılır: aynı etiketli iki
// alan ("Ad") varken monitör sessizce öbür alana kaymamalı.
// Bekleme aksiyonunun elementi yok ve Emir'in otomatik beklemeleri hep aynı süre ve etiketle gelir;
// bekleme, ARKASINDAN GELDİĞİ aksiyonla tanınır (after: "Tıkla Login'den sonraki bekleme"; edge'in
// başındaki bekleme için null). Aynı aksiyon edge'de birden çok kez olabilir (sihirbazda iki "İleri"):
// o aksiyondan sonra gelen beklemeler içindeki sırası da saklanır (nth, 0'dan), bu beklemelerin
// sayısıyla (count) ve süresi + aksiyonun etiketi kendisiyle aynı olanların sayısıyla (alike,
// kendisi dahil). Süresi ayrıca saklanır (target "wait:<ms>"), ✎ ile değişse de bağ kopmaz.
function monitorActionRef(action, index, actions = null) {
  if (!action) return null;
  const ref = { index, type: String(action.type ?? ''), label: String(action.label ?? ''), target: actionTarget(action) };
  if (action.type === 'wait') {
    ref.after = waitAnchor(actions, index);
    if (ref.after !== undefined) {
      const siblings = waitsAfter(actions, ref.after);
      Object.assign(ref, { nth: siblings.indexOf(index), count: siblings.length, alike: siblings.filter((i) => sameWait(actions, i, ref)).length });
    }
  }
  return ref;
}

// Aksiyonun hedefi: elementin parmak izi anahtarı ("input:phone") ya da selector'ı; beklemede süresi.
function actionTarget(action) {
  if (action?.type === 'wait') return Number.isFinite(action.ms) ? `wait:${action.ms}` : null;
  return action?.target?.key ?? action?.selector ?? null;
}

// Beklemenin arkasından geldiği aksiyon (önündeki ilk bekleme olmayan aksiyon): { type, label, target };
// edge'in başındaysa (önünde aksiyon yoksa) null. actions verilmemişse undefined (bilinmiyor).
function waitAnchor(actions, index) {
  if (!Array.isArray(actions)) return undefined;
  for (let i = index - 1; i >= 0; i--) {
    const a = actions[i];
    if (a && a.type !== 'wait') return { type: String(a.type ?? ''), label: String(a.label ?? ''), target: actionTarget(a) };
  }
  return null;
}

// İki beklemenin arkasından geldiği aksiyon aynı mı: tür + hedef (etiket değişmiş olabilir); edge
// başı (null) yalnızca edge başıyla.
function sameAnchor(a, b) {
  return a && b ? a.type === b.type && a.target === b.target : a === b;
}

// Aynı aksiyondan sonra gelen beklemelerin edge'deki sıraları (baştan sona)
function waitsAfter(actions, anchor) {
  return actions.flatMap((a, i) => (a?.type === 'wait' && sameAnchor(waitAnchor(actions, i), anchor) ? [i] : []));
}

// i'deki bekleme monitörün beklemesinin ikizi mi: süresi ve arkasından geldiği aksiyonun etiketi de aynı
function sameWait(actions, i, ref) {
  return actionTarget(actions[i]) === ref.target && waitAnchor(actions, i)?.label === ref.after?.label;
}

function normalizeActionRef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const index = Number(raw.index);
  if (!Number.isInteger(index) || index < 0) return null;
  const ref = { index, type: String(raw.type ?? ''), label: String(raw.label ?? ''), target: raw.target == null ? null : String(raw.target) };
  if (ref.type === 'wait' && 'after' in raw) { // eski kayıtlarda alan yok: undefined kalır (bilinmiyor)
    ref.after = raw.after && typeof raw.after === 'object'
      ? { type: String(raw.after.type ?? ''), label: String(raw.after.label ?? ''), target: raw.after.target == null ? null : String(raw.after.target) }
      : null;
    const { nth, count, alike } = raw; // beklemenin sırası (monitorActionRef); ilk sürümün kayıtlarında yok
    if ([nth, count, alike].every(Number.isInteger) && nth >= 0 && nth < count && alike >= 1 && alike <= count) Object.assign(ref, { nth, count, alike });
  }
  return ref;
}

// Edge'in aksiyonları içinde monitörün aksiyonu: index ya da -1 (aksiyon artık yok). Kademeler:
// 1) kayıttaki sırada tür + etiket + hedef aynı; 2) tür + hedef + etiket; 3) tür + hedef (etiket
// değişmiş); 4) tür + etiket, yalnızca hedefi olmayan aksiyonlar için (sayfa kaydırma gibi).
// Bekleme için ayrı: resolveWaitAction.
function resolveMonitorAction(ref, actions) {
  if (!ref || !Array.isArray(actions)) return -1;
  if (ref.type === 'wait') return resolveWaitAction(ref, actions);
  const sameType = (a) => a && a.type === ref.type;
  const sameTarget = (a) => sameType(a) && actionTarget(a) === ref.target;
  const at = actions[ref.index];
  if (sameTarget(at) && at.label === ref.label) return ref.index;
  let i = actions.findIndex((a) => sameTarget(a) && a.label === ref.label);
  if (i < 0) i = actions.findIndex(sameTarget);
  if (i < 0 && ref.target === null) i = actions.findIndex((a) => sameType(a) && a.label === ref.label);
  return i;
}

// Bekleme (ayrıntı: monitorActionRef). Adaylar: arkasından geldiği aksiyonu aynı olan beklemeler.
//   - Aday sayısı kayıttakiyle aynıysa (count) aynı sıradaki (nth): önündeki aksiyonlar silinse ya
//     da süresi ✎ ile değişse de doğru bekleme.
//   - Sayı değiştiyse (bekleme ya da aksiyonu eklendi / silindi) hangisinin gittiği ancak beklemenin
//     ikizi yoksa (alike 1) bilinir: süresi ve aksiyonun etiketi aynı tek aday.
//   - Sırası kaydedilmemiş kayıt (ilk sürüm, nth yok): yalnızca tek aday. Bağı kaydedilmemiş eski
//     kayıt (after yok): yalnızca kayıttaki sırada aynı süreli bekleme.
// Belirsizse -1 ("aksiyon bulunamadı"): monitör sessizce başka bir beklemeye kaymaz (issue #5).
function resolveWaitAction(ref, actions) {
  if (ref.after === undefined) {
    const at = actions[ref.index];
    return at?.type === 'wait' && actionTarget(at) === ref.target ? ref.index : -1;
  }
  const siblings = waitsAfter(actions, ref.after);
  if (ref.count === undefined) return siblings.length === 1 ? siblings[0] : -1;
  if (siblings.length === ref.count) return siblings[ref.nth] ?? -1;
  const twins = siblings.filter((i) => sameWait(actions, i, ref));
  return ref.alike === 1 && twins.length === 1 ? twins[0] : -1;
}

// "1. Yaz Fill Username" (Emir'in edge kartındaki satırla aynı: ACTION_TEXT panel.js'te). Bekleme:
// "2. Bekle 10 sn"; actions verilirse arkasından geldiği aksiyonla: "2. Bekle 10 sn (Tıkla Login sonrası)".
function actionText(action, index, actions = null) {
  const verb = (typeof ACTION_TEXT !== 'undefined' && ACTION_TEXT[action?.type]) || action?.type || '';
  if (action?.type === 'wait' && Number.isFinite(action.ms)) {
    const anchor = waitAnchor(actions, index);
    const after = anchor === undefined ? '' : anchor === null ? ' (edge başında)' : ` (${anchorText(anchor)} sonrası)`;
    return `${index + 1}. ${verb} ${waitSeconds(action.ms)}${after}`;
  }
  return `${index + 1}. ${verb} ${action?.label ?? ''}`.trim();
}

// Beklemenin arkasından geldiği aksiyon, kısa: "Tıkla Login" / "Yaz Fill Username" (ek almaz: "… sonrası")
function anchorText(anchor) {
  const verb = (typeof ACTION_TEXT !== 'undefined' && ACTION_TEXT[anchor.type]) || anchor.type || '';
  return `${verb} ${anchor.label}`.trim();
}

// Monitörün kayıttaki aksiyon bilgisinin metni (aksiyon bulunamayınca): "6. Bekle 0,01 sn (Tıkla Login sonrası)" / "3. Fill Username"
function actionRefText(ref) {
  if (ref.type === 'wait') {
    const ms = Number(String(ref.target ?? '').replace('wait:', ''));
    const after = ref.after === undefined ? '' : ref.after === null ? ' (edge başında)' : ` (${anchorText(ref.after)} sonrası)`;
    return `${ref.index + 1}. Bekle${Number.isFinite(ms) ? ' ' + waitSeconds(ms) : ''}${after}`;
  }
  return `${ref.index + 1}. ${ref.label}`;
}

// Bekleme süresi: "10 sn", "1,5 sn", "0,01 sn" (Emir'in edge kartındaki biçimde)
function waitSeconds(ms) {
  return `${String(Math.round(ms / 10) / 100).replace('.', ',')} sn`;
}

// Monitörün aksiyon metni; aksiyon edge'de bulunamıyorsa kayıttaki bilgiyle ve uyarıyla
function monitorActionText(m) {
  if (!m.action) return '';
  const edge = edgeById(m.scope, monitorGraphOf(m));
  const i = edge ? resolveMonitorAction(m.action, edge.actions) : -1;
  if (i >= 0) return actionText(edge.actions[i], i, edge.actions);
  return `aksiyon bulunamadı (${actionRefText(m.action)})`;
}

function isActionMissing(m) {
  if (!m.action) return false;
  const edge = edgeById(m.scope, monitorGraphOf(m));
  return !edge || resolveMonitorAction(m.action, edge.actions) < 0;
}

// Senaryo monitöründe node / edge senaryonun kopyasından okunur (adı kopyadaki ad).
function scopeText(m) {
  const graph = monitorGraphOf(m);
  switch (scopeKind(m.scope, graph)) {
    case 'global': return m.scenarioId ? 'Senaryonun tamamı' : 'Tüm model';
    case 'node': return `Node: ${nodeIn(graph, m.scope).name}`;
    case 'edge': return `Edge: ${edgeIn(graph, m.scope).name}` + (m.action ? ` · ${monitorActionText(m)}` : '');
    default: return !graph ? 'Sahipsiz: senaryosu artık yok' : `Sahipsiz: öğe (${m.scope}) ${m.scenarioId ? 'senaryonun graph\'ında yok' : 'artık yok'}`;
  }
}

// Parametrelerin kısa özeti: "Aksiyon tabanlı · Alan: input:phone · Desen (regex): ^0?5"
function paramsText(m) {
  const type = monitorType(m.type);
  if (!type) return `Bilinmeyen tür: ${m.type}`;
  const parts = type.params
    .filter((p) => m.params[p.key] !== '' && m.params[p.key] !== null && m.params[p.key] !== undefined && m.params[p.key] !== false)
    .map((p) => `${p.text}: ${p.kind === 'select' ? p.options.find((o) => o.value === m.params[p.key])?.text ?? m.params[p.key]
      : p.kind === 'checkbox' ? 'evet'
        : p.kind === 'image' ? (m.params[p.key]?.width ? `${m.params[p.key].width}×${m.params[p.key].height} px` : '?')
          : m.params[p.key]}`);
  return [MONITOR_WHEN[type.when]?.text, ...parts].filter(Boolean).join(' · ');
}


// Silinen graph'ın monitörleri, senaryo monitörleri ve uyarıları da silinir (graph listesi değişince:
// panel.js > GRAPH'LAR). Yalnızca listeden düşen id'lere bakılır; storage'ın tamamı (bütün graph'lar
// ve ekran görüntüleri) okunmaz. Liste sayı / ad değişiminde de yazıldığı için bu sık çalışır.
async function dropMonitorsOfDeletedGraphs(before, after) {
  const alive = new Set((after ?? []).map((g) => g.id));
  const gone = (before ?? []).map((g) => g.id).filter((id) => !alive.has(id));
  if (!gone.length) return;
  await chrome.storage.local.remove(gone.flatMap((id) => [monitorsKey(id), alarmsKey(id), scenarioMonitorsKey(id)]));
}


// -----------------------------------------------------------------------------
// BAŞLANGIÇ: aktif graph'ın monitörlerini oku, graph ve monitör değişince yeniden çiz
// -----------------------------------------------------------------------------
// panel.js graph listesini background'dan (SYNC) alıp aktif graph'ı kendi okumasıyla yükler;
// ilk açılışta aktif graph henüz yoksa 'activeGraph' değişince yüklenir. renderMonitors(),
// panel.js'in state'i bu graph'a geçene kadar bekler.

async function loadMonitors(graphId) {
  monitorsGraphId = graphId ?? null;
  resetMonitorListState(); // monitor-list.js
  monitorVerdicts.clear();
  const read = (key) => (graphId ? chrome.storage.local.get(key).then((r) => r[key]) : null);
  const [stored, storedScenario, alarms] = await Promise.all([read(monitorsKey(graphId)), read(scenarioMonitorsKey(graphId)), loadMonitorAlarms(graphId)]);
  if (graphId !== monitorsGraphId) return; // bu arada yine değişti
  monitors = normalizeMonitors(stored);
  scenarioMonitors = normalizeScenarioMonitors(storedScenario);
  monitorAlarms = alarms;
  renderMonitors(); // monitor-list.js
}

chrome.storage.local.get('activeGraph').then(({ activeGraph: id }) => loadMonitors(id ?? null));

chrome.storage.onChanged.addListener((changes, area) => { // panel.js'in dinleyicisinden sonra
  if (area !== 'local') return;
  if (changes.activeGraph && (changes.activeGraph.newValue ?? null) !== monitorsGraphId) {
    loadMonitors(changes.activeGraph.newValue ?? null);
    return;
  }
  if (monitorsGraphId && changes[monitorsKey()]) monitors = normalizeMonitors(changes[monitorsKey()].newValue);
  if (monitorsGraphId && changes[scenarioMonitorsKey()]) scenarioMonitors = normalizeScenarioMonitors(changes[scenarioMonitorsKey()].newValue);
  if (monitorsGraphId && changes[alarmsKey()]) monitorAlarms = normalizeAlarms(changes[alarmsKey()].newValue);
  const graphChange = monitorsGraphId ? changes['graph:' + monitorsGraphId] : null;
  if (graphChange) dropMonitorsOfDeletedScenarios(graphChange.oldValue, graphChange.newValue);
  if (monitorsGraphId && (changes[monitorsKey()] || changes[scenarioMonitorsKey()] || changes[alarmsKey()] || graphChange)) renderMonitors();
  if (changes.graphs) dropMonitorsOfDeletedGraphs(changes.graphs.oldValue, changes.graphs.newValue);
});
