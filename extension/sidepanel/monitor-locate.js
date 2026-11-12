// =============================================================================
// monitor-locate.js — HATA YERİ: bozulan elementin ekran görüntüsünde işaretlenmesi
// -----------------------------------------------------------------------------
// Monitör modülünün "nerede bozuldu?" parçası (dosya düzeni: monitor-store.js başlığı). Bir monitör
// bozulduğunda uyarı iki şeyi saklar: o anın ekran görüntüsü ve bozulan element(ler) (targets;
// sayfada monitor-probe.js > HATA YERİ, görüntü monitöründe monitor-image.js ölçer). Görüntü hatayı
// ekrana kadar yerelleştirir; bu dosya elemente kadar indirir: elementin kutusunu görüntünün üstüne
// çizer ve elementi adıyla listeler.
//   - Küçük resimler (ışık listesi, Monitörler listesi, uyarı listesi): kutu işaretli (shotThumb).
//   - "Bozulduğu andaki ekran" penceresi (monitor-list.js > openMonitorShot): kutular etiketli; altında
//     bozulan elementler, "Ekrandaki elementler" kartındaki (dom-tree.js) satırla aynı biçimde
//     (etiket "metin" anahtar) ve DOM'daki yeriyle. Satırın üzerine gelince o elementin kutusu öne
//     çıkar, tıklayınca görüntü o elemente yakınlaşır; işaretler kapatılıp ham görüntüye bakılabilir.
// Görüntüye çerçeve gömülmez; kutular üstüne çizilir: saklanan görüntü kanıt olarak olduğu gibi kalır,
// görüntü monitörünün eşlemesi çerçeveden etkilenmez, sayfaya da hiçbir şey çizilmez.
// Kutunun yeri: sayfada ölçülen kutu / görüntünün gösterdiği alan (viewport; ikisi de CSS pikseli). Oran
// olduğu için görüntü hangi boyda gösterilirse gösterilsin doğru kalır; yakınlaştırmadan ve ekranın piksel
// oranından bağımsızdır. Alan, uyarı kaydedilirken görüntünün kendisinden hesaplanır (shownViewport):
// oynatmada görüntü, sayfanın ölçtüğü alanın tamamı olmayabilir. Görüntünün ya da görünen alanın dışındaki,
// taşanı gizleyen bir kutunun dışındaki element görüntüde yoktur: çizilmez, nedeni listede yazar.
// Detay: docs/07-monitorler.md > Hata yeri
// =============================================================================

const FAULT_HIDDEN_TEXT = {
  above: 'ekranın görünen kısmının üstünde kalıyor (sayfa yukarı kaydırılınca görünür)',
  below: 'ekranın görünen kısmının altında kalıyor (sayfa aşağı kaydırılınca görünür)',
  left: 'ekranın görünen kısmının solunda kalıyor',
  right: 'ekranın görünen kısmının sağında kalıyor',
  clipped: 'taşanı gizleyen bir kutunun dışında kalıyor, o an görünmüyor',
  unrendered: 'sayfada çizilmiyor (gizli)',
};

// Kutunun görüntüdeki yeri, görüntünün yüzdesi olarak (merkez + boyut): { cx, cy, w, h }. Çizilecek
// kısım (visible) ya da ölçüldüğü alan yoksa null.
function faultBoxPlace(target, viewport) {
  const v = target?.visible;
  if (!v || !(viewport?.width > 0) || !(viewport?.height > 0)) return null;
  const left = Math.max(0, v.x), top = Math.max(0, v.y);
  const right = Math.min(viewport.width, v.x + v.w), bottom = Math.min(viewport.height, v.y + v.h);
  if (right <= left || bottom <= top) return null;
  const pct = (n, of) => Math.round((n / of) * 100000) / 1000;
  return { cx: pct((left + right) / 2, viewport.width), cy: pct((top + bottom) / 2, viewport.height), w: pct(right - left, viewport.width), h: pct(bottom - top, viewport.height) };
}

