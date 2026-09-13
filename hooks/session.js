(function () {
  window.Nutrilev = window.Nutrilev || {};
  window.Nutrilev.hooks = window.Nutrilev.hooks || {};
  window.Nutrilev.hooks.getSession = () => window.Nutrilev.services.supabase?.auth.getSession();
}());
