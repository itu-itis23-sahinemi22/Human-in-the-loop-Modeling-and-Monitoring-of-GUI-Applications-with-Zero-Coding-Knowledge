// =============================================================================
// monitor-dialog.js — MONİTÖR EKLE / DÜZENLE FORMU
// -----------------------------------------------------------------------------
// Monitör modülünün form parçası (dosya düzeni: monitor-store.js başlığı). İki adım: tür kartları
// (monitor-types.js kataloğundan), sonra kapsam (tüm model / node / edge ve edge'deki aksiyon),
// parametreler (tanımdan üretilen alanlar; element listesi, hazır desen çipleri, canlı deneme),
// etkin anahtarı, isim ve özet cümlesi. Kaydedilmemiş değişiklikte kapatmadan önce sorar.
// Detay: docs/07-monitorler.md > Kullanım
// =============================================================================

const MONITOR_DIALOG_HTML = `
  <div class="dialog-body">
    <div class="title-row">
      <h2 id="monitor-title">Monitör ekle</h2>
      <button id="btn-monitor-close" class="icon" title="Kapat" aria-label="Kapat">✕</button>
    </div>
    <div id="monitor-step-type">
      <p class="hint">Ne kontrol edilsin? Bir tür seçin; ayrıntılar sonraki adımda. Etiket, kontrol biçimini söyler: state tabanlı (ekrana varınca) ya da aksiyon tabanlı (aksiyondan sonra).</p>
      <input id="monitor-search" type="search" placeholder="Ara: hata, yazı, desen, süre…" autocomplete="off" spellcheck="false" aria-label="Tür ara">
      <div id="monitor-cards"></div>
      <p id="monitor-cards-empty" class="hint" hidden>Aramaya uyan tür yok.</p>
      <div class="toolbar">
        <button id="btn-monitor-cancel-type">Vazgeç</button>
      </div>
    </div>
    <div id="monitor-step-params" hidden>
      <div id="monitor-type-head" class="type-head">
        <div class="type-text"><b id="monitor-type-name"></b><small id="monitor-type-hint"></small></div>
        <button id="btn-monitor-change-type" class="small-btn">Türü değiştir</button>
      </div>
      <fieldset id="monitor-scope-set">
        <legend>Kapsam</legend>
        <label class="option"><input type="radio" name="monitor-scope" value="global"> <span>Tüm model: her node'da kontrol edilir</span></label>
        <label class="option"><input type="radio" name="monitor-scope" value="node"> <span>Yalnızca bu node:</span> <select id="monitor-node" aria-label="Node"></select></label>
        <label class="option"><input type="radio" name="monitor-scope" value="edge"> <span>Yalnızca bu edge:</span> <select id="monitor-edge" aria-label="Edge"></select></label>
        <label class="option action-row" id="monitor-action-row"><span>Edge'deki aksiyon:</span> <select id="monitor-action" aria-label="Edge'deki aksiyon"></select></label>
        <p class="hint action-hint" id="monitor-action-hint"></p>
        <p id="monitor-scope-hint" class="hint" hidden></p>
      </fieldset>
      <fieldset id="monitor-params-set">
        <legend>Parametreler</legend>
        <div id="monitor-params"></div>
      </fieldset>
      <fieldset>
        <legend>Diğer</legend>
        <div class="alarm-row">
          <label class="switch" title="Kapalıysa monitör tanımlı kalır, kontrol edilmez"><input type="checkbox" id="monitor-enabled" role="switch" checked><span class="track" aria-hidden="true"></span><span>Etkin</span></label>
        </div>
        <label class="field"><span>İsim</span> <input id="monitor-name" spellcheck="false" placeholder="boş bırakılırsa kendiliğinden"></label>
      </fieldset>
      <p id="monitor-summary" class="summary" aria-live="polite"></p>
      <p id="monitor-error" class="message error" hidden></p>
      <div class="toolbar">
        <button id="btn-monitor-save" class="primary">Kaydet</button>
        <button id="btn-monitor-cancel">Vazgeç</button>
      </div>
    </div>
  </div>`;

