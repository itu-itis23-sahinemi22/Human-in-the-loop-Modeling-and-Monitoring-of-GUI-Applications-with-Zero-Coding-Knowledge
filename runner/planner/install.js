#!/usr/bin/env node
// =============================================================================
// install.js — PLANLAYICI KURULUMU (bir kez)
// -----------------------------------------------------------------------------
// Panelin GraphWalker stratejisi kullanıcının bilgisayarındaki GraphWalker'ı Chrome'un native
// messaging'iyle çalıştırır: eklenti program çalıştıramaz, ama Chrome kayıtlı bir programı
// (host) kendisi başlatabilir. Kurulum bu kaydı yapar; yönetici yetkisi istemez:
//   1. GraphWalker'ın yolunu sorar: Java sürümünün jar'ı (ya da --jar) veya Rust sürümünün
//      derlenmiş graphwalker.exe'si (ya da --graphwalker). Sürüm uzantıdan anlaşılır (.jar: Java).
//   2. Jar ise Java 17 / 21'i bulur (graphwalker.js > findJava); yoksa nereden kurulacağını
//      söyler. Sonra GraphWalker'ı --version ile dener.
//   3. host.js ve graphwalker.js'i %LOCALAPPDATA%\GraphRecorder'a kopyalar; ayar dosyasını,
//      host.cmd'yi ve host manifestini yazar. Manifest yalnızca bu eklentinin kimliğine izin
//      verir (kimlik extension/manifest.json'daki key'den hesaplanır).
//   4. Chrome, Chromium ve Edge için HKCU kayıt anahtarı ekler.
//   5. Host'u bir "ping" isteğiyle dener.
// Repo kodu değişince (graphwalker.js, host.js) kurulum yeniden çalıştırılır: kopyalar güncellenir.
// Sürüm değiştirmek (Java ↔ Rust) için kurulum yeniden çalıştırılır.
// Kullanım: runner\install-planner.cmd [--jar <yol> [--java <yol>] | --graphwalker <exe>] [--uninstall]
// =============================================================================

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { HOST_NAME, JAVA_VERSIONS, findJava, graphWalkerVersion, installDir, javaMajor } from './graphwalker.js';

const HERE = new URL('.', import.meta.url);
const MANIFEST = new URL('../../extension/manifest.json', import.meta.url);
const BROWSERS = ['Google\\Chrome', 'Chromium', 'Microsoft\\Edge'];
const JAR_URL = 'https://github.com/GraphWalker/graphwalker-project/releases/tag/4.3.3';
const JAVA_URL = 'https://adoptium.net/temurin/releases/?version=21';
const RUST_URL = 'https://github.com/GraphWalker/graphwalker-rs';

const registryKey = (browser) => `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${HOST_NAME}`;

