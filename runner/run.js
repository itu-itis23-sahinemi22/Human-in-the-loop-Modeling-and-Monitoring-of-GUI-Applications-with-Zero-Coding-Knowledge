#!/usr/bin/env node
// =============================================================================
// run.js — RUNNER (komut satırı)
// -----------------------------------------------------------------------------
// Graph Recorder'ın dışa aktardığı modeldeki bir yolu (edge dizisi) gerçek bir tarayıcıda
// tekrar oynatır ve her edge'den sonra varılan ekranın beklenen node olduğunu doğrular.
// İlk başarısız adımda durur: sonraki edge'ler o adımın node'undan çıkar.
// Kullanım ve tasarım: runner/README.md
// =============================================================================

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { playAction } from './lib/actions.js';
import { loadModel, readPath, resolvePath } from './lib/model.js';
import { verifyState } from './lib/oracle.js';
import { INIT_SCRIPT, setViewport, settle } from './lib/page.js';

const USAGE = `Kullanım: node run.js <model.json> --path <yol> [seçenekler]

  <model.json>           eklentinin "GraphWalker JSON" butonuyla indirdiği model
  -p, --path <yol>       edge adları ya da id'leri, virgülle: e_Login,e_Cart
                         ya da bir dosya: JSON dizi veya GraphWalker "offline" çıktısı
  -s, --secrets <dosya>  maskeli değerler (******): { "input:password": "..." }
      --headed           tarayıcıyı görünür aç
      --slow-mo <ms>     her tarayıcı işleminden sonra bekle
      --timeout <ms>     element ve doğrulama için en fazla bekleme (varsayılan 10000)
      --channel <ad>     Playwright'ın Chromium'u yerine kurulu tarayıcı: chrome, msedge
      --out <klasör>     başarısız adımın ekran görüntüsü (varsayılan runner/out)`;

// Görünen alanı kaydedilmemiş (eski) modellerde kullanılır.
const DEFAULT_VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 };