const MONITOR_UNSAVED_HTML = `
  <div class="dialog-body">
    <p id="monitor-unsaved-text">Monitör kaydedilmedi. Kaydetmeden çıkılsın mı?</p>
    <div class="toolbar">
      <button id="btn-monitor-unsaved-discard" class="danger">Kaydetmeden çık</button>
      <button id="btn-monitor-unsaved-back">Geri dön</button>
    </div>
  </div>`;

(function mountMonitorDialogUi() {
  const dialog = document.createElement('dialog');
  dialog.id = 'monitor-dialog';
  dialog.className = 'settings monitor-dialog';
  dialog.setAttribute('aria-labelledby', 'monitor-title');
  dialog.innerHTML = MONITOR_DIALOG_HTML;
  document.body.append(dialog);

  const unsaved = document.createElement('dialog');
  unsaved.id = 'monitor-unsaved-dialog';
  unsaved.className = 'alert';
  unsaved.setAttribute('aria-labelledby', 'monitor-unsaved-text');
  unsaved.innerHTML = MONITOR_UNSAVED_HTML;
  document.body.append(unsaved);
})();


// -----------------------------------------------------------------------------
// FORM PENCERESİ: ekle / düzenle. Alanlar monitor-types.js'teki tanımdan üretilir.
// -----------------------------------------------------------------------------

let editingId = null;       // düzenlenen monitörün id'si; yeni monitörde null
let editingOrphan = false;  // düzenlenen monitör sahipsiz: kullanıcı yeni öğe seçmeli
let dialogTypeId = null;    // 2. adımdaki tür; 1. adımda null
let dialogScope = 'global'; // 2. adıma geçerken uygulanacak kapsam ('global', node id ya da edge id)
let dialogInitial = null;   // açılıştaki taslak (kaydedilmemiş değişiklik kontrolü için)
let dialogClean = true;     // pencere bilerek kapatılıyor (kaydedildi / vazgeçildi)

// id verilirse o monitör düzenlenir (2. adım); scope verilirse ('global', node id ya da edge id)
// yeni monitör o kapsamla açılır (1. adım: tür seçimi).
function openMonitorDialog({ id = null, scope = null } = {}) {
  const existing = id ? monitorById(id) : null;
  editingId = existing?.id ?? null;
  editingOrphan = Boolean(existing && isOrphan(existing));
  dialogScope = existing?.scope ?? scope ?? (selectedItem() ? selectedId : 'global');
  dialogClean = false;
  $('monitor-title').textContent = existing ? 'Monitörü düzenle' : 'Monitör ekle';
  $('btn-monitor-change-type').hidden = Boolean(existing); // tür değişmez: parametreleri başka türe taşınamaz
  showDialogError(null);
  $('monitor-dialog').showModal();
  if (existing) showParamsStep(existing.type, existing);
  else showTypeStep();
}

// 1. ADIM: tür kartları (gruplu, aranabilir)
function showTypeStep() {
  dialogTypeId = null;
  dialogInitial = null;
  $('monitor-step-type').hidden = false;
  $('monitor-step-params').hidden = true;
  $('monitor-search').value = '';
  renderTypeCards('');
  $('monitor-search').focus();
}

function renderTypeCards(query) {
  const q = query.trim().toLocaleLowerCase('tr');
  const matches = (type) => !q || [type.text, type.hint, type.id, MONITOR_WHEN[type.when]?.text ?? ''].some((s) => s.toLocaleLowerCase('tr').includes(q));
  const groups = MONITOR_GROUPS.map((group) => ({ group, types: MONITOR_TYPES.filter((t) => t.group === group.id && matches(t)) })).filter((g) => g.types.length);
  $('monitor-cards').replaceChildren(...groups.flatMap(({ group, types }) => {
    const title = document.createElement('h4');
    title.className = 'type-group';
    title.append(iconElement(group, true), group.text);
    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.append(...types.map((type) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'type-card';
      card.dataset.type = type.id;
      card.append(iconElement(group));
      card.insertAdjacentHTML('beforeend', '<span class="type-title"></span><span class="type-tags"><span class="when"></span></span><span class="type-desc"></span>');
      card.querySelector('.type-title').textContent = type.text;
      card.querySelector('.when').textContent = MONITOR_WHEN[type.when]?.text ?? '';
      card.querySelector('.when').title = MONITOR_WHEN[type.when]?.hint ?? '';
      card.querySelector('.when').classList.add(type.when);
      card.querySelector('.type-desc').textContent = type.hint;
      card.onclick = () => showParamsStep(type.id);
      return card;
    }));
    return [title, cards];
  }));
  $('monitor-cards-empty').hidden = groups.length > 0;
}

