// replay.js > fitViewport birim testi: Chrome API'leri taklit edilir (pencere, yan panel, yakınlaştırma, ekran).
// Kullanım: node tests/e2e/fit-unit.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { REPO } = require('./env');
const source = fs.readFileSync(path.join(REPO, 'extension', 'sidepanel', 'replay.js'), 'utf8');
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

// Tarayıcı: ekran 1920×1040 kullanılabilir alan; görünen alan = (pencere - yan panel - kenar) / yakınlaştırma.
function browser({ state, normal, panel, zoom, systemScale = 1, minWidth = 500, locked = false }) {
  const area = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1040 };
  const win = { state, ...(state === 'normal' ? normal : { left: 0, top: 0, width: 1920, height: 1040 }) };
  const updates = [];
  const viewport = () => ({ width: Math.floor((win.width - panel - 16) / zoom.value), height: Math.floor((win.height - 112) / zoom.value), devicePixelRatio: systemScale * zoom.value });
  const chrome = {
    tabs: {
      sendMessage: async () => ({ viewport: viewport() }),
      getZoom: async () => zoom.value,
      setZoom: async (_, z) => { zoom.value = z; },
      get: async () => ({ windowId: 1 }),
    },
    windows: {
      get: async () => ({ ...win }),
      update: async (_, change) => {
        updates.push(change);
        if (change.state === 'normal' && win.state !== 'normal') Object.assign(win, { state: 'normal' }, normal);
        else if (change.state && change.state !== 'normal') Object.assign(win, { state: change.state, left: 0, top: 0, width: 1920, height: 1040 });
        if (change.width !== undefined && !locked) {
          if (change.width > area.availWidth || change.height > area.availHeight) throw new Error('Invalid value for bounds');
          Object.assign(win, { left: change.left, top: change.top, width: Math.max(change.width, minWidth), height: change.height });
        }
      },
    },
  };
  const context = { chrome, screen: area, setTimeout: (fn) => setImmediate(fn), console };
  vm.runInNewContext(`${source}\nthis.fitViewport = fitViewport;`, context);
  return { fit: context.fitViewport, win, updates, viewport };
}

(async () => {
  // 1) Senin durumun: tam ekran pencere, yan panel kayıttakinden geniş -> pencereye dokunulmaz, eksik genişlik döner
  {
    const b = browser({ state: 'maximized', normal: { left: 100, top: 50, width: 1300, height: 900 }, panel: 734, zoom: { value: 0.8 } });
    const before = b.viewport();
    const target = { width: before.width + 287, height: before.height, devicePixelRatio: 0.8 };
    const result = await b.fit(1, target);
    check('tam ekran, genişlik eksik: pencere değişmedi', b.updates.length === 0 && b.win.state === 'maximized', JSON.stringify(b.updates));
    check('eksik genişlik ekran pikseliyle (287 × 0,8 = 230)', result.short?.width === 230 && result.short.height === 0, JSON.stringify(result));
  }
  // 2) Tam ekran pencere, görünen alan küçülmeli -> normal pencereye alınır, tam tutturulur
  {
    const b = browser({ state: 'maximized', normal: { left: 100, top: 50, width: 1000, height: 700 }, panel: 400, zoom: { value: 1 } });
    const result = await b.fit(1, { width: 1184, height: 749, devicePixelRatio: 1 });
    check('tam ekran, küçülme: normal pencere, tuttu', result.short === null && result.viewport.width === 1184 && result.viewport.height === 749 && b.win.state === 'normal', JSON.stringify(result));
  }
  // 3) Normal pencere, ekran yetmiyor -> dokunulmaz, eksik döner
  {
    const b = browser({ state: 'normal', normal: { left: 0, top: 0, width: 1800, height: 1000 }, panel: 400, zoom: { value: 1 } });
    const result = await b.fit(1, { width: 1600, height: 888, devicePixelRatio: 1 });
    check('normal pencere, ekran yetmiyor: dokunulmadı', b.updates.length === 0 && result.short?.width === 1800 + 216 - 1920, JSON.stringify(result));
  }
  // 4) Yakınlaştırma farklı ve pencere büyütülebilir -> önce yakınlaştırma, sonra pencere
  {
    const zoom = { value: 1.25 };
    const b = browser({ state: 'normal', normal: { left: 10, top: 10, width: 1000, height: 720 }, panel: 400, zoom });
    const result = await b.fit(1, { width: 1184, height: 749, devicePixelRatio: 1 });
    check('yakınlaştırma ve pencere: tuttu', result.short === null && zoom.value === 1 && result.viewport.width === 1184, JSON.stringify(result));
  }
  // 5) Sonuç kötüleşirse geri alınır: normal pencere küçük ve boyutlandırılamıyor (ör. işletim sistemi izin vermiyor)
  {
    const b = browser({ state: 'maximized', normal: { left: 0, top: 0, width: 520, height: 500 }, panel: 400, zoom: { value: 1 }, locked: true });
    const start = b.viewport();
    const result = await b.fit(1, { width: start.width - 100, height: start.height, devicePixelRatio: 1 });
    check('kötüleşince eski haline döndü', b.win.state === 'maximized' && result.viewport.width === start.width, JSON.stringify({ result, win: b.win }));
  }
  // 6) Hedefe yaklaşıp tutturamazsa yakın sonuç kalır (en küçük pencere genişliği engel)
  {
    const b = browser({ state: 'maximized', normal: { left: 0, top: 0, width: 520, height: 500 }, panel: 400, zoom: { value: 1 }, minWidth: 500 });
    const start = b.viewport();
    const result = await b.fit(1, { width: start.width - 1460, height: start.height, devicePixelRatio: 1 });
    check('yaklaştıysa kalır, eksik değil fazla', b.win.state === 'normal' && result.viewport.width === 84 && result.short.width === 0, JSON.stringify(result));
  }
  console.log(failures ? `\n${failures} FAIL` : '\nHepsi geçti');
  process.exit(failures ? 1 : 0);
})();
