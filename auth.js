(function () {
  const config = window.Nutrilev?.config;
  const client = window.Nutrilev?.services?.supabase || window.supabase?.createClient(
    config?.supabaseUrl || 'https://ostcnhshefjjnhuotucf.supabase.co',
    config?.supabasePublishableKey || 'sb_publishable_rg6aHaeawljbkG5RY2uTfA_gi4PWobG',
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
  );
  const roles = window.Nutrilev?.auth?.roles;
  const roleRoutes = roles?.routes || { student: 'app', coach: 'coach', gym_admin: 'admin', nutritionist: 'coach', super_admin: 'admin', gym_owner: 'admin' };
  const routeRoles = { app: 'student', coach: 'coach', admin: 'gym_admin' };
  const normalizedRoles = roles?.normalize || ((role) => ({ nutritionist: 'coach', super_admin: 'gym_admin', gym_owner: 'gym_admin' }[role] || role));
  const rootRelative = (file) => window.location.pathname.includes('/coach/students/') ? `../../${file}` : `../${file}`;

  function routeName() {
    const path = window.location.pathname.replace(/\/+$/, '');
    const match = path.match(/\/(app|coach|admin)(?:\/students)?(?:\/index\.html)?$/);
    return match ? match[1] : '';
  }

  async function getRole(user) {
    if (!client || !user) return 'student';
    const { data, error } = await client.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (error) {
      console.error('profile role lookup error', error);
      return null;
    }
    return (roles?.allowed || ['student', 'coach', 'gym_admin', 'nutritionist', 'super_admin', 'gym_owner']).includes(data?.role)
      ? normalizedRoles(data.role)
      : null;
  }

  async function requireSession() {
    if (!client) throw new Error('O serviço de autenticação não está disponível.');
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      window.location.href = rootRelative('login.html');
      return null;
    }
    return data.session;
  }

  async function redirectForRole() {
    const session = await requireSession();
    if (!session) return;
    const role = await getRole(session.user);
    if (!role) {
      window.location.href = `${rootRelative('login.html')}?error=role`;
      return;
    }
    window.location.href = `../${roleRoutes[role]}/index.html`;
  }

  async function protectRoute() {
    const session = await requireSession();
    if (!session) return;
    const role = await getRole(session.user);
    const requestedRole = routeRoles[routeName()];
    if (!role || !requestedRole || role !== requestedRole) {
      window.location.href = `../${roleRoutes[role || 'student']}/index.html`;
      return;
    }
    const frame = document.querySelector('[data-platform-frame]');
    if (frame) {
      const section = routeName() === 'coach' && window.location.pathname.includes('/students') ? '#/clients' : '';
      frame.src = `../platform.html?role=${encodeURIComponent(role)}&guarded=1${section}`;
    }
  }

  window.NutrilevAuth = { client, getRole, redirectForRole, protectRoute };
}());