$('monitor-search').oninput = () => renderTypeCards($('monitor-search').value);
$('btn-monitor-change-type').onclick = showTypeStep;

// 2. ADIM: seçilen türün kapsamı, parametreleri ve alarmı (existing verilirse değerleri onunla dolar)
function showParamsStep(typeId, existing = null) {
  const type = monitorType(typeId);
  dialogTypeId = type.id;
  $('monitor-step-type').hidden = true;
  $('monitor-step-params').hidden = false;

  const head = $('monitor-type-head');
  head.querySelector('.type-icon')?.remove();
  head.prepend(iconElement(monitorGroup(type)));
  $('monitor-type-name').textContent = type.text;
  $('monitor-type-hint').textContent = `${type.hint} ${MONITOR_WHEN[type.when]?.hint ?? ''}`;

  // Node ve edge listeleri: graph'taki öğeler oluşturulma sırasıyla; sahipsiz monitörün öğesi listede yok
  $('monitor-node').replaceChildren(...state.nodes.map((n) => new Option(n.name, n.id)));
  $('monitor-edge').replaceChildren(...state.edges.map((e) => new Option(edgeLabel(e), e.id)));
  const kind = scopeKind(dialogScope);
  setScopeRadio(kind === 'node' || kind === 'edge' ? kind : existing && kind === 'orphan' ? 'node' : 'global');
  if (kind === 'node') $('monitor-node').value = dialogScope;
  if (kind === 'edge') $('monitor-edge').value = dialogScope;

  const values = { ...monitorDefaults(type), ...(existing?.params ?? {}) };
  $('monitor-params').replaceChildren(...type.params.map((p) => paramField(p, values[p.key])));
  $('monitor-params-set').hidden = !type.params.length;
  $('monitor-enabled').checked = existing?.enabled ?? true;
  $('monitor-name').value = existing?.name ?? '';
  renderScopeState();
  showDialogError(null); // önce temizle: aşağıdaki aksiyon listesi "aksiyon artık yok" uyarısı koyabilir
  renderActionPicks(existing?.action ?? null);
  renderElementPicks();
  renderSummary();
  dialogInitial = JSON.stringify(draftMonitor());
  ($('monitor-params').querySelector('input:not([type="checkbox"]), select') ?? $('monitor-name')).focus();
}

function scopeRadio() {
  return $('monitor-dialog').querySelector('input[name="monitor-scope"]:checked')?.value ?? 'global';
}

function setScopeRadio(value) {
  for (const radio of $('monitor-dialog').querySelectorAll('input[name="monitor-scope"]')) radio.checked = radio.value === value;
}

// Türün kapsam kısıtı (monitor-types.js > scope): izin vermediği seçenekler kapalı; graph'ta node
// ya da edge yoksa o seçenek de kapalı.
function renderScopeState() {
  const type = monitorType(dialogTypeId);
  const allowed = monitorScopes(type);
  const radios = Object.fromEntries([...$('monitor-dialog').querySelectorAll('input[name="monitor-scope"]')].map((r) => [r.value, r]));
  radios.global.disabled = !allowed.global;
  radios.node.disabled = !allowed.node || !state.nodes.length;
  radios.edge.disabled = !allowed.edge || !state.edges.length;
  if (radios[scopeRadio()].disabled) {
    const open = ['global', 'node', 'edge'].find((value) => !radios[value].disabled);
    if (open) radios[open].checked = true;
  }
  $('monitor-node').disabled = scopeRadio() !== 'node' || radios.node.disabled;
  $('monitor-edge').disabled = scopeRadio() !== 'edge' || radios.edge.disabled;
  $('monitor-action-row').hidden = scopeRadio() !== 'edge' || radios.edge.disabled;
  $('monitor-action-hint').hidden = $('monitor-action-row').hidden;
  const names = { global: 'tüm model', node: 'tek node', edge: 'tek edge' };
  const allowedNames = Object.keys(allowed).filter((k) => allowed[k]).map((k) => names[k]);
  const hint = [
    allowedNames.length < 3 ? `Bu tür yalnızca ${allowedNames.join(' ya da ')} için tanımlanır.` : '',
    !state.nodes.length ? 'Graph\'ta henüz node yok; node ya da edge monitörü için önce kayıt yapın.' : '',
    editingOrphan ? 'Bu monitörün öğesi artık yok (sahipsiz): listeden yeni bir node ya da edge seçin ya da tüm modele alın.' : '',
  ].filter(Boolean).join(' ');
  $('monitor-scope-hint').textContent = hint;
  $('monitor-scope-hint').hidden = !hint;
}

