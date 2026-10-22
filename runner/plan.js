#!/usr/bin/env node
// =============================================================================
// plan.js — PLANLAYICI (komut satırı)
// -----------------------------------------------------------------------------
// Eklentinin dışa aktardığı modelden GraphWalker ile senaryo üretir (planner/graphwalker.js).
// Panelin "GraphWalker" stratejisiyle aynı senaryoyu üretir: CI'da ya da panel olmadan.
// Senaryo dosyası standart çıktıya ya da --out'a yazılır; uyarılar standart hataya.
// Kullanım ve tasarım: runner/README.md > Planlayıcı
// =============================================================================

import { writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadModel } from './lib/model.js';
import { SCENARIO_FORMAT, coverageOf, graphOf } from './lib/scenario.js';
import { plan, readConfig } from './planner/graphwalker.js';

const USAGE = `Kullanım:
  node plan.js <model.json> [seçenekler] > senaryo.json

  <model.json>           eklentinin "GraphWalker JSON" butonuyla indirdiği model
  -g, --goal <hedef>     edges: tüm edge'ler (varsayılan), nodes: tüm node'lar, node: bir node'a ulaş
  -t, --target <node>    (node hedefinde) ulaşılacak node'un adı ya da id'si
      --seed <sayı>      aynı tohum aynı senaryoyu verir (verilmezse rastgele, senaryoya yazılır)
  -o, --out <dosya>      senaryoyu dosyaya yaz (varsayılan: standart çıktı)
      --java <yol>       Java 17 / 21 (varsayılan: kurulumun bulduğu)
      --jar <yol>        GraphWalker CLI jar'ı (varsayılan: kurulumda verilen)`;

const GOAL_TEXT = { edges: "tüm edge'ler", nodes: "tüm node'lar", node: "node'a ulaş" };

async function main() {
  const { values: options, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      goal: { type: 'string', short: 'g', default: 'edges' },
      target: { type: 'string', short: 't' },
      seed: { type: 'string' },
      out: { type: 'string', short: 'o' },
      java: { type: 'string' },
      jar: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (options.help || positionals.length !== 1) {
    console.error(USAGE);
    return options.help ? 0 : 2;
  }
  const modelFile = resolve(positionals[0]);
  const model = loadModel(modelFile);
  const graph = graphOf(model);
  const target = options.target ? [...model.vertices.values()].find((v) => v.id === options.target || v.name === options.target)?.id : null;
  if (options.goal === 'node' && !target) throw new Error(`Ulaşılacak node bulunamadı: ${options.target ?? '(--target verilmedi)'}`);
  const seed = options.seed === undefined ? null : Number.parseInt(options.seed, 10);

  const result = await plan(graph, { goal: options.goal, target, seed }, readConfig({ java: options.java, jar: options.jar }));
  const out = options.out ? resolve(options.out) : null;
  const scenario = {
    format: SCENARIO_FORMAT,
    name: `${model.name} · GraphWalker (${GOAL_TEXT[options.goal]}${target ? ` ${model.vertices.get(target).name}` : ''})`,
    model: out ? relative(dirname(out), modelFile).replaceAll('\\', '/') : basename(modelFile),
    planner: result.planner,
    runs: result.runs,
    coverage: coverageOf(graph, result.runs),
  };
  const text = JSON.stringify(scenario, null, 2) + '\n';
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);

  const { edges, nodes } = scenario.coverage;
  console.error(`${result.runs.length} koşu · kapsama ${edges[0]}/${edges[1]} edge, ${nodes[0]}/${nodes[1]} node · tohum ${result.planner.seed ?? '-'} · ${result.calls} GraphWalker çağrısı${out ? ` · ${out}` : ''}`);
  if (result.unreachable.length) console.error(`Başlangıçtan ulaşılamayan: ${result.unreachable.map((x) => x.name).join(', ')}`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error) => {
  console.error(`Hata: ${error.message}`);
  process.exitCode = 1;
});
