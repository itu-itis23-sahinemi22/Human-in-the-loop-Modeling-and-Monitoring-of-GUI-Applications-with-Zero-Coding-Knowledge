// =============================================================================
// monitor-types.js — MONİTÖR TÜRLERİ (katalog)
// -----------------------------------------------------------------------------
// Run-time monitoring (Ceren'in kısmı). Bir "monitör", test her adım attıktan sonra
// kontrol edilen bir koşuldur (test oracle'ı): koşul bozulursa adım numarası ve ekran
// görüntüsüyle birlikte kırmızı yanar, bozulmadıysa yeşil. Bu dosya menünün TANIMINI içerir:
// hangi türler var, her türün hangi parametreleri var, parametre nasıl doğrulanır, monitör
// kullanıcıya nasıl okunur. Kontrolün kendisi monitor-probe.js (sayfada) ve
// sidepanel/monitor-run.js'tedir (oynatmada). monitor-dialog.js tür kartlarını ve formu bu listeden
// üretir: yeni bir tür için buraya bir kayıt (+ otomatik ad ve özet cümlesi için aşağıdaki iki
// switch'e birer satır) ve monitor-probe.js'e bir kontrol fonksiyonu yeter; arayüz kodu değişmez
// (docs/07-monitorler.md > Yeni bir monitör türü eklemek).
//
// Her türün:
//   group   : kategori (MONITOR_GROUPS)
//   when    : kontrol biçimi (MONITOR_WHEN): 'state' node'a (ekrana) varınca, 'action'
//             aksiyondan sonra, 'event' olay gerçekleşince, 'temporal' süre dolana kadar
//   scope   : 'any' | 'global' | 'node' | 'edge' | 'node-edge' — tüm model / tek node /
//             tek edge (aksiyon) seçeneklerinden hangileri olabilir
//   side    : kontrolün yeri: yoksa sayfada (monitor-probe.js, DOM'a bakar); 'panel' ise panelde
//             (sidepanel/monitor-image.js: sekmenin ekran görüntüsüne bakar; sayfa içinden görüntü alınamaz)
//   params  : [{ key, text, kind, required, placeholder, default, min, max, step, options, presets, element }]
// Parametre türleri (kind): 'text', 'regex', 'number', 'select', 'checkbox', 'image'.
//   'regex'   : kaydedilmeden derlenerek doğrulanır; formda canlı deneme kutusu çıkar.
//               presets: [{ text, value }] hazır desen çipleri.
//   'select'  : options: [{ value, text }].
//   'image'   : küçük bir resim (PNG / JPEG); değeri { data: 'data:image/png;base64,…', width, height }.
//               Formda dosya seçme + yapıştırma (Ctrl+V) ve önizleme.
//   element   : 'fields' | 'all' — alan, node'un kayıttaki etkileşimli elementlerinden
//               (parmak izi anahtarı: "input:phone") listeden de seçilebilir.
// =============================================================================

// Feather Icons (MIT), panelin diğer ikonlarıyla aynı set.
const MONITOR_ICON = {
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
  check: '<polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
};

// Kategoriler: tür kartları bu başlıklar altında gruplanır.
const MONITOR_GROUPS = [
  { id: 'functional', text: 'İşlevsel izleme', icon: 'check' },
  { id: 'error', text: 'Hata izleme', icon: 'alert' },
  { id: 'a11y', text: 'Erişilebilirlik', icon: 'eye' },
];

// Kontrol biçimi: ne zaman değerlendirilir? (tür kartındaki etiket)
const MONITOR_WHEN = {
  state: { text: 'State tabanlı', hint: 'İlgili node\'a (ekrana) varıldığında kontrol edilir.' },
  action: { text: 'Aksiyon tabanlı', hint: 'İlgili aksiyondan hemen sonra kontrol edilir: edge\'in seçilen aksiyonu (ör. kullanıcı adı yazılınca); aksiyon seçilmezse edge\'in her aksiyonundan sonra. Bir bekleme aksiyonu seçilirse bekleme bitince (yüklenmesi beklenen içerik gelmiş mi, geçici mesaj gitmiş mi).' },
  // event / temporal: henüz bu biçimde tür yok; ileride olay (hata / yanıt) ve süre tabanlı türler için
  event: { text: 'Olay tabanlı', hint: 'Hata ya da yanıt olayı gerçekleştiğinde kontrol edilir.' },
  temporal: { text: 'Zamansal', hint: 'Koşul gerçekleşene ya da süre dolana kadar beklenir.' },
};

