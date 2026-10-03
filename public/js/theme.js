// Light / dark theme. Loaded in <head> so the saved theme applies before the page paints.
(function () {
  const root = document.documentElement;
  let saved = null;
  try { saved = new URLSearchParams(location.search).get('theme') || localStorage.getItem('yb-theme'); } catch { }
  if (saved === 'dark') root.dataset.theme = 'dark';
  const sync = b => { const dark = root.dataset.theme === 'dark';
    b.setAttribute('aria-pressed', dark); b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); b.title = b.getAttribute('aria-label'); };
  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('.themebtn').forEach(b => {
    sync(b);
    b.onclick = () => {
      const dark = root.dataset.theme !== 'dark';
      if (dark) root.dataset.theme = 'dark'; else delete root.dataset.theme;
      try { localStorage.setItem('yb-theme', dark ? 'dark' : 'light'); } catch { }
      document.querySelectorAll('.themebtn').forEach(sync);
      document.dispatchEvent(new CustomEvent('themechange'));
    };
  }));
})();
