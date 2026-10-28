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
// Monitör modülü altı dosyadır (panel.html'de bu sırayla, panel.js'ten SONRA yüklenir):
//   monitor-types.js   tür kataloğu (parametreler, doğrulama, ad ve özet cümlesi)
//   monitor-store.js   BU DOSYA: veri — storage, normalize, uyarılar, kapsam ve aksiyon yardımcıları
//   monitor-list.js    Monitörler bölümü, detay alt bölümü, sağ tık menüsü, hale, uyarı pencereleri
//   monitor-dialog.js  ekle / düzenle formu
//   monitor-export.js  GraphWalker JSON'una yazma, "Yükle…", graph yedeği
//   monitor-run.js     oynatmada kontrol ve ışık listesi, "Bu ekranda şimdi kontrol et"
// Dosyalar klasik script'tir; birbirlerinin global fonksiyonlarını çağırırlar (modül yok: Emir'in
// paneli de öyle). panel.js'in global'leri okunur / sarmalanır (state, activeGraph, scenarioView,
// selectedId, renderDetails, cy, nodeById, showMessage, ACTION_TEXT, graphWalkerModel, graphBackup);
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
// Detay: docs/07-monitorler.md
// =============================================================================

const MONITORS_KEY_PREFIX = 'monitors:';            // chrome.storage.local > monitors:<graph id>
const MONITORS_FORMAT = 'graph-recorder-monitors/v1';
const MONITOR_ALARMS_KEY_PREFIX = 'monitor-alarms:'; // chrome.storage.local > monitor-alarms:<graph id> (bkz. UYARILAR)
const MONITOR_ALARMS_FORMAT = 'graph-recorder-monitor-alarms/v1';
const MONITOR_ALARM_LIMIT = 20;                     // graph başına saklanan son uyarı sayısı (her biri ekran görüntülü)

let monitors = emptyMonitors();  // aktif graph'ın monitörleri: { format, nextId, items: [{ id, type, scope, params, severity, enabled, name, createdAt }] }
let monitorAlarms = emptyAlarms(); // aktif graph'ın monitör uyarıları (ekran görüntüleriyle), bkz. UYARILAR
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
  const alive = new Set(monitors.items.map((m) => m.id));
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

// EDGE'DEKİ AKSİYON (m.action): edge'in bir aksiyonuna bağlı monitör. Aksiyon, kayıttaki
// sırasıyla (index) değil, yeniden bulunabilecek bilgiyle saklanır: tür + hedef anahtarı
// ("input:user-name") + etiket ("Fill Username"); Emir aksiyon silince sıra kayar, eşleştirme
// resolveMonitorAction ile yapılır. Hedef (alan) her kademede karşılaştırılır: aynı etiketli iki
// alan ("Ad") varken monitör sessizce öbür alana kaymamalı.
function monitorActionRef(action, index) {
  if (!action) return null;
  return { index, type: String(action.type ?? ''), label: String(action.label ?? ''), target: actionTarget(action) };
}

function actionTarget(action) {
  return action?.target?.key ?? action?.selector ?? null;
}

function normalizeActionRef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const index = Number(raw.index);
  if (!Number.isInteger(index) || index < 0) return null;
  return { index, type: String(raw.type ?? ''), label: String(raw.label ?? ''), target: raw.target == null ? null : String(raw.target) };
}

// Edge'in aksiyonları içinde monitörün aksiyonu: index ya da -1 (aksiyon artık yok). Kademeler:
// 1) kayıttaki sırada tür + etiket + hedef aynı; 2) tür + hedef + etiket; 3) tür + hedef (etiket
// değişmiş); 4) tür + etiket, yalnızca hedefi olmayan aksiyonlar için (sayfa kaydırma gibi).
function resolveMonitorAction(ref, actions) {
  if (!ref || !Array.isArray(actions)) return -1;
  const sameType = (a) => a && a.type === ref.type;
  const sameTarget = (a) => sameType(a) && actionTarget(a) === ref.target;
  const at = actions[ref.index];
  if (sameTarget(at) && at.label === ref.label) return ref.index;
  let i = actions.findIndex((a) => sameTarget(a) && a.label === ref.label);
  if (i < 0) i = actions.findIndex(sameTarget);
  if (i < 0 && ref.target === null) i = actions.findIndex((a) => sameType(a) && a.label === ref.label);
  return i;
}

// "1. Yaz Fill Username" (Emir'in edge kartındaki satırla aynı: ACTION_TEXT panel.js'te)
function actionText(action, index) {
  const verb = (typeof ACTION_TEXT !== 'undefined' && ACTION_TEXT[action?.type]) || action?.type || '';
  return `${index + 1}. ${verb} ${action?.label ?? ''}`.trim();
}

// Monitörün aksiyon metni; aksiyon edge'de bulunamıyorsa kayıttaki bilgiyle ve uyarıyla
function monitorActionText(m) {
  if (!m.action) return '';
  const edge = edgeById(m.scope);
  const i = edge ? resolveMonitorAction(m.action, edge.actions) : -1;
  if (i >= 0) return actionText(edge.actions[i], i);
  return `aksiyon bulunamadı (${m.action.index + 1}. ${m.action.label})`;
}

function isActionMissing(m) {
  if (!m.action) return false;
  const edge = edgeById(m.scope);
  return !edge || resolveMonitorAction(m.action, edge.actions) < 0;
}

function scopeText(m) {
  switch (scopeKind(m.scope)) {
    case 'global': return 'Tüm model';
    case 'node': return `Node: ${nodeById(m.scope).name}`;
    case 'edge': return `Edge: ${edgeById(m.scope).name}` + (m.action ? ` · ${monitorActionText(m)}` : '');
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


// Silinen graph'ın monitörleri ve uyarıları da silinir (graph listesi değişince: panel.js > GRAPH'LAR).
// Yalnızca listeden düşen id'lere bakılır; storage'ın tamamı (bütün graph'lar ve ekran görüntüleri)
// okunmaz. Liste sayı / ad değişiminde de yazıldığı için bu sık çalışır.
async function dropMonitorsOfDeletedGraphs(before, after) {
  const alive = new Set((after ?? []).map((g) => g.id));
  const gone = (before ?? []).map((g) => g.id).filter((id) => !alive.has(id));
  if (!gone.length) return;
  await chrome.storage.local.remove(gone.flatMap((id) => [monitorsKey(id), alarmsKey(id)]));
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
  const [stored, alarms] = await Promise.all([
    graphId ? chrome.storage.local.get(monitorsKey(graphId)).then((r) => r[monitorsKey(graphId)]) : null,
    loadMonitorAlarms(graphId),
  ]);
  if (graphId !== monitorsGraphId) return; // bu arada yine değişti
  monitors = normalizeMonitors(stored);
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
  if (monitorsGraphId && changes[alarmsKey()]) monitorAlarms = normalizeAlarms(changes[alarmsKey()].newValue);
  if (monitorsGraphId && (changes[monitorsKey()] || changes[alarmsKey()] || changes['graph:' + monitorsGraphId])) renderMonitors();
  if (changes.graphs) dropMonitorsOfDeletedGraphs(changes.graphs.oldValue, changes.graphs.newValue);
});
