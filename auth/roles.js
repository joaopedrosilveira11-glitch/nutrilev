(function () {
  window.Nutrilev = window.Nutrilev || {};
  window.Nutrilev.auth = window.Nutrilev.auth || {};
  window.Nutrilev.auth.roles = Object.freeze({
    routes: { student: 'app', coach: 'coach', gym_admin: 'admin', nutritionist: 'coach', super_admin: 'admin', gym_owner: 'admin' },
    normalize: (role) => ({ nutritionist: 'coach', super_admin: 'gym_admin', gym_owner: 'gym_admin' }[role] || role),
    allowed: ['student', 'coach', 'gym_admin', 'nutritionist', 'super_admin', 'gym_owner'],
  });
}());
