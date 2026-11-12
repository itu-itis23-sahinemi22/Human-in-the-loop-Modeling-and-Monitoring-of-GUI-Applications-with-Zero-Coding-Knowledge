// Monitör yardımcılarının birim testi: tür kataloğu
// (monitor-types.js: parametre doğrulama, ağır desen uyarısı, otomatik ad, özet cümlesi),
// monitor-store.js'ten çıkarılan saf fonksiyonlar (normalize*, aksiyon eşleştirme), görüntü eşleme
// (monitor-image.js > findImage: yapay görüntüde parça arama) ve hata yeri (monitor-locate.js: kutunun
// görüntüdeki yeri). Geçti / kaldı kararını etkileyen mantık burada hızlıca sınanır; arayüz ve oynatma
// uçtan uca testlerde.
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
// Satır sonları \n'e çevrilir: Windows'ta core.autocrlf dosyayı \r\n ile çıkarır, desenler \n arar
const monitorsSource = fs.readFileSync(path.join(REPO, 'extension', 'sidepanel', 'monitor-store.js'), 'utf8').replace(/\r\n/g, '\n');
const pick = (name) => {
  const match = monitorsSource.match(new RegExp(`\\n(?:async )?function ${name}\\([^]*?\\n}\\n`));
  if (!match) throw new Error(`monitor-store.js'te ${name} bulunamadı`);
  return match[0];
};
const constants = monitorsSource.match(/^const (MONITORS_KEY_PREFIX|MONITORS_FORMAT|MONITOR_ALARMS_KEY_PREFIX|MONITOR_ALARMS_FORMAT|MONITOR_ALARM_LIMIT|MONITOR_TARGET_LIMIT|MONITOR_REGION_TAG) = [^\n]*$/gm).join('\n');
const picked = ['emptyMonitors', 'normalizeMonitors', 'emptyAlarms', 'normalizeAlarms', 'normalizeLocation', 'actionTarget', 'waitAnchor', 'sameAnchor', 'waitsAfter', 'sameWait', 'monitorActionRef', 'normalizeActionRef', 'resolveMonitorAction', 'resolveWaitAction', 'actionText', 'waitSeconds', 'anchorText', 'actionRefText'].map(pick).join('\n');
// monitor-image.js: saf kısım DOM'suz yüklenir (panel kısmı fonksiyon tanımı olarak durur, çağrılmaz)
const imageSource = fs.readFileSync(path.join(REPO, 'extension', 'sidepanel', 'monitor-image.js'), 'utf8');
// monitor-locate.js: aynı şekilde (kutu hesabı saf; pencereyi dolduran kısım çağrılmaz)
const locateSource = fs.readFileSync(path.join(REPO, 'extension', 'sidepanel', 'monitor-locate.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(`${typesSource}\n${constants}\n${picked}\n${imageSource}\n${locateSource}\n`
  + 'this.T = { monitorType, monitorParamProblem, monitorImageProblem, monitorPatternWarning, monitorAutoName, monitorSentence, monitorDefaults, MONITOR_TYPES };\n'
  + 'this.M = { normalizeMonitors, normalizeAlarms, normalizeActionRef, monitorActionRef, resolveMonitorAction, actionText, actionRefText };\n'
  + 'this.I = { findImage, needleAnchors };\n'
  + 'this.L = { normalizeLocation, faultBoxPlace, faultLabelSide, shownViewport, faultVisibilityText, faultTargetName, faultSummary, isRegionTarget, MONITOR_REGION_TAG };', ctx);
const { T, M, I, L } = ctx;

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
// Bekleme aksiyonları: arkasından geldiği aksiyonla tanınır (Emir'in otomatik beklemeleri hep 10 ms ve "Wait" etiketli;
// süre ya da sıra tek başına yetmez). Issue #5'in senaryosu: saucedemo login edge'i, monitör 6. beklemede (Login'den sonra).
const W = (ms) => ({ type: 'wait', label: 'Wait', ms, selector: null, target: null });
const login = [A('input', 'input:user-name', 'Fill Username'), W(10), A('input', 'input:password', 'Fill Password'), W(10), A('click', 'button:login', 'Login'), W(10)];
const refW = M.monitorActionRef(login[5], 5, login);
check('monitorActionRef bekleme: süre + arkasından geldiği aksiyon (Tıkla Login) + Login\'den sonraki beklemeler içinde sırası (1. / 1)', refW.target === 'wait:10' && refW.after?.type === 'click' && refW.after.target === 'button:login'
  && refW.nth === 0 && refW.count === 1 && refW.alike === 1 && M.resolveMonitorAction(refW, login) === 5, JSON.stringify(refW));
check('issue #5a: bağlı bekleme silinince monitör 1. beklemeye KAYMAZ, bulunamadı (-1)', M.resolveMonitorAction(refW, login.slice(0, 5)) === -1);
check('issue #5b: beklemenin süresi 2 sn olunca aynı beklemede kalır (5), 2. beklemeye kaymaz', M.resolveMonitorAction(refW, [...login.slice(0, 5), W(2000)]) === 5);
check('önceki bir aksiyon (şifre + beklemesi) silinince Login\'den sonraki bekleme yine bulunur (3)', M.resolveMonitorAction(refW, [login[0], login[1], login[4], login[5]]) === 3);
check('arkasından geldiği aksiyon (Login) silinince bulunamaz (-1)', M.resolveMonitorAction(refW, [login[0], login[1], login[2], login[3], login[5]]) === -1);
check('Login\'in etiketi değişse de hedefi aynıysa bulunur', M.resolveMonitorAction(refW, [...login.slice(0, 4), { ...login[4], label: 'Giriş' }, W(10)]) === 5);
const twoWaits = [A('click', 'button:login', 'Login'), W(10), W(10)];
const refTwin = M.monitorActionRef(twoWaits[2], 2, twoWaits);
check('aynı aksiyondan sonra iki eş bekleme: kaçıncı olduğuyla bulunur (2); biri silinince hangisi olduğu belirsiz, -1', refTwin.nth === 1 && refTwin.count === 2 && refTwin.alike === 2
  && M.resolveMonitorAction(refTwin, twoWaits) === 2 && M.resolveMonitorAction(refTwin, twoWaits.slice(0, 2)) === -1, JSON.stringify(refTwin));
// Aynı aksiyon edge'de iki kez (sihirbazda iki "İleri"), her birinin arkasında otomatik bekleme; monitör ilk İleri'nin beklemesinde
const wizard = [A('input', 'input:ad', 'Fill Ad'), W(10), A('click', 'button:next', 'İleri'), W(10), A('click', 'button:next', 'İleri'), W(10)];
const refFirst = M.monitorActionRef(wizard[3], 3, wizard);
check('iki "İleri": önden bir aksiyon ve beklemesi silinince ilk İleri\'nin beklemesinde kalır (1), ikinciye KAYMAZ', M.resolveMonitorAction(refFirst, wizard.slice(2)) === 1, String(M.resolveMonitorAction(refFirst, wizard.slice(2))));
check('iki "İleri": bağlı İleri ve beklemesi silinince bulunamadı (-1), öbür İleri\'nin beklemesine KAYMAZ', M.resolveMonitorAction(refFirst, [wizard[0], wizard[1], wizard[4], wizard[5]]) === -1);
check('iki "İleri": ikinci İleri\'nin beklemesi de önden silmede yerinde kalır (3)', M.resolveMonitorAction(M.monitorActionRef(wizard[5], 5, wizard), wizard.slice(2)) === 3);
const mixed = [A('click', 'button:next', 'İleri'), W(10), A('click', 'button:next', 'İleri'), W(2000)];
const refLong = M.monitorActionRef(mixed[3], 3, mixed);
check('ikizi olmayan bekleme (2 sn): öbür İleri silinince süresiyle bulunur (1); kendisi silinince -1', refLong.alike === 1 && M.resolveMonitorAction(refLong, mixed.slice(2)) === 1 && M.resolveMonitorAction(refLong, mixed.slice(0, 2)) === -1, JSON.stringify(refLong));
check('sırası kaydedilmemiş kayıt (after var, nth yok): yalnızca tek adaysa bulunur', M.resolveMonitorAction({ index: 5, type: 'wait', label: 'Wait', target: 'wait:10', after: { type: 'click', label: 'Login', target: 'button:login' } }, login) === 5
  && M.resolveMonitorAction({ index: 3, type: 'wait', label: 'Wait', target: 'wait:10', after: { type: 'click', label: 'İleri', target: 'button:next' } }, wizard) === -1);
const startWait = [W(1500), A('click', 'button:next', 'Devam')];
const refStart = M.monitorActionRef(startWait[0], 0, startWait);
check('edge başındaki bekleme (after null): bulunur; önüne aksiyon gelince bulunamaz', refStart.after === null && M.resolveMonitorAction(refStart, startWait) === 0 && M.resolveMonitorAction(refStart, [A('click', 'button:x', 'X'), ...startWait]) === -1);
check('eski kayıt (after yok): yalnızca aynı sırada aynı süreli bekleme', M.resolveMonitorAction({ index: 5, type: 'wait', label: 'Wait', target: 'wait:10' }, login) === 5 && M.resolveMonitorAction({ index: 5, type: 'wait', label: 'Wait', target: 'wait:10' }, login.slice(0, 5)) === -1);
check('actionText bekleme: süre + arkasından geldiği aksiyon', M.actionText(login[5], 5, login) === '6. wait 0,01 sn (click Login sonrası)' && M.actionText(startWait[0], 0, startWait) === '1. wait 1,5 sn (edge başında)' && M.actionText(login[5], 5) === '6. wait 0,01 sn', M.actionText(login[5], 5, login)); // ACTION_TEXT yok: fiil yerine tür
check('actionRefText: bulunamayan bekleme kayıttaki bilgiyle', M.actionRefText(refW) === '6. Bekle 0,01 sn (click Login sonrası)' && M.actionRefText({ index: 2, type: 'click', label: 'Devam', target: 'button:next' }) === '3. Devam', M.actionRefText(refW));
check('normalizeActionRef: after korunur (nesne ya da null), eski kayıtta undefined', M.normalizeActionRef({ index: 5, type: 'wait', target: 'wait:10', after: { type: 'click', label: 'Login', target: 'button:login' } }).after.target === 'button:login'
  && M.normalizeActionRef({ index: 0, type: 'wait', target: 'wait:10', after: null }).after === null && M.normalizeActionRef({ index: 5, type: 'wait', target: 'wait:10' }).after === undefined);
const kept = M.normalizeActionRef(JSON.parse(JSON.stringify(refFirst)));
check('normalizeActionRef: beklemenin sırası (nth / count / alike) korunur, tutarsızsa atılır', kept.nth === 0 && kept.count === 2 && kept.alike === 2 && M.resolveMonitorAction(kept, wizard.slice(2)) === 1
  && M.normalizeActionRef({ ...refFirst, nth: 5 }).nth === undefined && M.normalizeActionRef({ ...refFirst, nth: 5 }).count === undefined, JSON.stringify(kept));
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

// ---- Hata yeri: uyarıda saklanan bozulan element ve görüntüdeki kutusu ----
const field = { tag: 'input#phone', text: 'Telefon', key: 'input:phone', path: ['form'], rect: { x: 100, y: 200, w: 300, h: 40 }, visible: { x: 100, y: 200, w: 300, h: 40 }, hidden: null, note: '' };
const below = { tag: 'small', text: 'küçük yazı', key: null, path: [], rect: { x: 10, y: 3000, w: 80, h: 6 }, visible: null, hidden: 'below', note: '3 pt' };
const located = L.normalizeLocation({ targets: [field, below], more: 2, viewport: { width: 1200, height: 800 } });
check('normalizeLocation: hedefler, more ve viewport korunur', located.targets.length === 2 && located.targets[0].key === 'input:phone' && located.targets[0].rect.w === 300 && located.targets[1].visible === null
  && located.targets[1].hidden === 'below' && located.more === 2 && located.viewport.width === 1200, JSON.stringify(located));
check('normalizeLocation: eski uyarıda (targets yok) hepsi null / 0; boş liste boş kalır (bozulan yer element değil)', L.normalizeLocation({}).targets === null && L.normalizeLocation({}).viewport === null && L.normalizeLocation({ more: 3 }).more === 0
  && Array.isArray(L.normalizeLocation({ targets: [] }).targets) && L.normalizeLocation({ targets: [] }).targets.length === 0 && L.normalizeLocation(null).targets === null);
const messy = L.normalizeLocation({ targets: [{ tag: 'x'.repeat(500), text: 5, key: undefined, path: 'bozuk', rect: { x: 1, y: 'a', w: 2, h: 2 }, visible: { x: 0, y: 0, w: -1, h: 2 }, hidden: 'uydurma', note: null }, null, 'metin', ...Array(20).fill(field)], more: -4, viewport: { width: 0, height: 10 } });
check('normalizeLocation: bozuk alanlar güvenli hale gelir (uzun metin kısalır, sayı olmayan kutu null, en fazla 10 hedef)', messy.targets.length === 10 && messy.targets[0].tag.length === 80 && messy.targets[0].text === '5' && messy.targets[0].key === null
  && messy.targets[0].path.length === 0 && messy.targets[0].rect === null && messy.targets[0].visible === null && messy.targets[0].hidden === null && messy.targets[0].note === '' && messy.more === 0 && messy.viewport === null, JSON.stringify(messy.targets[0]));
const withPlace = M.normalizeAlarms({ items: [{ id: 'a1', monitorId: 'm1', targets: [field], viewport: { width: 1200, height: 800 } }, { id: 'a2', monitorId: 'm1' }] });
check('normalizeAlarms: hata yeri uyarıyla saklanır; eski uyarıda null', withPlace.items[0].targets[0].tag === 'input#phone' && withPlace.items[0].viewport.height === 800 && withPlace.items[0].more === 0 && withPlace.items[1].targets === null && withPlace.items[1].viewport === null);
const place = L.faultBoxPlace(field, { width: 1200, height: 800 });
check('faultBoxPlace: kutu görüntünün yüzdesi olarak (merkez + boyut)', place.cx === 20.833 && place.cy === 27.5 && place.w === 25 && place.h === 5, JSON.stringify(place));
check('faultBoxPlace: ölçek (yakınlaştırma / piksel oranı) sonucu değiştirmez', JSON.stringify(L.faultBoxPlace({ visible: { x: 150, y: 300, w: 450, h: 60 } }, { width: 1800, height: 1200 })) === JSON.stringify(place));
check('faultBoxPlace: görünmeyen hedefte ya da alan bilinmiyorsa null; taşan kutu görüntüye kırpılır', L.faultBoxPlace(below, { width: 1200, height: 800 }) === null && L.faultBoxPlace(field, null) === null && L.faultBoxPlace(field, { width: 0, height: 800 }) === null
  && L.faultBoxPlace({ visible: { x: 1100, y: 700, w: 300, h: 300 } }, { width: 1200, height: 800 }).w === 8.333 && L.faultBoxPlace({ visible: { x: 1300, y: 0, w: 10, h: 10 } }, { width: 1200, height: 800 }) === null);
check('faultLabelSide: etiket üstte; en üstteki kutuda altta, boydan boya kutuda içinde, sağ yarıda başlayan kutuda sağdan hizalı', L.faultLabelSide(place) === '' && L.faultLabelSide({ cx: 30, cy: 5, w: 20, h: 6 }) === 'low'
  && L.faultLabelSide({ cx: 50, cy: 50, w: 90, h: 96 }) === 'inside' && L.faultLabelSide({ cx: 80, cy: 50, w: 20, h: 10 }) === 'end' && L.faultLabelSide({ cx: 80, cy: 4, w: 20, h: 6 }) === 'low end' && L.faultLabelSide({ cx: 60, cy: 50, w: 40, h: 10 }) === '');
check('faultVisibilityText: tamamı görünüyorsa boş; kısmen görünen ve görünmeyen nedeniyle; görüntü daha kısaysa "dışında"', L.faultVisibilityText(field) === '' && L.faultVisibilityText({ ...field, visible: { x: 100, y: 200, w: 300, h: 10 } }) === 'yalnızca bir kısmı görünüyor'
  && L.faultVisibilityText(below).includes('altında') && L.faultVisibilityText({ ...below, hidden: 'clipped' }).includes('taşanı gizleyen') && L.faultVisibilityText({ ...below, hidden: null }) === 'ekran görüntüsünde yok'
  && L.faultVisibilityText(field, { width: 1200, height: 800 }) === '' && L.faultVisibilityText(field, { width: 1200, height: 150 }) === 'ekran görüntüsünün dışında kalıyor');
// Görüntünün gösterdiği alan: sayfanın ölçtüğü alan (CSS pikseli + piksel oranı) ve alınan görüntü (piksel)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('shownViewport: görüntü ölçülen alanın tamamıysa alan aynen kalır (piksel oranı 1, 2 ve 1,5: retina, yakınlaştırma)', same(L.shownViewport({ width: 1200, height: 761, ratio: 1 }, { width: 1200, height: 761 }), { width: 1200, height: 761 })
  && same(L.shownViewport({ width: 1200, height: 761, ratio: 2 }, { width: 2400, height: 1522 }), { width: 1200, height: 761 }) && same(L.shownViewport({ width: 800, height: 506, ratio: 1.5 }, { width: 1200, height: 759 }), { width: 800, height: 506 }));
