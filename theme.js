(function () {
  const storageKey = 'nutrilev.theme';
  const root = document.documentElement;

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    root.dataset.theme = isDark ? 'dark' : 'light';
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const label = isDark ? 'Usar modo claro' : 'Usar modo escuro';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-pressed', String(isDark));
      const icon = button.querySelector('[data-theme-icon]');
      if (icon) icon.textContent = isDark ? '☀' : '☾';
      const text = button.querySelector('[data-theme-label]');
      if (text) text.textContent = isDark ? 'Modo claro' : 'Modo escuro';
    });
  }

  let savedTheme = 'light';
  try {
    savedTheme = localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';
  } catch (error) {
    console.error('Theme preference could not be loaded', error);
  }
  applyTheme(savedTheme);
  document.addEventListener('DOMContentLoaded', () => applyTheme(root.dataset.theme));

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    try {
      localStorage.setItem(storageKey, nextTheme);
    } catch (error) {
      console.error('Theme preference could not be saved', error);
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === storageKey) applyTheme(event.newValue === 'dark' ? 'dark' : 'light');
  });
}());
