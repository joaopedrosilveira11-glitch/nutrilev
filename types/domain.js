/**
 * Shared domain contracts are documented here while the static frontend remains JavaScript.
 * Database constraints and RLS are the source of truth for persistence.
 */
(function () {
  window.Nutrilev = window.Nutrilev || {};
  window.Nutrilev.types = Object.freeze({
    checkinSources: ['facial', 'qr', 'manual', 'integration'],
    nutritionSources: ['taco', 'usda_fooddata', 'manual_verified', 'integration'],
  });
}());