// Oynatma kayıttaki pencereyi taklit eder; görüntü sayfanın yalnızca gerçekten görünen kısmıdır (deney: tests/README > monitor-locate)
const shorter = L.shownViewport({ width: 1200, height: 761, ratio: 1 }, { width: 1200, height: 708 }); // üstte "hata ayıklama" çubuğu: 53 px kısa
check('shownViewport: görüntü ölçülenden kısaysa alan görüntünün gösterdiği kadardır; kutu yine elementin üstünde, görüntünün altında kalan çizilmez', same(shorter, { width: 1200, height: 708 })
  && L.faultBoxPlace(field, shorter).cy === Math.round((220 / 708) * 100000) / 1000 && L.faultBoxPlace(field, shorter).cx === place.cx && L.faultBoxPlace({ visible: { x: 0, y: 720, w: 50, h: 20 } }, shorter) === null);
const narrower = L.shownViewport({ width: 1400, height: 761, ratio: 2 }, { width: 2400, height: 1416 }); // taklit pencereden geniş, retina
const wider = L.shownViewport({ width: 900, height: 508, ratio: 1 }, { width: 1200, height: 708 });      // taklit pencereden küçük
check('shownViewport: görüntü ölçülenden dar ya da geniş de olabilir; ölçek (ratio) aynı kaldığı için kutu yerinde', same(narrower, { width: 1200, height: 708 }) && same(wider, { width: 1200, height: 708 })
  && L.faultBoxPlace(field, narrower).cx === place.cx && L.faultBoxPlace(field, wider).w === 25 && L.faultBoxPlace({ visible: { x: 1250, y: 10, w: 100, h: 20 } }, narrower) === null);