// Hazır desenler ("Input Validation" için). Kullanıcı çipe tıklayınca desen dolar.
const PATTERN_PRESETS = [
  { text: 'Telefon (5 ile başlar)', value: '^0?5\\d{9}$' },
  { text: 'E-posta', value: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
  { text: 'Sadece rakam', value: '^\\d+$' },
  { text: 'Tarih (GG.AA.YYYY)', value: '^\\d{2}\\.\\d{2}\\.\\d{4}$' },
  { text: 'Boş değil', value: '\\S' },
];

const MONITOR_TYPES = [
  {
    id: 'inputValidation', text: 'Input Validation', group: 'functional', when: 'action', scope: 'any',
    hint: 'Girilen değer kurala uyuyor mu? Alanın değeri desene (regex) uymalı; örnek: telefon 5 ile başlamalı.',
    params: [
      { key: 'selector', text: 'Alan', kind: 'text', required: true, placeholder: 'ör. input:phone ya da #phone', element: 'fields' },
      { key: 'pattern', text: 'Desen (regex)', kind: 'regex', required: true, placeholder: 'ör. ^0?5', presets: PATTERN_PRESETS },
      { key: 'mode', text: 'Kural', kind: 'select', required: true, default: 'match', options: [
        { value: 'match', text: 'Değer desene uymalı' },
        { value: 'notMatch', text: 'Değer desene uymamalı' },
      ] },
      { key: 'whenEmpty', text: 'Alan boşken', kind: 'select', required: true, default: 'skip', options: [
        { value: 'skip', text: 'Kontrol etme' },
        { value: 'check', text: 'Yine de kontrol et' },
      ] },
    ],
  },
  {
    id: 'expectedText', text: 'Expected Text', group: 'functional', when: 'state', scope: 'any',
    hint: 'Beklenen metin ekranda var mı (ya da artık yok mu)? Yazdığınız parça, görünen yazılardan birinin içinde geçmeli; örnek: "Password is required". "Olmamalı" kuralıyla: "Bekleyiniz" gitmiş olmalı.',
    params: [
      { key: 'text', text: 'Beklenen metin', kind: 'text', required: true, placeholder: 'ör. Password is required' },
      { key: 'mode', text: 'Kural', kind: 'select', required: true, default: 'present', options: [
        { value: 'present', text: 'Ekranda olmalı' },
        { value: 'absent', text: 'Ekranda olmamalı' },
      ] },
      { key: 'caseSensitive', text: 'Büyük/küçük harf aynı olmalı', kind: 'checkbox', default: false },
    ],
  },
  {
    id: 'expectedImage', text: 'Expected Image', group: 'functional', when: 'state', scope: 'any', side: 'panel',
    hint: 'Beklenen görüntü ekranda var mı (ya da artık yok mu)? Küçük bir resim (ör. bir uyarı mesajının ekrandan kesilmiş parçası) ekranın görüntüsü içinde bulunmalı; "olmamalı" kuralıyla bulunmamalı.',
    params: [
      { key: 'image', text: 'Görüntü', kind: 'image', required: true },
      { key: 'mode', text: 'Kural', kind: 'select', required: true, default: 'present', options: [
        { value: 'present', text: 'Ekranda olmalı' },
        { value: 'absent', text: 'Ekranda olmamalı' },
      ] },
      { key: 'similarity', text: 'Benzerlik (en az %)', kind: 'number', required: true, default: 90, min: 50, max: 100, step: 1 },
    ],
  },
  {
    id: 'errorText', text: 'Error Text', group: 'error', when: 'state', scope: 'any',
    hint: 'Ekranda "404", "500", "Internal Server Error" gibi hata metinleri var mı?',
    params: [{ key: 'pattern', text: 'Hata kalıbı (desen)', kind: 'regex', required: true, default: '\\b(404|500|internal server error|something went wrong|bir hata oluştu)\\b' }],
  },
  {
    id: 'fontSize', text: 'Font Size', group: 'a11y', when: 'state', scope: 'any',
    hint: 'Küçük yazı yok: görünen hiçbir metnin yazı boyutu alt sınırın altında olmamalı (ör. 4 pt).',
    params: [
      { key: 'min', text: 'Alt sınır', kind: 'number', required: true, default: 4, min: 1, max: 72, step: 0.5 },
      { key: 'unit', text: 'Birim', kind: 'select', required: true, default: 'pt', options: [{ value: 'pt', text: 'pt' }, { value: 'px', text: 'px' }] },
    ],
  },
];

// Önem. Arayüzde seçilmez: her bozulma kırmızıdır, yeşil / kırmızı dışında ışık yoktur. Alan veri
// uyumluluğu için kayıtta durur ('error'); eski ya da dışarıdan gelen kayıtlarda 'warning' de kabul
// edilir ve kırmızı yanar.
const MONITOR_SEVERITIES = [
  { id: 'error', text: 'Hata' },
  { id: 'warning', text: 'Uyarı' },
];

function monitorType(id) {
  return MONITOR_TYPES.find((t) => t.id === id);
}

function monitorGroup(type) {
  return MONITOR_GROUPS.find((g) => g.id === type?.group) ?? MONITOR_GROUPS[0];
}

// Türün izin verdiği kapsamlar: { global, node, edge }
function monitorScopes(type) {
  const s = type.scope;
  return { global: s === 'any' || s === 'global', node: s === 'any' || s === 'node' || s === 'node-edge', edge: s === 'any' || s === 'edge' || s === 'node-edge' };
}

// Parametrelerin varsayılan değerleri: { min: 4, unit: 'pt' }
function monitorDefaults(type) {
  return Object.fromEntries(type.params.map((p) => [p.key, p.default ?? (p.kind === 'checkbox' ? false : p.kind === 'select' ? p.options[0].value : '')]));
}

// Görüntü parametresinin sınırları ('image'): küçük bir parça beklenir (bir mesaj, bir düğme), tam
// ekran görüntüsü değil. Veri data URL olarak saklanır (storage'da ve dışa aktarılan JSON'da).
const MONITOR_IMAGE_MAX_SIDE = 800;         // en, boy (px)
const MONITOR_IMAGE_MAX_CHARS = 1400000;    // data URL uzunluğu (~1 MB dosya)
const MONITOR_IMAGE_TYPES = /^data:image\/(png|jpeg|webp);base64,/;

// Görüntü değeri biçimi doğru mu: { data, width, height }
function monitorImageProblem(value) {
  if (!value || typeof value !== 'object' || typeof value.data !== 'string') return 'Bir görüntü yükleyin (PNG ya da JPEG).';
  if (!MONITOR_IMAGE_TYPES.test(value.data)) return 'Görüntü PNG, JPEG ya da WebP olmalı.';
  if (value.data.length > MONITOR_IMAGE_MAX_CHARS) return `Görüntü çok büyük (en fazla ${Math.round(MONITOR_IMAGE_MAX_CHARS * 0.75 / 1e6 * 10) / 10} MB).`;
  const sideOk = (n) => Number.isInteger(n) && n >= 1 && n <= MONITOR_IMAGE_MAX_SIDE;
  if (!sideOk(value.width) || !sideOk(value.height)) return `Görüntünün eni ve boyu 1–${MONITOR_IMAGE_MAX_SIDE} px olmalı; tam ekran yerine küçük bir parça kesin.`;
  return null;
}

// Tek bir parametreyi doğrular; sorun yoksa null, varsa kullanıcıya gösterilecek metin döner.
function monitorParamProblem(param, value) {
  const empty = value === '' || value === null || value === undefined;
  if (empty) return param.required ? (param.kind === 'image' ? 'Bir görüntü yükleyin (PNG ya da JPEG).' : 'Bu alan gerekli.') : null;
  if (param.kind === 'image') return monitorImageProblem(value);
  if (param.kind === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Sayı girin.';
    if (param.min !== undefined && n < param.min) return `En az ${param.min} olmalı.`;
    if (param.max !== undefined && n > param.max) return `En fazla ${param.max} olmalı.`;
  }
  if (param.kind === 'regex') {
    try {
      new RegExp(value);
    } catch (error) {
      return `Geçersiz desen: ${error.message.replace(/^Invalid regular expression: /, '')}`;
    }
  }
  if (param.kind === 'select' && !param.options.some((o) => o.value === value)) return 'Listeden bir seçenek seçin.';
  return null;
}

// Ağır desen uyarısı (engellemez): iç içe tekrar, ör. (\w+\s?)+ ya da (a*)* — uymayan uzun bir
// metinde üstel sürede çalışır (catastrophic backtracking) ve kontrol edilen sayfayı kilitleyebilir.
// Kullanıcı regex bilmeyebilir; formda ve "Dene" kutusunda uyarı olarak gösterilir.
function monitorPatternWarning(pattern) {
  const text = String(pattern ?? '');
  if (!text) return null;
  // Bir grup içinde + * {n,} ile tekrar eden bir parça ve grubun kendisi de + * {n,} ile tekrarlı
  const piece = '(?:[^()\\\\]|\\\\.|\\([^()]*\\))';
  const nested = new RegExp(`\\(${piece}*?(?:[+*]|\\{\\d*,\\d*\\})${piece}*\\)(?:[+*]|\\{\\d*,\\d*\\})`);
  if (nested.test(text)) return 'Desen ağır olabilir (iç içe tekrar, ör. (…+)+): uzun bir sayfada kontrol gecikebilir ya da sayfayı yavaşlatabilir.';
  return null;
}

// Monitörün listede görünen kısa adı: tür adı + en belirleyici parametre.
//   "Input Validation · input:phone ~ /^0?5/"
function monitorAutoName(type, params) {
  const detail = (() => {
    switch (type.id) {
      case 'inputValidation': return `${params.selector} ${params.mode === 'notMatch' ? '≁' : '~'} /${params.pattern}/`;
      case 'expectedText': return `"${String(params.text ?? '').trim().slice(0, 40)}"${params.mode === 'absent' ? ' yok' : ''}`;
      case 'expectedImage': return (params.image?.width ? `${params.image.width}×${params.image.height} px` : '') + (params.mode === 'absent' ? ' yok' : '');
      case 'errorText': return `/${params.pattern}/`;
      case 'fontSize': return `≥ ${params.min} ${params.unit}`;
      default: return '';
    }
  })();
  return detail ? `${type.text} · ${detail}` : type.text;
}

// Monitörün kullanıcıya okunan hali (formun altındaki özet). Parçalar dizisi döner:
// düz metin ya da { b: 'vurgulanan değer' }; monitor-dialog.js bunları ekrana yazar.
//   scope: { kind: 'global' } | { kind: 'node', name } | { kind: 'edge', name }
function monitorSentence(type, params, scope, enabled) {
  const v = (value, fallback = '…') => ({ b: value === '' || value === null || value === undefined ? fallback : String(value) });
  const rx = (value) => v(value === '' || value == null ? '' : `/${value}/`);
  // scope: { kind: 'global' } | { kind: 'node', name } | { kind: 'edge', name, action?: '1. Yaz Fill Username' }
  const head = scope.kind === 'node' ? ['Testte ', v(scope.name), ' node\'una her varıldığında: ']
    : scope.kind === 'edge' ? (scope.action
      ? ['Testte ', v(scope.name), ' edge\'inin ', v(scope.action), ' aksiyonundan hemen sonra: ']
      : ['Testte ', v(scope.name), ' edge\'inin her aksiyonundan sonra: '])
      : ['Testte her adımdan sonra, her node\'da: '];
  const body = (() => {
    switch (type.id) {
      case 'inputValidation': return [
        v(params.selector), ' alanının değeri ', rx(params.pattern), params.mode === 'notMatch' ? ' desenine uymamalı' : ' desenine uymalı',
        params.whenEmpty === 'check' ? ' (alan boşken de kontrol edilir).' : ' (alan boşsa kontrol edilmez).',
      ];
      case 'expectedText': return [params.mode === 'absent' ? 'görünen yazıların hiçbirinde ' : 'görünen yazılardan birinde ', v(params.text), params.mode === 'absent' ? ' geçmemeli' : ' geçmeli', params.caseSensitive ? ' (büyük/küçük harf aynı olmalı).' : ' (büyük/küçük harf fark etmez).'];
      case 'expectedImage': return ['yüklenen görüntü (', v(params.image?.width ? `${params.image.width}×${params.image.height} px` : ''), params.mode === 'absent' ? ') ekranda bulunmamalı (benzerlik en az %' : ') ekranda bulunmalı (benzerlik en az %', v(params.similarity), ').'];
      case 'errorText': return ['görünen metinde ', rx(params.pattern), ' gibi hata metni geçmemeli.'];
      case 'fontSize': return ['görünen hiçbir metin ', v(params.min), ' ', v(params.unit), '\'den küçük olmamalı.'];
      default: return [type.text, '.'];
    }
  })();
  const tail = enabled ? [' Bozulursa ', { b: 'kırmızı' }, ' yanar.'] : [' Şimdilik kapalı: kontrol edilmez.'];
  return [...head, ...body, ...tail];
}
