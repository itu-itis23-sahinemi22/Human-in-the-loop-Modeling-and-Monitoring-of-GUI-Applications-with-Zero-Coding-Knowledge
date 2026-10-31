// Komut satırı planlayıcısı (runner/plan.js, tarayıcısız) GraphWalker'ın iki sürümüyle: bulunan
// her sürüm için tüm edge'ler (çıkmaz node), aynı tohum aynı koşular, tüm node'lar, bir node'a
// ulaş, senaryoda sürüm (planner.cli), tohum 0'ın reddi. Sürümler:
//   Java: GRAPHWALKER_JAR (+ GRAPHWALKER_JAVA) ya da kurulumun jar'ı
//   Rust: GRAPHWALKER_BIN ya da kurulumun graphwalker.exe'si
// Hiçbiri yoksa test atlanır (çıkış kodu 3).
// Kullanım: node tests/e2e/planner-cli.test.js
//   Rust'ı kurulum olmadan denemek için (PowerShell): $env:GRAPHWALKER_BIN = 'C:\yol\graphwalker.exe'
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO } = require('./env');

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

// Kurulumun ayarı (install.js); eski kurulumda cli yok: Java
let saved = {};
try {
  saved = JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA ?? '', 'GraphRecorder', 'config.json'), 'utf8'));
} catch { /* kurulum yok */ }
const exists = (file) => Boolean(file) && fs.existsSync(file);
const jar = process.env.GRAPHWALKER_JAR ?? ((saved.cli ?? 'java') === 'java' ? saved.jar : null);
const java = process.env.GRAPHWALKER_JAVA ?? saved.java ?? 'java';
const binary = process.env.GRAPHWALKER_BIN ?? (saved.cli === 'rust' ? saved.binary : null);
const clis = [
  ...(exists(jar) ? [{ cli: 'java', label: 'Java', flags: ['--jar', jar, '--java', java] }] : []),
  ...(exists(binary) ? [{ cli: 'rust', label: 'Rust', flags: ['--graphwalker', binary] }] : []),
];
if (!clis.length) {
  console.log('ATLANDI: GraphWalker yok (kurulum ya da GRAPHWALKER_JAR / GRAPHWALKER_BIN).');
  process.exit(3);
}

// Model: Ana → A → Ana, Ana → C → Ana, Ana → B (çıkmaz); eklentinin dışa aktardığı biçimde
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-planner-cli-'));
const vertex = (id, name) => ({ id, name, properties: { elements: [{ key: `button:${name}`, types: ['button'], count: 1 }] } });
const edge = (id, name, source, target) => ({ id, name, sourceVertexId: source, targetVertexId: target, properties: { uiActions: [] } });
const modelFile = path.join(OUT, 'Plan.json');
fs.writeFileSync(modelFile, JSON.stringify({
  name: 'Plan',
  models: [{
    id: 'm', name: 'Plan', generator: 'random(edge_coverage(100))', startElementId: 'n1',
    properties: { graphRecorder: { format: 'graph-recorder/v5', settings: {} } },
    vertices: [vertex('n1', 'v_Ana'), vertex('n2', 'v_A'), vertex('n3', 'v_B'), vertex('n4', 'v_C')],
    edges: [edge('e1', 'e_A', 'n1', 'n2'), edge('e2', 'e_GeriA', 'n2', 'n1'), edge('e3', 'e_B', 'n1', 'n3'), edge('e4', 'e_C', 'n1', 'n4'), edge('e5', 'e_GeriC', 'n4', 'n1')],
  }],
}));
const targetOf = new Map([['e1', 'n2'], ['e2', 'n1'], ['e3', 'n3'], ['e4', 'n4'], ['e5', 'n1']]);
const sourceOf = new Map([['e1', 'n1'], ['e2', 'n2'], ['e3', 'n1'], ['e4', 'n1'], ['e5', 'n4']]);
// Koşu başlangıçtan yürünür mü: her edge bir öncekinin vardığı node'dan çıkar
const walkable = (run) => run.reduce((at, id) => (at !== null && sourceOf.get(id) === at ? targetOf.get(id) : null), 'n1') !== null;

// plan.js; ortamdaki GRAPHWALKER_* değişkenleri karışmasın diye sürüm bayraklarla verilir
function plan({ flags }, args, name) {
  const out = path.join(OUT, `${name}.json`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GRAPHWALKER_')));
  const result = spawnSync(process.execPath, [path.join(REPO, 'runner', 'plan.js'), modelFile, ...args, ...flags, '--out', out], { encoding: 'utf8', env, timeout: 120000 });
  const scenario = result.status === 0 && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  return { code: result.status, stderr: (result.stderr ?? '').trim(), scenario };
}

for (const gw of clis) {
  console.log(`\n=== GraphWalker (${gw.label})`);
  const edges = plan(gw, ['--goal', 'edges', '--seed', '42'], `${gw.cli}-edges`);
  const sc = edges.scenario;
  check(`${gw.label}: tüm edge'ler 5/5`, edges.code === 0 && sc?.coverage.edges.join('/') === '5/5', `${edges.code} ${JSON.stringify(sc?.runs)} ${edges.stderr.slice(-300)}`);
  if (!sc) continue;
  check(`${gw.label}: senaryoda sürüm ve tohum (planner.cli, seed)`, sc.planner.engine === 'graphwalker' && sc.planner.cli === gw.cli && sc.planner.seed === 42, JSON.stringify(sc.planner));
  check(`${gw.label}: çıkmaz node B (birden fazla koşu varsa)`, sc.runs.length === 1 ? !sc.planner.deadEnd || sc.planner.deadEnd === 'n3' : sc.planner.deadEnd === 'n3', `${sc.runs.length} koşu, deadEnd ${sc.planner.deadEnd}`);
  check(`${gw.label}: her koşu başlangıçtan yürünür`, sc.runs.every(walkable), JSON.stringify(sc.runs));
  check(`${gw.label}: özet satırında sürüm`, edges.stderr.includes(`GraphWalker (${gw.label})`), edges.stderr);

  const again = plan(gw, ['--goal', 'edges', '--seed', '42'], `${gw.cli}-edges-2`);
  check(`${gw.label}: aynı tohum aynı koşular`, JSON.stringify(again.scenario?.runs) === JSON.stringify(sc.runs), JSON.stringify(again.scenario?.runs));

  const nodes = plan(gw, ['--goal', 'nodes', '--seed', '7'], `${gw.cli}-nodes`);
  check(`${gw.label}: tüm node'lar 4/4`, nodes.code === 0 && nodes.scenario?.coverage.nodes.join('/') === '4/4', `${nodes.code} ${JSON.stringify(nodes.scenario?.runs)} ${nodes.stderr.slice(-300)}`);

  const reach = plan(gw, ['--goal', 'node', '--target', 'v_C'], `${gw.cli}-node`);
  const run = reach.scenario?.runs[0] ?? [];
  check(`${gw.label}: node'a ulaş: tek koşu, C'de biter`, reach.code === 0 && reach.scenario.runs.length === 1 && walkable(run) && targetOf.get(run.at(-1)) === 'n4', `${reach.code} ${JSON.stringify(reach.scenario?.runs)} ${reach.stderr.slice(-300)}`);

  const zero = plan(gw, ['--goal', 'edges', '--seed', '0'], `${gw.cli}-zero`);
  check(`${gw.label}: tohum 0 reddedilir`, zero.code === 1 && zero.stderr.includes('Tohum 1'), `${zero.code} ${zero.stderr}`);
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
process.exit(failures ? 1 : 0);
