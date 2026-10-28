// =============================================================================
// report.js — RAPORLAR
// -----------------------------------------------------------------------------
// Çalıştırmanın sonucu üç biçimde yazılır:
//   report.json : makine için; sonucun tamamı (ekran görüntüleri dosya adıyla)
//   report.html : insan için; tek dosya (ekran görüntüleri gömülü). Başarısız adımda edge set
//                 farkı, beklenen node'un kayıttaki ekran görüntüsü, runner'ın gördüğü ekran ve
//                 ikisinin görsel farkı (eklentinin compare.js'i, rapor açılınca tarayıcıda)
//   junit.xml   : CI için; her adım bir test, kırılan koşunun kalan adımları "atlandı"
// Sonucun biçimi: run.js > runScenario.
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COMPARE_JS = readFileSync(new URL('../../extension/sidepanel/compare.js', import.meta.url), 'utf8');

export function writeReports(dir, result, model) {
  writeFileSync(join(dir, 'report.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(dir, 'junit.xml'), junit(result));
  writeFileSync(join(dir, 'report.html'), html(result, model, dir));
}


// -----------------------------------------------------------------------------
// JUnit XML
// -----------------------------------------------------------------------------
// testsuite = koşu, testcase = adım (başlangıç doğrulaması ya da edge).

function junit(result) {
  const { summary } = result;
  const suites = result.runs.map((run) => {
    const count = (status) => run.steps.filter((s) => s.status === status).length;
    const broken = run.steps.find((s) => s.status === 'failed');
    const cases = run.steps.map((step) => {
      const head = `<testcase classname="${xml(`${result.model.name}.Koşu ${run.index}`)}" name="${xml(step.name)}" time="${secondsOf(step.duration)}"`;
      if (step.status === 'skipped') return `${head}><skipped message="${xml(`Koşu "${broken?.name}" adımında kırıldı`)}"/></testcase>`;
      if (step.status === 'failed') return `${head}><failure message="${xml(failureTitle(step))}">${xml(failureLines(step).join('\n'))}</failure></testcase>`;
      return `${head}/>`;
    });
    return `  <testsuite name="${xml(`${result.scenario} · Koşu ${run.index}`)}" tests="${run.steps.length}" failures="${count('failed')}" skipped="${count('skipped')}" time="${secondsOf(run.duration)}" timestamp="${run.startedAt}">\n    ${cases.join('\n    ')}\n  </testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xml(result.scenario)}" tests="${summary.steps}" failures="${summary.failed}" skipped="${summary.skipped}" time="${secondsOf(result.duration)}">\n${suites.join('\n')}\n</testsuites>\n`;
}

function failureTitle(step) {
  return step.error ?? `Beklenen ekrana (${step.target}) varılmadı`;
}

// Fark satırları: URL şablonu, sayısı farklı türler, görünen alan; ardından aksiyonların izi.
function failureLines(step) {
  const m = step.mismatch;
  const trail = step.trail ? trailLines(step) : [];
  if (!m) return [step.error ?? '', ...trail];
  return [
    ...(m.url !== m.expectedUrl ? [`URL şablonu: beklenen ${m.expectedUrl}, ekranda ${m.url}`] : []),
    ...m.diff.map(({ key, expected, actual }) => `${key}: beklenen ${expected}, ekranda ${actual}`),
    ...(m.viewport !== m.expectedViewport ? [`Görünen alan: kayıtta ${m.expectedViewport}, ekranda ${m.viewport}`] : []),
    ...trail,
  ];
}

// Kalan edge'in aksiyonları sırayla: her birinin ekrana etkisi ve kayıttan sapması; sonunda
// kaydan ilk sapan aksiyon. Sapma yoksa fark yalnızca edge'in sonunda görülmüştür.
//   Aksiyonlar:
//     1/2 ✓ Scroll down · ekranı değiştirdi
//     2/2 ⚠ Zoom in · ekranı değiştirmedi · görünen alan 1075×731, kayıtta 1079×734 @1.38x
//   İlk sapma: 2. aksiyon "Zoom in"
export function trailLines({ trail, actions }) {
  const lines = ['Aksiyonlar:', ...trail.map((t, i) => {
    const mark = t.error ? '✗' : t.deviations.length ? '⚠' : '✓';
    const effect = t.error ? t.error : t.changed === null ? 'etkisi ölçülemedi' : `ekranı ${t.changed ? 'değiştirdi' : 'değiştirmedi'}`;
    return `  ${i + 1}/${actions} ${mark} ${t.label} · ${[effect, ...t.deviations].join(' · ')}`;
  })];
  const first = trail.findIndex((t) => t.error || t.deviations.length);
  if (first >= 0) lines.push(`İlk sapma: ${first + 1}. aksiyon "${trail[first].label}"`);
  else if (trail.length) lines.push(`Aksiyonlarda kayıttan sapma görülmedi; fark edge'in sonundaki ekranda (son aksiyon: "${trail.at(-1).label}").`);
  return lines;
}


// -----------------------------------------------------------------------------
// HTML
// -----------------------------------------------------------------------------

function html(result, model, dir) {
  const { summary } = result;
  const ok = summary.failed === 0;
  const [ce, te] = result.coverage.edges;
  const [cn, tn] = result.coverage.nodes;
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapor · ${esc(result.scenario)}</title>
<style>${STYLE}</style></head>
<body>
<h1>${esc(result.scenario)}</h1>
<p class="verdict ${ok ? 'pass' : 'fail'}">${ok ? 'GEÇTİ' : 'KALDI'} · ${summary.passed}/${summary.steps} adım geçti${summary.failed ? `, ${summary.failed} kaldı` : ''}${summary.skipped ? `, ${summary.skipped} atlandı` : ''} · ${result.runs.length} koşu · ${secondsText(result.duration)}</p>
<p class="meta">Model: ${esc(result.model.name)} (${esc(result.model.format)}) · görünen alan ${esc(result.model.viewport)} · senaryonun kapsaması: ${ce}/${te} edge, ${cn}/${tn} node${result.planner ? ` · üreten: ${esc(plannerText(result.planner))}` : ''} · ${esc(new Date(result.startedAt).toLocaleString('tr-TR'))}</p>
${result.runs.map((run) => runSection(run, model, dir)).join('\n')}
<p class="meta">Doğrulama kayıttaki kuralın aynısıdır: URL şablonu ve edge set'i (ekranda kaydırmadan tıklanabilen etkileşimli elementler) birebir aynı olmalı. Etkileşimli olmayan farklar (sepet sayacı gibi) doğrulamaya girmez; görsel fark onları görmeye yardım eder.</p>
<script>${COMPARE_JS}</script>
<script>${DIFF_SCRIPT}</script>
</body></html>
`;
}

function runSection(run, model, dir) {
  const failed = run.steps.find((s) => s.status === 'failed');
  return `<section class="run">
<h2>Koşu ${run.index} <span class="badge ${failed ? 'fail' : 'pass'}">${failed ? 'kaldı' : 'geçti'}</span></h2>
<table><thead><tr><th></th><th>Adım</th><th>Aksiyon</th><th>Süre</th></tr></thead><tbody>
${run.steps.map((step) => `<tr class="${step.status}"><td>${{ passed: '✓', failed: '✗', skipped: '–' }[step.status]}</td><td>${esc(step.name)}</td><td>${step.kind === 'start' ? 'başlangıç' : `${step.actions}`}</td><td>${step.status === 'skipped' ? '' : secondsText(step.duration)}</td></tr>`).join('\n')}
</tbody></table>
${run.steps.filter((s) => s.warnings?.length).map((s) => `<p class="warn">${esc(s.name)}: ${s.warnings.map(esc).join(' · ')}</p>`).join('\n')}
${failed ? failureSection(failed, model, dir) : ''}
</section>`;
}

function failureSection(step, model, dir) {
  const expected = model.vertices.get(step.targetId)?.screenshot;
  const actual = step.screenshot ? `data:image/png;base64,${readFileSync(join(dir, step.screenshot)).toString('base64')}` : null;
  const id = `s${step.targetId}-${Math.random().toString(36).slice(2, 8)}`;
  const diff = step.mismatch?.diff ?? [];
  return `<div class="failure">
<h3>${esc(step.name)}: ${esc(failureTitle(step))}</h3>
${step.mismatch && step.mismatch.url !== step.mismatch.expectedUrl ? `<p>URL şablonu: beklenen <code>${esc(step.mismatch.expectedUrl)}</code>, ekranda <code>${esc(step.mismatch.url)}</code></p>` : ''}
${diff.length ? `<table class="diff"><thead><tr><th>Tür</th><th>Beklenen</th><th>Ekranda</th></tr></thead><tbody>${diff.map((d) => `<tr><td><code>${esc(d.key)}</code></td><td>${d.expected}</td><td>${d.actual}</td></tr>`).join('')}</tbody></table>` : ''}
${step.mismatch && step.mismatch.viewport !== step.mismatch.expectedViewport ? `<p class="warn">Görünen alan: kayıtta ${esc(step.mismatch.expectedViewport)}, ekranda ${esc(step.mismatch.viewport)}</p>` : ''}
${step.trail?.length ? `<pre class="trail">${esc(trailLines(step).join('\n'))}</pre>` : ''}
<div class="shots">
${expected ? `<figure><img id="${id}-e" src="${expected}" alt=""><figcaption>Beklenen: ${esc(step.target)} (kayıttaki ekran)</figcaption></figure>` : ''}
${actual ? `<figure><img id="${id}-a" src="${actual}" alt=""><figcaption>Runner'ın gördüğü</figcaption></figure>` : ''}
${expected && actual ? `<figure><canvas data-expected="${id}-e" data-actual="${id}-a"></canvas><figcaption>Görsel fark: kırmızı farklı pikseller, turuncu kutu farklı bölgeler</figcaption></figure>` : ''}
</div>
</div>`;
}

// Rapor açılınca: her "Görsel fark" tuvali, beklenen ve gerçek ekran görüntüsünden çizilir (compare.js).
const DIFF_SCRIPT = `
for (const canvas of document.querySelectorAll('canvas[data-expected]')) {
  const expected = document.getElementById(canvas.dataset.expected);
  const actual = document.getElementById(canvas.dataset.actual);
  compareScreenshots(expected.src, actual.src).then(async (result) => {
    const img = await loadImage(actual.src);
    drawDifference(canvas, img, result);
    const percent = result.ratio > 0 && result.ratio < 0.001 ? '<%0,1' : '%' + (result.ratio * 100).toFixed(1).replace('.', ',');
    canvas.nextElementSibling.textContent += ' · fark ' + percent + (result.sameSize ? '' : ' (görüntü boyutları farklı)');
  });
}`;

const STYLE = `
:root { color-scheme: light dark; --pass: #15803d; --fail: #b91c1c; --muted: #6b7280; --border: #d1d5db; }
body { margin: 24px auto; max-width: 1100px; padding: 0 16px; font: 14px/1.5 system-ui, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; }
h2 { font-size: 17px; margin: 0 0 8px; }
h3 { font-size: 15px; margin: 0 0 8px; }
.verdict { font-size: 16px; font-weight: 600; margin: 4px 0; }
.verdict.pass, .badge.pass { color: var(--pass); }
.verdict.fail, .badge.fail { color: var(--fail); }
.meta { color: var(--muted); font-size: 12px; }
.run { border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin: 16px 0; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--border); }
tr.failed td { color: var(--fail); font-weight: 600; }
tr.skipped td { color: var(--muted); }
.diff { width: auto; margin: 8px 0; }
.warn { color: #b45309; font-size: 13px; }
.failure { margin-top: 12px; }
.trail { padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; white-space: pre-wrap; overflow-x: auto; }
.shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.shots figure { margin: 0; }
.shots img, .shots canvas { width: 100%; border: 1px solid var(--border); border-radius: 4px; }
figcaption { color: var(--muted); font-size: 12px; }
code { font-size: 12px; }
`;

function plannerText(planner) {
  if (planner.engine === 'graphwalker') return `GraphWalker ${planner.generator ?? ''}${planner.seed !== undefined ? ` (tohum ${planner.seed})` : ''}`;
  if (planner.engine === 'path') return 'komut satırında verilen yol';
  return planner.strategy ? `${planner.engine} · ${planner.strategy}` : planner.engine;
}

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function xml(text) {
  return esc(text).replace(/'/g, '&apos;');
}

function secondsOf(ms) {
  return (ms / 1000).toFixed(3);
}

function secondsText(ms) {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} sn`;
}
