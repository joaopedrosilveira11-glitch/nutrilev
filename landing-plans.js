(function () {
  const plans = [
    { id: 'free', name: 'Nutrilev Free', price: 'R$ 0', period: '', audience: 'Para começar', description: 'O essencial para organizar sua rotina.', features: ['Registro de refeições e água', 'Metas básicas de calorias', 'Treinos recebidos da academia'], featured: false },
    { id: 'plus', name: 'Nutrilev Plus', price: 'R$ 19,90', period: '/mês', audience: 'Para alunos', description: 'Mais recursos para acompanhar sua evolução.', features: ['Tudo do Free', 'Nutri IA para sua rotina', 'Evolução e métricas completas', 'Histórico sem limitações'], featured: true },
    { id: 'academy-start', name: 'Academia Start', price: 'R$ 99', period: '/mês', audience: 'Para academias', description: 'Uma base simples para começar a gestão.', features: ['Gestão de alunos', 'Dashboard de frequência', 'Convites para alunos'], featured: false },
    { id: 'academy-pro', name: 'Academia Pro', price: 'R$ 179', period: '/mês', audience: 'Para academias', description: 'Mais acompanhamento para seus alunos.', features: ['Tudo do Start', 'Coaches e fichas de treino', 'Avaliações e evolução', 'Relatórios de acompanhamento'], featured: false },
    { id: 'academy-business', name: 'Academia Business', price: 'R$ 299', period: '/mês', audience: 'Para academias', description: 'Gestão completa para operações em crescimento.', features: ['Tudo do Pro', 'Integrações', 'Indicadores avançados', 'Suporte prioritário'], featured: false },
    { id: 'enterprise', name: 'Enterprise', price: 'a partir de R$ 449', period: '/mês', audience: 'Para grandes operações', description: 'Uma solução sob medida para sua escala.', features: ['Tudo do Business', 'Configuração sob medida', 'Atendimento dedicado', 'Integrações customizadas'], featured: false },
  ];

  window.NUTRILEV_PLANS = plans;
  const grid = document.querySelector('[data-plans-grid]');
  if (!grid) return;

  grid.innerHTML = plans.map((plan) => `
    <article class="plan-card plan-card-${plan.id}${plan.featured ? ' plan-card-featured' : ''}" title="${plan.description}">
      ${plan.featured ? '<span class="pricing-badge">MAIS POPULAR</span>' : ''}
      <span class="plan-audience">${plan.audience}</span>
      <h3>${plan.name}</h3>
      <div class="pricing-value"><strong>${plan.price}</strong><span>${plan.period}</span></div>
      <p>${plan.description}</p>
      <ul class="plan-features">${plan.features.map((feature) => `<li>${feature}</li>`).join('')}</ul>
      <button class="button ${plan.featured ? 'button-primary' : 'button-outline'}" type="button" data-open-access data-plan-id="${plan.id}">${plan.id === 'free' ? 'Começar grátis' : 'Conhecer plano'} <span aria-hidden="true">→</span></button>
    </article>
  `).join('');
})();
