(function () {
  const services = window.Nutrilev.services;
  const plugin = window.Capacitor?.Plugins?.PushNotifications;
  const client = services.supabase;
  const push = {
    async register() {
      if (!window.NUTRILEV_MOBILE_APP || !plugin || !client) return;
      const permission = await plugin.requestPermissions();
      if (permission.receive !== 'granted') return;
      await plugin.register();
      await plugin.addListener('registration', async (token) => {
        const { data } = await client.auth.getUser();
        if (!data.user) return;
        const { error } = await client.from('push_tokens').upsert({
          user_id: data.user.id,
          token: token.value,
          platform: 'android',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'token' });
        if (error) console.error('Push token registration failed', error);
      });
      await plugin.addListener('registrationError', (error) => console.error('Push registration failed', error));
      await plugin.addListener('pushNotificationActionPerformed', (event) => {
        const target = event.notification?.data?.route;
        if (target) window.location.hash = `#/${String(target).replace(/^#?\/?/, '')}`;
      });
    },
  };
  services.pushNotifications = push;
}());