// Görüntünün gösterdiği alan (CSS pikseli; kutular buna oranlanır). measured: sayfanın ölçtüğü alan
// { width, height, ratio } (ratio: bir CSS pikselinin görüntüde kaç piksel ettiği), image: alınan görüntünün
// piksel boyutu. Görüntü her zaman ölçülen alanın tamamı değildir: oynatma, kayıttaki pencere boyutunu taklit
// eder ve üstte "hata ayıklama" çubuğu durur; görüntü o zaman sayfanın yalnızca gerçekten görünen kısmıdır
// (ölçülenden kısa, dar ya da geniş). Değişmeyen şey ölçektir: sayfadaki (x, y) noktası görüntüde her durumda
// sol üstten (x × ratio, y × ratio) pikselindedir. Bu yüzden alan ölçülen boyuttan değil görüntünün
// kendisinden hesaplanır: görüntü / ratio. Görüntünün dışında kalan element çizilmez.
// ratio yoksa kutular zaten görüntüde ölçülmüştür (görüntü monitörü): alan olduğu gibi kalır.
function shownViewport(measured, image) {
  if (!(measured?.width > 0) || !(measured?.height > 0)) return null;
  if (!(measured.ratio > 0)) return { width: measured.width, height: measured.height };
  if (!(image?.width > 0) || !(image?.height > 0)) return null;
  return { width: image.width / measured.ratio, height: image.height / measured.ratio };
}

