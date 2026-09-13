(function () {
  document.querySelectorAll('[data-open-access]').forEach((button) => {
    button.addEventListener('click', () => {
      const planId = button.dataset.planId;
      const destination = planId
        ? `login.html?signup=1&plan=${encodeURIComponent(planId)}`
        : 'login.html';
      window.location.assign(destination);
    });
  });
}());
