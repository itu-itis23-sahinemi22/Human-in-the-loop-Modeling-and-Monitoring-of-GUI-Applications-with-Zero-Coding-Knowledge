// =============================================================================
// monitor-image.js — GÖRÜNTÜ MONİTÖRÜ: küçük bir resmi ekran görüntüsünde arama (Expected Image)
// -----------------------------------------------------------------------------
// Monitör modülünün panel tarafında çalışan kontrolü (dosya düzeni: monitor-store.js başlığı).
// "Expected Image" türü (monitor-types.js, side: 'panel') sayfanın DOM'una değil, sekmenin ekran
// görüntüsüne bakar: kullanıcının yüklediği küçük parça (ör. bir uyarı mesajının ekran görüntüsünden
// kesilmiş) görüntünün içinde bir yerde bulunmalı. Sayfa içinden ekran görüntüsü alınamadığı için
// (chrome.tabs.captureVisibleTab yalnızca eklenti sayfalarında) bu kontrol monitor-probe.js'te değil
// burada, panelde yapılır; monitor-run.js > probeMonitors listeyi ikiye ayırır.
//
// Eşleme (findImage): şablon (parça), ekran görüntüsünün her konumunda denenir. Önce şablonun en
// belirgin birkaç pikseli (kenarlar: anchors) karşılaştırılır; hepsi uyuyorsa tüm pikseller karşılaştırılıp
// benzerlik (1 − ortalama mutlak fark / 255) hesaplanır. Benzerlik eşiği geçerse bulundu. Şeffaf pikseller
// (alpha < 128) sayılmaz. Parçanın ölçeği ekrandan farklıysa (Retina 2× / 1×) 2 ve 0,5 ölçekleri de denenir.
// Sınırlar: tam karşılaştırma sayısı (MONITOR_IMAGE_MAX_FULL) ile süre sınırlanır; sayfa yakınlaştırması
// (zoom) değiştiyse ya da parça başka bir temadan alındıysa bulunamaz.
//
// Saf fonksiyonlar (findImage, needleAnchors) DOM'a dokunmaz: tests/e2e/monitor-unit.test.js'te vm ile sınanır.
// =============================================================================

const MONITOR_IMAGE_ANCHORS = 16;         // ön elemede karşılaştırılan piksel sayısı
const MONITOR_IMAGE_ANCHOR_TOL = 64;      // ön elemede kanal başına izin verilen fark (0–255)
const MONITOR_IMAGE_MAX_WORK = 60000000;  // en fazla bu kadar piksel karşılaştırması (≈ 0,3 sn); aşılırsa arama kesilir
const MONITOR_IMAGE_SCALES = [1, 2, 0.5]; // parça bu ölçeklerde denenir (önce olduğu gibi)

// Şablonun en belirgin pikselleri: bir kenarın İKİ yanı (ör. kırmızı kutu üstündeki beyaz yazı: hem yazı
// hem zemin pikseli), kenarlar birbirine yakın olmayacak şekilde; düz bir parçada (hep aynı renk) ızgara
// üzerinden seçilir. Tek yan seçilse (yalnızca beyaz yazı pikselleri) beyaz bir sayfanın her yeri ön
// elemeyi geçerdi.
//   image: { width, height, data: Uint8ClampedArray (RGBA) }  →  [{ x, y, r, g, b }]
function needleAnchors(image, count = MONITOR_IMAGE_ANCHORS) {
  const { width, height, data } = image;
  const at = (x, y) => (y * width + x) * 4;
  const opaque = (x, y) => data[at(x, y) + 3] >= 128;
  const diff = (i, j) => Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
  const edges = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaque(x, y)) continue;
      const i = at(x, y);
      const right = x + 1 < width && opaque(x + 1, y) ? diff(i, at(x + 1, y)) : -1;
      const below = y + 1 < height && opaque(x, y + 1) ? diff(i, at(x, y + 1)) : -1;
      if (right <= 0 && below <= 0) continue;
      edges.push(right >= below ? { x, y, s: right, nx: x + 1, ny: y } : { x, y, s: below, nx: x, ny: y + 1 });
    }
  }
  edges.sort((a, b) => b.s - a.s);
  const apart = Math.max(2, Math.floor(Math.min(width, height) / 6));
  const picked = [];
  const has = (x, y) => picked.some((q) => q.x === x && q.y === y);
  for (const e of edges) {
    if (picked.length + 2 > count) break;
    if (picked.some((q) => Math.abs(q.x - e.x) < apart && Math.abs(q.y - e.y) < apart)) continue;
    picked.push({ x: e.x, y: e.y });
    if (!has(e.nx, e.ny)) picked.push({ x: e.nx, y: e.ny });
  }
  // Belirgin kenar az (düz parça): ızgaradan tamamla
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / count)));
  for (let y = 0; y < height && picked.length < count; y += step) {
    for (let x = 0; x < width && picked.length < count; x += step) {
      if (opaque(x, y) && !has(x, y)) picked.push({ x, y });
    }
  }
  return picked.map(({ x, y }) => { const i = at(x, y); return { x, y, r: data[i], g: data[i + 1], b: data[i + 2] }; });
}