// Bir parametre alanı: etiket + girdi; regex için hazır desen çipleri ve canlı deneme kutusu;
// element için node'un kaydedilmiş elementlerinden seçme listesi. Hata metni alanın altında.
function paramField(param, value) {
  const wrap = document.createElement('div');
  wrap.className = 'monitor-param';
  wrap.dataset.key = param.key;
  const label = document.createElement('label');
  if (param.kind === 'checkbox') {
    label.className = 'option';
    label.innerHTML = '<input type="checkbox"> <span></span>';
    label.querySelector('input').checked = Boolean(value);
  } else if (param.kind === 'select') {
    label.className = 'option';
    label.innerHTML = '<span></span> <select></select>';
    label.querySelector('select').replaceChildren(...param.options.map((o) => new Option(o.text, o.value)));
    label.querySelector('select').value = value;
  } else {
    label.className = 'field';
    label.innerHTML = '<span></span> <input spellcheck="false">';
    const input = label.querySelector('input');
    input.type = param.kind === 'number' ? 'number' : 'text';
    if (param.kind === 'number') {
      if (param.min !== undefined) input.min = param.min;
      if (param.max !== undefined) input.max = param.max;
      if (param.step !== undefined) input.step = param.step;
    }
    input.placeholder = param.placeholder ?? '';
    input.value = value ?? '';
    input.classList.toggle('mono', param.kind === 'regex');
  }
  label.querySelector('span').textContent = param.text + (param.required ? '' : ' (isteğe bağlı)');
  wrap.append(label);

  if (param.element) {
    const pick = document.createElement('select');
    pick.className = 'element-pick';
    pick.setAttribute('aria-label', `${param.text}: sayfadaki elementlerden seç`);
    pick.onchange = () => {
      if (!pick.value) return;
      const input = label.querySelector('input');
      input.value = pick.value;
      pick.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    wrap.append(pick);
  }

  if (param.kind === 'regex') {
    const tools = document.createElement('div');
    tools.className = 'regex-tools';
    if (param.presets?.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.append(...param.presets.map((preset) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = preset.text;
        chip.title = preset.value;
        chip.onclick = () => {
          const input = label.querySelector('input');
          input.value = preset.value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        };
        return chip;
      }));
      tools.append(chips);
    }
    const tester = document.createElement('label');
    tester.className = 'field tester';
    tester.innerHTML = '<span>Dene</span> <input spellcheck="false" maxlength="200" placeholder="örnek bir değer yazın"><em class="test-result"></em>'; // örnek kısa: ağır desen paneli kilitlemesin
    tester.querySelector('input').oninput = () => updateTester(wrap);
    tools.append(tester);
    const warn = document.createElement('p');
    warn.className = 'field-warn';
    warn.hidden = true;
    tools.append(warn);
    wrap.append(tools);
  }

  const error = document.createElement('p');
  error.className = 'field-error';
  error.hidden = true;
  wrap.append(error);
  wrap.addEventListener('input', () => { error.hidden = true; if (param.kind === 'regex') updateTester(wrap); });
  if (param.kind === 'regex') updatePatternWarning(wrap);
  return wrap;
}

// Ağır desen uyarısı (monitor-types.js > monitorPatternWarning), desenin altında
function updatePatternWarning(wrap) {
  const warn = wrap.querySelector('.field-warn');
  if (!warn) return;
  const text = monitorPatternWarning(wrap.querySelector('.field:not(.tester) input').value);
  warn.textContent = text ?? '';
  warn.hidden = !text;
}