async function main() {
  const { values: options, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      path: { type: 'string', short: 'p' },
      secrets: { type: 'string', short: 's' },
      headed: { type: 'boolean' },
      'slow-mo': { type: 'string' },
      timeout: { type: 'string' },
      channel: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (options.help || positionals.length !== 1 || !options.path) {
    console.log(USAGE);
    return options.help ? 0 : 2;
  }

  const model = loadModel(positionals[0]);
  const steps = resolvePath(model, readPath(options.path));
  const secrets = options.secrets ? JSON.parse(readFileSync(options.secrets, 'utf8')) : {};
  const timeout = Number(options.timeout ?? 10000);
  const out = options.out ?? fileURLToPath(new URL('./out/', import.meta.url));
  const viewport = model.start.viewport ?? DEFAULT_VIEWPORT;

  console.log(`Model: ${model.name} · ${model.format} · görünen alan ${viewportText(viewport)}`);
  if (!model.start.viewport) console.log(`Uyarı: modelde görünen alan yok (eski kayıt); ${viewportText(viewport)} kullanılıyor, state'ler tutmayabilir.`);
  console.log(`Yol: ${[model.start.name, ...steps.map((e) => e.name)].join(' → ')} (${steps.length} edge)\n`);

  const browser = await chromium.launch({
    headless: !options.headed,
    slowMo: Number(options['slow-mo'] ?? 0),
    channel: options.channel,
    // Kaydırma çubukları kayıt yapılan tarayıcıdaki gibi yer kaplasın: sayfanın düzeni, dolayısıyla
    // ekrana sığan elementler aynı kalsın. Playwright headless modda onları varsayılan olarak gizler.
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  const started = Date.now();
  let passed = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.devicePixelRatio,
    });
    await context.addInitScript({ content: INIT_SCRIPT });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const warnings = [];
    const run = {
      timeout, secrets, viewport,
      async setViewport(next) {
        run.viewport = next;
        await setViewport(cdp, next);
      },
      warn: (text) => warnings.push(text),
    };
    const fail = async (name) => {
      mkdirSync(out, { recursive: true });
      const file = join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}.png`);
      await page.screenshot({ path: file });
      console.log(`    Ekran görüntüsü: ${file}`);
    };

    // Başlangıç: kayıttaki ilk ekran
    let stepStarted = Date.now();
    await page.goto(model.start.url);
    let result = await verifyState(page, model.start, model.settings, { timeout });
    printStep(result.ok, model.start.name, 'başlangıç', Date.now() - stepStarted);
    if (!result.ok) {
      printMismatch(result, model.start);
      await fail(model.start.name);
      return summary(false, passed, steps, started);
    }

    for (const edge of steps) {
      const target = model.vertices.get(edge.target);
      const name = `${edge.name} → ${target.name}`;
      stepStarted = Date.now();
      warnings.length = 0;
      const broken = await playEdge(page, edge, run);
      if (broken) {
        printStep(false, name, `${edge.actions.length} aksiyon`, Date.now() - stepStarted);
        printWarnings(warnings);
        console.log(`    Aksiyon ${broken.index + 1}/${edge.actions.length} ("${broken.action.label}") oynatılamadı: ${broken.error.message.split('\n')[0]}`);
        await fail(edge.name);
        return summary(false, passed, steps, started);
      }
      result = await verifyState(page, target, model.settings, { timeout });
      printStep(result.ok, name, `${edge.actions.length} aksiyon`, Date.now() - stepStarted);
      printWarnings(warnings);
      if (!result.ok) {
        printMismatch(result, target);
        await fail(edge.name);
        return summary(false, passed, steps, started);
      }
      passed++;
    }
    return summary(true, passed, steps, started);
  } finally {
    await browser.close();
  }
}

// Edge'in aksiyonlarını sırayla oynatır; her aksiyondan sonra sayfanın durulması beklenir
// (kayıtta her aksiyon, öncekinin etkisi durulduktan sonraki ekranda yapılmıştı).
// Oynatılamayan ilk aksiyonu döner, hepsi oynatıldıysa null.
async function playEdge(page, edge, run) {
  for (const [index, action] of edge.actions.entries()) {
    try {
      await playAction(page, action, run);
      await settle(page);
    } catch (error) {
      return { index, action, error };
    }
  }
  return null;
}


// -----------------------------------------------------------------------------
// ÇIKTI
// -----------------------------------------------------------------------------

function printStep(ok, name, detail, ms) {
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(36)} ${detail.padEnd(12)} ${seconds(ms)}`);
}

function printWarnings(warnings) {
  for (const text of warnings) console.log(`    Uyarı: ${text}`);
}

// Beklenen node ile ekranın farkı: URL şablonu ve sayısı farklı türler.
function printMismatch(result, vertex) {
  console.log(`    Beklenen ekrana (${vertex.name}) varılmadı:`);
  if (result.url !== vertex.urlKey) console.log(`      URL şablonu: beklenen ${vertex.urlKey}, ekranda ${result.url}`);
  const LIMIT = 12;
  for (const { key, expected, actual } of result.diff.slice(0, LIMIT)) {
    console.log(`      ${key}: beklenen ${expected}, ekranda ${actual}`);
  }
  if (result.diff.length > LIMIT) console.log(`      (+${result.diff.length - LIMIT} tür daha)`);
  const actual = result.screen.viewport;
  if (vertex.viewport && viewportText(vertex.viewport) !== viewportText(actual)) {
    console.log(`      Görünen alan: kayıtta ${viewportText(vertex.viewport)}, ekranda ${viewportText(actual)}`);
  }
}

function summary(ok, passed, steps, started) {
  console.log(`\nSonuç: ${ok ? 'GEÇTİ' : 'KALDI'} · ${passed}/${steps.length} edge · ${seconds(Date.now() - started)}`);
  return ok ? 0 : 1;
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} sn`;
}

function viewportText({ width, height, devicePixelRatio }) {
  const scale = Math.round(devicePixelRatio * 100) / 100;
  return `${width}×${height}` + (scale !== 1 ? ` @${scale}x` : '');
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => {
    console.error(`Hata: ${error.message.split('\n')[0]}`);
    process.exitCode = 2;
  },
);
