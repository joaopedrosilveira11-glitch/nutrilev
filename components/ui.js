(function () {
  window.Nutrilev = window.Nutrilev || {};
  window.Nutrilev.components = window.Nutrilev.components || {};
  window.Nutrilev.components.cardHeading = (title, link = '') => `<div class="card-heading"><h3>${window.Nutrilev.utils.escapeHtml(title)}</h3>${link ? `<a href="#/${window.Nutrilev.utils.escapeHtml(link)}">Ver tudo →</a>` : ''}</div>`;
  window.Nutrilev.components.emptyState = (message) => `<p class="empty-state">${window.Nutrilev.utils.escapeHtml(message)}</p>`;
}());
