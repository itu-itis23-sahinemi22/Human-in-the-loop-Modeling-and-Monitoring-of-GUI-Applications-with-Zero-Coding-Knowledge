// Planlayıcının GraphWalker sürümlerine bağlı kısımlarının birim testi (tarayıcısız, GraphWalker
// çalıştırmadan): komut (Java jar / Rust exe), --version ve çıkmaz node çıktılarının okunması
// (iki sürümün gerçek çıktı biçimleriyle), tohum, ayarın seçimi, runner'ın Rust yolunu okuması.
// Kullanım: node tests/e2e/planner-unit.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { REPO } = require('./env');

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const load = (...parts) => import(pathToFileURL(path.join(REPO, 'runner', ...parts)).href);

(async () => {
  const gw = await load('planner', 'graphwalker.js');
  const { readPath } = await load('lib', 'model.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-planner-unit-'));

  // ---- Komut ----
  const java = { cli: 'java', java: 'C:\\Java\\bin\\java.exe', jar: 'C:\\gw\\graphwalker-cli-4.3.3.jar' };
  const rust = { cli: 'rust', binary: 'C:\\gw\\graphwalker.exe' };
  const args = ['offline', '--seed', '42', '-m', 'model.json', 'random(edge_coverage(100))'];
  check('komut: Java "java -jar <jar> …"', JSON.stringify(gw.gwCommand(java, args)) === JSON.stringify([java.java, ['-jar', java.jar, ...args]]), JSON.stringify(gw.gwCommand(java, args)));
  check('komut: Rust "graphwalker.exe …"', JSON.stringify(gw.gwCommand(rust, args)) === JSON.stringify([rust.binary, args]), JSON.stringify(gw.gwCommand(rust, args)));

  // ---- --version ----
  const javaVersion = 'org.graphwalker version: 4.3.3-1c28d9c\n\norg.graphwalker is open source software licensed under MIT license\n';
  check('sürüm: Java', gw.parseVersion(javaVersion) === '4.3.3-1c28d9c', gw.parseVersion(javaVersion));
  check('sürüm: Rust', gw.parseVersion('graphwalker 1.0.4 (git be3810e)\n') === '1.0.4', gw.parseVersion('graphwalker 1.0.4 (git be3810e)\n'));

  // ---- Çıkmaz node ----
  const javaDeadEnd = "An error occurred when running command: 'offline --seed 1 -m m.json random(edge_coverage(100))'.\norg.graphwalker.core.generator.NoPathFoundException: Could not find a valid path from element: n3 (n3)\n";
  const rustDeadEnd = "2026-10-31T12:00:00.000000Z ERROR graphwalker: CLI command failed error=Generator error: No path found from vertex 'n3' in model 'plan'\nGenerator error: No path found from vertex 'n3' in model 'plan'\n";
  const rustNoRoute = "Generator error: No path found from vertex 'n1' to vertex 'n9' in model 'plan'\n";
  check('çıkmaz node: Java', gw.deadEndOf(javaDeadEnd) === 'n3', String(gw.deadEndOf(javaDeadEnd)));
  check('çıkmaz node: Rust', gw.deadEndOf(rustDeadEnd) === 'n3', String(gw.deadEndOf(rustDeadEnd)));
  check('Rust\'ın hedefli "from … to …" hatası çıkmaz node değil', gw.deadEndOf(rustNoRoute) === null, String(gw.deadEndOf(rustNoRoute)));
  check('hatasız çıktıda çıkmaz node yok', gw.deadEndOf('{"currentElementName":"e1"}\n') === null);

  // ---- Tohum ----
  const seeds = Array.from({ length: 2000 }, () => gw.randomSeed());
  check('rastgele tohum 1 .. 2^31-1 (0 yok: Rust\'ta "rastgele")', seeds.every((s) => Number.isInteger(s) && s >= 1 && s < 2 ** 31));
  const graph = { start: 'n1', nodes: [{ id: 'n1', name: 'v_A' }, { id: 'n2', name: 'v_B' }], edges: [{ id: 'e1', name: 'e_AB', source: 'n1', target: 'n2' }] };
  const zero = await gw.plan(graph, { goal: 'edges', seed: 0 }, rust).then(() => null, (error) => error.message);
  check('tohum 0 reddedilir (GraphWalker çalıştırılmadan)', Boolean(zero?.includes('Tohum 1')), String(zero));

  // ---- Ayar: komut satırı > ortam değişkeni > kurulum ----
  const exe = path.join(dir, 'graphwalker.exe');
  fs.writeFileSync(exe, '');
  const jar = path.join(dir, 'graphwalker-cli.jar');
  fs.writeFileSync(jar, '');
  const saved = { BIN: process.env.GRAPHWALKER_BIN, JAR: process.env.GRAPHWALKER_JAR, JAVA: process.env.GRAPHWALKER_JAVA };
  delete process.env.GRAPHWALKER_BIN;
  delete process.env.GRAPHWALKER_JAR;
  delete process.env.GRAPHWALKER_JAVA;
  try {
    const c1 = gw.readConfig({ graphwalker: exe });
    check('--graphwalker: Rust', c1.cli === 'rust' && c1.binary === exe, JSON.stringify(c1));
    const c2 = gw.readConfig({ jar, java: 'java' });
    check('--jar / --java: Java', c2.cli === 'java' && c2.jar === jar && c2.java === 'java', JSON.stringify(c2));
    process.env.GRAPHWALKER_BIN = exe;
    const c3 = gw.readConfig();
    check('GRAPHWALKER_BIN: Rust', c3.cli === 'rust' && c3.binary === exe, JSON.stringify(c3));
    const c4 = gw.readConfig({ jar, java: 'java' });
    check('komut satırı ortam değişkenini geçer', c4.cli === 'java', JSON.stringify(c4));
    process.env.GRAPHWALKER_BIN = path.join(dir, 'yok.exe');
    const missing = (() => { try { gw.readConfig(); return null; } catch (error) { return error.message; } })();
    check('olmayan exe: anlaşılır hata', Boolean(missing?.includes('GraphWalker (Rust) bulunamadı')), String(missing));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[`GRAPHWALKER_${key}`];
      else process.env[`GRAPHWALKER_${key}`] = value;
    }
  }

  // ---- Runner: Rust'ın offline çıktısı (--path) ----
  const out = path.join(dir, 'yol.txt');
  fs.writeFileSync(out, [
    { modelId: 'm', modelName: 'm', currentElementName: 'v_Login', currentElementId: 'n1' },
    { modelId: 'm', modelName: 'm', currentElementName: 'e_Login', currentElementId: 'e1' },
    { modelId: 'm', modelName: 'm', currentElementName: 'v_Home', currentElementId: 'n2' },
  ].map((x) => JSON.stringify(x)).join('\n'));
  const items = readPath(out);
  check('runner --path: Rust çıktısında id (currentElementId)', JSON.stringify(items) === '["n1","e1","n2"]', JSON.stringify(items));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