// Canlı deneme: desen ile örnek değer eşleşiyor mu?
function updateTester(wrap) {
  updatePatternWarning(wrap);
  const pattern = wrap.querySelector('.field:not(.tester) input').value;
  const sample = wrap.querySelector('.tester input').value;
  const result = wrap.querySelector('.test-result');
  result.className = 'test-result';
  result.textContent = '';
  if (!pattern || !sample) return;
  try {
    const ok = new RegExp(pattern).test(sample);
    result.classList.add(ok ? 'ok' : 'fail');
    result.textContent = ok ? '✓ uyuyor' : '✗ uymuyor';
  } catch {
    result.classList.add('invalid');
    result.textContent = 'desen geçersiz';
  }
}

// İKİNCİ KATMAN: seçili edge'in aksiyon listesi. "" = edge'in tamamı (her aksiyondan sonra);
// değer = aksiyonun sırası. Düzenlemede kayıtlı aksiyon edge'de yeniden bulunur (resolveMonitorAction).
function renderActionPicks(ref = undefined) {
  const select = $('monitor-action');
  const previous = select.value;
  const edge = edgeById($('monitor-edge').value);
  const actions = edge?.actions ?? [];
  select.replaceChildren(new Option(actions.length ? 'Edge\'in tamamı (her aksiyondan sonra)' : 'Edge\'de aksiyon yok', ''));
  select.append(...actions.map((a, i) => new Option(actionText(a, i) + (a.target?.key ? ` (${a.target.key})` : ''), String(i))));
  if (ref !== undefined) {
    const i = ref ? resolveMonitorAction(ref, actions) : -1;
    select.value = i >= 0 ? String(i) : '';
    if (ref && i < 0) showDialogError(`Monitörün aksiyonu (${ref.index + 1}. ${ref.label}) bu edge'de artık yok; listeden yeniden seçin.`);
  } else {
    select.value = [...select.options].some((o) => o.value === previous) ? previous : '';
  }
  renderActionHint();
}

function renderActionHint() {
  const edge = edgeById($('monitor-edge').value);
  const i = $('monitor-action').value === '' ? -1 : Number($('monitor-action').value);
  const action = edge?.actions?.[i];
  $('monitor-action-hint').textContent = !edge?.actions?.length ? ''
    : i < 0 ? `Bu edge'de ${edge.actions.length} aksiyon var. Belirli bir aksiyondan hemen sonra kontrol için (ör. kullanıcı adı yazılınca) listeden seçin; seçilmezse her aksiyondan sonra kontrol edilir.`
      : `Yalnızca bu aksiyondan hemen sonra kontrol edilir (bir sonraki aksiyon oynatılmadan).${action.type === 'input' && action.target?.key ? ` Alan: ${action.target.key}` : ''}`;
}

// Aksiyon seçilince: Input Validation gibi alan isteyen türde alan, aksiyonun hedefiyle dolar
// (kullanıcı kendi yazdıysa dokunulmaz; data-auto ile ayırt edilir).
function fillSelectorFromAction() {
  const edge = edgeById($('monitor-edge').value);
  const i = $('monitor-action').value === '' ? -1 : Number($('monitor-action').value);
  const action = edge?.actions?.[i];
  const key = action?.type === 'input' ? action.target?.key ?? action.selector ?? '' : '';
  for (const wrap of $('monitor-params').querySelectorAll('.monitor-param')) {
    const param = monitorType(dialogTypeId)?.params.find((p) => p.key === wrap.dataset.key);
    if (!param?.element) continue;
    const input = wrap.querySelector('label input');
    if (!input) continue;
    if (input.value.trim() && input.value !== input.dataset.auto) continue; // kullanıcının kendi değeri
    if (!key) continue;
    input.value = key;
    input.dataset.auto = key;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Kapsamdaki ekranlar: node ise o node; edge ise edge'in çıktığı ve vardığı node'lar; tüm
// model ise bütün node'lar.
function scopeNodes() {
  if (scopeRadio() === 'node') return [nodeById($('monitor-node').value)].filter(Boolean);
  if (scopeRadio() === 'edge') {
    const edge = edgeById($('monitor-edge').value);
    return edge ? [...new Set([nodeById(edge.source), nodeById(edge.target)].filter(Boolean))] : [];
  }
  return state.nodes;
}

// Element listeleri: kapsamdaki ekranların kaydedilmiş etkileşimli elementleri (parmak izi
// anahtarları, fingerprint.js > elementKey). 'fields' yalnızca form alanlarını listeler.
function renderElementPicks() {
  const type = monitorType(dialogTypeId);
  const nodes = scopeNodes();
  for (const param of type.params.filter((p) => p.element)) {
    const pick = $('monitor-params').querySelector(`[data-key="${param.key}"] .element-pick`);
    if (!pick) continue;
    const counts = new Map();
    for (const node of nodes) {
      for (const { key, count } of Array.isArray(node.elements) ? node.elements : []) {
        if (typeof key !== 'string') continue;
        if (param.element === 'fields' && !/^(input|textarea|select)\b/.test(key)) continue;
        counts.set(key, (counts.get(key) ?? 0) + count);
      }
    }
    const keys = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'tr'));
    pick.replaceChildren(new Option(keys.length
      ? (nodes.length === 1 ? `${nodes[0].name} ekranındaki elementlerden seç…` : 'Kayıtlı ekranlardaki elementlerden seç…')
      : 'Kayıtlı ekranlarda uygun element yok', ''));
    pick.append(...keys.map((key) => new Option(nodes.length > 1 && counts.get(key) > 1 ? `${key} (${counts.get(key)})` : key, key)));
    pick.disabled = !keys.length;
  }
}

