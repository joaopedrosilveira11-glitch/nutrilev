(function () {
  const app = window.Capacitor?.Plugins?.App;
  const pendingKey = 'nutrilev.pending.academy.invite';
  function parseInvite(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const isTrustedHost = parsed.protocol === 'nutrilev:' || (parsed.protocol === 'https:' && parsed.hostname === 'nutrilev.app');
      const isInvitePath = parsed.pathname.toLowerCase().startsWith('/convite')
        || (parsed.protocol === 'nutrilev:' && parsed.hostname.toLowerCase() === 'convite');
      if (!isTrustedHost || !isInvitePath) return null;
      const code = (parsed.searchParams.get('code') || parsed.pathname.split('/').filter(Boolean).pop() || '').trim().toUpperCase();
      return /^[A-Z0-9-]{4,80}$/.test(code) ? code : null;
    } catch (error) {
      console.error('Deep link could not be parsed', error);
      return null;
    }
  }
  function handle(url) {
    const code = parseInvite(url);
    if (!code) return;
    localStorage.setItem(pendingKey, code);
    window.location.hash = '#/academy-invite';
    window.dispatchEvent(new CustomEvent('nutrilev:academy-invite', { detail: { code } }));
  }
  window.Nutrilev = window.Nutrilev || {};
  window.Nutrilev.deepLinks = { pendingKey, parseInvite, handle };
  if (!app) return;
  app.getLaunchUrl().then((result) => handle(result?.url)).catch((error) => console.error('Launch URL unavailable', error));
  app.addListener('appUrlOpen', (event) => handle(event.url)).catch((error) => console.error('Deep link listener unavailable', error));
}());
