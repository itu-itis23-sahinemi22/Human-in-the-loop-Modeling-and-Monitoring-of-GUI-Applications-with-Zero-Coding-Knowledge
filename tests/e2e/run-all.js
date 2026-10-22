// Tüm uçtan uca testleri sırayla çalıştırır; her testin çıktısı tests/out/<ad>.log'a yazılır.
// Çıkış kodu 3 olan test atlanmıştır (ör. planlayıcı kurulu değil); başarısız sayılmaz.
// Kullanım: node tests/e2e/run-all.js [--offline] [ad ...]
//   --offline : internet isteyen testleri (gerçek saucedemo) atlar
//   ad        : yalnızca adı verilen testler (ör. graphs scenarios)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ONLINE = new Set(['saucedemo-return']);
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const only = args.filter((a) => !a.startsWith('--'));
const OUT = path.join(__dirname, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

const tests = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => f.replace(/\.test\.js$/, ''))
  .filter((name) => (!only.length || only.includes(name)) && !(offline && ONLINE.has(name)));

function run(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const log = fs.createWriteStream(path.join(OUT, `${name}.log`));
    const child = spawn(process.execPath, [path.join(__dirname, `${name}.test.js`)], { cwd: path.join(__dirname, '..', '..') });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on('exit', (code) => resolve({ name, code, seconds: Math.round((Date.now() - started) / 1000) }));
  });
}

(async () => {
  const results = [];
  for (const name of tests) {
    process.stdout.write(`${name.padEnd(18)} `);
    const result = await run(name);
    results.push(result);
    console.log(`${result.code === 0 ? 'GEÇTİ' : result.code === 3 ? 'ATLANDI' : `KALDI (çıkış kodu ${result.code})`}  ${result.seconds} sn`);
  }
  const failed = results.filter((r) => r.code !== 0 && r.code !== 3);
  const skipped = results.filter((r) => r.code === 3).length;
  console.log(`\n${results.length - failed.length - skipped}/${results.length} test geçti${skipped ? `, ${skipped} atlandı` : ''}.` + (failed.length ? ` Ayrıntı: tests/out/<ad>.log` : ''));
  process.exit(failed.length ? 1 : 0);
})();
