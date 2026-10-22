// =============================================================================
// graphwalker.js — PLANLAYICI: GraphWalker ile senaryo üretimi
// -----------------------------------------------------------------------------
// Graph'tan GraphWalker CLI'ın "offline" komutuyla test yolları (koşular) üretir. Panel native
// host üzerinden (host.js), komut satırı plan.js üzerinden kullanır; ikisi aynı senaryoyu üretir.
//
//   Hedefler: edges (tüm edge'ler)  random(edge_coverage(100) or length(N))
//             nodes (tüm node'lar)  random(vertex_coverage(100) or length(N))
//             node  (bir node'a ulaş) a_star(reached_vertex(<node>))
//   - GraphWalker'a yalnızca başlangıçtan ulaşılabilen kısım verilir: ulaşılamayan bir edge'i
//     hiçbir yol kapsayamaz (GraphWalker'ın a_star'ı orada bitmez); bunlar ayrıca raporlanır.
//   - Adlar id'dir: GraphWalker reached_edge'i adla arar, kayıtta aynı adlı edge'ler olabilir.
//   - Çıkmaz node: random oraya varınca GraphWalker NoPathFoundException verir; o ana kadarki
//     yol 1. koşu olur. Kapsanmamış her edge (node) için başlangıçtan a_star(reached_edge(e))
//     ile yeni koşu açılır; her koşudan sonra kapsananlar düşer. Başlangıçtan en uzak olanlar
//     önce: onların en kısa yolu yakındakileri de kapsar, koşu sayısı azalır. length(N), random'un bir
//     şekilde bitmemesine karşı üst sınırdır; kalanlar yine a_star koşularıyla kapsanır.
//   - Tohum: verilmezse rastgele seçilir ve senaryoya yazılır; aynı tohum aynı senaryoyu verir.
//
// Java ve jar'ın yeri kurulumun yazdığı ayar dosyasındadır (install.js); komut satırında ve
// ortam değişkenleriyle (GRAPHWALKER_JAVA, GRAPHWALKER_JAR) de verilebilir.
// =============================================================================

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const HOST_NAME = 'com.graphrecorder.planner';
export const JAVA_VERSIONS = [17, 21]; // GraphWalker 4.3.3 ile denenen (Java 25 ile çalışmaz)
const CALL_TIMEOUT_MS = 30000;

// Kurulumun dosyaları: Windows'ta %LOCALAPPDATA%\GraphRecorder.
export function installDir() {
  return process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'GraphRecorder') : join(homedir(), '.graph-recorder');
}

// Java ve jar: komut satırı > ortam değişkeni > kurulumun ayar dosyası.
export function readConfig(overrides = {}) {
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(join(installDir(), 'config.json'), 'utf8'));
  } catch { /* kurulum yok */ }
  const java = overrides.java ?? process.env.GRAPHWALKER_JAVA ?? saved.java ?? null;
  const jar = overrides.jar ?? process.env.GRAPHWALKER_JAR ?? saved.jar ?? null;
  if (!java) throw new Error('Java bulunamadı. Kurulumu çalıştırın (runner\\install-planner.cmd) ya da --java ile verin.');
  if (!jar) throw new Error('GraphWalker jar\'ı bilinmiyor. Kurulumu çalıştırın (runner\\install-planner.cmd) ya da --jar ile verin.');
  if (!existsSync(jar)) throw new Error(`GraphWalker jar'ı bulunamadı: ${jar}. Dosya taşındıysa kurulumu yeniden çalıştırın.`);
  return { java, jar };
}

// Java'nın ana sürümü ("17.0.12" -> 17, "1.8.0_461" -> 8); çalışmazsa null. Java sürümünü
// standart hataya yazar.
export function javaMajor(java) {
  const result = spawnSync(java, ['-version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  return parseMajor(`${result.stderr ?? ''}${result.stdout ?? ''}`);
}

function parseMajor(text) {
  const version = /version "([^"]+)"/.exec(text)?.[1];
  if (!version) return null;
  const [first, second] = version.split(/[._-]/).map(Number);
  return first === 1 ? second : first;
}

