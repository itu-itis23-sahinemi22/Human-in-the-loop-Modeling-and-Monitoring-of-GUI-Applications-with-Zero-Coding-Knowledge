// =============================================================================
// replay.js — PANELDE OYNATMA
// -----------------------------------------------------------------------------
// Seçili koşu, kullanıcının kendi tarayıcısında, kullanıcının o an açık sekmesinde oynatılır;
// kullanıcı her adımı görür. Runner'ın (runner/run.js) aynı işi Playwright'la ve temiz bir
// tarayıcıda yapar; burada:
//   - Başlangıç sayfası kullanıcının sorumluluğudur: oynatma sayfaya kendisi gitmez. Panel
//     önce ekranı koşunun ilk node'uyla karşılaştırır, farklıysa uyarır; uyarı kartındaki
//     buton sekmeyi başlangıç node'unun adresine getirir (goToAddress). Ekranın tutması yine
//     kullanıcıya kalır (giriş gerektiren sayfa gibi). Görünen alanı oynatma kendisi kurar
//     (fitStart): başlangıç node'unun kaydedildiği boyut, panel ve pencereden bağımsız.
//   - Fare ve klavye DevTools protokolüyle (chrome.debugger) gönderilir: gerçek kullanıcı
//     olayı gibidir (isTrusted), CSS :hover ve sayfanın tuş dinleyicileri çalışır. Chrome
//     oynatma boyunca üstte "hata ayıklama başlatıldı" çubuğu gösterir; çubukta "İptal"e
//     basılırsa oynatma durur.
//   - Elementi bulmak, sayfanın durulmasını beklemek ve parmak izi content.js'tedir (PANELDE
//     OYNATMA); tanımlar kayıttakiyle aynıdır (fingerprint.js).
//   - Doğrulama kayıttaki kuralın aynısıdır: URL şablonu ve edge set'i, şu anki Ayarlar'la
//     birebir aynı olmalı (settings.js > stateCounts, diffCounts).
// Oynatma sürerken background kaydı durdurur (background.js > PANELDE OYNATMA).
// =============================================================================

// Element ve doğrulama için en fazla bekleme (runner'ın --timeout varsayılanı).
const REPLAY_TIMEOUT_MS = 10000;
// Yavaş oynatma: element aksiyondan önce bu süre çerçevelenir, aksiyonlar arasında beklenir.
const REPLAY_FLASH_MS = 500;
const REPLAY_PAUSE_MS = 400;
const REPLAY_STOPPED = 'Oynatma durduruldu.';

// Oynatmayı başlatır. edges: koşunun edge'leri (state'teki biçim: { id, name, source, target,
// actions }), nodes: id -> node, secrets: maskeli alanların değerleri (anahtar: hedefin türü ya da
// selector; bkz. maskedKeys), onUpdate(replay): her adımda ve aksiyonda çağrılır.
// Döner: { stop(), done } ve done şuna çözülür:
//   { status: passed | failed | stopped, endNodeId, tabId, steps: [{ edgeId, name, target,
//     status: pending | running | passed | failed | stopped | skipped, error?, mismatch?,
//     warnings, duration }] }
function startReplay({ tabId, edges, nodes, settings, secrets, slow, onUpdate }) {
  const replay = {
    tabId, tabs: [tabId], settings, secrets, slow,
    steps: edges.map((edge) => ({ edgeId: edge.id, name: edge.name, target: edge.target, status: 'pending', warnings: [] })),
    step: -1, action: -1, actionLabel: '',
    attached: new Set(), emulated: new Set(), opened: [], stopped: false, stopReason: null,
    update: () => onUpdate?.(replay),
  };
  replay.stop = (reason = REPLAY_STOPPED) => {
    replay.stopped = true;
    replay.stopReason ??= reason;
  };
  replay.done = playRun(replay, edges, nodes);
  return replay;
}

