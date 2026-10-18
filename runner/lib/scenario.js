// =============================================================================
// scenario.js — SENARYO DOSYASI
// -----------------------------------------------------------------------------
// Komut satırının girdisi: bir senaryo dosyası (panelin ya da planlayıcının ürettiği; biçim
// extension/scenario.js) ya da bir model ve --path ile tek bir yol. İkisi de aynı yapıya
// çevrilir: { model, scenario: { name, planner, runs: [[edge, ...], ...] } }.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { loadModel, readJson, readPath, resolvePath } from './model.js';

const file = new URL('../../extension/scenario.js', import.meta.url);

// Eklentinin scenario.js'i olduğu gibi yüklenir: panel ve runner aynı kapsama tanımını kullanır.
export const { SCENARIO_FORMAT, coverageOf } = vm.runInNewContext(
  `${readFileSync(file, 'utf8')}\n({ SCENARIO_FORMAT, coverageOf })`,
  {},
  { filename: file.pathname },
);

// Senaryodaki model yolu senaryo dosyasına göredir (ikisi genelde aynı klasörde iner).
export function loadInput(path, pathOption) {
  const json = readJson(path);
  if (json.format === SCENARIO_FORMAT) {
    if (pathOption) throw new Error('Senaryo dosyası verildiğinde --path kullanılmaz: yollar senaryonun içinde.');
    const model = loadModel(resolve(dirname(path), json.model));
    // Başlangıcı graph'ın başlangıcı olmayan senaryo panelde oynatılır (extension/scenario.js).
    if (json.start && json.start !== model.start.id) {
      const start = model.vertices.get(json.start);
      throw new Error(`Senaryo ${start ? `"${start.name}"` : `modelde olmayan "${json.start}"`} node'undan başlıyor. Runner her koşuyu temiz bir tarayıcıda, graph'ın başlangıcından ("${model.start.name}") oynatır; bu senaryoyu panelde "Koşuyu oynat" ile oynatın.`);
    }
    const runs = json.runs.map((run, i) => {
      try {
        return resolvePath(model, run);
      } catch (error) {
        throw new Error(`Senaryonun ${i + 1}. koşusu modelle uyuşmuyor: ${error.message}`);
      }
    });
    return { model, scenario: { name: json.name ?? model.name, planner: json.planner ?? null, runs } };
  }
  if (!pathOption) throw new Error('Model verildiyse yol da verilmeli (--path e_Login,e_Cart) ya da bir senaryo dosyası verin.');
  const model = loadModel(path);
  return { model, scenario: { name: model.name, planner: { engine: 'path' }, runs: [resolvePath(model, readPath(pathOption))] } };
}

// Modelin scenario.js'teki graph biçimi.
export function graphOf(model) {
  return { start: model.start.id, nodes: [...model.vertices.values()], edges: model.edges };
}
