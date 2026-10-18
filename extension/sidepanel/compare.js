// =============================================================================
// compare.js — GÖRSEL KARŞILAŞTIRMA (onay kartı)
// -----------------------------------------------------------------------------
// "Aynı state mi?" sorusunda adayların edge set'i şu anki ekranla zaten birebir aynıdır;
// kullanıcı etkileşimli olmayan farka (sepet sayacı, uyarı metni, farklı ürün) bakarak karar
// verir. Bu dosya iki ekran görüntüsünü piksel piksel karşılaştırır, farklı bölgeleri kutular
// ve bir fark oranı hesaplar. Oran yalnızca yardımcı bir sinyaldir: karar kullanıcınındır,
// eşleştirme kuralının yerine geçmez. Yöntem ve sınırlar: docs/03 > Görsel karşılaştırma
// =============================================================================

// Karşılaştırma bu genişliğe küçültülmüş görüntülerde yapılır: küçültme JPEG sıkıştırma
// gürültüsünü ve kenar yumuşatmayı ortalar, hesap da hızlı olur. Kutular bu ölçektedir.
const COMPARE_WIDTH = 480;
// İki pikselin rengi, YIQ renk uzayındaki en büyük farkın bu oranından fazla ayrışıyorsa
// piksel farklıdır (pixelmatch'in varsayılan eşiği). YIQ insan gözünün parlaklığa renkten
// daha duyarlı olmasını hesaba katar.
const COLOR_THRESHOLD = 0.1;
const MAX_DELTA = 35215; // YIQ uzayında iki renk arasındaki en büyük fark
// Bölgeler ızgarayla çıkarılır: CELL_SIZE piksellik bir hücrede en az CELL_MIN_PIXELS farklı
// piksel varsa hücre farklıdır; birbirine değen farklı hücreler tek bölge (kutu) olur. Tek
// tük farklı piksel (sıkıştırma gürültüsü) bölge oluşturmaz, orana da girmez.
const CELL_SIZE = 8;
const CELL_MIN_PIXELS = 6;

// İki ekran görüntüsünü (data URL) karşılaştırır. Sonuç:
//   { width, height, ratio, boxes: [{ x, y, width, height }], mask, sameSize }
// ratio: farklı bölgelerdeki farklı piksellerin tüm piksellere oranı. sameSize: görüntüler
// aynı boyutta mıydı (değilse aynı boyuta çizilip karşılaştırıldı; sonuç yanıltıcı olabilir).
async function compareScreenshots(srcA, srcB) {
  const [a, b] = await Promise.all([loadImage(srcA), loadImage(srcB)]);
  const width = Math.min(COMPARE_WIDTH, a.naturalWidth);
  const height = Math.round(a.naturalHeight * width / a.naturalWidth);
  const pa = pixelsOf(a, width, height);
  const pb = pixelsOf(b, width, height);
  const mask = new Uint8Array(width * height);
  const limit = MAX_DELTA * COLOR_THRESHOLD * COLOR_THRESHOLD;
  for (let i = 0; i < mask.length; i++) mask[i] = colorDelta(pa, pb, i * 4) > limit ? 1 : 0;
  const { boxes, counted } = differingRegions(mask, width, height);
  return {
    width, height, boxes, mask, ratio: counted / (width * height),
    sameSize: a.naturalWidth === b.naturalWidth && a.naturalHeight === b.naturalHeight,
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Ekran görüntüsü okunamadı.'));
    img.src = src;
  });
}

