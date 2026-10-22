// =============================================================================
// scenario.js — SENARYO (panel, background ve runner ortak kullanır)
// -----------------------------------------------------------------------------
// Senaryo: modelde başlangıç node'undan başlayan bir ya da birden fazla koşu (edge dizisi).
// Her koşu tarayıcıda temiz bir oturumla baştan oynatılır. Yol çıkmaz bir node'a varırsa
// (oradan çıkan edge yoksa) koşu biter; kalan edge'ler yeni bir koşuyla kapsanır.
// Senaryoyu panel üretir (önizleme, elle yol) ya da runner'ın planlayıcısı; runner oynatır
// (runner/README.md). Bu dosya yalnızca tanımlar; panelde <script>, background'da importScripts,
// runner'da Node'da yüklenir.
//
// Başlangıç node'u varsayılan olarak graph'ın başlangıcıdır; senaryo başka bir node seçebilir
// (dosyada start alanı). Böyle bir senaryo yalnızca panelde oynatılır: runner her koşuyu temiz
// bir tarayıcıda başlattığı için graph'ın ortasındaki bir ekrana doğrudan gidemez.
//
// Graph biçimi: { start, nodes: [{ id, name }], edges: [{ id, name, source, target }] }
// (panelde state, runner'da dışa aktarılan model bu biçime çevrilir). start: senaryonun
// başlangıç node'u.
// =============================================================================

const SCENARIO_FORMAT = 'graph-recorder-scenario/v1';

// Koşular graph'ta yürünebilir mi? Her koşu başlangıç node'undan başlar; her edge bir
// öncekinin vardığı node'dan çıkar. Sorun yoksa null, varsa açıklaması.
function runProblem(graph, runs) {
  const edges = new Map(graph.edges.map((e) => [e.id, e]));
  const nodeName = (id) => graph.nodes.find((n) => n.id === id)?.name ?? id;
  for (const [i, run] of runs.entries()) {
    let at = graph.start;
    for (const id of run) {
      const edge = edges.get(id);
      if (!edge) return `Koşu ${i + 1}: "${id}" modelde yok (graph değişmiş olabilir).`;
      if (edge.source !== at) return `Koşu ${i + 1}: "${edge.name}", "${nodeName(at)}" node'undan çıkmıyor.`;
      at = edge.target;
    }
  }
  return null;
}

// Koşunun vardığı node: boş koşuda başlangıç.
function runEnd(graph, run) {
  const last = graph.edges.find((e) => e.id === run.at(-1));
  return last ? last.target : graph.start;
}

// Kapsama: koşuların geçtiği farklı edge ve node sayısı ile toplamlar. Her koşu başlangıç
// node'unu ziyaret eder.
function coverageOf(graph, runs) {
  const known = new Map(graph.edges.map((e) => [e.id, e]));
  const edges = new Set(runs.flat().filter((id) => known.has(id)));
  const nodes = new Set(runs.some((run) => run.length) ? [graph.start] : []);
  for (const id of edges) nodes.add(known.get(id).target);
  return { edges: [edges.size, graph.edges.length], nodes: [nodes.size, graph.nodes.length] };
}

// SENARYO GRAPH'I: koşuların geçtiği node'ların ve edge'lerin ana graph'tan kopyası; ileride
// senaryoya özel monitörlerin bağlanacağı yer (her node ve edge'de monitors). Ana graph sonradan
// değişse de kopya değişmez; koşular düzenlenince ya da "Ana graph'tan yenile" denince yeniden
// alınır. Ekran görüntüleri kopyalanmaz (node id'siyle ana graph'tan okunur). Önceki kopyadaki
// monitörler id'yle korunur. Background kaydederken, panel anında göstermek için aynısını alır.
// graph: { start, nodes, edges } (ana graph; start senaryonun başlangıcı)
function scenarioSnapshot(graph, runs, previous = null) {
  const monitors = new Map([...(previous?.nodes ?? []), ...(previous?.edges ?? [])].map((x) => [x.id, x.monitors ?? []]));
  const used = new Set(runs.flat());
  const edges = graph.edges.filter((e) => used.has(e.id));
  const nodeIds = new Set([graph.start, ...edges.flatMap((e) => [e.source, e.target])]);
  const copy = (item) => {
    const { screenshot, monitors: _, ...rest } = item;
    return { ...rest, monitors: monitors.get(item.id) ?? [] };
  };
  return {
    start: graph.start,
    nodes: graph.nodes.filter((n) => nodeIds.has(n.id)).map(copy),
    edges: edges.map(copy),
    copied: Date.now(),
  };
}

// Kopyadan sonra ana graph'ta değişenler: silinen ya da değişen (ad, URL şablonu, edge set,
// uçlar, aksiyonlar) node ve edge'ler; koşuların kullandığı, ana graph'ta olan ama kopyada
// olmayan edge'ler (ör. silme geri alındı). [{ kind, id, name, change: 'silindi' | 'değişti' | 'eklendi' }]
function snapshotDrift(graph, snapshot, runs = []) {
  if (!snapshot) return [];
  const copied = new Set(snapshot.edges.map((e) => e.id));
  const added = graph.edges.filter((e) => runs.some((run) => run.includes(e.id)) && !copied.has(e.id))
    .map((e) => ({ kind: 'edge', id: e.id, name: e.name, change: 'eklendi' }));
  const fields = { node: ['name', 'urlKey', 'elements'], edge: ['name', 'source', 'target', 'actions'] };
  const drift = [];
  for (const [kind, copied, live] of [['node', snapshot.nodes, graph.nodes], ['edge', snapshot.edges, graph.edges]]) {
    const byId = new Map(live.map((x) => [x.id, x]));
    for (const item of copied) {
      const now = byId.get(item.id);
      if (!now) drift.push({ kind, id: item.id, name: item.name, change: 'silindi' });
      else if (fields[kind].some((f) => sortedJson(now[f]) !== sortedJson(item[f]))) drift.push({ kind, id: item.id, name: item.name, change: 'değişti' });
    }
  }
  return [...drift, ...added];
}

// Anahtar sırasından bağımsız JSON: Chrome storage nesne anahtarlarını alfabetik sıralar, mesajla
// gelen nesne sıralamaz; aynı içerik farklı görünmesin.
function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${sortedJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