// Formdaki değerler
function draftMonitor() {
  const type = monitorType(dialogTypeId);
  const params = {};
  for (const p of type.params) {
    const field = $('monitor-params').querySelector(`[data-key="${p.key}"] > label input, [data-key="${p.key}"] > label select`);
    params[p.key] = p.kind === 'checkbox' ? field.checked
      : p.kind === 'number' ? (field.value.trim() === '' ? '' : Number(field.value))
        : field.value.trim();
  }
  const radio = scopeRadio();
  const edge = radio === 'edge' ? edgeById($('monitor-edge').value) : null;
  const actionIndex = edge && $('monitor-action').value !== '' ? Number($('monitor-action').value) : -1;
  return {
    type: type.id,
    scope: radio === 'node' ? $('monitor-node').value : radio === 'edge' ? $('monitor-edge').value : 'global',
    action: actionIndex >= 0 ? monitorActionRef(edge.actions?.[actionIndex], actionIndex) : null,
    params,
    severity: 'error', // arayüzde önem seçilmez: her bozulma kırmızı (monitor-types.js > MONITOR_SEVERITIES)
    enabled: $('monitor-enabled').checked,
    name: $('monitor-name').value.trim() || null,
  };
}

// Özet cümlesi: "Testte v_Telefon node'una her varıldığında: input:phone alanının değeri /^0?5/ desenine uymalı…"
function renderSummary() {
  if (!dialogTypeId) return;
  const draft = draftMonitor();
  const type = monitorType(draft.type);
  const kind = scopeRadio();
  const edge = kind === 'edge' ? edgeById(draft.scope) : null;
  const scope = kind === 'global' ? { kind: 'global' }
    : kind === 'node' ? { kind: 'node', name: nodeById(draft.scope)?.name ?? '…' }
      : { kind: 'edge', name: edge?.name ?? '…', action: draft.action ? actionText(edge.actions[draft.action.index], draft.action.index) : null };
  $('monitor-summary').replaceChildren(...monitorSentence(type, draft.params, scope, draft.enabled).map((part) => {
    if (typeof part === 'string') return part;
    const b = document.createElement('b');
    b.textContent = part.b;
    return b;
  }));
}

// Sorunlar alanların altına yazılır; kapsam sorunu pencerenin altındaki kutuya.
function validateDraft(draft) {
  const type = monitorType(draft.type);
  let problems = 0;
  for (const p of type.params) {
    const problem = monitorParamProblem(p, draft.params[p.key]);
    const error = $('monitor-params').querySelector(`[data-key="${p.key}"] .field-error`);
    error.textContent = problem ?? '';
    error.hidden = !problem;
    if (problem) problems++;
  }
  if (problems) return 'Parametrelerde sorun var; işaretli alanları düzeltin.';
  const kind = scopeKind(draft.scope);
  if (kind === 'orphan') return scopeRadio() === 'edge' ? 'Bir edge seçin.' : 'Bir node seçin (graph\'ta node yoksa "Tüm model" seçin).';
  if (!monitorScopes(type)[kind]) return `Bu tür ${{ global: 'tüm model', node: 'tek node', edge: 'tek edge' }[kind]} için tanımlanamaz.`;
  if (kind === 'edge' && $('monitor-action').value !== '' && !draft.action) return 'Seçilen aksiyon bu edge\'de yok; listeden yeniden seçin.';
  return null;
}

