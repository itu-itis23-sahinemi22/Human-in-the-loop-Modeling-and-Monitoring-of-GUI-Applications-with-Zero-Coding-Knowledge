// =============================================================================
// theme.js — aydınlık / karanlık tema
// -----------------------------------------------------------------------------
// panel.html'in <head>'inde yüklenir ki sayfa ilk kez çizilmeden tema uygulanmış olsun.
// Kullanıcının seçimi localStorage'da durur (yalnızca panelin görünümüdür; graph ya da
// ayar değildir). Seçim yoksa sistem teması izlenir. Renkler panel.css'te
// :root[data-theme="dark"] altında tanımlıdır.
// =============================================================================

const THEME_KEY = 'theme';

function savedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null; // depolama kapalıysa sistem teması kullanılır
  }
}

// Temayı uygular ve haber verir (panel.js graph renklerini buna göre yeniler).
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

const systemDark = matchMedia('(prefers-color-scheme: dark)');
applyTheme(savedTheme() ?? (systemDark.matches ? 'dark' : 'light'));
systemDark.addEventListener('change', (event) => {
  if (!savedTheme()) applyTheme(event.matches ? 'dark' : 'light');
});
