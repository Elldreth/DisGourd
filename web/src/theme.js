// Dark / light / match-the-system theme. The choice is saved in this
// browser; the light palette is `[data-theme='light']` in index.css.
// public/theme-init.js applies the saved theme before the app loads (so a
// light-theme user never sees a dark flash) and must agree with this file.

const KEY = 'disgourd.theme';
export const THEMES = ['dark', 'light', 'system'];
// The browser UI colour (address bar on mobile, PWA title bar) per theme:
// the server rail / input colour, ink-900.
const THEME_COLOR = { dark: '#0E0B1A', light: '#EAE5F7' };

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : 'dark';
  } catch {
    return 'dark';
  }
}

// What a choice looks like right now: 'dark' or 'light'.
export function resolveTheme(choice, prefersLight) {
  return choice === 'system' ? (prefersLight ? 'light' : 'dark') : choice;
}

const lightQuery = () =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

// Put a theme on the page. Returns the resolved 'dark' | 'light'.
export function applyTheme(choice = getTheme()) {
  const theme = resolveTheme(choice, !!lightQuery()?.matches);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  return theme;
}

export function setTheme(choice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* storage blocked: the theme still applies for this visit */
  }
  return applyTheme(choice);
}

// In "system" mode, follow the OS when it switches between light and dark.
// Returns a function that stops watching.
export function watchSystemTheme() {
  const q = lightQuery();
  if (!q?.addEventListener) return () => {};
  const onChange = () => {
    if (getTheme() === 'system') applyTheme('system');
  };
  q.addEventListener('change', onChange);
  return () => q.removeEventListener('change', onChange);
}