async function main() {
  const { values: options } = parseArgs({ options: { jar: { type: 'string' }, java: { type: 'string' }, graphwalker: { type: 'string' }, uninstall: { type: 'boolean' } } });
  if (process.platform !== 'win32') {
    console.log('Kurulum şimdilik yalnızca Windows için. Komut satırında planlayıcı yine çalışır: node runner/plan.js model.json --jar <yol>');
    return 1;
  }
  const dir = installDir();
  if (options.uninstall) {
    for (const browser of BROWSERS) {
      try {
        execFileSync('reg', ['delete', registryKey(browser), '/f'], { stdio: 'ignore' });
      } catch { /* kayıt yok */ }
    }
    rmSync(dir, { recursive: true, force: true });
    console.log(`Planlayıcı kaldırıldı (${dir} ve kayıt anahtarları).`);
    return 0;
  }

  // 1. GraphWalker: Java sürümünün jar'ı ya da Rust sürümünün graphwalker.exe'si
  const saved = readSaved(dir);
  const previous = saved.cli === 'rust' ? saved.binary : saved.jar;
  let file = options.graphwalker ?? options.jar;
  if (!file) {
    console.log('GraphWalker gerekli; iki sürümden biri:');
    console.log(`  Java: graphwalker-cli-4.3.3.jar (indirme: ${JAR_URL}; Java 17 ya da 21 ister)`);
    console.log(`  Rust: derlenmiş graphwalker.exe (graphwalker-rs; derleme: ${RUST_URL})`);
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    file = (await prompt.question(`Jar'ın ya da graphwalker.exe'nin yolu${previous ? ` [Enter: ${previous}]` : ''}: `)).trim().replace(/^"|"$/g, '') || previous;
    prompt.close();
  }
  if (!file || !existsSync(file)) {
    console.log(`Dosya bulunamadı: ${file ?? '(boş)'}`);
    return 1;
  }
  const cli = options.graphwalker ? 'rust' : options.jar || /\.jar$/i.test(file) ? 'java' : 'rust';

  // 2. Java (yalnızca jar için)
  let config = { cli, binary: file };
  if (cli === 'java') {
    const java = options.java ?? findJava().java;
    const major = java && javaMajor(java);
    if (!java || !JAVA_VERSIONS.includes(major)) {
      const { found } = findJava();
      console.log(`GraphWalker 4.3.3 için Java ${JAVA_VERSIONS.join(' ya da ')} gerekli.`);
      console.log(found.length ? `Bulunanlar: ${found.map((c) => `Java ${c.major} (${c.java})`).join(', ')}` : 'Bilgisayarda Java bulunamadı.');
      console.log(`Java 21'i kurun (${JAVA_URL}) ve kurulumu yeniden çalıştırın; ya da --java ile bir java.exe gösterin.`);
      return 1;
    }
    console.log(`Java ${major}: ${java}`);
    config = { cli, java, jar: file };
  }
  let version;
  try {
    version = graphWalkerVersion(config);
  } catch (error) {
    console.log(`GraphWalker çalışmadı: ${error.message}`);
    return 1;
  }
  console.log(`GraphWalker ${version} (${cli === 'rust' ? 'Rust' : 'Java'}): ${file}`);

  // 3. Dosyalar
  const id = extensionId();
  mkdirSync(dir, { recursive: true });
  for (const file of ['host.js', 'graphwalker.js']) copyFileSync(new URL(file, HERE), join(dir, file));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...config, node: process.execPath, version }, null, 2));
  // %~dp0: host.cmd'nin klasörü; Türkçe karakterli yol dosyaya yazılmaz (cmd onu yanlış okur).
  const node = process.execPath;
  writeFileSync(join(dir, 'host.cmd'), `@echo off\r\n${/[^\x00-\x7f]/.test(node) ? 'chcp 65001 >nul\r\n' : ''}"${node}" "%~dp0host.js" %*\r\n`);
  const manifest = join(dir, `${HOST_NAME}.json`);
  writeFileSync(manifest, JSON.stringify({
    name: HOST_NAME,
    description: 'Graph Recorder: GraphWalker ile senaryo üretimi',
    path: join(dir, 'host.cmd'),
    type: 'stdio',
    allowed_origins: [`chrome-extension://${id}/`],
  }, null, 2));

  // 4. Kayıt
  for (const browser of BROWSERS) execFileSync('reg', ['add', registryKey(browser), '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'], { stdio: 'ignore' });

  // 5. Deneme
  const reply = await ping(join(dir, 'host.cmd'));
  if (reply.error || !reply.ok) {
    console.log(`Host denemesi başarısız: ${reply.error ?? JSON.stringify(reply)}`);
    return 1;
  }
  console.log(`\nKurulum tamam (${dir}). Eklenti kimliği: ${id}`);
  console.log('Panelde Senaryo > Strateji > "GraphWalker" seçeneklerini kullanabilirsiniz. Eklenti açıksa yenilemeye gerek yok.');
  return 0;
}

function readSaved(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

// Paketlenmemiş eklentinin kimliği manifest'teki public key'den gelir: SHA-256'nın ilk 32
// onaltılık hanesi, 0-f yerine a-p.
function extensionId() {
  const { key } = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (!key) throw new Error('extension/manifest.json\'da key yok: eklenti kimliği sabit değil.');
  const hash = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

// host.cmd'ye Chrome'un göndereceği biçimde bir "ping" gönderir.
function ping(hostCmd) {
  return new Promise((resolve) => {
    const child = spawn(`"${hostCmd}"`, { shell: true, windowsHide: true });
    const body = Buffer.from(JSON.stringify({ type: 'ping' }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    let out = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => { out = Buffer.concat([out, chunk]); });
    child.on('close', () => {
      try {
        resolve(JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString('utf8')));
      } catch {
        resolve({ error: `cevap okunamadı: ${out.toString('utf8').slice(0, 200)}` });
      }
    });
    child.stdin.end(Buffer.concat([header, body]));
  });
}

main().then((code) => { process.exitCode = code; }, (error) => {
  console.error(`Hata: ${error.message}`);
  process.exitCode = 1;
});
