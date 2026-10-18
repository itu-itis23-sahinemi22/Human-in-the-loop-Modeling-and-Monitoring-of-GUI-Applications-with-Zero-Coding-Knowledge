// =============================================================================
// oracle.js — VARILAN EKRAN BEKLENEN NODE MU?
// -----------------------------------------------------------------------------
// Kayıttaki eşleştirme kuralının aynısı: URL şablonu ve edge set'i (dışa aktarımdaki
// Ayarlar ile) birebir aynı olmalı (docs/03-state-eslestirme.md). Sayfa geç yüklenebilir;
// eşleşene kadar timeout boyunca tekrar denenir. Eşleşmezse fark döner.
// Sınır: aynı edge set aynı durum için gereklidir ama yeterli değildir (sepetteki ürün
// sayısı gibi etkileşimli olmayan farklar görülmez; docs/03 > Küme aynıysa neden hâlâ soruluyor?).
// =============================================================================

import { diffCounts, stateCounts, urlKey } from './state.js';
import { screenOf } from './page.js';

const RETRY_MS = 500;

export async function verifyState(page, vertex, settings, { timeout }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const result = compare(vertex, await screenOf(page), settings);
    if (result.ok || Date.now() > deadline) return result;
    await page.waitForTimeout(RETRY_MS);
  }
}

// diff: sayısı farklı her tür; expected node'daki, actual ekrandaki sayı.
function compare(vertex, screen, settings) {
  const diff = diffCounts(stateCounts(vertex.elements, settings), stateCounts(screen.elements, settings))
    .map(({ key, a, b }) => ({ key, expected: a, actual: b }));
  const url = urlKey(screen.url);
  return { ok: url === vertex.urlKey && diff.length === 0, url, diff, screen };
}
