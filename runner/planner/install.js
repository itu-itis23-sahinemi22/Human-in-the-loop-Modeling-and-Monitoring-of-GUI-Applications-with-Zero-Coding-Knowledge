#!/usr/bin/env node
// =============================================================================
// install.js — PLANLAYICI KURULUMU (bir kez)
// -----------------------------------------------------------------------------
// Panelin GraphWalker stratejisi kullanıcının bilgisayarındaki GraphWalker'ı Chrome'un native
// messaging'iyle çalıştırır: eklenti program çalıştıramaz, ama Chrome kayıtlı bir programı
// (host) kendisi başlatabilir. Kurulum bu kaydı yapar; yönetici yetkisi istemez:
//   1. Java 17 / 21'i bulur (graphwalker.js > findJava); yoksa nereden kurulacağını söyler.
//   2. GraphWalker CLI jar'ının yolunu sorar (ya da --jar) ve Java'yla dener.
//   3. host.js ve graphwalker.js'i %LOCALAPPDATA%\GraphRecorder'a kopyalar; ayar dosyasını,
//      host.cmd'yi ve host manifestini yazar. Manifest yalnızca bu eklentinin kimliğine izin
//      verir (kimlik extension/manifest.json'daki key'den hesaplanır).
//   4. Chrome, Chromium ve Edge için HKCU kayıt anahtarı ekler.
//   5. Host'u bir "ping" isteğiyle dener.
// Repo kodu değişince (graphwalker.js, host.js) kurulum yeniden çalıştırılır: kopyalar güncellenir.
// Kullanım: runner\install-planner.cmd [--jar <yol>] [--java <yol>] [--uninstall]
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

const registryKey = (browser) => `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${HOST_NAME}`;

async function main() {
  const { values: options } = parseArgs({ options: { jar: { type: 'string' }, java: { type: 'string' }, uninstall: { type: 'boolean' } } });
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

  // 1. Java
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

  // 2. Jar
  const previous = readSaved(dir).jar;
  let jar = options.jar;
  if (!jar) {
    console.log(`GraphWalker CLI jar'ı gerekli (graphwalker-cli-4.3.3.jar; indirme: ${JAR_URL}).`);
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    jar = (await prompt.question(`Jar'ın yolu${previous ? ` [Enter: ${previous}]` : ''}: `)).trim().replace(/^"|"$/g, '') || previous;
    prompt.close();
  }
  if (!jar || !existsSync(jar)) {
    console.log(`Jar bulunamadı: ${jar ?? '(boş)'}`);
    return 1;
  }
  let version;
  try {
    version = graphWalkerVersion({ java, jar });
  } catch (error) {
    console.log(`GraphWalker çalışmadı: ${error.message}`);
    return 1;
  }
  console.log(`GraphWalker ${version}: ${jar}`);

  // 3. Dosyalar
  const id = extensionId();
  mkdirSync(dir, { recursive: true });
  for (const file of ['host.js', 'graphwalker.js']) copyFileSync(new URL(file, HERE), join(dir, file));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ java, jar, node: process.execPath, version }, null, 2));
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