// Uygun Java (JAVA_VERSIONS): JAVA_HOME, PATH ve bilinen kurulum klasörleri; en yenisi seçilir.
export function findJava() {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = new Set();
  if (process.env.GRAPHWALKER_JAVA) candidates.add(process.env.GRAPHWALKER_JAVA);
  if (process.env.JAVA_HOME) candidates.add(join(process.env.JAVA_HOME, 'bin', exe));
  try {
    const where = process.platform === 'win32'
      ? execFileSync('where', ['java'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      : execFileSync('which', ['-a', 'java'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of where.split(/\r?\n/)) if (line.trim()) candidates.add(line.trim());
  } catch { /* PATH'te yok */ }
  const roots = process.platform === 'win32'
    ? ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft'].flatMap((vendor) => [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((base) => join(base, vendor)))
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      for (const bin of [join(root, dir, 'bin', exe), join(root, dir, 'Contents', 'Home', 'bin', exe)]) if (existsSync(bin)) candidates.add(bin);
    }
  }
  const found = [...candidates].map((java) => ({ java, major: javaMajor(java) })).filter((c) => c.major !== null);
  const usable = found.filter((c) => JAVA_VERSIONS.includes(c.major)).sort((a, b) => b.major - a.major);
  return { java: usable[0]?.java ?? null, found };
}

// GraphWalker'ın sürümü: jar ve Java'nın birlikte çalıştığını da gösterir.
export function graphWalkerVersion({ java, jar }) {
  const out = execFileSync(java, ['-jar', jar, '--version'], { encoding: 'utf8', timeout: 20000 });
  return /version:\s*(\S+)/.exec(out)?.[1] ?? out.trim();
}

// graph: { start, nodes: [{ id, name }], edges: [{ id, name, source, target }] } (scenario.js'teki biçim)
// options: { goal: 'edges' | 'nodes' | 'node', target, seed }
// Döner: { runs: [[edgeId...]], planner, unreachable: [{ id, name }], calls }
export async function plan(graph, { goal = 'edges', target = null, seed = null } = {}, config) {
  if (!graph?.start || !graph.nodes.some((n) => n.id === graph.start)) throw new Error('Graph\'ın başlangıç node\'u yok.');
  if (!['edges', 'nodes', 'node'].includes(goal)) throw new Error(`Bilinmeyen hedef: ${goal}`);
  const reach = reachable(graph);
  const unreachable = goal === 'nodes'
    ? graph.nodes.filter((n) => !reach.nodes.has(n.id))
    : graph.edges.filter((e) => !reach.edges.has(e.id));
  const usedSeed = Number.isInteger(seed) ? seed : Math.floor(Math.random() * 2 ** 31);
  const walker = await modelWalker(graph, reach, config);
  try {
    if (goal === 'node') {
      if (!graph.nodes.some((n) => n.id === target)) throw new Error('Ulaşılacak node seçilmedi ya da graph\'ta yok.');
      if (target === graph.start) throw new Error('Ulaşılacak node başlangıç node\'u; yol boş olurdu.');
      if (!reach.nodes.has(target)) throw new Error(`"${nameOf(graph, target)}" başlangıçtan ulaşılamıyor.`);
      const generator = `a_star(reached_vertex(${target}))`;
      const run = await walker.offline(generator);
      return { runs: [run.edges], planner: { engine: 'graphwalker', goal, target, generator }, unreachable: [], calls: walker.calls };
    }

    const kind = goal === 'edges' ? 'edge' : 'vertex';
    const depth = (id) => (goal === 'edges' ? reach.depth.get(graph.edges.find((e) => e.id === id).source) + 1 : reach.depth.get(id));
    const wanted = (goal === 'edges' ? [...reach.edges] : [...reach.nodes].filter((id) => id !== graph.start))
      .sort((a, b) => depth(b) - depth(a));
    if (!wanted.length) throw new Error(goal === 'edges' ? 'Başlangıç node\'undan çıkan edge yok.' : 'Başlangıçtan ulaşılan başka node yok.');
    const generator = `random(${kind}_coverage(100) or length(${20 * graph.edges.length + 20}))`;
    const runs = [];
    const first = await walker.offline(generator, usedSeed);
    if (first.edges.length) runs.push(first.edges);
    const covered = coveredBy(graph, runs, goal);
    for (const id of wanted) {
      if (covered.has(id)) continue;
      const run = await walker.offline(`a_star(reached_${kind}(${id}))`);
      if (!run.edges.length) continue;
      runs.push(run.edges);
      for (const x of coveredBy(graph, [run.edges], goal)) covered.add(x);
    }
    return {
      runs,
      planner: { engine: 'graphwalker', goal, generator, seed: usedSeed, ...(first.deadEnd && { deadEnd: first.deadEnd }) },
      unreachable: unreachable.map(({ id, name }) => ({ id, name })),
      calls: walker.calls,
    };
  } finally {
    walker.dispose();
  }
}

// Başlangıçtan ulaşılabilen node'lar ve edge'ler, node'ların başlangıca uzaklığı (BFS).
function reachable(graph) {
  const nodes = new Set([graph.start]);
  const edges = new Set();
  const depth = new Map([[graph.start, 0]]);
  const queue = [graph.start];
  while (queue.length) {
    const at = queue.shift();
    for (const edge of graph.edges.filter((e) => e.source === at)) {
      edges.add(edge.id);
      if (!nodes.has(edge.target)) {
        nodes.add(edge.target);
        depth.set(edge.target, depth.get(at) + 1);
        queue.push(edge.target);
      }
    }
  }
  return { nodes, edges, depth };
}

function coveredBy(graph, runs, goal) {
  const byId = new Map(graph.edges.map((e) => [e.id, e]));
  if (goal === 'edges') return new Set(runs.flat());
  return new Set([graph.start, ...runs.flat().map((id) => byId.get(id).target)]);
}

function nameOf(graph, id) {
  return graph.nodes.find((n) => n.id === id)?.name ?? id;
}

// Ulaşılabilen kısım GraphWalker modeli olarak geçici bir dosyaya yazılır; her offline çağrısı
// onu okur. Adlar id'dir.
async function modelWalker(graph, reach, { java, jar }) {
  const dir = mkdtempSync(join(tmpdir(), 'graph-recorder-plan-'));
  const file = join(dir, 'model.json');
  writeFileSync(file, JSON.stringify({
    name: 'plan',
    models: [{
      id: 'plan', name: 'plan', generator: 'random(edge_coverage(100))', startElementId: graph.start,
      vertices: graph.nodes.filter((n) => reach.nodes.has(n.id)).map((n) => ({ id: n.id, name: n.id })),
      edges: graph.edges.filter((e) => reach.edges.has(e.id)).map((e) => ({ id: e.id, name: e.id, sourceVertexId: e.source, targetVertexId: e.target })),
    }],
  }));
  const edgeIds = new Set(reach.edges);
  const walker = {
    calls: 0,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
    // Döner: { edges: [id...], deadEnd: node id | null }
    offline: async (generator, seed = null) => {
      walker.calls++;
      const args = ['-jar', jar, 'offline', ...(seed !== null ? ['--seed', String(seed)] : []), '-m', file, generator];
      const { code, stdout, stderr } = await run(java, args);
      const steps = stdout.split(/\r?\n/).filter((line) => line.startsWith('{')).map((line) => JSON.parse(line).currentElementName);
      const deadEnd = /NoPathFoundException[^\n]*element: (\S+)/.exec(stdout + stderr)?.[1] ?? null;
      if (code !== 0 && !deadEnd) throw new Error(`GraphWalker çalışmadı (${generator}): ${(stderr || stdout).trim().split(/\r?\n/).slice(-2).join(' ')}`);
      return { edges: steps.filter((id) => edgeIds.has(id)), deadEnd };
    },
  };
  return walker;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`GraphWalker ${CALL_TIMEOUT_MS / 1000} sn içinde bitmedi.`));
    }, CALL_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Java çalıştırılamadı (${command}): ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