check('shownViewport: görüntü ya da ölçüm yoksa null; oransız alan (görüntüde ölçülmüş: görüntü monitörü) aynen', L.shownViewport({ width: 1200, height: 761, ratio: 1 }, null) === null && L.shownViewport(null, { width: 1200, height: 761 }) === null
  && L.shownViewport({ width: 0, height: 761, ratio: 1 }, { width: 1200, height: 761 }) === null && L.shownViewport({ width: 1200, height: 761, ratio: 1 }, { width: 0, height: 0 }) === null && same(L.shownViewport({ width: 640, height: 480 }, null), { width: 640, height: 480 }));
check('faultTargetName / faultSummary: tek element adıyla, çoğu sayıyla; element yoksa boş', L.faultTargetName(field) === 'input#phone "Telefon"' && L.faultTargetName({ tag: 'h1', text: '' }) === 'h1'
  && L.faultSummary({ targets: [field] }) === 'input#phone "Telefon"' && L.faultSummary({ targets: [field, below], more: 3 }) === '5 element: input#phone "Telefon", small "küçük yazı", …'
  && L.faultSummary({ targets: [field, below] }) === '2 element: input#phone "Telefon", small "küçük yazı"' && L.faultSummary({ targets: [] }) === '' && L.faultSummary({ targets: null }) === '' && L.faultSummary(null) === '');
check('isRegionTarget: görüntü monitörünün bölgesi element değildir', L.isRegionTarget({ tag: L.MONITOR_REGION_TAG }) && !L.isRegionTarget(field));

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