// Görüntünün baskın rengi (seyrek örnekleme, kaba kutulama): çapalar bu renkten en uzak olandan
// başlayarak sırayla denenir; böylece beyaz bir sayfada kırmızı bir çapa konumların çoğunu ilk bakışta eler.
function dominantColor(image) {
  const { width, height, data } = image;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));
  const counts = new Map();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = 0, bestKey = 0xfff;
  for (const [key, n] of counts) if (n > best) { best = n; bestKey = key; }
  return { r: ((bestKey >> 8) & 15) * 17, g: ((bestKey >> 4) & 15) * 17, b: (bestKey & 15) * 17 };
}

// Parçayı (needle) görüntüde (haystack) arar.
//   threshold: 0–1 benzerlik eşiği.  →  { found, x, y, score, compared, capped }
//   score: en iyi benzerlik (bulunamadıysa da; kullanıcıya "en iyi benzerlik %62" denir)
//   compared: tüm pikselleriyle karşılaştırılan konum sayısı; capped: iş sınırına takıldı, arama bitmedi
function findImage(haystack, needle, { threshold = 0.9, maxWork = MONITOR_IMAGE_MAX_WORK } = {}) {
  const H = haystack, N = needle;
  const result = { found: false, x: -1, y: -1, score: 0, compared: 0, capped: false };
  if (!H?.data || !N?.data || N.width < 1 || N.height < 1 || N.width > H.width || N.height > H.height) return result;
  const anchors = needleAnchors(N);
  if (!anchors.length) return result; // tamamen şeffaf parça
  const dom = dominantColor(H);
  anchors.sort((a, b) => (Math.abs(b.r - dom.r) + Math.abs(b.g - dom.g) + Math.abs(b.b - dom.b)) - (Math.abs(a.r - dom.r) + Math.abs(a.g - dom.g) + Math.abs(a.b - dom.b)));
  const hd = H.data, nd = N.data, hw = H.width, nw = N.width;
  // Parçanın opak pikselleri: parça içi indeks (ni) ve görüntüde (0,0)'a göre kayma (off); konum (x,y)
  // için görüntü indeksi = (y*hw + x)*4 + off. Çarpımlar döngü dışında kalsın.
  const nidx = [], noff = [];
  for (let y = 0; y < N.height; y++) for (let x = 0; x < nw; x++) { const ni = (y * nw + x) * 4; if (nd[ni + 3] >= 128) { nidx.push(ni); noff.push((y * hw + x) * 4); } }
  const total = nidx.length;
  const aoff = anchors.map((a) => (a.y * hw + a.x) * 4);
  const allowed = (1 - threshold) * 255 * total; // bu toplam farkın üstü eşik altı demektir
  const tol = MONITOR_IMAGE_ANCHOR_TOL;
  const fullUntil = 50; // ilk adaylar sonuna kadar karşılaştırılır (en iyi benzerlik gerçekçi çıksın); sonra eşiği aşan aday bırakılır
  let bestDiff = Infinity;
  let work = 0; // karşılaştırılan piksel sayısı (ön eleme hariç)
  for (let y = 0; y <= H.height - N.height; y++) {
    for (let x = 0; x <= hw - nw; x++) {
      const base = (y * hw + x) * 4;
      let ok = true;
      for (let k = 0; k < anchors.length; k++) {
        const a = anchors[k];
        const i = base + aoff[k];
        if (Math.abs(hd[i] - a.r) > tol || Math.abs(hd[i + 1] - a.g) > tol || Math.abs(hd[i + 2] - a.b) > tol) { ok = false; break; }
      }
      if (!ok) continue;
      if (work >= maxWork) { result.capped = true; break; }
      result.compared++;
      let diff = 0; // üç kanalın toplamı
      const stop = (result.compared <= fullUntil ? bestDiff : Math.min(bestDiff, allowed)) * 3;
      let p = 0;
      for (; p < total && diff <= stop; p++) {
        const hi = base + noff[p], ni = nidx[p];
        diff += Math.abs(hd[hi] - nd[ni]) + Math.abs(hd[hi + 1] - nd[ni + 1]) + Math.abs(hd[hi + 2] - nd[ni + 2]);
      }
      work += p;
      if (p < total) continue; // erken bırakıldı: en iyiden ya da eşikten kötü
      diff /= 3; // kanal ortalaması: piksel başına 0–255
      if (diff < bestDiff) { bestDiff = diff; result.x = x; result.y = y; }
      if (diff <= allowed) { result.found = true; result.score = 1 - diff / (255 * total); return result; }
    }
    if (result.capped) break;
  }
  result.score = bestDiff === Infinity ? 0 : 1 - bestDiff / (255 * total);
  return result;
}


