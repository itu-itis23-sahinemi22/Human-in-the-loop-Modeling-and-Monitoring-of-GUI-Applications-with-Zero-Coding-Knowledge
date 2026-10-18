#!/usr/bin/env node
// =============================================================================
// run.js — RUNNER (komut satırı)
// -----------------------------------------------------------------------------
// Bir senaryoyu (bir ya da birden fazla koşu) gerçek bir tarayıcıda tekrar oynatır ve her
// edge'den sonra varılan ekranın beklenen node olduğunu doğrular. Her koşu yeni bir tarayıcı
// bağlamında, temiz bir oturumla baştan başlar. Bir koşu ilk başarısız adımında durur (sonraki
// edge'ler o adımın node'undan çıkar); kalan adımlar "atlandı" sayılır, sonraki koşu yine
// çalışır. Sonuç report.json, report.html ve junit.xml olarak yazılır (lib/report.js).
// Kullanım ve tasarım: runner/README.md
// =============================================================================

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { playAction } from './lib/actions.js';
import { verifyState } from './lib/oracle.js';
import { INIT_SCRIPT, setViewport, settle } from './lib/page.js';
import { writeReports } from './lib/report.js';
import { coverageOf, graphOf, loadInput } from './lib/scenario.js';

const USAGE = `Kullanım:
  node run.js <senaryo.json> [seçenekler]
  node run.js <model.json> --path <yol> [seçenekler]

  <senaryo.json>         paneldeki "Senaryo indir"in ya da planlayıcının ürettiği senaryo
  <model.json>           eklentinin "GraphWalker JSON" butonuyla indirdiği model
  -p, --path <yol>       (modelle) edge adları ya da id'leri, virgülle: e_Login,e_Cart
                         ya da bir dosya: JSON dizi veya GraphWalker "offline" çıktısı
  -s, --secrets <dosya>  maskeli değerler (******): { "input:password": "..." }
      --headed           tarayıcıyı görünür aç
      --slow-mo <ms>     her tarayıcı işleminden sonra bekle
      --timeout <ms>     element ve doğrulama için en fazla bekleme (varsayılan 10000)
      --channel <ad>     Playwright'ın Chromium'u yerine kurulu tarayıcı: chrome, msedge
      --out <klasör>     raporlar ve ekran görüntüleri (varsayılan runner/out/<senaryo>-<zaman>)`;

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
  if (options.help || positionals.length !== 1) {
    console.log(USAGE);
    return options.help ? 0 : 2;
  }

  const { model, scenario } = loadInput(positionals[0], options.path);
  const settings = {
    timeout: Number(options.timeout ?? 10000),
    secrets: options.secrets ? JSON.parse(readFileSync(options.secrets, 'utf8')) : {},
    viewport: model.start.viewport ?? DEFAULT_VIEWPORT,
  };
  const startedAt = new Date();
  const out = options.out ?? fileURLToPath(new URL(`./out/${slug(scenario.name)}-${startedAt.toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
  mkdirSync(out, { recursive: true });
  const coverage = coverageOf(graphOf(model), scenario.runs.map((run) => run.map((edge) => edge.id)));

  console.log(`Senaryo: ${scenario.name} · ${scenario.runs.length} koşu · kapsama ${coverage.edges[0]}/${coverage.edges[1]} edge, ${coverage.nodes[0]}/${coverage.nodes[1]} node`);
  console.log(`Model: ${model.name} · ${model.format} · görünen alan ${viewportText(settings.viewport)}`);
  if (!model.start.viewport) console.log(`Uyarı: modelde görünen alan yok (eski kayıt); ${viewportText(settings.viewport)} kullanılıyor, state'ler tutmayabilir.`);

  const browser = await chromium.launch({
    headless: !options.headed,
    slowMo: Number(options['slow-mo'] ?? 0),
    channel: options.channel,
    // Kaydırma çubukları kayıt yapılan tarayıcıdaki gibi yer kaplasın: sayfanın düzeni, dolayısıyla
    // ekrana sığan elementler aynı kalsın. Playwright headless modda onları varsayılan olarak gizler.
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  const runs = [];
  try {
    for (const [i, edges] of scenario.runs.entries()) {
      console.log(`\nKoşu ${i + 1}/${scenario.runs.length}: ${[model.start.name, ...edges.map((e) => e.name)].join(' → ')}`);
      runs.push(await runPath(browser, model, edges, i + 1, { ...settings, out }));
    }
  } finally {
    await browser.close();
  }

  const steps = runs.flatMap((run) => run.steps);
  const count = (status) => steps.filter((s) => s.status === status).length;
  const summary = { runs: runs.length, failedRuns: runs.filter((r) => r.status === 'failed').length, steps: steps.length, passed: count('passed'), failed: count('failed'), skipped: count('skipped') };
  const result = {
    scenario: scenario.name, planner: scenario.planner,
    model: { name: model.name, format: model.format, viewport: viewportText(settings.viewport) },
    startedAt: startedAt.toISOString(), duration: Date.now() - startedAt, coverage, summary, runs,
  };
  writeReports(out, result, model);
  console.log(`\nSonuç: ${summary.failed ? 'KALDI' : 'GEÇTİ'} · ${summary.passed}/${summary.steps} adım · ${summary.runs} koşu`
    + `${summary.failedRuns ? ` (${summary.failedRuns} koşu kaldı)` : ''} · ${seconds(result.duration)}`);
  console.log(`Rapor: ${join(out, 'report.html')} (ayrıca report.json, junit.xml)`);
  return summary.failed ? 1 : 0;
}

// Bir koşu: yeni tarayıcı bağlamı (temiz oturum), başlangıç doğrulaması, sonra edge'ler. Adım:
//   { kind: 'start' | 'edge', name, edgeId?, actions?, target, targetId, status, duration,
//     warnings, error?, mismatch?, screenshot? }   status: passed | failed | skipped
async function runPath(browser, model, edges, index, { timeout, secrets, viewport, out }) {
  const startedAt = new Date();
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.devicePixelRatio,
  });
  await context.addInitScript({ content: INIT_SCRIPT });
  const warnings = [];
  const run = createRun(context, { timeout, secrets, viewport, warn: (text) => warnings.push(text) });
  await run.track(await context.newPage());
  const steps = [];
  try {
    for (const [i, edge] of [null, ...edges].entries()) {
      const target = edge ? model.vertices.get(edge.target) : model.start;
      const step = {
        kind: edge ? 'edge' : 'start', name: edge ? `${edge.name} → ${target.name}` : target.name,
        ...(edge && { edgeId: edge.id, actions: edge.actions.length }), target: target.name, targetId: target.id,
      };
      const stepStarted = Date.now();
      warnings.length = 0;
      try {
        const broken = edge ? await playEdge(edge, run) : (await run.page.goto(model.start.url), null);
        if (broken) {
          step.error = `Aksiyon ${broken.index + 1}/${edge.actions.length} ("${broken.action.label}") oynatılamadı: ${broken.error.message.split('\n')[0]}`;
        } else {
          const verdict = await verifyState(run.page, target, model.settings, { timeout });
          if (!verdict.ok) step.mismatch = mismatchOf(verdict, target);
        }
      } catch (error) {
        step.error = error.message.split('\n')[0];
      }
      step.status = step.error || step.mismatch ? 'failed' : 'passed';
      step.duration = Date.now() - stepStarted;
      step.warnings = [...warnings];
      printStep(step);
      steps.push(step);
      if (step.status === 'failed') {
        step.screenshot = await screenshot(run.page, out, `kosu-${index}-${slug(edge?.name ?? target.name)}.png`);
        for (const rest of edges.slice(i)) {
          const restTarget = model.vertices.get(rest.target);
          steps.push({ kind: 'edge', name: `${rest.name} → ${restTarget.name}`, edgeId: rest.id, actions: rest.actions.length, target: restTarget.name, targetId: restTarget.id, status: 'skipped', duration: 0, warnings: [] });
        }
        break;
      }
    }
  } finally {
    await context.close();
  }
  return { index, startedAt: startedAt.toISOString(), duration: Date.now() - startedAt, status: steps.some((s) => s.status === 'failed') ? 'failed' : 'passed', steps };
}

function mismatchOf(verdict, vertex) {
  const viewport = viewportText(verdict.screen.viewport);
  return { url: verdict.url, expectedUrl: vertex.urlKey, diff: verdict.diff, viewport, expectedViewport: vertex.viewport ? viewportText(vertex.viewport) : viewport };
}

// Başarısız adımın ekran görüntüsü (rapora gömülür). Sayfa kapanmışsa alınamaz.
async function screenshot(page, out, name) {
  try {
    await page.screenshot({ path: join(out, name) });
    return name;
  } catch {
    return null;
  }
}

// Çalıştırmanın durumu: açık sayfalar (sekmeler) ve aktif olanı. Kayıt birden fazla sekmeye
// yayılabilir ('tab' aksiyonları, bkz. lib/actions.js). pages en son kullanılan sonda olacak
// şekilde tutulur. Görünen alan sayfa başınadır (DevTools protokolü oturumu da): yeni sayfa,
// aktif sayfanın görünen alanıyla açılır.
function createRun(context, options) {
  const sessions = new Map(); // sayfa -> { cdp, viewport }
  const run = {
    ...options, context, pages: [], page: null,
    async track(page) {
      sessions.set(page, { cdp: await context.newCDPSession(page), viewport: run.viewport });
      await setViewport(sessions.get(page).cdp, run.viewport);
      run.pages.push(page);
      run.page ??= page;
    },
    async activate(page) {
      run.pages = [...run.pages.filter((p) => p !== page), page];
      run.page = page;
      run.viewport = sessions.get(page).viewport;
      await page.bringToFront();
    },
    forget(page) {
      run.pages = run.pages.filter((p) => p !== page);
      sessions.delete(page);
    },
    async setViewport(next) {
      run.viewport = next;
      sessions.get(run.page).viewport = next;
      await setViewport(sessions.get(run.page).cdp, next);
    },
  };
  return run;
}

// Edge'in aksiyonlarını sırayla oynatır; her aksiyondan sonra sayfanın durulması beklenir
// (kayıtta her aksiyon, öncekinin etkisi durulduktan sonraki ekranda yapılmıştı). Aksiyon
// aktif sekmeyi değiştirebilir; her aksiyon o anki aktif sayfada oynatılır.
// Oynatılamayan ilk aksiyonu döner, hepsi oynatıldıysa null.
async function playEdge(edge, run) {
  for (const [index, action] of edge.actions.entries()) {
    try {
      await playAction(run.page, action, run);
      await settle(run.page);
    } catch (error) {
      return { index, action, error };
    }
  }
  return null;
}


// -----------------------------------------------------------------------------
// ÇIKTI
// -----------------------------------------------------------------------------

function printStep(step) {
  const detail = step.kind === 'start' ? 'başlangıç' : `${step.actions} aksiyon`;
  console.log(`${step.status === 'passed' ? '✓' : '✗'} ${step.name.padEnd(36)} ${detail.padEnd(12)} ${seconds(step.duration)}`);
  for (const text of step.warnings) console.log(`    Uyarı: ${text}`);
  if (step.error) console.log(`    ${step.error}`);
  if (step.mismatch) printMismatch(step);
}

// Beklenen node ile ekranın farkı: URL şablonu, sayısı farklı türler, görünen alan.
function printMismatch({ target, mismatch: m }) {
  console.log(`    Beklenen ekrana (${target}) varılmadı:`);
  if (m.url !== m.expectedUrl) console.log(`      URL şablonu: beklenen ${m.expectedUrl}, ekranda ${m.url}`);
  const LIMIT = 12;
  for (const { key, expected, actual } of m.diff.slice(0, LIMIT)) console.log(`      ${key}: beklenen ${expected}, ekranda ${actual}`);
  if (m.diff.length > LIMIT) console.log(`      (+${m.diff.length - LIMIT} tür daha)`);
  if (m.viewport !== m.expectedViewport) console.log(`      Görünen alan: kayıtta ${m.expectedViewport}, ekranda ${m.viewport}`);
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} sn`;
}

function viewportText({ width, height, devicePixelRatio }) {
  const scale = Math.round(devicePixelRatio * 100) / 100;
  return `${width}×${height}` + (scale !== 1 ? ` @${scale}x` : '');
}

// Dosya adına uygun kısa ad: "SwagLabs · tüm edge'ler" -> "SwagLabs-tum-edge-ler"
function slug(text) {
  return String(text).replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'senaryo';
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => {
    console.error(`Hata: ${error.message.split('\n')[0]}`);
    process.exitCode = 2;
  },
);