// Görüntünün piksel boyutu { width, height }; okunamazsa null
async function imageSize(dataUrl) {
  try {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

// Etiketin kutuya göre yeri (monitors.css > .fault-label). Varsayılan: kutunun üstünde, soldan hizalı. Kutu
// görüntünün en üstündeyse altında ('low'), görüntüyü boydan boya kaplıyorsa içinde ('inside'); kutu görüntünün
// sağ yarısında başlıyorsa sağdan hizalı ('end': etiket görüntünün dışına taşmasın).
function faultLabelSide(place) {
  const top = place.cy - place.h / 2;
  const left = place.cx - place.w / 2;
  return [top < 9 ? (top + place.h > 91 ? 'inside' : 'low') : '', left > 50 ? 'end' : ''].filter(Boolean).join(' ');
}

// Element görüntüde neden işaretli değil ya da ne kadarı görünüyor; tamamı görünüyorsa ''. viewport: görüntünün
// gösterdiği alan (yoksa yalnızca sayfadaki ölçüme bakılır).
function faultVisibilityText(target, viewport = null) {
  if (!target.visible) return FAULT_HIDDEN_TEXT[target.hidden] ?? 'ekran görüntüsünde yok';
  if (viewport && !faultBoxPlace(target, viewport)) return 'ekran görüntüsünün dışında kalıyor';
  const whole = target.rect;
  return whole && (target.visible.w < whole.w - 1 || target.visible.h < whole.h - 1) ? 'yalnızca bir kısmı görünüyor' : '';
}

// Elementin tek satırlık adı: input#user-name "Username"
function faultTargetName(target) {
  return target.tag + (target.text ? ` "${target.text}"` : '');
}

// Uyarının bozulan elementlerinin özeti (uyarı listesi, küçük resmin başlığı); element yoksa ''.
function faultSummary(alarmLike) {
  const targets = alarmLike?.targets ?? [];
  if (!targets.length) return '';
  const count = targets.length + (alarmLike.more ?? 0);
  return count === 1 ? faultTargetName(targets[0]) : `${count} element: ${targets.slice(0, 2).map(faultTargetName).join(', ')}${count > 2 ? ', …' : ''}`;
}

// Bozulan yer bir ekran bölgesi mi (görüntü monitörü), element mi?
function isRegionTarget(target) {
  return target.tag === MONITOR_REGION_TAG; // monitor-store.js
}


// -----------------------------------------------------------------------------
// GÖRÜNTÜ + KUTULAR
// -----------------------------------------------------------------------------
// Yapı: .shot-figure > .shot-canvas > img.shot + .fault-box… Kap (canvas) görüntüyle aynı boydadır,
// kutular onun yüzdesiyle yerleşir; görüntü hangi boyda gösterilirse gösterilsin yerleri doğru kalır.
// Görüntünün en-boy oranı kaba --ar olarak yazılır (önce ölçülen alandan, görüntü yüklenince kendisinden).

// Kutuları yeniden çizer; döner: çizilen kutular (hedef sırasıyla; çizilmeyen hedefin yeri null).
// labels: kutunun üstünde etiket (tek elementte adı, birden çokta numarası).
function drawFaultBoxes(canvas, alarmLike, { labels = false } = {}) {
  for (const old of canvas.querySelectorAll('.fault-box')) old.remove();
  const targets = alarmLike?.targets ?? [];
  return targets.map((target, index) => {
    const place = faultBoxPlace(target, alarmLike.viewport);
    if (!place) return null;
    const box = document.createElement('span');
    box.className = `fault-box ${faultLabelSide(place)}`.trim();
    box.dataset.index = index;
    box.style.cssText = `left:${place.cx}%;top:${place.cy}%;width:${place.w}%;height:${place.h}%;`;
    box.title = faultTargetName(target) + (target.note ? ` · ${target.note}` : '') + (labels ? ' · yakından bakmak için tıklayın' : '');
    if (labels) {
      const label = document.createElement('span');
      label.className = 'fault-label';
      label.textContent = targets.length > 1 ? String(index + 1) : target.tag;
      box.append(label);
    }
    canvas.append(box);
    return box;
  });
}

function setShotImage(figure, img, alarmLike) {
  const viewport = alarmLike?.viewport;
  if (viewport?.width > 0 && viewport?.height > 0) figure.style.setProperty('--ar', String(viewport.width / viewport.height));
  img.onload = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    figure.style.setProperty('--ar', String(img.naturalWidth / img.naturalHeight));
    figure.style.setProperty('--nw', `${img.naturalWidth}px`);
  };
  img.src = alarmLike?.screenshot ?? '';
}

// Küçük resim: bozulduğu andaki ekran, bozulan element işaretli; tıklayınca (ya da Enter / boşluk) büyür.
function shotThumb(alarmLike, onOpen, label, title = 'Bozulduğu andaki ekran: büyütmek için tıklayın') {
  const figure = document.createElement('span');
  figure.className = 'shot-figure thumb';
  figure.innerHTML = '<span class="shot-canvas"><img class="shot" alt="Bozulduğu andaki ekran"></span>';
  setShotImage(figure, figure.querySelector('img'), alarmLike);
  drawFaultBoxes(figure.querySelector('.shot-canvas'), alarmLike);
  const what = faultSummary(alarmLike);
  figure.title = title + (what ? ` · bozulan: ${what}` : '');
  activatable(figure, onOpen, label + (what ? ` (bozulan: ${what})` : '')); // monitor-list.js
  return figure;
}


// -----------------------------------------------------------------------------
// "BOZULDUĞU ANDAKİ EKRAN" PENCERESİ: büyük görüntü + bozulan elementler
// -----------------------------------------------------------------------------

// Pencerenin gövdesi (monitor-list.js pencereyi kurarken ekler): görüntü, işaret anahtarı, element listesi
const MONITOR_SHOT_BODY_HTML = `
  <div class="shot-stage"><span id="monitor-shot-figure" class="shot-figure large"><span class="shot-canvas"><img id="monitor-shot-image" class="shot" alt="Monitörün bozulduğu andaki ekran görüntüsü"></span></span></div>
  <p id="monitor-shot-noimage" class="hint" hidden>Bu uyarı için ekran görüntüsü alınamadı.</p>
  <div id="monitor-shot-targets" class="fault-targets">
    <div class="fault-head">
      <b id="monitor-shot-targets-title">Bozulan element</b>
      <label class="fault-toggle" title="İşaretleri kapatıp ham ekran görüntüsüne bakın"><input type="checkbox" id="monitor-shot-mark" checked> Görüntüde işaretle</label>
    </div>
    <ul id="monitor-shot-target-list" class="fault-list"></ul>
    <p id="monitor-shot-targets-note" class="hint"></p>
  </div>`;

// Pencereyi bir uyarıyla doldurur. alarmLike: { screenshot, targets, more, viewport }; m: monitör
// (element yoksa nedenini türünden söylemek için).
function renderShotLocation(m, alarmLike) {
  const figure = $('monitor-shot-figure');
  const targets = alarmLike.targets ?? [];
  figure.hidden = !alarmLike.screenshot;
  $('monitor-shot-noimage').hidden = Boolean(alarmLike.screenshot);
  setShotImage(figure, $('monitor-shot-image'), alarmLike);
  const boxes = alarmLike.screenshot ? drawFaultBoxes(figure.querySelector('.shot-canvas'), alarmLike, { labels: true }) : targets.map(() => null);
  const drawn = boxes.filter(Boolean).length;

  const region = targets.length > 0 && targets.every(isRegionTarget);
  const count = targets.length + (alarmLike.more ?? 0);
  $('monitor-shot-targets-title').textContent = region ? 'Bozulan bölge' : count > 1 ? `Bozulan elementler (${count})` : 'Bozulan element';
  $('monitor-shot-mark').checked = true;
  $('monitor-shot-mark').closest('label').hidden = !drawn;
  figure.classList.remove('no-marks');
  $('monitor-shot-mark').onchange = () => figure.classList.toggle('no-marks', !$('monitor-shot-mark').checked);

  const items = targets.map((target, index) => faultItem(target, { index, numbered: targets.length > 1, marked: Boolean(boxes[index]), viewport: alarmLike.screenshot ? alarmLike.viewport : null }));
  $('monitor-shot-target-list').replaceChildren(...items);
  // Satır ↔ kutu: satırın üzerine gelince (ya da odaklanınca) kutusu öne çıkar, öbürleri solar; kutunun üzerine gelince satırı
  const activate = (index) => {
    figure.classList.toggle('focused', index !== null && Boolean(boxes[index]));
    boxes.forEach((box, i) => box?.classList.toggle('active', i === index));
    items.forEach((item, i) => item.classList.toggle('active', i === index));
  };
  items.forEach((item, index) => {
    item.onmouseenter = item.onfocus = () => activate(index);
    item.onmouseleave = item.onblur = () => activate(null);
  });
  boxes.forEach((box, index) => {
    if (!box) return;
    box.onmouseenter = () => activate(index);
    box.onmouseleave = () => activate(null);
  });
  activate(null);
  // Yakından bakma: satıra ya da kutuya tıklayınca görüntü o elemente yakınlaşır (zoomTo); aynı yere yeniden ya da
  // görüntünün boş bir yerine tıklayınca eski haline döner. Yan panelde görüntü küçülür; elementin çevresi böyle okunur.
  let zoomed = null;
  const zoom = (index) => {
    const place = index === null || index === zoomed ? null : faultBoxPlace(targets[index], alarmLike.viewport);
    zoomed = zoomTo(figure, place, alarmLike.viewport) ? index : null;
    items.forEach((item, i) => item.classList.toggle('zoomed', i === zoomed));
  };
  zoom(null);
  figure.onclick = () => zoom(null);
  items.forEach((item, index) => {
    if (!boxes[index]) return;
    item.onclick = () => zoom(index);
    item.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      zoom(index);
    };
    boxes[index].onclick = (event) => {
      event.stopPropagation(); // görüntünün kendi tıklaması (uzaklaş) çalışmasın
      zoom(index);
    };
  });
  $('monitor-shot-targets-note').textContent = faultNote(m, alarmLike, drawn);
}

