#!/usr/bin/env node
// =============================================================================
// host.js — NATIVE MESSAGING HOST (panel ↔ GraphWalker)
// -----------------------------------------------------------------------------
// Chrome bu programı panelin her isteğinde kendisi başlatır (chrome.runtime.sendNativeMessage)
// ve standart giriş / çıkışla konuşur: her mesaj 4 bayt uzunluk (little-endian) + UTF-8 JSON.
// Bir istek, bir cevap, sonra çıkış. İstekler:
//   { type: 'ping' }                               -> { ok, java, jar, version }
//   { type: 'plan', graph, goal, target?, seed? }  -> { runs, planner, unreachable, calls }
// Hata { error } olarak döner. Standart çıktıya mesajdan başka bir şey yazılmaz: Chrome
// bağlantıyı keser. Kurulum bu dosyayı ve graphwalker.js'i kullanıcının klasörüne kopyalar
// (install.js); repo taşınsa da host çalışır.
// =============================================================================

import { graphWalkerVersion, plan, readConfig } from './graphwalker.js';

function readMessage() {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    process.stdin.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (buffer.length >= 4 + length) resolve(JSON.parse(buffer.subarray(4, 4 + length).toString('utf8')));
    });
    process.stdin.on('end', () => reject(new Error('İstek gelmedi.')));
  });
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]), () => process.exit(0));
}

async function handle(message) {
  const config = readConfig();
  if (message.type === 'ping') return { ok: true, ...config, version: graphWalkerVersion(config) };
  if (message.type === 'plan') return plan(message.graph, message, config);
  throw new Error(`Bilinmeyen istek: ${message.type}`);
}

readMessage().then(handle).then(writeMessage, (error) => writeMessage({ error: error.message }));