// -----------------------------------------------------------------------------
// PANEL: ekran görüntüsünü alma, çözme, ölçekleme, kontrol (yalnızca eklenti sayfasında)
// -----------------------------------------------------------------------------

// data URL -> { width, height, data } (RGBA). Boyut sınırı aşılırsa Error.
async function decodeImage(dataUrl, maxSide = Infinity) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width > maxSide || bitmap.height > maxSide) throw new Error(`görüntü ${bitmap.width}×${bitmap.height} px, en fazla ${maxSide}×${maxSide} olmalı`);
    return bitmapPixels(bitmap, 1);
  } finally {
    bitmap.close();
  }
}

// Bitmap'in pikselleri, istenen ölçekte (ölçek 1 dışında yumuşatılarak çizilir)
function bitmapPixels(bitmap, scale) {
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = scale !== 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data };
}

// Bitmap -> jpeg data URL (Emir'in node görüntüleriyle aynı biçim; uyarı listesinde saklanır)
async function bitmapToJpeg(bitmap, quality = 0.4) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Sekmenin görünen kısmı, kayıpsız (png): eşleme için. Chrome saniyede 2 görüntüyle sınırlar; sınır
// aşılırsa kısa bekleyip bir kez daha denenir (monitor-run.js > monitorScreenshot ile aynı).
async function captureTabPng(tabId) {
  const { windowId } = await chrome.tabs.get(tabId);
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (error) {
    if (!/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota|exceed/i.test(error?.message ?? '')) throw error;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  }
}

// Görüntü monitörlerini bir ekran görüntüsünde kontrol eder (hepsi için TEK çekim).
//   list: [{ id, params: { image: { data, width, height }, similarity } }]
//   → { results: { [id]: { status, text } }, screenshot: jpeg data URL (uyarı için; alınamadıysa null) }
async function checkImageMonitors(tabId, list) {
  const results = Object.create(null);
  const skipAll = (text) => { for (const m of list) results[m.id] = { status: 'skip', text }; return { results, screenshot: null }; };
  let png;
  try {
    png = await captureTabPng(tabId);
  } catch (error) {
    return skipAll(`ekran görüntüsü alınamadı (${error.message})`);
  }
  const blob = await (await fetch(png)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const haystack = bitmapPixels(bitmap, 1);
    for (const m of list) {
      try {
        results[m.id] = await matchExpectedImage(haystack, m.params ?? {});
      } catch (error) {
        results[m.id] = { status: 'skip', text: `kontrol edilemedi: ${error.message}` };
      }
    }
    let screenshot = null;
    try { screenshot = await bitmapToJpeg(bitmap); } catch { /* uyarı görüntüsüz kalır */ }
    return { results, screenshot };
  } finally {
    bitmap.close();
  }
}

// Tek bir görüntü monitörü: parça ekran görüntüsünde var mı? Ölçekler sırayla denenir (önce 1).
async function matchExpectedImage(haystack, { image, similarity }) {
  const problem = monitorImageProblem(image); // monitor-types.js
  if (problem) return { status: 'skip', text: problem };
  const threshold = Math.min(100, Math.max(50, Number(similarity) || 90)) / 100;
  const blob = await (await fetch(image.data)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    let best = null;
    for (const scale of MONITOR_IMAGE_SCALES) {
      const needle = bitmapPixels(bitmap, scale);
      if (needle.width > haystack.width || needle.height > haystack.height) continue;
      const r = findImage(haystack, needle, { threshold });
      if (!best || r.score > best.score) best = { ...r, scale };
      if (r.found) break;
    }
    const pct = (score) => Math.round(score * 100);
    const size = `${image.width}×${image.height} px`;
    if (!best) return { status: 'skip', text: `parça (${size}) ekran görüntüsünden (${haystack.width}×${haystack.height}) büyük` };
    if (best.found) return { status: 'ok', text: `görüntü bulundu (benzerlik %${pct(best.score)}${best.scale !== 1 ? `, ${best.scale}× ölçekte` : ''})` };
    const closest = best.compared ? `en iyi benzerlik %${pct(best.score)}, eşik %${pct(threshold)}` : 'benzer bir bölge yok';
    return { status: 'fail', text: `beklenen görüntü (${size}) ekranda yok (${closest}${best.capped ? '; arama sınırına ulaşıldı' : ''})` };
  } finally {
    bitmap.close();
  }
}
