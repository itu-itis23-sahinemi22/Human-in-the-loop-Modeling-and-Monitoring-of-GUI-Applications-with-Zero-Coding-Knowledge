// Monitör yardımcılarının birim testi (tarayıcısız; fit-unit.test.js gibi vm ile): tür kataloğu
// (monitor-types.js: parametre doğrulama, ağır desen uyarısı, otomatik ad, özet cümlesi),
// monitor-store.js'ten çıkarılan saf fonksiyonlar (normalize*, aksiyon eşleştirme) ve görüntü eşleme
// (monitor-image.js > findImage: yapay görüntüde parça arama). Geçti / kaldı kararını etkileyen mantık
// burada hızlıca sınanır; arayüz ve oynatma uçtan uca testlerde.
// Kullanım: node tests/e2e/monitor-unit.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { REPO } = require('./env');
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

// monitor-types.js tamamen saf: olduğu gibi yüklenir
const typesSource = fs.readFileSync(path.join(REPO, 'extension', 'sidepanel', 'monitor-types.js'), 'utf8');
// monitor-store.js storage ve panel'e bağlı; yalnızca saf fonksiyonlar adlarıyla çıkarılır
const monitorsSource = fs.readFileSync(path.join(REPO, 'extension', 'sidepanel', 'monitor-store.js'), 'utf8');
const pick = (name) => {
  const match = monitorsSource.match(new RegExp(`\\n(?:async )?function ${name}\\([^]*?\\n}\\n`));
  if (!match) throw new Error(`monitor-store.js'te ${name} bulunamadı`);
  return match[0];
};
const constants = monitorsSource.match(/^const (MONITORS_KEY_PREFIX|MONITORS_FORMAT|MONITOR_ALARMS_KEY_PREFIX|MONITOR_ALARMS_FORMAT|MONITOR_ALARM_LIMIT) = [^\n]*$/gm).join('\n');
const picked = ['emptyMonitors', 'normalizeMonitors', 'emptyAlarms', 'normalizeAlarms', 'actionTarget', 'monitorActionRef', 'normalizeActionRef', 'resolveMonitorAction'].map(pick).join('\n');
// monitor-image.js: saf kısım DOM'suz yüklenir (panel kısmı fonksiyon tanımı olarak durur, çağrılmaz)
const imageSource = fs.readFileSync(path.join(REPO, 'extension', 'sidepanel', 'monitor-image.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(`${typesSource}\n${constants}\n${picked}\n${imageSource}\n`
  + 'this.T = { monitorType, monitorParamProblem, monitorImageProblem, monitorPatternWarning, monitorAutoName, monitorSentence, monitorDefaults, MONITOR_TYPES };\n'
  + 'this.M = { normalizeMonitors, normalizeAlarms, normalizeActionRef, monitorActionRef, resolveMonitorAction };\n'
  + 'this.I = { findImage, needleAnchors };', ctx);
const { T, M, I } = ctx;

// ---- Katalog ----
check('5 tür: inputValidation (aksiyon), expectedText / expectedImage / errorText / fontSize (state); görüntü panelde', T.MONITOR_TYPES.map((t) => `${t.id}:${t.when}${t.side ? ':' + t.side : ''}`).join(',') === 'inputValidation:action,expectedText:state,expectedImage:state:panel,errorText:state,fontSize:state', T.MONITOR_TYPES.map((t) => t.id).join(','));
const iv = T.monitorType('inputValidation');
const pattern = iv.params.find((p) => p.key === 'pattern');
const min = T.monitorType('fontSize').params.find((p) => p.key === 'min');
check('parametre doğrulama: boş zorunlu, geçersiz desen, sayı sınırı, listede olmayan seçenek', T.monitorParamProblem(pattern, '') === 'Bu alan gerekli.'
  && /Geçersiz desen/.test(T.monitorParamProblem(pattern, 'ab(+')) && T.monitorParamProblem(pattern, '^0?5') === null
  && T.monitorParamProblem(min, 'abc') === 'Sayı girin.' && T.monitorParamProblem(min, 0) === 'En az 1 olmalı.' && T.monitorParamProblem(min, 99) === 'En fazla 72 olmalı.' && T.monitorParamProblem(min, 12) === null
  && T.monitorParamProblem(iv.params.find((p) => p.key === 'mode'), 'x') === 'Listeden bir seçenek seçin.');
const heavy = ['(\\w+\\s?)+$', '(a*)*', '(x+){2,}', '(?:[a-z]+)*'];
const light = ['^0?5\\d{9}$', '\\b(404|500|internal server error)\\b', '(ab|cd)+', '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', '(\\d{3}-)+', ''];
check('ağır desen uyarısı: iç içe tekrar uyarır, sıradan desenler uyarmaz', heavy.every((p) => T.monitorPatternWarning(p)) && light.every((p) => !T.monitorPatternWarning(p)), JSON.stringify([heavy.map((p) => Boolean(T.monitorPatternWarning(p))), light.map((p) => Boolean(T.monitorPatternWarning(p)))]));
check('otomatik ad', T.monitorAutoName(iv, { selector: 'input:phone', pattern: '^0?5' }) === 'Input Validation · input:phone ~ /^0?5/' && T.monitorAutoName(T.monitorType('fontSize'), { min: 4, unit: 'pt' }) === 'Font Size · ≥ 4 pt', T.monitorAutoName(iv, { selector: 'input:phone', pattern: '^0?5' }));
const sentence = (scope) => T.monitorSentence(iv, { selector: 'input:phone', pattern: '^0?5', mode: 'match', whenEmpty: 'skip' }, scope, true).map((p) => (typeof p === 'string' ? p : p.b)).join('');
check('özet cümlesi: tüm model / node / edge (tamamı) / edge (aksiyon)', sentence({ kind: 'global' }).startsWith('Testte her adımdan sonra, her node\'da: input:phone alanının değeri /^0?5/ desenine uymalı')
  && sentence({ kind: 'node', name: 'v_Telefon' }).startsWith('Testte v_Telefon node\'una her varıldığında:')
  && sentence({ kind: 'edge', name: 'e_Devam' }).startsWith('Testte e_Devam edge\'inin her aksiyonundan sonra:')
  && sentence({ kind: 'edge', name: 'e_Devam', action: '1. Yaz Fill Telefon' }).startsWith('Testte e_Devam edge\'inin 1. Yaz Fill Telefon aksiyonundan hemen sonra:')
  && sentence({ kind: 'global' }).endsWith('Bozulursa kırmızı yanar.'), sentence({ kind: 'edge', name: 'e_Devam', action: '1. Yaz Fill Telefon' }));

// ---- Aksiyon eşleştirme (edge'in aksiyonu silinince / değişince) ----
const A = (type, key, label) => ({ type, label, target: key ? { key, index: 1 } : null, selector: key ? '#' + key.split(':')[1] : null });
const edge = [A('input', 'input:ad-sahibi', 'Fill Ad'), A('input', 'input:ad-cocuk', 'Fill Ad'), A('click', 'button:next', 'Devam')];
const ref0 = M.monitorActionRef(edge[0], 0);
check('monitorActionRef: sıra + tür + etiket + hedef', JSON.stringify(ref0) === JSON.stringify({ index: 0, type: 'input', label: 'Fill Ad', target: 'input:ad-sahibi' }), JSON.stringify(ref0));
check('tam eşleşme kayıttaki sırada', M.resolveMonitorAction(ref0, edge) === 0);
check('aynı etiketli iki alan: ilki silinince monitör öbür alana KAYMAZ (-1)', M.resolveMonitorAction(ref0, edge.slice(1)) === -1);
check('ikinci alan öne kayınca hedefiyle bulunur (0)', M.resolveMonitorAction(M.monitorActionRef(edge[1], 1), edge.slice(1)) === 0);
check('etiket değişmiş, tür + hedef aynı: bulunur', M.resolveMonitorAction({ index: 2, type: 'click', label: 'Eski', target: 'button:next' }, edge) === 2);
check('sıra yanlış kaydedilmiş: tür + hedef + etiketle bulunur', M.resolveMonitorAction({ index: 9, type: 'click', label: 'Devam', target: 'button:next' }, edge) === 2);
check('hedefsiz aksiyon (kaydırma) etiketle bulunur', M.resolveMonitorAction({ index: 0, type: 'scroll', label: 'Scroll down', target: null }, [A('scroll', null, 'Scroll down')]) === 0);
// Bekleme aksiyonları: hedef = süre ("wait:2500"); otomatik beklemeler (hepsi "Wait" etiketli) süreyle ayrılır; süresi değişen bekleme aynı sırada bulunur
const W = (ms) => ({ type: 'wait', label: 'Wait', ms, selector: null, target: null });
const waits = [A('input', 'input:a', 'Fill A'), W(10), A('click', 'button:b', 'B'), W(2500)];
const refW = M.monitorActionRef(waits[3], 3);
check('monitorActionRef bekleme: hedef süre', refW.target === 'wait:2500' && M.resolveMonitorAction(refW, waits) === 3, JSON.stringify(refW));
check('bekleme öne kayınca süresiyle bulunur (10 ms otomatik beklemeyle karışmaz)', M.resolveMonitorAction(refW, waits.slice(1)) === 2);
check('süresi değiştirilmiş bekleme (2,5 → 4 sn) aynı sırada bulunur', M.resolveMonitorAction(refW, [...waits.slice(0, 3), W(4000)]) === 3);
check('bekleme silinip yerine başka tür gelirse bulunmaz', M.resolveMonitorAction(refW, [...waits.slice(0, 3), A('click', 'button:c', 'C')]) === -1);
check('tür farklıysa bulunmaz', M.resolveMonitorAction({ index: 2, type: 'input', label: 'Devam', target: 'button:next' }, edge) === -1);
check('normalizeActionRef: string sıra sayıya çevrilir, bozuk sıra null, eksik alanlar boş', JSON.stringify(M.normalizeActionRef({ index: '1', type: 'input', label: 'x', target: 'input:a' })) === JSON.stringify({ index: 1, type: 'input', label: 'x', target: 'input:a' })
  && M.normalizeActionRef({ index: 'abc' }) === null && M.normalizeActionRef(null) === null && M.normalizeActionRef({ index: 2 }).label === '' && M.normalizeActionRef({ index: 2 }).target === null);

// ---- Storage'dan gelen verinin normalize edilmesi ----
const stored = { format: 'x', nextId: 'bozuk', items: [
  { id: 'm1', type: 'fontSize', scope: 'global', params: { min: 4, unit: 'pt' }, severity: 'warning', enabled: true, name: '  Ad  ' },
  { id: 'm2', type: 'errorText', scope: 'n3', params: 'bozuk', enabled: false, action: { index: '0', type: 'input', label: 'L', target: 'input:a' } },
  { id: 3, type: 'fontSize' }, { type: 'fontSize' }, null, 'çöp',
] };
const n = M.normalizeMonitors(stored);
check('normalizeMonitors: bozuk kayıtlar atılır, eksikler tamamlanır, önem bilinen değerse kalır, ad kırpılır', n.format === 'graph-recorder-monitors/v1' && n.nextId === 1 && n.items.length === 2
  && n.items[0].severity === 'warning' && n.items[0].name === 'Ad' && n.items[0].action === null && n.items[0].createdAt === null
  && n.items[1].params !== 'bozuk' && typeof n.items[1].params === 'object' && n.items[1].enabled === false && n.items[1].action.index === 0 && n.items[1].name === null, JSON.stringify(n));
check('normalizeMonitors: boş / yanlış giriş boş liste', M.normalizeMonitors(null).items.length === 0 && M.normalizeMonitors('x').items.length === 0 && M.normalizeMonitors({ items: 'x' }).items.length === 0);
const alarms = M.normalizeAlarms({ nextId: 7, items: [
  { id: 'a1', monitorId: 'm1', at: 5, source: 'live', where: 'Şimdi', text: 't', url: 'http://x', screenshot: 'data:image/jpeg;base64,AAAA', step: null, action: null },
  { id: 'a2', monitorId: 'm1', screenshot: 'javascript:alert(1)', source: 'başka' },
  { id: 'a3' }, {},
] });
check('normalizeAlarms: görüntü yalnızca data:image, kaynak replay/live, eksikler boş, monitörsüz kayıt atılır', alarms.nextId === 7 && alarms.items.length === 2 && alarms.items[0].source === 'live' && alarms.items[0].screenshot.startsWith('data:image/')
  && alarms.items[1].screenshot === null && alarms.items[1].source === 'replay' && alarms.items[1].at === 0 && alarms.items[1].where === '', JSON.stringify(alarms));

// ---- Expected Text / Expected Image: parametre doğrulama, ad, özet ----
const et = T.monitorType('expectedText');
const ei = T.monitorType('expectedImage');
const png = { data: 'data:image/png;base64,iVBORw0KGgo=', width: 120, height: 24 };
check('expectedText: metin gerekli; harf duyarlılığı varsayılan kapalı; kural varsayılan olmalı; ad ve özet', T.monitorParamProblem(et.params[0], '') === 'Bu alan gerekli.' && T.monitorParamProblem(et.params[0], 'Password is required') === null
  && T.monitorDefaults(et).caseSensitive === false && T.monitorDefaults(et).mode === 'present' && T.monitorAutoName(et, { text: 'Password is required' }) === 'Expected Text · "Password is required"'
  && T.monitorSentence(et, { text: 'Password is required', caseSensitive: false }, { kind: 'node', name: 'v_Login' }, true).map((p) => p.b ?? p).join('').includes('görünen yazılardan birinde Password is required geçmeli (büyük/küçük harf fark etmez)'));
check('expectedText olmamalı: ad "… yok", özet "hiçbirinde … geçmemeli"; kural listede olmayan değer reddedilir', T.monitorAutoName(et, { text: 'Bekleyiniz', mode: 'absent' }) === 'Expected Text · "Bekleyiniz" yok'
  && T.monitorSentence(et, { text: 'Bekleyiniz', mode: 'absent' }, { kind: 'edge', name: 'e_SGK', action: '2. Bekle 10 sn' }, true).map((p) => p.b ?? p).join('').includes('2. Bekle 10 sn aksiyonundan hemen sonra: görünen yazıların hiçbirinde Bekleyiniz geçmemeli')
  && T.monitorParamProblem(et.params.find((p) => p.key === 'mode'), 'maybe') === 'Listeden bir seçenek seçin.');
check('expectedImage: görüntü gerekli; biçim, boyut ve en/boy sınırı; benzerlik 50–100', T.monitorParamProblem(ei.params[0], '') === 'Bir görüntü yükleyin (PNG ya da JPEG).'
  && T.monitorParamProblem(ei.params[0], png) === null && /PNG, JPEG/.test(T.monitorParamProblem(ei.params[0], { ...png, data: 'data:text/plain;base64,QQ==' }))
  && /çok büyük/.test(T.monitorParamProblem(ei.params[0], { ...png, data: 'data:image/png;base64,' + 'A'.repeat(1500000) })) && /1–800 px/.test(T.monitorParamProblem(ei.params[0], { ...png, width: 2000 }))
  && T.monitorParamProblem(ei.params.find((p) => p.key === 'similarity'), 30) === 'En az 50 olmalı.' && T.monitorParamProblem(ei.params.find((p) => p.key === 'similarity'), 90) === null && T.monitorDefaults(ei).similarity === 90 && T.monitorDefaults(ei).mode === 'present'
  && T.monitorAutoName(ei, { image: png, similarity: 90 }) === 'Expected Image · 120×24 px' && T.monitorAutoName(ei, { image: png, mode: 'absent', similarity: 90 }) === 'Expected Image · 120×24 px yok'
  && T.monitorSentence(ei, { image: png, mode: 'absent', similarity: 90 }, { kind: 'global' }, true).map((p) => p.b ?? p).join('').includes('ekranda bulunmamalı (benzerlik en az %90)'));
check('import için de aynı doğrulama: {image:"x"} geçersiz', T.monitorImageProblem('x') !== null && T.monitorImageProblem({ data: png.data }) !== null);

// ---- Görüntü eşleme (monitor-image.js > findImage): yapay görüntüler ----
// Rastgele renkli zemin (tekrar üretilebilir), içine parça gömülür; parça zeminin bir kesitidir.
const rnd = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >>> 16) & 255; }; })(); // üst bitler: alt bitlerin kısa döngüsü deseni tekrar ettirir
const makeImage = (width, height, fill) => { const data = new Uint8ClampedArray(width * height * 4); for (let i = 0; i < width * height; i++) { const [r, g, b, a] = fill(i % width, Math.floor(i / width)); data.set([r, g, b, a ?? 255], i * 4); } return { width, height, data }; };
const crop = (img, x0, y0, w, h, alter = (p) => p) => makeImage(w, h, (x, y) => alter([...img.data.slice(((y0 + y) * img.width + x0 + x) * 4, ((y0 + y) * img.width + x0 + x) * 4 + 4)], x, y));
const scene = makeImage(90, 60, () => [rnd(), rnd(), rnd()]);
const piece = crop(scene, 23, 17, 14, 9);
let r = I.findImage(scene, piece, { threshold: 0.9 });
check('parça tam yerinde bulunur (23,17), benzerlik 1', r.found && r.x === 23 && r.y === 17 && r.score === 1, JSON.stringify(r));
const noisy = crop(scene, 23, 17, 14, 9, ([R, G, B, A]) => [Math.min(255, R + 8), Math.max(0, G - 8), B, A]);
r = I.findImage(scene, noisy, { threshold: 0.9 });
check('küçük renk farkı (JPEG gibi): yine bulunur, benzerlik %95+', r.found && r.x === 23 && r.y === 17 && r.score > 0.95, JSON.stringify(r));
const other = makeImage(14, 9, () => [rnd(), rnd(), rnd()]);
r = I.findImage(scene, other, { threshold: 0.9 });
check('başka bir parça bulunmaz; en iyi benzerlik düşük (<%85)', !r.found && r.score < 0.85, JSON.stringify(r));
const masked = crop(scene, 23, 17, 14, 9, ([R, G, B], x, y) => (x < 4 ? [0, 0, 0, 0] : [R, G, B, 255])); // sol 4 sütun şeffaf
r = I.findImage(scene, masked, { threshold: 0.99 });
check('şeffaf pikseller sayılmaz: maskeli parça yine (23,17)', r.found && r.x === 23 && r.y === 17, JSON.stringify(r));
const flat = makeImage(10, 6, () => [200, 200, 200]);
const flatScene = makeImage(40, 30, (x, y) => (x >= 12 && x < 22 && y >= 9 && y < 15 ? [200, 200, 200] : [rnd(), rnd(), rnd()]));
r = I.findImage(flatScene, flat, { threshold: 0.95 });
check('düz (tek renk) parça: ızgara çapalarıyla bulunur', r.found && r.x === 12 && r.y === 9, JSON.stringify(r));
r = I.findImage(scene, makeImage(100, 5, () => [0, 0, 0]), { threshold: 0.9 });
check('parça görüntüden büyükse bulunamaz (hata yok)', !r.found && r.score === 0);
r = I.findImage(flatScene, flat, { threshold: 0.95, maxWork: 1 });
check('tam karşılaştırma sınırı: ilk adaydan sonra durur, capped işaretli', (r.capped || r.found) && r.compared <= 1, JSON.stringify(r));
check('needleAnchors: en fazla 16 çapa, hepsi parça içinde', I.needleAnchors(piece).length <= 16 && I.needleAnchors(piece).every((a) => a.x >= 0 && a.x < 14 && a.y >= 0 && a.y < 9));

console.log(failures ? `\n${failures} kontrol başarısız` : '\nHepsi geçti');
process.exit(failures ? 1 : 0);