async function playRun(replay, edges, nodes) {
  // Sayfanın açtığı sekmeler ('tab' open, by: page); kullanıcı oynatma sırasında açsa da girer.
  const onOpened = ({ sourceTabId, tabId }) => { if (replay.tabs.includes(sourceTabId)) replay.opened.push(tabId); };
  // Hata ayıklama çubuğunda "İptal" ya da sekme kapandı.
  const onDetach = ({ tabId }, reason) => {
    if (!replay.attached.delete(tabId)) return;
    if (reason === 'canceled_by_user') replay.stop('Oynatma durduruldu: hata ayıklama çubuğunda "İptal"e basıldı.');
  };
  chrome.webNavigation.onCreatedNavigationTarget.addListener(onOpened);
  chrome.debugger.onDetach.addListener(onDetach);
  try {
    await attach(replay, replay.tabId);
    await fitStart(replay, nodes.get(edges[0]?.source));
    for (const [i, edge] of edges.entries()) {
      const step = replay.steps[i];
      const started = Date.now();
      Object.assign(replay, { step: i, action: -1, actionLabel: '' });
      step.status = 'running';
      replay.update();
      try {
        for (const [j, action] of edge.actions.entries()) {
          Object.assign(replay, { action: j, actionLabel: action.label });
          replay.update();
          try {
            await playAction(replay, action, step);
            await afterAction(replay);
          } catch (error) {
            if (replay.stopped) throw error;
            throw new Error(`Aksiyon ${j + 1}/${edge.actions.length} ("${action.label}") oynatılamadı: ${error.message}`);
          }
        }
        Object.assign(replay, { action: -1, actionLabel: '' });
        replay.update();
        const verdict = await verify(replay, nodes.get(edge.target));
        if (!verdict.ok) step.mismatch = verdict;
      } catch (error) {
        step.error = replay.stopped ? replay.stopReason : error.message;
      }
      step.duration = Date.now() - started;
      step.status = replay.stopped ? 'stopped' : step.error || step.mismatch ? 'failed' : 'passed';
      // Kalınan ekran: beklenen node'un ekran görüntüsüyle karşılaştırmak için (görünen alan
      // ayarı kaldırılmadan önce).
      if (step.status === 'failed') step.screenshot = await capture(replay);
      replay.update();
      if (step.status !== 'passed') break;
    }
  } catch (error) {
    // Oynatma başlayamadı (sekmeye bağlanılamadı)
    const step = replay.steps[0];
    if (step) Object.assign(step, { status: 'failed', error: error.message, duration: 0 });
  } finally {
    chrome.webNavigation.onCreatedNavigationTarget.removeListener(onOpened);
    chrome.debugger.onDetach.removeListener(onDetach);
    await release(replay);
  }
  for (const step of replay.steps) if (step.status === 'pending') step.status = 'skipped';
  const broken = replay.steps.find((s) => s.status !== 'passed' && s.status !== 'skipped');
  Object.assign(replay, { step: -1, action: -1, actionLabel: '' });
  replay.update();
  return {
    status: broken ? broken.status : 'passed',
    endNodeId: broken ? null : edges.at(-1)?.target ?? null,
    tabId: replay.tabId,
    steps: replay.steps,
  };
}

// Edge set ve URL şablonu karşılaştırması (oynatmanın başında ve her edge'in sonunda).
// diff: sayısı farklı her tür; expected node'daki, actual ekrandaki sayı.
function compareScreen(node, screen, settings) {
  const expected = stateCounts(node.elements, settings);
  const actual = stateCounts(screen.elements, settings);
  const diff = expected && actual ? diffCounts(expected, actual).map(({ key, a, b }) => ({ key, expected: a, actual: b })) : [];
  const url = urlKey(screen.url);
  return { ok: Boolean(expected && actual) && url === node.urlKey && diff.length === 0, url, expectedUrl: node.urlKey, diff, screen };
}

