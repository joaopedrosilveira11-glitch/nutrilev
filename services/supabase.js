(function () {
  window.Nutrilev = window.Nutrilev || {};
  window.Nutrilev.services = window.Nutrilev.services || {};
  const config = window.Nutrilev.config;
  window.Nutrilev.services.supabase = window.supabase?.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'nutrilev.auth.session',
    },
  });
}());
