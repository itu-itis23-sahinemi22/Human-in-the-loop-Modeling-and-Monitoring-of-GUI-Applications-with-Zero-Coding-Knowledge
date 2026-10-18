// =============================================================================
// page.js — TEST EDİLEN SAYFA
// -----------------------------------------------------------------------------
// Eklentinin parmak izi kodunu sayfaya ekler, sayfanın durulmasını bekler, parmak izi
// alır ve görünen alanı (viewport) ayarlar. Parmak izi kayıttaki kodun AYNISIDIR
// (extension/fingerprint.js): kayıt ile test aynı state tanımını kullanır.
// =============================================================================

import { readFileSync } from 'node:fs';

const extension = (name) => readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');

// Her sayfaya, sayfanın kendi kodundan önce eklenir (context.addInitScript). Eklentinin
// dosyaları sayfanın global adlarıyla çakışmasın diye bir fonksiyonun içinde çalışır;
// dışarıya yalnızca window.__graphRecorder açılır. settled(): durulma tanımı kayıttakiyle
// aynıdır (fingerprint.js).
export const INIT_SCRIPT = `window.__graphRecorder = (() => {
${extension('settings.js')}
${extension('fingerprint.js')}
return { fingerprint, targetElement, settled };
})();`;

// window.__graphRecorder'daki bir fonksiyonu sayfada çalıştırır. Sayfa değişirken (aksiyon bir
// gezinme başlattıysa) çağrı yarıda kalır; yeni sayfa yüklenince tekrar denenir. Kod
// eklenemeyen sayfalarda (tarayıcının hata sayfası gibi) birkaç denemeden sonra hata verir.
const ATTEMPTS = 10;

export async function inPage(page, method, arg) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.waitForLoadState('domcontentloaded');
      const result = await page.evaluate(async ([method, arg]) => {
        const api = window.__graphRecorder;
        return api ? { value: await api[method](arg) } : { missing: true };
      }, [method, arg]);
      if (!result.missing) return result.value;
      if (attempt >= ATTEMPTS) throw new Error(`Sayfaya parmak izi kodu eklenemedi: ${page.url()}`);
    } catch (error) {
      if (attempt >= ATTEMPTS || !/Execution context was destroyed|Cannot find context/.test(error.message)) throw error;
    }
    await page.waitForTimeout(200);
  }
}

// Aksiyondan sonra sayfanın durulmasını bekler.
export function settle(page) {
  return inPage(page, 'settled');
}

// Sayfa durulunca ekranın parmak izi: { url, title, elements, viewport } (fingerprint.js).
export async function screenOf(page) {
  await settle(page);
  return inPage(page, 'fingerprint');
}

// Görünen alanı CSS piksel boyutu ve piksel oranıyla ayarlar (resize ve zoom aksiyonları).
// Playwright'ın setViewportSize'ı piksel oranını değiştiremez; tarayıcı yakınlaştırması da
// yoktur. Kayıttaki yakınlaştırma, sayfanın gördüğü boyut ve piksel oranı aynı kurularak
// tekrarlanır (docs/03 > Pencere boyutu ve state).
export function setViewport(cdp, { width, height, devicePixelRatio }) {
  return cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: devicePixelRatio, mobile: false });
}