// Görüntüyü bir kutuya yakınlaştırır: kap (canvas) büyür, pencere (figure) kaydırılabilir olur ve kutu ortaya
// gelir. En fazla sayfanın kendi boyutuna kadar büyür (viewport.width; kutu pencereye sığmıyorsa sığacağı
// kadar). place null: eski haline döner. Döner: yakınlaştı mı (görüntü zaten o boydaysa yakınlaşmaz).
function zoomTo(figure, place, viewport = null) {
  const canvas = figure.querySelector('.shot-canvas');
  figure.classList.remove('zoomed');
  canvas.style.width = '';
  if (!place) return false;
  const fit = figure.clientWidth;
  const full = Math.max(fit, viewport.width);
  const box = { w: (place.w / 100) * full, h: (place.h / 100) * full * (viewport.height / viewport.width) };
  const width = Math.round(Math.max(fit, full * Math.min(1, (0.8 * fit) / box.w, (0.8 * figure.clientHeight) / box.h)));
  if (width < fit * 1.1) return false;
  figure.classList.add('zoomed');
  canvas.style.width = `${width}px`;
  figure.scrollLeft = (place.cx / 100) * canvas.offsetWidth - figure.clientWidth / 2;
  figure.scrollTop = (place.cy / 100) * canvas.offsetHeight - figure.clientHeight / 2;
  return true;
}

