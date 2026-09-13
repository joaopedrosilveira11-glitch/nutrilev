(function () {
  window.Nutrilev = window.Nutrilev || {};
  window.Nutrilev.layouts = window.Nutrilev.layouts || {};
  window.Nutrilev.layouts.setBusy = (busy) => document.getElementById('dashboard')?.setAttribute('aria-busy', String(busy));
}());
