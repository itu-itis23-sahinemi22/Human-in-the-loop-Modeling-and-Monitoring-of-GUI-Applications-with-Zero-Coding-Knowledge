// =============================================================================
// model.js — MODEL VE YOL
// -----------------------------------------------------------------------------
// Eklentinin dışa aktardığı GraphWalker JSON modelini okur (docs/04-veri-modeli.md >
// Dışa aktarılan JSON) ve verilen yolu (edge dizisi) başlangıç node'undan itibaren çözer.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, stateCounts } from './state.js';

// v4: sayılı küme ve aksiyon hedefi var, viewport yok (test varsayılan boyutta çalışır).
// v3 ve öncesi: sayısız küme; doğrulama kayıttaki tanımla yapılamaz.
const FORMATS = ['graph-recorder/v4', 'graph-recorder/v5'];

// Kullanıcının verdiği dosyalar (model, senaryo, secrets, yol). Windows PowerShell 5.1
// (Set-Content -Encoding utf8, Out-File) dosyanın başına BOM koyar; JSON.parse onu kabul etmez.
export function readText(file) {
  return readFileSync(file, 'utf8').replace(/^﻿/, '');
}

export function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${file}: geçerli JSON değil (${error.message}).`);
    throw error;
  }
}

export function loadModel(file) {
  const json = readJson(file);
  const model = json.models?.[0];
  if (!model) throw new Error(`${file}: GraphWalker modeli değil (models yok).`);
  const format = model.properties?.graphRecorder?.format;
  if (!FORMATS.includes(format)) {
    throw new Error(`${file}: ${format ? `"${format}" biçimi desteklenmiyor` : "Graph Recorder'ın dışa aktardığı bir model değil"}. Graph'ı eklentiden yeniden dışa aktarın.`);
  }

  const vertices = new Map(model.vertices.map((v) => [v.id, { id: v.id, name: v.name, ...v.properties }]));
  const edges = model.edges.map((e) => ({
    id: e.id, name: e.name, source: e.sourceVertexId, target: e.targetVertexId, actions: e.properties?.uiActions ?? [],
  }));
  const start = vertices.get(model.startElementId);
  if (!start) throw new Error(`${file}: başlangıç node'u (startElementId) yok.`);
  const settings = { ...DEFAULT_SETTINGS, ...model.properties.graphRecorder.settings };
  const broken = [...vertices.values()].find((v) => !stateCounts(v.elements, settings));
  if (broken) throw new Error(`${file}: "${broken.name}" node'unun parmak izi okunamadı.`);
  return { name: model.name, format, settings, vertices, edges, start };
}

// Yol: virgülle ayrılmış edge adları ya da id'leri ("e_Login,e_Cart") ya da bir dosya: JSON
// dizi ya da GraphWalker'ın "offline" çıktısı (her satırda bir JSON; id varsa o, yoksa
// currentElementName kullanılır: Java --verbose'da currentElementID, Rust her zaman currentElementId).
export function readPath(value) {
  if (!existsSync(value)) return value.split(',').map((item) => item.trim()).filter(Boolean);
  const text = readText(value).trim();
  if (text.startsWith('[')) return JSON.parse(text);
  return text.split(/\r?\n/).filter((line) => line.trim().startsWith('{')).map((line) => {
    const step = JSON.parse(line);
    return step.currentElementID ?? step.currentElementId ?? step.currentElementName;
  });
}

// Yolu başlangıç node'undan itibaren edge'lere çözer. Edge adı tekil değilse (iki edge aynı
// adı alabilir: docs/04 > GraphWalker ile doğrulama) şu anki node'dan çıkan edge seçilir;
// orada da birden fazlaysa id istenir. Yoldaki node'lar (GraphWalker çıktısında edge'lerin
// arasında gelir) yalnızca tutarlılık için kontrol edilir.
export function resolvePath(model, items) {
  const byName = (name) => [...model.vertices.values()].find((v) => v.id === name || v.name === name);
  const steps = [];
  let current = model.start;
  for (const item of items) {
    const vertex = byName(item);
    if (vertex) {
      if (vertex !== current) throw new Error(`Yol tutarsız: "${item}" bekleniyordu ama yol "${current.name}" node'unda.`);
      continue;
    }
    const matches = model.edges.filter((e) => (e.id === item || e.name === item) && e.source === current.id);
    if (!matches.length) throw new Error(`"${item}": "${current.name}" node'undan çıkan böyle bir edge yok.`);
    if (matches.length > 1) {
      throw new Error(`"${item}": "${current.name}" node'undan bu adla ${matches.length} edge çıkıyor (${matches.map((e) => e.id).join(', ')}); id ile verin.`);
    }
    steps.push(matches[0]);
    current = model.vertices.get(matches[0].target);
  }
  return steps;
}
