// =============================================================================
// state.js — KAYITTAKİ STATE TANIMI (Node tarafı)
// -----------------------------------------------------------------------------
// Eklentinin settings.js'i olduğu gibi yüklenir: urlKey, stateCounts, sameCounts,
// diffCounts. Böylece runner'ın "varılan ekran beklenen node mu?" kararı, kayıttaki
// eşleştirmeyle birebir aynı koddan gelir (docs/03-state-eslestirme.md).
// =============================================================================

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const file = new URL('../../extension/settings.js', import.meta.url);

// settings.js tarayıcı için yazılmış düz bir script: global sabit ve fonksiyonlar tanımlar.
// Ayrı bir bağlamda çalıştırılır; urlKey'in kullandığı URL dışında hiçbir şeye erişmez.
export const { urlKey, stateCounts, sameCounts, diffCounts, DEFAULT_SETTINGS } = vm.runInNewContext(
  `${readFileSync(file, 'utf8')}\n({ urlKey, stateCounts, sameCounts, diffCounts, DEFAULT_SETTINGS })`,
  { URL },
  { filename: file.pathname },
);