function showDialogError(text) {
  $('monitor-error').hidden = !text;
  $('monitor-error').textContent = text ?? '';
}

async function saveMonitor() {
  if (!dialogTypeId) return;
  const draft = draftMonitor();
  const problem = validateDraft(draft);
  showDialogError(problem);
  if (problem) return;
  const existing = editingId ? monitorById(editingId) : null;
  if (existing) {
    Object.assign(existing, draft);
    monitorVerdicts.delete(existing.id); // kural değişti: eski sonuç geçersiz
  } else {
    monitors.items.push({ id: 'm' + monitors.nextId++, ...draft, createdAt: new Date().toISOString() });
  }
  await saveMonitors();
  closeMonitorDialog();
  const saved = existing ?? monitors.items.at(-1);
  showMessage({ notice: `"${monitorName(saved)}" ${existing ? 'güncellendi' : 'eklendi'} (${scopeText(saved)}).` });
  if (!existing) $('monitors').open = true;
  renderMonitors();
}

function isDialogDirty() {
  return Boolean(dialogTypeId) && dialogInitial !== null && JSON.stringify(draftMonitor()) !== dialogInitial;
}

function closeMonitorDialog() {
  dialogClean = true;
  $('monitor-dialog').close();
}

// Kapatma isteği (✕, Vazgeç, Esc, pencere dışı): kaydedilmemiş değişiklik varsa önce sorar
function requestCloseMonitorDialog() {
  if (isDialogDirty()) $('monitor-unsaved-dialog').showModal();
  else closeMonitorDialog();
}

// 2. adımdaki her değişiklik: kapsam kısıtı, element listeleri ve özet cümlesi
$('monitor-step-params').addEventListener('input', renderSummary);
$('monitor-step-params').addEventListener('change', (event) => {
  if (event.target.name === 'monitor-scope' || event.target.id === 'monitor-node' || event.target.id === 'monitor-edge') {
    renderScopeState();
    if (event.target.id === 'monitor-edge') renderActionPicks();
    renderElementPicks();
  }
  if (event.target.id === 'monitor-action') {
    renderActionHint();
    fillSelectorFromAction();
  }
  renderSummary();
});
$('btn-monitor-save').onclick = saveMonitor;
$('btn-monitor-cancel').onclick = requestCloseMonitorDialog;
$('btn-monitor-cancel-type').onclick = requestCloseMonitorDialog;
$('btn-monitor-close').onclick = requestCloseMonitorDialog;
$('monitor-dialog').onkeydown = (event) => { // metin alanında Enter = Kaydet (deneme kutusu hariç)
  if (event.key === 'Enter' && event.target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="search"])') && !event.target.closest('.tester')) {
    event.preventDefault();
    saveMonitor();
  }
};
$('monitor-dialog').oncancel = (event) => { // Esc
  event.preventDefault();
  requestCloseMonitorDialog();
};
$('monitor-dialog').onclick = (event) => { // karartılmış alana tıklama
  if (event.target === $('monitor-dialog')) requestCloseMonitorDialog();
};
// Chrome, kullanıcı etkileşimi olmadan basılan Esc'te 'cancel'ı iptal ettirmeyebilir ve pencereyi
// doğrudan kapatır (panel.js'teki Ayarlar penceresiyle aynı durum). Kirli kapandıysa geri aç.
$('monitor-dialog').onclose = () => {
  if (dialogClean || $('monitor-dialog').open || !isDialogDirty()) return;
  $('monitor-dialog').showModal();
  $('monitor-unsaved-dialog').showModal();
};
$('btn-monitor-unsaved-discard').onclick = () => {
  $('monitor-unsaved-dialog').close();
  closeMonitorDialog();
};
$('btn-monitor-unsaved-back').onclick = () => $('monitor-unsaved-dialog').close();

$('btn-monitor-add').onclick = () => openMonitorDialog({ scope: selectedItem() ? selectedId : 'global' });
$('btn-node-monitor-add').onclick = () => openMonitorDialog({ scope: selectedId });
