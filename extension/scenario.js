// =============================================================================
// scenario.js — SENARYO (panel ve runner ortak kullanır)
// -----------------------------------------------------------------------------
// Senaryo: modelde başlangıç node'undan başlayan bir ya da birden fazla koşu (edge dizisi).
// Her koşu tarayıcıda temiz bir oturumla baştan oynatılır. Yol çıkmaz bir node'a varırsa
// (oradan çıkan edge yoksa) koşu biter; kalan edge'ler yeni bir koşuyla kapsanır.
// Senaryoyu panel üretir (önizleme, elle yol) ya da runner'ın planlayıcısı; runner oynatır
// (runner/README.md). Bu dosya yalnızca tanımlar; panelde <script>, runner'da Node'da yüklenir.
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
