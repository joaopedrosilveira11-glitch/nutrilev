(function () {
  window.Nutrilev = window.Nutrilev || {};
  window.Nutrilev.utils = window.Nutrilev.utils || {};
  window.Nutrilev.utils.escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}());
