// Monitör yardımcılarının birim testi (tarayıcısız; fit-unit.test.js gibi vm ile): tür kataloğu
// (monitor-types.js: parametre doğrulama, ağır desen uyarısı, otomatik ad, özet cümlesi) ve
// monitors.js'ten çıkarılan saf fonksiyonlar (normalize*, aksiyon eşleştirme). Geçti / kaldı kararını
// etkileyen mantık burada hızlıca sınanır; arayüz ve oynatma uçtan uca testlerde.
// Kullanım: node tests/e2e/monitor-unit.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { REPO } = require('./env');
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

// monitor-types.js tamamen saf: olduğu gibi yüklenir
const typesSource = fs.readFileSync(path.join(REPO, 'extension', 'sidepanel', 'monitor-types.js'), 'utf8');
// monitors.js DOM'a bağlı; yalnızca saf fonksiyonlar adlarıyla çıkarılır
const monitorsSource = fs.readFileSync(path.join(REPO, 'extension', 'sidepanel', 'monitors.js'), 'utf8');
const pick = (name) => {
  const match = monitorsSource.match(new RegExp(`\\n(?:async )?function ${name}\\([^]*?\\n}\\n`));
  if (!match) throw new Error(`monitors.js'te ${name} bulunamadı`);
  return match[0];
};
const constants = monitorsSource.match(/^const (MONITORS_KEY_PREFIX|MONITORS_FORMAT|MONITOR_ALARMS_KEY_PREFIX|MONITOR_ALARMS_FORMAT|MONITOR_ALARM_LIMIT) = [^\n]*$/gm).join('\n');
const picked = ['emptyMonitors', 'normalizeMonitors', 'emptyAlarms', 'normalizeAlarms', 'actionTarget', 'monitorActionRef', 'normalizeActionRef', 'resolveMonitorAction'].map(pick).join('\n');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(`${typesSource}\n${constants}\n${picked}\n`
  + 'this.T = { monitorType, monitorParamProblem, monitorPatternWarning, monitorAutoName, monitorSentence, monitorDefaults, MONITOR_TYPES };\n'
  + 'this.M = { normalizeMonitors, normalizeAlarms, normalizeActionRef, monitorActionRef, resolveMonitorAction };', ctx);
const { T, M } = ctx;

// ---- Katalog ----
check('3 tür: inputValidation (aksiyon), errorText (state), fontSize (state)', T.MONITOR_TYPES.map((t) => `${t.id}:${t.when}`).join(',') === 'inputValidation:action,errorText:state,fontSize:state');
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

console.log(failures ? `\n${failures} kontrol başarısız` : '\nHepsi geçti');
process.exit(failures ? 1 : 0);
