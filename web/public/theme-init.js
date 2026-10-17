// Runs before the app (a plain blocking script in <head>), so the saved
// theme is on the page before the first paint: no dark flash for light-theme
// users. Mirrors src/theme.js (getTheme / resolveTheme / applyTheme), which
// theme.test.js checks.
(function () {
  try {
    var choice = localStorage.getItem('disgourd.theme');
    var light = choice === 'light' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#EAE5F7' : '#0E0B1A');
  } catch (e) {
    /* storage blocked: stay dark */
  }
})();