function pixelsOf(img, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

// İki pikselin YIQ uzayındaki ağırlıklı renk farkı (pixelmatch'teki formül).
function colorDelta(a, b, i) {
  const [r1, g1, b1] = [a[i], a[i + 1], a[i + 2]];
  const [r2, g2, b2] = [b[i], b[i + 1], b[i + 2]];
  const y = (r1 - r2) * 0.29889531 + (g1 - g2) * 0.58662247 + (b1 - b2) * 0.11448223;
  const iq = (r1 - r2) * 0.59597799 - (g1 - g2) * 0.27417610 - (b1 - b2) * 0.32180189;
  const q = (r1 - r2) * 0.21147017 - (g1 - g2) * 0.52261711 + (b1 - b2) * 0.31114694;
  return 0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q;
}

// Farklı hücreleri bulur ve birbirine değenleri (8 komşu) tek kutuda birleştirir.
// counted: farklı hücrelerdeki farklı piksel sayısı (oran bununla hesaplanır).
function differingRegions(mask, width, height) {
  const cols = Math.ceil(width / CELL_SIZE);
  const rows = Math.ceil(height / CELL_SIZE);
  const counts = new Uint16Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) counts[((y / CELL_SIZE) | 0) * cols + ((x / CELL_SIZE) | 0)]++;
    }
  }
  const hot = (cell) => counts[cell] >= CELL_MIN_PIXELS;
  const seen = new Uint8Array(cols * rows);
  const boxes = [];
  let counted = 0;
  for (let start = 0; start < counts.length; start++) {
    if (!hot(start) || seen[start]) continue;
    let [minC, maxC, minR, maxR] = [cols, -1, rows, -1];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cell = stack.pop();
      const c = cell % cols;
      const r = (cell / cols) | 0;
      counted += counts[cell];
      [minC, maxC, minR, maxR] = [Math.min(minC, c), Math.max(maxC, c), Math.min(minR, r), Math.max(maxR, r)];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc;
          const nr = r + dr;
          const next = nr * cols + nc;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen[next] || !hot(next)) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    const x = minC * CELL_SIZE;
    const y = minR * CELL_SIZE;
    boxes.push({ x, y, width: Math.min(width, (maxC + 1) * CELL_SIZE) - x, height: Math.min(height, (maxR + 1) * CELL_SIZE) - y });
  }
  return { boxes, counted };
}

// "Fark" görünümü: şu anki ekran soluk, farklı pikseller kırmızı, farklı bölgeler kutulu.
// Görüntü tam çözünürlükte çizilir; fark maskesi ve kutular karşılaştırma ölçeğinden büyütülür.
// Farklı bölgelere girmeyen tek tük pikseller (gürültü) gösterilmez.
function drawDifference(canvas, img, result) {
  const { width, height, mask, boxes } = result;
  const ctx = drawImageFull(canvas, img);
  const scale = canvas.width / width;
  const inBox = new Uint8Array(width * height);
  for (const box of boxes) {
    for (let y = box.y; y < box.y + box.height; y++) inBox.fill(1, y * width + box.x, y * width + box.x + box.width);
  }
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let y = 0; y < canvas.height; y++) {
    const row = Math.min(height - 1, (y / scale) | 0) * width;
    for (let x = 0; x < canvas.width; x++) {
      const i = row + Math.min(width - 1, (x / scale) | 0);
      const p = (y * canvas.width + x) * 4;
      if (mask[i] && inBox[i]) {
        [data[p], data[p + 1], data[p + 2]] = [235, 30, 60];
      } else {
        const gray = 0.3 * data[p] + 0.59 * data[p + 1] + 0.11 * data[p + 2];
        const faded = 255 - (255 - gray) * 0.25;
        [data[p], data[p + 1], data[p + 2]] = [faded, faded, faded];
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  strokeBoxes(ctx, boxes, scale);
}

// "Yan yana" görünümü: görüntü (tam çözünürlük) ve üstünde farklı bölgelerin kutuları.
function drawWithBoxes(canvas, img, result) {
  const ctx = drawImageFull(canvas, img);
  strokeBoxes(ctx, result.boxes, canvas.width / result.width);
}

function drawImageFull(canvas, img) {
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx;
}

// Kutular biraz geniş çizilir: küçük bir fark (tek rakam) da gözden kaçmasın.
function strokeBoxes(ctx, boxes, scale) {
  const pad = 3 * scale;
  ctx.lineWidth = Math.max(2, 1.5 * scale);
  ctx.strokeStyle = 'rgb(255, 149, 0)';
  for (const { x, y, width, height } of boxes) ctx.strokeRect(x * scale - pad, y * scale - pad, width * scale + 2 * pad, height * scale + 2 * pad);
}