// Listenin bir satırı: numara · etiket "metin" anahtar (dom-tree.css'in satır biçimi) · DOM'daki yeri ·
// parçaya özgü not ve görüntüde neden işaretli olmadığı. marked: görüntüde kutusu var mı
function faultItem(target, { index, numbered, marked, viewport }) {
  const li = document.createElement('li');
  li.className = 'fault-item' + (marked ? '' : ' unmarked');
  li.tabIndex = 0;
  li.innerHTML = '<span class="fault-index"></span><div class="fault-desc"><div class="dom-row"><span class="dom-tag"></span> <span class="dom-text"></span> <code></code></div><small class="fault-path"></small><small class="fault-note"></small></div>';
  li.querySelector('.fault-index').textContent = numbered ? String(index + 1) : '';
  li.querySelector('.fault-index').hidden = !numbered;
  li.querySelector('.dom-tag').textContent = target.tag;
  li.querySelector('.dom-text').textContent = target.text ? `"${target.text}"` : '';
  li.querySelector('code').textContent = target.key ?? '';
  li.querySelector('.fault-path').textContent = target.path.length ? `DOM'daki yeri: ${[...target.path, target.tag].join(' › ')}` : '';
  li.querySelector('.fault-path').hidden = !target.path.length;
  const notes = [target.note, faultVisibilityText(target, viewport)].filter(Boolean);
  li.querySelector('.fault-note').textContent = notes.join(' · ');
  li.querySelector('.fault-note').hidden = !notes.length;
  li.title = [faultTargetName(target), target.key, ...notes].filter(Boolean).join(' · ') + (marked ? ' · yakından bakmak için tıklayın' : '');
  return li;
}

// Listenin altındaki açıklama: element yoksa nedeni, listeye sığmayanlar, çizilemeyenler
function faultNote(m, alarmLike, drawn) {
  const targets = alarmLike.targets;
  if (targets === null || targets === undefined) return 'Bu uyarıda bozulan element bilgisi yok (element saklanmaya başlamadan önce alınmış ya da sayfada yeri bulunamamış); yalnızca ekran görüntüsü var.';
  if (!targets.length) {
    const expected = (m?.type === 'expectedText' || m?.type === 'expectedImage') && m.params?.mode !== 'absent';
    return expected
      ? `İşaretlenecek element yok: beklenen ${m.type === 'expectedImage' ? 'görüntü' : 'metin'} ekranda bulunamadığı için bozuldu; olmayan şeyin ekranda yeri de yoktur.`
      : 'İşaretlenecek tek bir element yok: bozulan yer tek bir elemente indirilemedi (ör. metin sayfanın ayrı bölümlerine yayılmış).';
  }
  const parts = [];
  if (alarmLike.more > 0) parts.push(`${alarmLike.more} element daha var; ilk ${targets.length} tanesi listelendi (önce ekranda görünenler).`);
  if (!alarmLike.screenshot) parts.push('Ekran görüntüsü alınamadığı için görüntüde işaretlenemedi.');
  else if (!alarmLike.viewport) parts.push('Görüntüde işaretlenemedi: görüntünün sayfanın hangi kısmını gösterdiği bilinmiyor.');
  else if (!drawn) parts.push('Bu elementler o an ekran görüntüsünün içinde değil; görüntüde işaretlenemedi.');
  else if (drawn < targets.length) parts.push(`${targets.length - drawn} element o an ekran görüntüsünün içinde değil; nedeni satırında.`);
  return parts.join(' ');
}
