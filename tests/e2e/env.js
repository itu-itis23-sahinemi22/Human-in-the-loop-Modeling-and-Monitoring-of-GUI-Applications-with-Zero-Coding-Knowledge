// Uçtan uca testlerin ortak ortamı: repo ve eklenti klasörü, Chromium, çıktı klasörü.
// Playwright runner'ın kurulu paketinden yüklenir: testler runner'la aynı sürümü ve aynı
// Chromium'u kullanır, ayrıca kurulum gerekmez (runner/README.md > Kurulum).
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');
const EXT = path.join(REPO, 'extension');

let playwright;
try {
  playwright = require(require.resolve('playwright-core', { paths: [path.join(REPO, 'runner')] }));
} catch {
  console.error('Playwright bulunamadı. Önce runner\'ı kurun: cd runner && npm install && npx playwright install chromium');
  process.exit(2);
}
const { chromium } = playwright;
const CHROME = chromium.executablePath();

// Testin çıktı klasörü: tests/out/<ad> (repoya girmez).
function outDir(name) {
  const dir = path.join(REPO, 'tests', 'out', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Panelde oynatma: "Koşuyu oynat"tan sonra açılan temizlik penceresinde "Temizlemeden oynat"
// (sidepanel/panel.js > TEMİZLİK). Pencere maskeli değer kontrolünden sonra açılır.
async function skipCleanup(panel) {
  await panel.waitForFunction(() => document.getElementById('cleanup-dialog').open, null, { timeout: 10000 });
  await panel.evaluate(() => document.getElementById('btn-cleanup-skip').click());
}

module.exports = { chromium, REPO, EXT, CHROME, outDir, skipCleanup };