// BAŞLANGIÇ BOYUTU: oynatma, başlangıç node'unun kaydedildiği görünen alanda başlar. State ekrana
// sığan elementlerden oluştuğu için boyut piksel piksel tutmalı. Pencereyi büyütmek yan panel,
// kenarlıklar ve ekran ölçeği yüzünden birkaç piksel kaçırabilir (eklenti panelin genişliğini
// değiştiremez); bu yüzden 'resize' aksiyonu gibi taklit kullanılır (DevTools'un cihaz modu):
// panelden ve pencereden bağımsızdır, oynatma bitince kaldırılır (release).
//   1. Piksel oranı = ekran ölçeği × yakınlaştırma: oran farklıysa sekmenin yakınlaştırması
//      ayarlanır (Chrome bunu site başına saklar, oynatmadan sonra da kalır).
//   2. Taklidin boyutu ekran pikseli, görünen alan CSS pikselidir; yakınlaştırmada ikisi ayrılır.
//      Boyut kurulur, ölçülür, kalan fark yakınlaştırmayla çarpılıp düzeltilir.
// Sonra ekran başlangıç node'uyla karşılaştırılır: tutmazsa ilk adıma uyarı yazılır, oynatma
// sürer (uyarı kartındaki "Yine de oynat" gibi; ilk edge'in doğrulaması asıl sonucu verir).
async function fitStart(replay, start) {
  if (!start?.viewport) return;
  const target = start.viewport;
  const measure = async () => { await pause(replay, 200); return (await chrome.tabs.sendMessage(replay.tabId, { type: 'GET_FINGERPRINT' }, { frameId: 0 })).viewport; };
  let now = await measure();
  if (Math.abs(now.devicePixelRatio - target.devicePixelRatio) > 0.001) {
    const screenScale = now.devicePixelRatio / await chrome.tabs.getZoom(replay.tabId);
    await chrome.tabs.setZoom(replay.tabId, target.devicePixelRatio / screenScale);
    now = await measure();
  }
  const zoom = await chrome.tabs.getZoom(replay.tabId);
  let size = { width: Math.round(target.width * zoom), height: Math.round(target.height * zoom) };
  for (let attempt = 0; attempt < 3; attempt++) {
    await cdp(replay, 'Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 0, mobile: false });
    replay.emulated.add(replay.tabId);
    now = await measure();
    if (now.width === target.width && now.height === target.height) break;
    size = { width: size.width + Math.round((target.width - now.width) * zoom), height: size.height + Math.round((target.height - now.height) * zoom) };
  }
  const step = replay.steps[0];
  if (now.width !== target.width || now.height !== target.height) {
    step.warnings.push(`Görünen alan tam tutturulamadı: "${start.name}" ${target.width}×${target.height} boyutunda kaydedildi, ulaşılan ${now.width}×${now.height}.`);
  }
  const check = compareScreen(start, await inPage(replay, { op: 'settled' }), replay.settings);
  if (!check.ok) step.warnings.push(`Oynatma başında ekran "${start.name}" node'una uymuyor: koşu doğru sonuç vermeyebilir.`);
}

// BAŞLANGIÇ NODE'UNUN ADRESİNE GİTMEK (uyarı kartındaki "Başlangıç node'una dön"). Sekme adrese
// gider, yeni sayfa durulunca ekranı döner. Site başka bir adrese yönlendirebilir (giriş
// gerektiren sayfa); varılan adres ekranda (url) döner, karşılaştırmayı panel yapar. Gezinme
// kayıt sekmesindeyse adres çubuğuna yazmak gibi kaydedilir (background.js > navigateAction).
async function goToAddress(tabId, url) {
  await chrome.runtime.sendMessage({ type: 'RECORD_NAVIGATE', tabId, url });
  const committed = new Promise((resolve) => {
    const timer = setTimeout(done, REPLAY_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      resolve();
    }
    function onCommitted(details) {
      if (details.tabId === tabId && details.frameId === 0) done();
    }
    chrome.webNavigation.onCommitted.addListener(onCommitted);
  });
  await chrome.tabs.update(tabId, { url });
  await committed; // eski sayfanın content.js'i artık cevap vermez
  const deadline = Date.now() + REPLAY_TIMEOUT_MS;
  for (;;) {
    const tab = await chrome.tabs.get(tabId);
    const screen = tab.status === 'complete'
      ? await chrome.tabs.sendMessage(tabId, { type: 'REPLAY', op: 'settled' }, { frameId: 0 }).catch(() => null)
      : null;
    if (screen && !screen.error) return screen;
    if (Date.now() > deadline) throw new Error('sayfa yüklenmedi ya da sayfaya ulaşılamadı.');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// Koşudaki maskeli (******) alanların anahtarları: oynatmadan önce kullanıcıya sorulur.
function maskedKeys(edges) {
  const keys = edges.flatMap((e) => e.actions).filter((a) => a.type === 'input' && a.value === '******').map((a) => a.target?.key ?? a.selector);
  return [...new Set(keys)];
}


// -----------------------------------------------------------------------------
// AKSİYONLAR (runner/lib/actions.js ile aynı tablo)
// -----------------------------------------------------------------------------

async function playAction(replay, action, step) {
  switch (action.type) {
    case 'click': return click(replay, action, step);
    case 'contextmenu': return click(replay, action, step, 'right');
    case 'hover': return moveMouse(replay, await locate(replay, action, step));
    case 'focus': return focus(replay, action, step);
    case 'input': return fill(replay, action, step);
    case 'enter':
      await focus(replay, action, step);
      return press(replay, 'Enter');
    case 'key': return pressKey(replay, action, step);
    case 'scroll': {
      const result = await inPage(replay, { op: 'scroll', selector: action.selector, x: action.x, y: action.y });
      if (result.missing) throw new Error(`kaydırılan kutu bulunamadı (${action.selector}).`);
      return;
    }
    case 'navigate': return navigate(replay, () => chrome.tabs.update(replay.tabId, { url: action.url }));
    case 'history': return history(replay, action);
    case 'reload': return navigate(replay, () => chrome.tabs.reload(replay.tabId));
    case 'resize': return resize(replay, action.viewport);
    case 'zoom': return chrome.tabs.setZoom(replay.tabId, action.zoom);
    // Ekranı değiştiren bekleme biraz geç sonuçlansa da doğrulamadaki tekrar deneme onu yakalar.
    case 'wait': return pause(replay, action.ms);
    case 'tab': return tab(replay, action);
    default: throw new Error(`"${action.type}" aksiyonu henüz oynatılamıyor.`);
  }
}

// Elementin tıklanacak noktası ve türü. Element sayfa durulduktan sonra da gelebilir ya da bir
// süre başka bir katmanın altında kalabilir: timeout boyunca tekrar denenir. Kayıttaki hedef yok
// ama selector bulduysa uyarılır. flash: yavaş oynatmada vurgulansın mı.
async function locate(replay, action, step, flash = true) {
  const deadline = Date.now() + REPLAY_TIMEOUT_MS;
  for (;;) {
    const found = await inPage(replay, { op: 'locate', ...ref(action), highlight: flash && replay.slow ? REPLAY_FLASH_MS : 0 });
    if (!found.missing && !found.covered) {
      if (found.viaSelector) warnSelector(action, step);
      return found;
    }
    if (Date.now() > deadline) {
      const target = action.target ? `${action.target.key} #${action.target.index}` : 'hedef yok';
      if (found.covered) throw new Error(`element başka bir katmanın altında (${target}).`);
      throw new Error(`element bulunamadı (${target}, selector: ${action.selector ?? 'yok'}).`);
    }
    await pause(replay, 200);
  }
}

async function focus(replay, action, step) {
  await locate(replay, action, step); // ekranda olana kadar bekle (ve vurgula)
  const result = await inPage(replay, { op: 'focus', ...ref(action) });
  if (result.missing) throw new Error('element odaklanamadı.');
}

function ref({ target, selector }) {
  return { target, selector };
}

function warnSelector(action, step) {
  const text = `"${action.label}": hedef (${action.target.key} #${action.target.index}) ekranda yok, selector kullanıldı (${action.selector}).`;
  if (!step.warnings.includes(text)) step.warnings.push(text);
}

// Kayıttaki değer alanın türüne göre: açılır liste (seçenek değeri), checkbox / radio (işaretli
// mi; değilse tıklanır), metin (içerik seçilip yerine yazılır; boşsa silinir).
async function fill(replay, action, step) {
  const value = valueOf(action, replay.secrets);
  const found = await locate(replay, action, step);
  if (found.kind === 'select') return inPage(replay, { op: 'choose', ...ref(action), value });
  if (found.kind === 'check') return found.checked === Boolean(value) ? undefined : click(replay, action, step);
  const focused = await inPage(replay, { op: 'focus', ...ref(action), select: true });
  if (focused.missing) throw new Error('element odaklanamadı.');
  const text = String(value ?? '');
  if (text) await cdp(replay, 'Input.insertText', { text });
  else await press(replay, 'Delete');
}

// Şifre alanları kayıtta "******" olarak saklanır; gerçek değeri kullanıcı oynatmadan önce girer.
function valueOf(action, secrets) {
  if (action.value !== '******') return action.value;
  const secret = secrets[action.target?.key] ?? secrets[action.selector];
  if (secret === undefined || secret === '') throw new Error(`değer maskeli (******); oynatmadan önce "${action.target?.key ?? action.selector}" değerini girin.`);
  return secret;
}

// Tuş, kayıttaki gibi Playwright biçimindedir ("Escape", "Control+Enter"); count kez basılır.
// Hedef yoksa (odakta bir element yoktu) sayfaya basılır.
async function pressKey(replay, action, step) {
  if (action.target || action.selector) await focus(replay, action, step);
  for (let i = 0; i < (action.count ?? 1); i++) await press(replay, action.key);
}

// Geri/İleri: kayıt yönü bilmez, varılan adresi bilir (runner'daki gibi).
async function history(replay, { url }) {
  const now = async () => (await chrome.tabs.get(replay.tabId)).url;
  await navigate(replay, () => chrome.tabs.goBack(replay.tabId));
  if (await now() === url) return;
  await navigate(replay, () => chrome.tabs.goForward(replay.tabId)).catch(() => { });
  await navigate(replay, () => chrome.tabs.goForward(replay.tabId)).catch(() => { });
  if (await now() !== url) await navigate(replay, () => chrome.tabs.update(replay.tabId, { url }));
}

async function navigate(replay, go) {
  await go();
  await loaded(replay);
}

// Pencere boyutu: görünen alan kayıttaki boyuta ayarlanır (DevTools'taki cihaz modu gibi);
// oynatma bitince kaldırılır.
async function resize(replay, viewport) {
  await cdp(replay, 'Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 0, mobile: false });
  replay.emulated.add(replay.tabId);
}


// -----------------------------------------------------------------------------
// SEKMELER (runner/lib/actions.js > SEKMELER ile aynı kural: sekme adresiyle bulunur)
// -----------------------------------------------------------------------------

async function tab(replay, action) {
  if (action.operation === 'open') return openTab(replay, action);
  if (action.operation === 'switch') {
    if (sameAddress((await chrome.tabs.get(replay.tabId)).url, action.url)) return;
    return activate(replay, await otherTab(replay, action));
  }
  const id = action.active ? replay.tabId : await otherTab(replay, action);
  replay.tabs = replay.tabs.filter((t) => t !== id);
  replay.attached.delete(id);
  await chrome.tabs.remove(id);
  if (action.active && replay.tabs.length) await activate(replay, replay.tabs.at(-1));
}

// Sayfanın açtığı sekme önceki aksiyonla açılmıştır (henüz oynatmaya katılmamış, açılan ilk
// sekme). Kullanıcının açtığı sekme yenidir; kayıttaki adrese gidilir.
async function openTab(replay, { by, url, label }) {
  let id;
  if (by === 'page') {
    const deadline = Date.now() + REPLAY_TIMEOUT_MS;
    while ((id = replay.opened.find((t) => !replay.tabs.includes(t))) === undefined) {
      if (Date.now() > deadline) throw new Error(`"${label}": sayfanın açacağı sekme açılmadı.`);
      await pause(replay, 100);
    }
  } else {
    id = (await chrome.tabs.create({ url: /^https?:/.test(url) ? url : undefined, active: true })).id;
  }
  await activate(replay, id);
  await loaded(replay);
}

async function activate(replay, id) {
  replay.tabs = [...replay.tabs.filter((t) => t !== id), id];
  replay.tabId = id;
  const tab = await chrome.tabs.update(id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await attach(replay, id);
}

async function otherTab(replay, action) {
  const others = replay.tabs.filter((t) => t !== replay.tabId);
  const urls = await Promise.all(others.map((t) => chrome.tabs.get(t).then((x) => x.url, () => null)));
  const matching = others.filter((_, i) => urls[i] && sameAddress(urls[i], action.url));
  const id = matching.at(-1) ?? (others.length === 1 ? others[0] : undefined);
  if (id === undefined) throw new Error(`"${action.label}": ${action.url} adresinde açık bir sekme yok.`);
  return id;
}

function sameAddress(a, b) {
  try {
    return urlKey(a) === urlKey(b);
  } catch {
    return a === b;
  }
}


// -----------------------------------------------------------------------------
// FARE VE KLAVYE (DevTools protokolü: Input.dispatchMouseEvent / dispatchKeyEvent)
// -----------------------------------------------------------------------------

// Koordinatlar sayfanın CSS pikselidir (content.js > clickPoint); tarayıcı yakınlaştırması
// varken de protokol aynı birimi bekler (%150 yakınlaştırmada denendi).
async function moveMouse(replay, { x, y }) {
  await cdp(replay, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
}

// Fare önce elementin üzerine gelir; bu, sayfanın düzenini değiştirebilir (üzerinde durulan menü
// kapanır, alttaki link kayar). Nokta değiştiyse ya da üstü kapandıysa yeniden bulunur, tıklama
// elementin o anki yerine yapılır (Playwright da tıklamadan önce elementin durmasını bekler).
async function click(replay, action, step, button = 'left') {
  let point = await locate(replay, action, step);
  for (let moves = 0; ; moves++) {
    await moveMouse(replay, point);
    const now = await locate(replay, action, step, false);
    if ((now.x === point.x && now.y === point.y) || moves >= 3) {
      point = now;
      break;
    }
    point = now;
  }
  const at = { x: point.x, y: point.y };
  const buttons = button === 'left' ? 1 : 2;
  await cdp(replay, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
  await cdp(replay, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button, buttons, clickCount: 1 });
  await cdp(replay, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button, buttons: 0, clickCount: 1 });
}

const KEY_CODES = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46, ContextMenu: 93,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 112 + i])),
};
const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

// "Control+Shift+ArrowDown" -> tuş ve değiştirici bitleri. "Control++": tuşun kendisi "+".
function parseKey(combo) {
  const parts = combo.split('+');
  let key = parts.pop();
  if (key === '') {
    parts.pop();
    key = '+';
  }
  return { key, modifiers: parts.reduce((bits, part) => bits | (MODIFIER_BITS[part] ?? 0), 0) };
}

// Tek karakterli tuş yazı da yazar (Ctrl/Alt/Cmd ile değilse); Enter satır sonu yazar (form gönderir).
async function press(replay, combo) {
  const { key, modifiers } = parseKey(combo);
  const name = key === 'Space' ? ' ' : key;
  const single = [...name].length === 1;
  const keyCode = KEY_CODES[key] ?? (single ? name.toUpperCase().charCodeAt(0) : 0);
  const code = key === 'Space' ? 'Space' : !single ? key : /[a-z]/i.test(name) ? `Key${name.toUpperCase()}` : /\d/.test(name) ? `Digit${name}` : '';
  const text = key === 'Enter' ? '\r' : single && !(modifiers & (MODIFIER_BITS.Alt | MODIFIER_BITS.Control | MODIFIER_BITS.Meta)) ? name : undefined;
  const base = { key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
  await cdp(replay, 'Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text && { text, unmodifiedText: text }) });
  await cdp(replay, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}


// -----------------------------------------------------------------------------
// SAYFA VE SEKME
// -----------------------------------------------------------------------------

async function attach(replay, tabId) {
  if (replay.attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (error) {
    throw new Error(`Sekmeye bağlanılamadı: ${error.message}`);
  }
  replay.attached.add(tabId);
}

function cdp(replay, method, params) {
  return chrome.debugger.sendCommand({ tabId: replay.tabId }, method, params);
}

// Aktif sekmenin görünen alanı; node'ların ekran görüntüsüyle aynı biçimde (background.js >
// takeScreenshot). DevTools protokolüyle oynatmanın bağlı olduğu sekmeden alınır
// (captureVisibleTab penceredeki seçili sekmeyi alır: kullanıcı başka sekmeye geçtiyse yanlış
// ekran gelirdi). Taklit edilen boyutun tamamı çizilir. Alınamazsa null.
async function capture(replay) {
  try {
    const { data } = await cdp(replay, 'Page.captureScreenshot', { format: 'jpeg', quality: 40 });
    return `data:image/jpeg;base64,${data}`;
  } catch {
    return null;
  }
}

// Pencere boyutu ayarını kaldırır, sekmelerden ayrılır (çubuk kalkar).
async function release(replay) {
  for (const tabId of replay.emulated) {
    if (replay.attached.has(tabId)) await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride').catch(() => { });
  }
  for (const tabId of replay.attached) await chrome.debugger.detach({ tabId }).catch(() => { });
  replay.attached.clear();
}

// content.js'e istek (PANELDE OYNATMA). Sayfa değişirken (aksiyon bir gezinme başlattıysa) istek
// yarıda kalır ya da yeni sayfada content.js henüz yüklenmemiştir: timeout boyunca tekrar denenir.
async function inPage(replay, request) {
  const deadline = Date.now() + REPLAY_TIMEOUT_MS;
  for (;;) {
    checkStopped(replay);
    let response;
    let failure = null;
    try {
      response = await chrome.tabs.sendMessage(replay.tabId, { type: 'REPLAY', ...request }, { frameId: 0 });
    } catch (error) {
      failure = error;
    }
    if (response?.error) throw new Error(response.error);
    if (response) return response;
    if (Date.now() > deadline) {
      throw new Error(`sayfaya ulaşılamadı${failure ? ` (${failure.message})` : ''}. Sayfa eklenti yüklenmeden önce açıldıysa yenileyin.`);
    }
    await pause(replay, 200);
  }
}

// Aksiyondan sonra sayfanın durulması (kayıtta da her aksiyon öncekinin etkisi durulduktan
// sonra yapılmıştı). Yavaş oynatmada ayrıca kısa bir ara.
async function afterAction(replay) {
  await loaded(replay);
  await inPage(replay, { op: 'settled' });
  if (replay.slow) await pause(replay, REPLAY_PAUSE_MS);
}

// Varılan ekran beklenen node mu? Sayfa geç yüklenebilir: eşleşene kadar timeout boyunca.
async function verify(replay, node) {
  const deadline = Date.now() + REPLAY_TIMEOUT_MS;
  for (;;) {
    const screen = await inPage(replay, { op: 'settled' });
    const result = compareScreen(node, screen, replay.settings);
    if (result.ok || Date.now() > deadline) return result;
    await pause(replay, 500);
  }
}

// Sekme yükleniyorsa bitmesini bekler.
async function loaded(replay) {
  const deadline = Date.now() + REPLAY_TIMEOUT_MS;
  while ((await chrome.tabs.get(replay.tabId)).status === 'loading') {
    if (Date.now() > deadline) throw new Error('sayfa yüklenmesi bitmedi.');
    await pause(replay, 100);
  }
}

async function pause(replay, ms) {
  const end = Date.now() + ms;
  for (let left = ms; left > 0; left = end - Date.now()) {
    checkStopped(replay);
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, left)));
  }
  checkStopped(replay);
}

function checkStopped(replay) {
  if (replay.stopped) throw new Error(replay.stopReason ?? REPLAY_STOPPED);
}
