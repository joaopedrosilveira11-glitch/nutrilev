(function () {
  const client = window.Nutrilev.services.supabase;
  const queryRole = new URLSearchParams(window.location.search).get('role');
  const forcedRole = window.NUTRILEV_MOBILE_APP ? 'student' : (['student', 'coach', 'gym_admin'].includes(queryRole) ? queryRole : null);
  const normalizeRole = (role) => ({ nutritionist: 'coach', super_admin: 'gym_admin', gym_owner: 'gym_admin' }[role] || role);
  const visualRole = (role) => role === 'gym_admin' ? 'admin' : role;
  const dataService = window.Nutrilev.services.platformData;
  const state = { role: visualRole(forcedRole || 'student'), remote: false, dataError: null };
  const remoteData = { membership: null, academyDetails: null, workouts: null, students: null, coaches: null, checkins: null, progress: null, plan: null, subscription: { plan: 'free' }, hydration: [], notifications: [], coachStudents: [], exercises: [], evolution: [], gym: null, adminStats: null, profile: null };
  const PLAN_ENTITLEMENTS = {
    free: new Set(['meal_tracking', 'hydration', 'basic_calorie_goals', 'assigned_workouts']),
    plus: new Set(['meal_tracking', 'hydration', 'basic_calorie_goals', 'assigned_workouts', 'nutri_ai', 'complete_progress', 'unlimited_history']),
  };
  const offlineCacheKey = (userId) => `nutrilev.offline.cache.${userId}`;
  const localDayKey = (date = new Date()) => {
    const value = new Date(date);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  };
  let midnightRefreshTimer = null;
  function scheduleMidnightRefresh() {
    if (midnightRefreshTimer) window.clearTimeout(midnightRefreshTimer);
    const nextDay = new Date();
    nextDay.setHours(24, 0, 2, 0);
    midnightRefreshTimer = window.setTimeout(async () => {
      await refreshStudentData(true);
      scheduleMidnightRefresh();
    }, Math.max(1000, nextDay.getTime() - Date.now()));
  }
  function saveOfflineCache(userId) {
    if (!userId || !state.remote || state.role !== 'student') return;
    localStorage.setItem(offlineCacheKey(userId), JSON.stringify({
      saved_at: new Date().toISOString(),
      workouts: remoteData.workouts,
      progress: remoteData.progress,
      plan: remoteData.plan,
      hydration: remoteData.hydration,
      profile: remoteData.profile,
      membership: remoteData.membership,
      academyDetails: remoteData.academyDetails,
      subscription: remoteData.subscription,
    }));
  }
  async function refreshStudentData(force = false) {
    if (!state.remote || state.role !== 'student' || !navigator.onLine || refreshInProgress || (!force && Date.now() - lastRefreshAt < 5000)) return;
    refreshInProgress = true;
    try {
      const user = await dataService.user();
      if (!user) return;
      const [profile, membership, subscription, workouts, progress, plan, hydration] = await Promise.all([
        dataService.studentProfile(),
        dataService.membership(),
        dataService.subscription(),
        dataService.assignedWorkouts(),
        dataService.studentProgress(),
        dataService.studentPlan(),
        dataService.hydrationHistory(),
      ]);
      remoteData.profile = profile;
      remoteData.membership = membership;
      remoteData.subscription = subscription;
      remoteData.workouts = workouts;
      remoteData.progress = progress;
      remoteData.plan = plan;
      remoteData.hydration = hydration;
      try {
        remoteData.notifications = await dataService.notifications();
      } catch (error) {
        console.error('Optional student data load failed: notifications', error);
        remoteData.notifications = [];
      }
      remoteData.profile = profile;
      lastRefreshAt = Date.now();
      setUserIdentity({ ...user, user_metadata: { ...user.user_metadata, full_name: profile?.full_name || user.user_metadata?.full_name } });
      saveOfflineCache(user.id);
      render();
    } catch (error) {
      console.error('Cross-device data refresh failed', error);
    } finally {
      refreshInProgress = false;
    }
  }
  function loadOfflineCache(userId) {
    try {
      const cached = JSON.parse(localStorage.getItem(offlineCacheKey(userId)) || 'null');
      if (!cached) return false;
      Object.assign(remoteData, cached);
      return true;
    } catch (error) {
      console.error('Offline cache unavailable', error);
      return false;
    }
  }
  function offlineStatus() {
    return !navigator.onLine ? '<div class="offline-status" role="status">Modo offline: exibindo dados sincronizados. Ações pendentes serão enviadas quando a conexão voltar.</div>' : '';
  }
  function hasBenefit(benefit) {
    const subscription = remoteData.subscription || { plan: 'free', status: 'active' };
    if (!['active', 'trialing'].includes(subscription.status || 'active')) return false;
    return PLAN_ENTITLEMENTS[subscription.plan]?.has(benefit) || PLAN_ENTITLEMENTS.free.has(benefit) && subscription.plan === 'free';
  }
  function hasPlusPlan() {
    return hasBenefit('complete_progress');
  }
  function plusUpgradeCard(feature) {
    return `<article class="card upgrade-card"><span class="eyebrow">RECURSO DO NUTRILEV PLUS</span><h2>${esc(feature)}</h2><p class="admin-copy">Este recurso está disponível no plano Plus. No Free, você continua com refeições, água, metas básicas e treinos enviados pela academia.</p><a class="primary-button" href="landing.html#planos">Conhecer o Nutrilev Plus <span>→</span></a></article>`;
  }
  function errorState(message = 'Não foi possível carregar os dados agora.') {
    return `<article class="card state-card error-state" role="alert"><strong>Não foi possível carregar esta área.</strong><p>${esc(message)}</p><button class="primary-button" type="button" data-action="retry-data">Tentar novamente</button></article>`;
  }
  const students = [];
  const roleLabels = { student: 'Aluno', coach: 'Coach / Personal', admin: 'Administração' };
  const navByRole = {
    student: [['overview', '⌂', 'Visão geral'], ['plan', '☰', 'Meu plano'], ['academy', '▣', 'Minha Academia'], ['progress', '◔', 'Meu progresso'], ['assistant', '✦', 'Nutri IA'], ['profile', '◉', 'Meu perfil']],
    coach: [['overview', '⌂', 'Dashboard'], ['clients', '◎', 'Meus alunos'], ['workouts', '☰', 'Treinos'], ['exercises', '◇', 'Exercícios'], ['evolution', '◔', 'Evolução'], ['notifications', '♢', 'Notificações'], ['profile', '◉', 'Perfil']],
    admin: [['overview', '⌂', 'Dashboard'], ['members', '◎', 'Alunos'], ['coaches', '♧', 'Coaches'], ['gym', '▣', 'Academia'], ['attendance', '◷', 'Frequência'], ['checkins', '✓', 'Check-ins'], ['reports', '▤', 'Relatórios'], ['settings', '⚙', 'Configurações']],
  };
  const mobileStudentNav = window.Nutrilev.mobile.studentNavigation;
  const esc = window.Nutrilev.utils.escapeHtml;
  const page = () => location.hash.replace('#/', '') || 'overview';
  const dashboard = document.getElementById('dashboard');
  let refreshInProgress = false;
  let lastRefreshAt = 0;
  let loginInProgress = false;
  let workoutTimer = null;
  let restTimer = null;
  let activeWorkoutStartedAt = null;
  function stopWorkoutTimers() {
    if (workoutTimer) window.clearInterval(workoutTimer);
    if (restTimer) window.clearInterval(restTimer);
    workoutTimer = null;
    restTimer = null;
  }
  function updateKeyboardState() {
    const viewport = window.visualViewport;
    const keyboardOpen = viewport && window.innerHeight - viewport.height > 140;
    document.body.classList.toggle('keyboard-open', Boolean(keyboardOpen));
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateKeyboardState);
    window.visualViewport.addEventListener('scroll', updateKeyboardState);
  }
  document.addEventListener('focusin', updateKeyboardState);
  document.addEventListener('focusout', () => window.setTimeout(updateKeyboardState, 120));
  updateKeyboardState();
  function setUserIdentity(user, role = state.role) {
    const name = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Usuário';
    const initial = name.trim().charAt(0).toUpperCase() || 'U';
    document.getElementById('userName').textContent = name;
    document.getElementById('userInitial').textContent = initial;
    const avatar = user?.user_metadata?.avatar_url || remoteData.profile?.avatar_url || '';
    const identity = document.getElementById('userInitial');
    if (avatar) {
      identity.innerHTML = `<img src="${esc(avatar)}" alt="" />`;
      identity.classList.add('has-avatar');
    } else {
      identity.textContent = initial;
      identity.classList.remove('has-avatar');
    }
    document.getElementById('userRole').textContent = roleLabels[role] || role;
  }
  function notificationPanel() {
    const notifications = remoteData.notifications || [];
    const unread = notifications.filter((item) => !item.read_at);
    return `<div class="notification-panel" id="notificationPanel" role="dialog" aria-label="Notificações" hidden><div class="notification-panel-header"><strong>Notificações</strong>${unread.length ? '<button type="button" data-mark-all-notifications>Marcar todas como lidas</button>' : ''}</div><div class="notification-panel-list">${notifications.length ? notifications.slice(0, 8).map((item) => `<button class="notification-panel-item${item.read_at ? '' : ' unread'}" type="button" data-notification-id="${esc(item.id)}" ${item.read_at ? 'disabled' : ''}><span class="notification-panel-dot"></span><span><strong>${esc(item.title || 'Aviso Nutrilev')}</strong><small>${esc(item.body || '')}</small><time>${new Date(item.created_at).toLocaleString('pt-BR')}</time></span></button>`).join('') : '<p class="empty-state">Você não possui notificações no momento.</p>'}</div></div>`;
  }
  async function refreshNotifications() {
    if (!state.remote || !navigator.onLine) return;
    try {
      remoteData.notifications = await dataService.notifications();
    } catch (error) {
      console.error('Notifications load failed', error);
    }
  }
  function bindNotificationButton() {
    const button = document.querySelector('.icon-button[aria-label="Notificações"]');
    if (!button || button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.insertAdjacentHTML('afterend', notificationPanel());
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await refreshNotifications();
      const panel = document.getElementById('notificationPanel');
      if (!panel) return;
      panel.outerHTML = notificationPanel();
      document.getElementById('notificationPanel').hidden = false;
    });
    document.addEventListener('click', async (event) => {
      const panel = document.getElementById('notificationPanel');
      const markAll = event.target.closest('[data-mark-all-notifications]');
      const item = event.target.closest('[data-notification-id]');
      if (markAll || item) {
        try {
          if (markAll) await dataService.markAllNotificationsRead();
          else await dataService.markNotificationRead(item.dataset.notificationId);
          await refreshNotifications();
          panel.outerHTML = notificationPanel();
          document.getElementById('notificationPanel').hidden = false;
        } catch (error) {
          console.error('Notification update failed', error);
        }
        return;
      }
      if (!panel || panel.hidden || panel.contains(event.target) || event.target === button) return;
      panel.hidden = true;
    });
  }

  function renderNav() {
    const links = window.NUTRILEV_MOBILE_APP && state.role === 'student' ? mobileStudentNav : navByRole[state.role];
    document.getElementById('mainNav').innerHTML = links.map(([id, icon, label]) => `<a class="nav-link" aria-label="${label}" href="#/${id}"><span aria-hidden="true">${icon}</span><b>${label}</b></a>`).join('');
    document.querySelectorAll('#mainNav .nav-link').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#/${page()}`));
  }
  function shell(title, eyebrow, content) {
    stopWorkoutTimers();
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageEyebrow').textContent = eyebrow;
    renderNav();
    dashboard.innerHTML = `${offlineStatus()}<div class="dashboard-grid page-${page()}">${content}</div>`;
    bindNotificationButton();
    window.Nutrilev.layouts.setBusy(false);
  }
  const cardHeading = window.Nutrilev.components.cardHeading;
  const academyName = '';
  const checkinSourceLabels = { facial: 'Reconhecimento facial', qr: 'QR Code', manual: 'Manual', integration: 'Integração' };
  function studentAcademy() {
    const membership = state.remote ? remoteData.membership : null;
    const deepLinkCode = window.Nutrilev.deepLinks?.pendingKey ? localStorage.getItem(window.Nutrilev.deepLinks.pendingKey) : '';
    const pendingCode = membership?.status === 'active' ? '' : (membership?.code || deepLinkCode || '');
    return `<article class="card academy-join-card">${cardHeading('Minha Academia')}<p class="admin-copy">Use o código enviado pela sua academia ou cole um link de convite para conectar seu perfil ao acompanhamento dos Coaches.</p><form id="academyCodeForm" class="academy-code-form"><label>Código do convite<input name="code" value="${esc(pendingCode)}" placeholder="Ex.: NUTRI-8F29" aria-label="Código do convite" /></label><label>Link de convite<input name="inviteLink" type="url" placeholder="Cole aqui o link recebido" aria-label="Link de convite" /></label><button class="primary-button" type="submit">Vincular academia</button></form><p class="admin-copy">QR Code poderá ser ativado futuramente.</p><p class="form-message" id="academyCodeFeedback" hidden></p></article><article class="card side-card">${cardHeading('Vínculo atual')}<div id="academyMembership">${membership?.status === 'active' ? `<span class="status">Vinculado</span><h3>${esc(membership.gymName)}</h3><p class="admin-copy">Seu histórico pessoal continua pertencendo à sua conta Nutrilev.</p>` : '<p class="empty-state">Você ainda não está vinculado a uma academia.</p>'}</div></article>`;
  }
  function bindStudentAcademy() {
    const form = document.getElementById('academyCodeForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const link = form.elements.inviteLink.value.trim();
      let linkCode = '';
      if (link) {
        try {
          linkCode = new URL(link, window.location.origin).searchParams.get('code') || link.split('/').pop();
        } catch (error) {
          linkCode = '';
        }
      }
      const code = (form.elements.code.value.trim() || linkCode).toUpperCase();
      const feedback = document.getElementById('academyCodeFeedback');
      if (state.remote) {
        try {
          const membership = await dataService.acceptInvitation(code);
          localStorage.removeItem(window.Nutrilev.deepLinks?.pendingKey || 'nutrilev.pending.academy.invite');
          remoteData.membership = membership;
          render();
        } catch (error) {
          feedback.textContent = error.message || 'Código inválido ou expirado.';
          feedback.className = 'form-message';
          feedback.hidden = false;
        }
        return;
      }
      feedback.textContent = 'Entre na sua conta para vincular uma academia aos seus dados reais.';
      feedback.className = 'form-message';
      feedback.hidden = false;
    });
    document.addEventListener('click', async (event) => {
      if (event.target.closest('[data-confirm-academy], [data-cancel-academy]')) location.hash = '#/academy';
    });
  }
  function studentAcademySummary() {
    const membership = state.remote ? remoteData.membership : null;
    if (membership?.status !== 'active') {
      return `<article class="card section-card student-academy-summary">${cardHeading('Minha Academia')}<p class="admin-copy">Você ainda não está vinculado a uma academia.</p><a class="primary-button" href="#/academy">Adicionar academia</a></article>`;
    }
    return `<article class="card table-card student-academy-summary">${cardHeading('Minha Academia', window.NUTRILEV_MOBILE_APP ? 'academy-details' : 'academy')}<div class="student-academy-facts"><div><span>Academia</span><strong>${esc(membership.gymName)}</strong></div><div><span>Coach</span><strong>A definir</strong></div><div><span>Frequência</span><strong>Sem registros</strong></div><div><span>Treino do dia</span><strong>Não definido</strong></div><div><span>Evolução</span><strong>Sem avaliações</strong></div><div><span>Último check-in</span><strong>Sem registros</strong></div></div></article>`;
  }
  function nutritionIntegrationCard() {
    const plan = remoteData.plan || { entries: [], goals: [] };
    const calories = plan.entries.reduce((total, entry) => total + Number(entry.calories || 0), 0);
    const protein = plan.entries.reduce((total, entry) => total + Number(entry.protein_grams || 0), 0);
    const calorieGoal = plan.goals.find((goal) => goal.type === 'calories');
    const proteinGoal = plan.goals.find((goal) => goal.type === 'protein');
    const hasData = plan.entries.length || plan.goals.length;
    return `<article class="card table-card integration-card">${cardHeading('Treino + alimentação + evolução')}<p class="admin-copy">Seus registros aparecerão aqui depois que você configurar seu plano e registrar atividades.</p>${hasData ? `<div class="integration-metrics"><div><span>Calorias registradas</span><strong>${calories} kcal</strong><small>Meta: ${calorieGoal?.target_value || 'não definida'} kcal</small></div><div><span>Proteína registrada</span><strong>${protein} g</strong><small>Meta: ${proteinGoal?.target_value || 'não definida'} g</small></div></div>` : '<p class="empty-state">Nenhum dado nutricional cadastrado ainda.</p>'}</article>`;
  }
  function whatToEatNowCard(remainingCalories, remainingProtein, foods) {
    const availableFoods = (foods || []).slice(0, 100)
      .map((food) => ({ ...food, calories: Number(food.calories), protein: Number(food.protein_grams), serving: Number(food.serving_size) || 1 }))
      .filter((food) => food.name && Number.isFinite(food.calories) && food.calories > 0 && Number.isFinite(food.protein) && food.protein >= 0);
    if (remainingCalories == null || remainingProtein == null) {
      return `<article class="card ai-feature-card"><span class="eyebrow">NUTRI IA</span><h3>O que comer agora?</h3><p class="admin-copy">Configure sua meta calórica e de proteína para receber sugestões baseadas no catálogo nutricional.</p><a class="outline-button" href="#/plan">Configurar alimentação</a></article>`;
    }
    const options = [];
    for (let first = 0; first < availableFoods.length && options.length < 3; first += 1) {
      for (let second = first + 1; second < availableFoods.length && options.length < 3; second += 1) {
        const items = [availableFoods[first], availableFoods[second]];
        const calories = items.reduce((sum, item) => sum + item.calories, 0);
        const protein = items.reduce((sum, item) => sum + item.protein, 0);
        if (calories <= remainingCalories && protein >= Math.min(remainingProtein, 20)) {
          options.push({ items, calories, protein });
        }
      }
    }
    if (!options.length) {
      return `<article class="card ai-feature-card"><span class="eyebrow">NUTRI IA</span><h3>O que comer agora?</h3><p class="admin-copy">Você ainda tem <strong>${Math.round(remainingCalories)} kcal</strong> disponíveis e <strong>${Math.round(remainingProtein)} g</strong> de proteína restante.</p><p class="empty-state">Não encontramos uma combinação adequada no catálogo nutricional atual.</p><a class="outline-button" href="#/plan">Pesquisar alimentos</a></article>`;
    }
    return `<article class="card ai-feature-card"><div class="ai-feature-heading"><div><span class="eyebrow">NUTRI IA</span><h3>O que comer agora?</h3></div><span class="ai-feature-icon">🍽️</span></div><p class="ai-feature-summary">Você ainda tem <strong>${Math.round(remainingCalories)} kcal</strong> disponíveis.<br><strong>Proteína restante: ${Math.round(remainingProtein)} g.</strong></p><div class="ai-suggestion-grid">${options.map((option, index) => `<div class="ai-suggestion"><span class="eyebrow">OPÇÃO ${index + 1}</span><strong>${option.items.map((item) => esc(item.name)).join(' + ')}</strong><small>${Math.round(option.calories)} kcal · ${Math.round(option.protein)} g proteína</small></div>`).join('')}</div><p class="metric-meta">Valores calculados com os alimentos e porções disponíveis no catálogo.</p><a class="outline-button" href="#/assistant" data-ai-prompt="O que posso comer agora?">Pedir outras sugestões</a></article>`;
  }
  function studentOverview() {
    const assigned = state.remote ? (remoteData.workouts || []) : getSavedWorkouts();
    const assignedCard = `<article class="card table-card">${cardHeading('Treinos enviados pelo Coach','plan')}<div class="student-workout-list">${assigned.length ? assigned.map((workout) => `<div class="student-workout"><div><strong>${esc(workout.name)}</strong><small>${esc(workout.muscles)} · ${workout.exercises.length} exercícios</small></div><span class="status">Disponível</span></div>`).join('') : '<p class="empty-state">Seu Coach ainda não enviou uma ficha.</p>'}</div></article>`;
    const meals = remoteData.plan?.meals || [];
    const mealContent = meals.length ? meals.map((meal) => `<div class="meal-item"><div class="meal-icon">🍽</div><div class="meal-copy"><strong>${esc(meal.name)}</strong><small>${new Date(meal.consumed_at || meal.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div><span class="status">Registrada</span></div>`).join('') : '<div class="empty-state"><strong>Comece registrando sua primeira refeição.</strong><p>Assim você acompanha suas metas ao longo do dia.</p></div>';
    const plan = remoteData.plan || { entries: [], goals: [] };
    const progress = remoteData.progress || { workoutLogs: [] };
    const calories = plan.entries.reduce((sum, entry) => sum + Number(entry.calories || 0), 0);
    const calorieGoal = plan.goals.find((goal) => goal.type === 'calories')?.target_value;
    const protein = plan.entries.reduce((sum, entry) => sum + Number(entry.protein_grams || 0), 0);
    const proteinGoal = plan.goals.find((goal) => goal.type === 'protein')?.target_value;
    const carbohydrates = plan.entries.reduce((sum, entry) => sum + Number(entry.carbohydrates_grams || entry.carbs_grams || entry.carbs_g || 0), 0);
    const fats = plan.entries.reduce((sum, entry) => sum + Number(entry.fat_grams || entry.fats_grams || entry.fats_g || 0), 0);
    const remainingCalories = calorieGoal == null ? null : Math.max(0, Number(calorieGoal) - calories);
    const calorieProgress = calorieGoal ? Math.min(100, Math.round(calories / Number(calorieGoal) * 100)) : 0;
    const todayKey = localDayKey();
    const todayHydration = (remoteData.hydration || []).filter((entry) => localDayKey(entry.consumed_at) === todayKey);
    const water = todayHydration.reduce((sum, entry) => sum + Number(entry.amount_ml || 0), 0);
    const waterGoal = 2500;
    const waterProgress = Math.min(100, Math.round(water / waterGoal * 100));
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    const weeklyLogs = progress.workoutLogs.filter((log) => new Date(log.performed_at) >= weekStart);
    const dailyProgress = calorieGoal || plan.entries.length || progress.workoutLogs.length ? Math.min(100, Math.round((calorieProgress + (plan.entries.length ? 25 : 0) + (weeklyLogs.length ? 25 : 0) + (remoteData.membership ? 25 : 0)) / 2)) : 0;
    const greeting = document.getElementById('userName')?.textContent || 'você';
    const hour = new Date().getHours();
    const greetingLabel = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const latestEvolution = progress.measurements?.length ? progress.measurements[progress.measurements.length - 1] : null;
    const evolutionLabel = latestEvolution?.weight_kg ? `${Number(latestEvolution.weight_kg).toLocaleString('pt-BR')} kg em ${new Date(latestEvolution.measured_at).toLocaleDateString('pt-BR')}` : 'Nenhuma avaliação registrada';
    const workoutOfDay = assigned[0];
    const academyLabel = remoteData.membership?.gymName || 'Nenhuma academia vinculada';
    const evolution = weeklyLogs.length ? `<div class="profile-facts"><div><span>Treinos nos últimos 7 dias</span><strong>${weeklyLogs.length}</strong></div><div><span>Refeições hoje</span><strong>${meals.length}</strong></div><div><span>Calorias hoje</span><strong>${Math.round(calories)} kcal</strong></div></div>` : '<p class="empty-state">Registre treinos para acompanhar sua evolução semanal.</p>';
    shell('Seu dia mais leve', 'VISÃO GERAL', `<article class="card welcome-card"><div><span class="eyebrow">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</span><h2>${greetingLabel}, <span id="studentGreetingName">${esc(greeting)}</span> <span>✦</span></h2><p>${remainingCalories == null ? 'Defina sua meta calórica para acompanhar o dia.' : `Você ainda tem ${Math.round(remainingCalories)} kcal disponíveis hoje.`}</p></div><div class="welcome-illustration">🥗</div></article>${whatToEatNowCard(remainingCalories, proteinGoal == null ? null : Math.max(0, Number(proteinGoal) - protein), plan.foods)}<article class="card dashboard-calories"><span class="eyebrow">META CALÓRICA</span><div class="dashboard-calorie-grid"><div><strong>${calorieGoal == null ? '—' : `${Math.round(Number(calorieGoal))} kcal`}</strong><small>Meta diária</small></div><div><strong>${Math.round(calories)} kcal</strong><small>Consumidas</small></div><div><strong>${remainingCalories == null ? '—' : `${Math.round(remainingCalories)} kcal`}</strong><small>Restantes</small></div></div><div class="progress-track"><span style="width:${calorieProgress}%"></span></div></article><article class="card dashboard-macros">${cardHeading('Resumo nutricional')}<div class="dashboard-macro-grid"><div><span>Proteína</span><strong>${Math.round(protein)} / ${proteinGoal == null ? '—' : Math.round(Number(proteinGoal))} g</strong></div><div><span>Carboidratos</span><strong>${carbohydrates ? `${Math.round(carbohydrates)} g` : '—'}</strong></div><div><span>Gorduras</span><strong>${fats ? `${Math.round(fats)} g` : '—'}</strong></div><div><span>Água</span><strong>${water} / ${waterGoal} ml</strong></div></div></article><article class="card dashboard-status-grid"><div><span class="eyebrow">TREINO DE HOJE</span><strong>${esc(workoutOfDay?.name || 'Nenhum treino atribuído')}</strong><small>${esc(workoutOfDay?.muscles || 'Consulte seu Coach para saber o próximo treino.')}</small></div><div><span class="eyebrow">ÚLTIMA EVOLUÇÃO</span><strong>${esc(evolutionLabel)}</strong><small>${latestEvolution ? 'Avaliação corporal mais recente' : 'Registre uma avaliação para acompanhar'}</small></div><div><span class="eyebrow">ACADEMIA VINCULADA</span><strong>${esc(academyLabel)}</strong><small>${remoteData.membership ? 'Vínculo ativo' : 'Nenhum vínculo ativo'}</small></div></article>${studentAcademySummary()}<article class="card section-card">${cardHeading('Refeições de hoje','plan')}<div class="meal-list">${mealContent}</div><a class="outline-button" href="#/plan">Gerenciar refeições</a></article><article class="card side-card hydration-summary-card">${cardHeading('Hidratação','hydration')}<div class="water-row"><div class="water-circle">${waterProgress}%</div><div><strong>${water} ml consumidos</strong><p class="metric-meta">Meta diária: ${waterGoal.toLocaleString('pt-BR')} ml</p><div class="hydration-quick-buttons"><button class="outline-button" type="button" data-action="water" data-water-amount="200">+200 ml</button><button class="outline-button" type="button" data-action="water" data-water-amount="300">+300 ml</button><button class="outline-button" type="button" data-action="water" data-water-amount="500">+500 ml</button></div><a class="hydration-history-link" href="#/hydration">Ver histórico</a></div></div></article>${assignedCard}<article class="card section-card">${cardHeading('Evolução semanal','progress')}${evolution}<a class="outline-button" href="#/progress">Ver evolução completa</a></article>`);
  }
  function studentHydration() {
    const goal = 2500;
    const todayKey = localDayKey();
    const entries = remoteData.hydration || [];
    const today = entries.filter((entry) => localDayKey(entry.consumed_at) === todayKey);
    const consumed = today.reduce((sum, entry) => sum + Number(entry.amount_ml || 0), 0);
    const byDay = new Map();
    entries.forEach((entry) => {
      const key = new Date(entry.consumed_at).toLocaleDateString('pt-BR');
      byDay.set(key, (byDay.get(key) || 0) + Number(entry.amount_ml || 0));
    });
    const history = [...byDay.entries()].map(([date, amount]) => `<div class="hydration-history-row"><strong>${date}</strong><span>${amount.toLocaleString('pt-BR')} ml</span><small>${Math.min(100, Math.round(amount / goal * 100))}% da meta</small></div>`).join('');
    shell('Hidratação', 'CONTROLE DE ÁGUA', `<article class="card hydration-hero"><div><span class="eyebrow">META DIÁRIA</span><h2>${goal.toLocaleString('pt-BR')} ml</h2><p>Registre sua água ao longo do dia e acompanhe seu histórico.</p></div><div class="hydration-hero-icon">💧</div></article><article class="card hydration-today-card">${cardHeading('Hoje')}<div class="hydration-today-values"><div><span>Meta</span><strong>${goal.toLocaleString('pt-BR')} ml</strong></div><div><span>Consumido</span><strong>${consumed.toLocaleString('pt-BR')} ml</strong></div><div><span>Restante</span><strong>${Math.max(0, goal - consumed).toLocaleString('pt-BR')} ml</strong></div></div><div class="progress-track"><span style="width:${Math.min(100, Math.round(consumed / goal * 100))}%"></span></div><div class="hydration-quick-buttons hydration-page-buttons"><button class="primary-button" type="button" data-action="water" data-water-amount="200">+200 ml</button><button class="primary-button" type="button" data-action="water" data-water-amount="300">+300 ml</button><button class="primary-button" type="button" data-action="water" data-water-amount="500">+500 ml</button></div></article><article class="card hydration-history-card">${cardHeading('Histórico de hidratação')}<div class="hydration-history-list">${history || '<p class="empty-state">Nenhum registro de água ainda.</p>'}</div></article>`);
  }
  function studentAcademyDetails() {
    const academy = remoteData.academyDetails;
    if (!academy) {
      shell('Minha Academia', 'VÍNCULO COM A ACADEMIA', `<article class="card academy-join-card">${cardHeading('Minha Academia')}<p class="admin-copy">Você ainda não está vinculado a uma academia.</p><a class="primary-button" href="#/academy-invite">Vincular academia</a><p class="admin-copy">Use um código ou link de convite. O QR Code poderá ser usado futuramente.</p></article>`);
      return;
    }
    const logo = academy.gymLogo ? `<img class="academy-logo" src="${esc(academy.gymLogo)}" alt="Logo da ${esc(academy.gymName)}" />` : '<div class="academy-logo-placeholder">🏢</div>';
    const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklyCheckins = (academy.checkins || []).filter((checkin) => new Date(checkin.timestamp).getTime() >= weekStart);
    const sourceLabel = { facial: 'Sistema externo', qr: 'QR Code', manual: 'Manual', integration: 'API/Webhook' };
    const checkinRows = (academy.checkins || []).slice(0, 12).map((checkin) => `<div class="checkin-history-row"><div><strong>${esc(checkin.timestampLabel)}</strong><small>${esc(sourceLabel[checkin.source] || 'Integração externa')}</small></div><span class="status">Recebido</span></div>`).join('');
    shell('Minha Academia', 'VÍNCULO COM A ACADEMIA', `<article class="card academy-profile-hero"><div class="academy-brand-row">${logo}<div><span class="eyebrow">ACADEMIA VINCULADA</span><h2>${esc(academy.gymName)}</h2><p>Seu histórico pessoal continua pertencendo à sua conta Nutrilev.</p></div></div><span class="status">Vinculado</span></article><article class="card table-card academy-details-card">${cardHeading('Resumo da academia')}<div class="student-academy-facts"><div><span>Coach</span><strong>${esc(academy.coachName)}</strong></div><div><span>Treino atual</span><strong>${esc(academy.currentWorkout)}</strong></div><div><span>Frequência</span><strong>Você treinou ${weeklyCheckins.length} vez${weeklyCheckins.length === 1 ? '' : 'es'} esta semana.</strong></div><div><span>Último check-in</span><strong>${esc(academy.lastCheckin === 'Sem registros' ? academy.lastCheckin : `Seu último acesso foi ${academy.lastCheckin}.`)}</strong></div><div><span>Evolução</span><strong>${esc(academy.evolution)}</strong></div></div></article><article class="card section-card academy-checkin-history">${cardHeading('Histórico de frequência')}<p class="admin-copy">Registros recebidos da academia por integração externa. O aplicativo não realiza reconhecimento facial.</p><div class="checkin-history-list">${checkinRows || '<p class="empty-state">Nenhum registro de frequência recebido ainda.</p>'}</div></article>`);
  }
  function studentWorkout() {
    const workouts = state.remote ? (remoteData.workouts || []) : getSavedWorkouts();
    const workout = workouts[0];
    if (!workout) {
      shell('Meu treino', 'TREINO DO DIA', '<article class="card section-card student-workout-empty"><div class="empty-state"><strong>Você ainda não possui um treino cadastrado.</strong><p>Quando seu Coach enviar uma ficha, ela aparecerá aqui.</p><a class="primary-button" href="#/academy-details">Ver Minha Academia</a></div></article>');
      return;
    }
    const exercises = workout.exercises || [];
    const rows = exercises.length ? exercises.map((exercise, index) => {
      const sets = exercise.sets ?? exercise[1]?.match?.(/\d+/)?.[0];
      const reps = exercise.reps ?? exercise[1]?.match?.(/·\s*(\d+)/)?.[1];
      const load = exercise.load ?? '';
      const rest = exercise.rest ? `${exercise.rest} s` : 'Não informado';
      return `<article class="workout-exercise-card" data-exercise-index="${index}"><div class="workout-exercise-title"><span class="workout-exercise-number">${index + 1}</span><h3>${esc(exercise.name || exercise[0] || 'Exercício')}</h3><span class="status exercise-status">Pendente</span></div><div class="workout-exercise-facts"><label><span>Séries concluídas</span><input class="workout-input" data-field="sets" type="number" min="0" max="${esc(sets || 99)}" value="0" /></label><label><span>Repetições</span><input class="workout-input" data-field="reps" type="number" min="0" value="${esc(reps || '')}" /></label><label><span>Carga (kg)</span><input class="workout-input" data-field="load" type="number" min="0" step="0.5" value="${esc(load || '')}" /></label><div><span>Descanso</span><strong>${esc(rest)}</strong></div></div><div class="workout-exercise-actions"><button class="outline-button" type="button" data-rest-seconds="${Number(exercise.rest || 60)}" data-action="rest">Iniciar descanso</button><button class="primary-button" type="button" data-action="finish-exercise">Finalizar exercício</button></div></article>`;
    }).join('') : '<p class="empty-state">Este treino ainda não possui exercícios cadastrados.</p>';
    shell('Meu treino', 'TREINO DO DIA', `<article class="card workout-day-hero"><div><span class="eyebrow">TREINO DO DIA</span><h2>${esc(workout.name || 'Treino')}</h2><p>${esc(workout.muscles || 'Treino personalizado')} · ${exercises.length} exercício${exercises.length === 1 ? '' : 's'}</p><strong class="workout-elapsed" id="workoutElapsed">00:00</strong><a class="outline-button workout-academy-link" href="#/academy-details">Minha Academia</a></div><div class="workout-day-icon">🏋️</div></article><article class="card table-card student-workout-details">${cardHeading('Executar treino')}<div class="workout-exercise-list">${rows}</div><p class="form-message" id="workoutExecutionFeedback" hidden></p><button class="primary-button finish-workout-button" type="button" data-action="finish-workout">Finalizar treino</button></article><article class="card section-card workout-notes-card">${cardHeading('Observações')}<p class="${workout.notes ? 'admin-copy' : 'empty-state'}">${workout.notes ? esc(workout.notes) : 'Nenhuma observação cadastrada para este treino.'}</p></article>`);
    const workoutStorageKey = `nutrilev.workout.started.${workout.id || workout.name || 'current'}`;
    const storedStartedAt = Number(sessionStorage.getItem(workoutStorageKey));
    const startedAt = Number.isFinite(storedStartedAt) && storedStartedAt > 0 ? storedStartedAt : Date.now();
    sessionStorage.setItem(workoutStorageKey, String(startedAt));
    activeWorkoutStartedAt = startedAt;
    const updateWorkoutElapsed = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const target = document.getElementById('workoutElapsed');
      if (target) target.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    };
    updateWorkoutElapsed();
    workoutTimer = window.setInterval(updateWorkoutElapsed, 1000);
    let restRemaining = 0;
    document.querySelectorAll('[data-action="rest"]').forEach((button) => button.addEventListener('click', () => {
      if (restTimer) window.clearInterval(restTimer);
      restRemaining = Number(button.dataset.restSeconds) || 60;
      const original = button.textContent;
      button.disabled = true;
      const tick = () => {
        button.textContent = `Descanso ${Math.floor(restRemaining / 60)}:${String(restRemaining % 60).padStart(2, '0')}`;
        if (restRemaining <= 0) {
          window.clearInterval(restTimer);
          restTimer = null;
          button.disabled = false;
          button.textContent = original;
        }
        restRemaining -= 1;
      };
      tick();
      restTimer = window.setInterval(tick, 1000);
    }));
    document.querySelectorAll('[data-action="finish-exercise"]').forEach((button) => button.addEventListener('click', () => {
      const card = button.closest('.workout-exercise-card');
      card.querySelector('[data-field="sets"]').value = card.querySelector('[data-field="sets"]').value || '0';
      card.querySelector('.exercise-status').textContent = 'Concluído';
      card.querySelector('.exercise-status').classList.add('exercise-complete');
      button.disabled = true;
      button.textContent = 'Exercício concluído';
    }));
    document.querySelector('[data-action="finish-workout"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const feedback = document.getElementById('workoutExecutionFeedback');
      const completed = [...document.querySelectorAll('.workout-exercise-card')].map((card, index) => ({
        exercise_index: index,
        name: exercises[index]?.name || exercises[index]?.[0] || 'Exercício',
        completed: card.querySelector('.exercise-status')?.classList.contains('exercise-complete') || false,
        sets_completed: Number(card.querySelector('[data-field="sets"]')?.value || 0),
        repetitions: Number(card.querySelector('[data-field="reps"]')?.value || 0),
        load_kg: Number(card.querySelector('[data-field="load"]')?.value || 0),
      }));
      if (completed.some((item) => !item.completed)) {
        feedback.textContent = 'Finalize cada exercício antes de finalizar o treino.';
        feedback.hidden = false;
        return;
      }
      button.disabled = true;
      try {
        await dataService.finishWorkout({ workoutId: workout.id, durationSeconds: Math.floor((Date.now() - startedAt) / 1000), exercises: completed });
        sessionStorage.removeItem(workoutStorageKey);
        activeWorkoutStartedAt = null;
        stopWorkoutTimers();
        shell('Meu treino', 'TREINO FINALIZADO', '<article class="card section-card workout-finished-card"><div class="empty-state">Treino finalizado e salvo com sucesso.</div><p class="admin-copy">Seu registro já está disponível no histórico de evolução.</p><a class="primary-button" href="#/progress">Ver evolução</a></article>');
      } catch (error) {
        feedback.textContent = error.message || 'Não foi possível salvar o treino.';
        feedback.hidden = false;
        button.disabled = false;
      }
    });
  }
  function studentProgress() {
    if (state.remote && !hasPlusPlan()) {
      shell('Meu progresso', 'ACOMPANHAMENTO PESSOAL', plusUpgradeCard('Acompanhe sua evolução com métricas completas.'));
      return;
    }
    const progress = state.remote ? remoteData.progress : null;
    const measurements = progress?.measurements || [];
    const logs = progress?.workoutLogs || [];
    const goals = progress?.goals || [];
    const latest = measurements[measurements.length - 1];
    const first = measurements[0];
    const weightDelta = latest?.weight_kg && first?.weight_kg ? latest.weight_kg - first.weight_kg : null;
    const chartValues = measurements.filter((item) => item.weight_kg != null).slice(-8);
    const maxWeight = chartValues.length ? Math.max(...chartValues.map((item) => Number(item.weight_kg))) : 1;
    const chart = chartValues.length ? chartValues.map((item) => {
      const height = Math.max(28, 28 + (Number(item.weight_kg) / maxWeight * 62));
      return `<div class="progress-chart-column"><span class="progress-chart-value">${Number(item.weight_kg).toLocaleString('pt-BR')} kg</span><span class="progress-chart-bar" style="height:${height}%"></span><small>${new Date(item.measured_at).toLocaleDateString('pt-BR', { month: 'short' })}</small></div>`;
    }).join('') : '<p class="empty-state">Registre sua primeira avaliação para acompanhar o peso ao longo do tempo.</p>';
    const bodyFat = latest?.body_fat_percentage != null ? Number(latest.body_fat_percentage) : null;
    const fatMass = latest?.fat_mass_kg != null ? Number(latest.fat_mass_kg) : null;
    const leanMass = latest?.lean_mass_kg != null ? Number(latest.lean_mass_kg) : (latest?.weight_kg != null && bodyFat != null ? Number(latest.weight_kg) * (1 - bodyFat / 100) : null);
    const heightMeters = latest?.height_cm ? Number(latest.height_cm) / 100 : null;
    const bmi = latest?.weight_kg && heightMeters > 0 ? Number(latest.weight_kg) / (heightMeters * heightMeters) : null;
    const bmiLabel = bmi == null ? 'Informe peso e altura' : bmi < 18.5 ? 'Abaixo do peso' : bmi < 25 ? 'Faixa adequada' : bmi < 30 ? 'Acima do peso' : 'Obesidade';
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const weeklyWorkouts = logs.filter((log) => new Date(log.performed_at).getTime() >= sevenDaysAgo).length;
    const monthlyWorkouts = logs.filter((log) => new Date(log.performed_at).getTime() >= thirtyDaysAgo).length;
    const averageDuration = logs.length ? Math.round(logs.reduce((sum, log) => sum + Number(log.duration_seconds || 0), 0) / logs.length / 60) : 0;
    const measurementCards = latest ? `<div class="evolution-measurements"><div><span>Peso</span><strong>${latest.weight_kg != null ? `${Number(latest.weight_kg).toLocaleString('pt-BR')} kg` : '—'}</strong></div><div><span>Altura</span><strong>${latest.height_cm != null ? `${Number(latest.height_cm).toLocaleString('pt-BR')} cm` : '—'}</strong></div><div><span>Cintura</span><strong>${latest.waist_cm != null ? `${Number(latest.waist_cm).toLocaleString('pt-BR')} cm` : '—'}</strong></div><div><span>Quadril</span><strong>${latest.hip_cm != null ? `${Number(latest.hip_cm).toLocaleString('pt-BR')} cm` : '—'}</strong></div></div>` : '<p class="empty-state">Registre uma avaliação para visualizar suas medidas.</p>';
    const executionItems = (log) => {
      try {
        const parsed = JSON.parse(log.notes || '{}');
        return Array.isArray(parsed.exercises) ? parsed.exercises : [];
      } catch (error) {
        return [];
      }
    };
    const exerciseHistory = new Map();
    logs.forEach((log) => executionItems(log).forEach((item) => {
      const name = String(item.name || '').trim();
      if (!name) return;
      if (!exerciseHistory.has(name)) exerciseHistory.set(name, []);
      exerciseHistory.get(name).push({ date: log.performed_at, load: Number(item.load_kg || 0), reps: Number(item.repetitions || 0), sets: Number(item.sets_completed || 0) });
    }));
    const comparisonRows = [...exerciseHistory.entries()].map(([name, records]) => `<div class="exercise-comparison-row"><div><strong>${esc(name)}</strong><small>${records.length} registro${records.length === 1 ? '' : 's'}</small></div><div class="exercise-comparison-values">${records.slice().reverse().slice(-6).map((record) => `<span><b>${new Date(record.date).toLocaleDateString('pt-BR', { month: 'short' })}</b><strong>${record.load ? `${record.load} kg` : '—'}</strong><small>${record.sets || '—'} séries · ${record.reps || '—'} reps</small></span>`).join('')}</div></div>`).join('');
    const workoutHistoryRows = logs.length ? logs.map((log) => {
      const items = executionItems(log);
      return `<div class="workout-history-row"><div><strong>${esc(log.workout_name || 'Treino')}</strong><small>${new Date(log.performed_at).toLocaleDateString('pt-BR')} · ${log.duration_seconds ? `${Math.round(log.duration_seconds / 60)} min` : 'Duração não informada'}</small></div><div class="workout-history-exercises">${items.length ? items.map((item) => `<span>${esc(item.name)} · ${item.load_kg ? `${item.load_kg} kg` : 'sem carga'} · ${item.sets_completed || '—'} séries · ${item.repetitions || '—'} reps</span>`).join('') : '<span>Detalhes não informados</span>'}</div></div>`;
    }).join('') : '<p class="empty-state">Nenhum treino registrado ainda.</p>';
    const composition = bodyFat == null ? `<article class="card section-card">${cardHeading('Composição corporal')}<p class="empty-state">O Coach ainda não compartilhou uma avaliação de composição corporal.</p></article>` : `<article class="card section-card composition-card">${cardHeading('Composição corporal')}<p class="admin-copy">Avaliação atual compartilhada pelo seu Coach · ${new Date(latest.measured_at).toLocaleDateString('pt-BR')}</p><div class="composition-bars"><div><span class="composition-value">${Number(latest.weight_kg).toLocaleString('pt-BR')} kg</span><b class="composition-bar current" style="height:${Math.min(100, Number(latest.weight_kg))}%"></b><small>Atual</small></div><div><span class="composition-value">${fatMass?.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) || '—'} kg</span><b class="composition-bar fat" style="height:${Math.min(100, fatMass || 0)}%"></b><small>Gordo</small></div><div><span class="composition-value">${leanMass?.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) || '—'} kg</span><b class="composition-bar lean" style="height:${Math.min(100, leanMass || 0)}%"></b><small>Magro</small></div></div><div class="profile-facts composition-facts"><div><span>Gordura atual</span><strong>${bodyFat.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</strong></div><div><span>Massa gorda</span><strong>${fatMass?.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) || '—'} kg</strong></div><div><span>Massa magra</span><strong>${leanMass?.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) || '—'} kg</strong></div><div><span>Método</span><strong>${esc(latest.body_fat_method || 'Pollock')}</strong></div></div></article>`;
    shell('Meu progresso', 'ACOMPANHAMENTO PESSOAL', `<article class="card evolution-dashboard-hero"><div><span class="eyebrow">EVOLUÇÃO PESSOAL</span><h2>Acompanhe sua evolução.</h2><p>Veja peso, medidas, frequência e desempenho dos seus treinos em um só lugar.</p></div><div class="evolution-dashboard-icon">📊</div></article><article class="card evolution-kpi-grid"><div><span>Peso atual</span><strong>${latest?.weight_kg ? `${Number(latest.weight_kg).toLocaleString('pt-BR')} kg` : '—'}</strong><small>${weightDelta == null ? 'Sem histórico comparável' : `${weightDelta > 0 ? '+' : ''}${Number(weightDelta).toLocaleString('pt-BR')} kg desde o primeiro registro`}</small></div><div><span>IMC</span><strong>${bmi == null ? '—' : bmi.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><small>${esc(bmiLabel)}</small></div><div><span>Treinos realizados</span><strong>${logs.length}</strong><small>${weeklyWorkouts} nos últimos 7 dias</small></div><div><span>Frequência mensal</span><strong>${monthlyWorkouts}</strong><small>${averageDuration ? `${averageDuration} min em média` : 'Duração ainda não registrada'}</small></div></article>${composition}<article class="card section-card evolution-measurements-card">${cardHeading('Medidas atuais')}<p class="admin-copy">${latest ? `Última avaliação em ${new Date(latest.measured_at).toLocaleDateString('pt-BR')}.` : 'Dados compartilhados pelo seu Coach aparecerão aqui.'}</p>${measurementCards}</article><article class="card section-card">${cardHeading('Evolução do peso')}<div class="profile-chart">${chart}</div><div class="profile-chart-legend"><span>Histórico dos últimos registros</span><strong>${latest?.weight_kg ? `${Number(latest.weight_kg).toLocaleString('pt-BR')} kg atual` : 'Sem registro'}</strong></div></article><article class="card table-card workout-history-card">${cardHeading('Histórico de treinos')}<div class="workout-history-list">${workoutHistoryRows}</div></article><article class="card table-card workout-comparison-card">${cardHeading('Comparar evolução por exercício')}<p class="admin-copy">Veja carga, séries e repetições registradas ao longo dos treinos.</p><div class="exercise-comparison-list">${comparisonRows || '<p class="empty-state">Finalize treinos para comparar sua evolução.</p>'}</div></article><article class="card section-card">${cardHeading('Metas ativas')}<div class="activity-list">${goals.length ? goals.map((goal) => `<div class="activity-item"><div class="client-copy"><strong>${esc(goal.name)}</strong><small>${goal.target_value != null ? `Meta: ${esc(goal.target_value)} ${esc(goal.unit || '')}` : 'Meta personalizada'}</small></div><span class="status">Ativa</span></div>`).join('') : '<p class="empty-state">Você ainda não tem metas cadastradas.</p>'}</div></article><article class="card section-card">${cardHeading('Registrar avaliação')}<form id="measurementForm" class="settings-list"><label>Peso (kg)<input name="weight_kg" type="number" min="1" step="0.01" required placeholder="Ex.: 72,5" /></label><label>Altura (cm)<input name="height_cm" type="number" min="1" step="0.1" placeholder="Ex.: 175" /></label><label>Observações<textarea name="notes" rows="3" placeholder="Como você está se sentindo?"></textarea></label><p class="form-message" id="measurementFeedback" hidden></p><button class="primary-button" type="submit">Salvar avaliação <span>→</span></button></form></article>`);
    document.getElementById('measurementForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const feedback = document.getElementById('measurementFeedback');
      const button = form.querySelector('button');
      button.disabled = true;
      feedback.hidden = true;
      try {
        const values = new FormData(form);
        await dataService.addMeasurement({ weight_kg: Number(values.get('weight_kg')), height_cm: values.get('height_cm') ? Number(values.get('height_cm')) : null, notes: values.get('notes')?.trim() || null });
        remoteData.progress = await dataService.studentProgress();
        studentProgress();
      } catch (error) {
        feedback.textContent = error.message || 'Não foi possível salvar sua avaliação.';
        feedback.hidden = false;
      } finally {
        button.disabled = false;
      }
    });
  }
  async function estimateMealNutrition(message) {
    const session = await client?.auth.getSession();
    const accessToken = session?.data?.session?.access_token;
    if (!accessToken) throw new Error('Entre novamente para consultar os dados nutricionais.');
    const response = await fetch(`${window.Nutrilev.config.supabaseUrl}/functions/v1/nutri-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ action: 'estimate_nutrition', message, servings: 1 }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível consultar a API nutricional.');
    if (!Number.isFinite(Number(payload.calories)) || !Number.isFinite(Number(payload.protein))) throw new Error('A IA não retornou valores nutricionais para esse nome.');
    return payload;
  }
  async function searchAiFoodItems(message) {
    const session = await client?.auth.getSession();
    const accessToken = session?.data?.session?.access_token;
    if (!accessToken) throw new Error('Entre novamente para consultar os alimentos.');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60000);
    const response = await fetch(`${window.Nutrilev.config.supabaseUrl}/functions/v1/nutri-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ action: 'food_search', food_text: message }),
      signal: controller.signal,
    });
    window.clearTimeout(timeout);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível consultar a fonte nutricional.');
    const items = Array.isArray(payload.items) ? payload.items : [];
    const normalizedItems = items.map((item) => {
      const name = String(item?.name || '').trim();
      const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
      return {
        ...item,
        name,
        matched: item?.matched !== false,
        protein: Number(item?.protein ?? item?.protein_grams),
        carbs: Number(item?.carbs ?? item?.carbohydrates ?? item?.carbohydrate),
        food_id: item?.food_id || `gemini-${slug}`,
      };
    });
    if (!normalizedItems.length || normalizedItems.some((item) => !item.name || !Number.isFinite(item.calories) || !Number.isFinite(item.protein) || !Number.isFinite(item.carbs) || !item.food_id)) {
      throw new Error('O Gemini não retornou proteínas e carboidratos válidos para todos os alimentos. Informe as quantidades e tente novamente.');
    }
    return normalizedItems;
  }
  function studentPlan() {
    const plan = state.remote ? remoteData.plan : null;
    const entries = plan?.entries || [];
    const meals = plan?.meals || [];
    const goals = plan?.goals || [];
    const foods = plan?.foods || [];
    const calories = entries.reduce((sum, entry) => sum + Number(entry.calories || 0), 0);
    const protein = entries.reduce((sum, entry) => sum + Number(entry.protein_grams || 0), 0);
    const calorieGoal = goals.find((goal) => goal.type === 'calories')?.target_value;
    const proteinGoal = goals.find((goal) => goal.type === 'protein')?.target_value;
    const categoryOptions = ['Café da manhã', 'Lanche', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia', 'Outras'];
    const unitOptions = ['porção', 'g', 'kg', 'ml', 'l', 'unidade', 'unidades', 'fatia', 'colher de sopa', 'colher de chá', 'xícara', 'copo', 'pacote'];
    const usedFoodCounts = entries.reduce((counts, entry) => {
      const name = String(entry.food_name || '').replace(/\s*\([^)]*\)$/, '').trim().toLowerCase();
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
      return counts;
    }, new Map());
    const recentFoods = foods.filter((food) => entries.some((entry) => String(entry.food_name || '').toLowerCase().startsWith(`${food.name.toLowerCase()} (`))).slice(0, 6);
    const popularFoods = [...foods].sort((a, b) => (usedFoodCounts.get(b.name.toLowerCase()) || 0) - (usedFoodCounts.get(a.name.toLowerCase()) || 0)).filter((food) => usedFoodCounts.has(food.name.toLowerCase())).slice(0, 6);
    const foodButton = (food) => `<div class="food-result"><button class="food-result-select" type="button" data-food-id="${esc(food.id)}" data-food-name="${esc(food.name)}" data-food-calories="${Number(food.calories || 0)}" data-food-protein="${Number(food.protein_grams || 0)}" data-food-unit="${esc(food.serving_unit || 'porção')}"><span class="food-result-copy"><strong>${esc(food.name)}</strong><small>${Number(food.calories || 0).toLocaleString('pt-BR')} kcal · ${Number(food.protein_grams || 0).toLocaleString('pt-BR')} g proteína por ${Number(food.serving_size || 1).toLocaleString('pt-BR')} ${esc(food.serving_unit || 'porção')}</small></span><span class="food-result-arrow" aria-hidden="true">→</span></button><button class="food-favorite-button${food.favorite ? ' is-favorite' : ''}" type="button" aria-label="${food.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}" data-food-favorite="${esc(food.id)}">${food.favorite ? '★' : '☆'}</button></div>`;
    const discoverySection = (title, list) => list.length ? `<section class="food-discovery-section"><h4>${title}</h4><div class="food-results">${list.map(foodButton).join('')}</div></section>` : '';
    const mealRows = meals.length ? meals.map((meal) => `<div class="meal-item"><div class="meal-icon">🍽️</div><div class="meal-copy"><strong>${esc(meal.name)}</strong><small>${meal.consumed_at ? new Date(meal.consumed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Sem horário'}</small></div><span class="status">Registrada</span></div>`).join('') : '<p class="empty-state">Nenhuma refeição registrada hoje.</p>';
    const mealById = new Map(meals.map((meal) => [meal.id, meal]));
    const entryRows = entries.length ? entries.map((entry) => {
      const sourceId = String(entry.source_id || '');
      const sourceParts = sourceId.split(':');
      const mealId = sourceParts.length > 1 ? sourceParts.pop() : '';
      const meal = mealById.get(mealId);
      const foodKey = sourceParts.join(':');
      const food = foods.find((item) => String(item.source_id || '') === foodKey || String(item.id) === foodKey);
      const foodId = food?.id || '';
      const quantityMatch = String(entry.food_name).match(/\(([\d.,]+)\s*([^)]*)\)$/);
      const quantity = quantityMatch ? Number(quantityMatch[1].replace(',', '.')) : 1;
      const unit = quantityMatch?.[2] || food?.serving_unit || 'porção';
      return `<div class="activity-item food-entry" data-entry-id="${esc(entry.id)}" data-meal-id="${esc(mealId)}" data-food-id="${esc(foodId)}"><div class="client-copy"><strong>${esc(entry.food_name)}</strong><small>${Number(entry.calories).toLocaleString('pt-BR')} kcal · ${Number(entry.protein_grams).toLocaleString('pt-BR')} g proteína · ${esc(meal?.name || 'Outras')}</small></div><button class="outline-button" type="button" data-food-action="edit" data-quantity="${quantity}" data-unit="${esc(unit)}" data-category="${esc(meal?.name || 'Outras')}">Editar</button><button class="outline-button danger-button" type="button" data-food-action="delete">Remover</button></div>`;
    }).join('') : '<p class="empty-state">Nenhum alimento registrado hoje.</p>';
    shell('Meu plano', 'ALIMENTAÇÃO E METAS', `<article class="card welcome-card student-plan-welcome"><div><span class="eyebrow">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</span><h2>Organize sua alimentação.</h2><p>Registre cada alimento, quantidade e refeição para acompanhar suas metas.</p></div><div class="welcome-illustration">🥗</div></article><div class="kpi-grid student-plan-kpis"><article class="card"><span class="kpi-label">Calorias consumidas</span><div class="kpi-number">${Math.round(calories)} kcal</div><span class="metric-meta">${calorieGoal ? `${Math.max(0, Math.round(calorieGoal - calories))} kcal restantes de ${calorieGoal}` : 'Meta não cadastrada'}</span></article><article class="card"><span class="kpi-label">Proteína consumida</span><div class="kpi-number">${Math.round(protein)} g</div><span class="metric-meta">${proteinGoal ? `${Math.max(0, Math.round(proteinGoal - protein))} g restantes de ${proteinGoal}` : 'Meta não cadastrada'}</span></article></div><article class="card section-card student-plan-card">${cardHeading('Adicionar com IA')}<form id="aiMealForm" class="settings-list" novalidate><label>Texto da refeição<textarea name="aiMealText" rows="3" required placeholder="Ex.: 150 g de arroz, 100 g de feijão e 120 g de frango."></textarea></label><label>Refeição<select name="category" required>${categoryOptions.map((category) => `<option value="${category}">${category}</option>`).join('')}</select></label><p class="admin-copy">A IA interpreta o texto e o Gemini calcula calorias, proteínas e carboidratos. Confirme os valores antes de salvar.</p><div id="aiMealPreview" class="activity-list"></div><p class="form-message" id="aiMealFeedback" hidden></p><button class="primary-button" type="submit">Consultar fonte nutricional</button><button class="outline-button" type="button" id="confirmAiMeal" hidden>Confirmar e salvar</button></form></article><article class="card section-card student-plan-card">${cardHeading('Adicionar alimento')}<form id="mealForm" class="settings-list"><label>Refeição<select name="category" required>${categoryOptions.map((category) => `<option value="${category}">${category}</option>`).join('')}</select></label>    <label>Alimento<input name="mealName" required placeholder="Ex.: arroz, frango ou banana" autocomplete="off" /></label><div id="foodDiscovery" class="food-discovery">${discoverySection('Alimentos recentes', recentFoods)}${discoverySection('Mais utilizados', popularFoods)}<p class="empty-state">Digite para pesquisar alimentos do catálogo.</p></div><label>Quantidade<input name="servings" type="number" min="0.01" step="0.01" value="1" required /></label><label>Unidade<select name="unit">${unitOptions.map((unit) => `<option value="${unit}">${unit}</option>`).join('')}</select></label><p class="form-message" id="mealAiPreview">Pesquise no catálogo ou digite um alimento para calcular.</p><p class="form-message" id="mealFeedback" hidden></p><button class="primary-button" type="submit">Adicionar alimento <span>→</span></button></form></article><article class="card section-card student-plan-card">${cardHeading('Refeições de hoje')}<div class="meal-list">${mealRows}</div></article><article class="card section-card student-plan-card">${cardHeading('Alimentos registrados')}<div class="activity-list">${entryRows}</div><p class="admin-copy">Você pode editar quantidade, unidade e refeição ou remover qualquer alimento registrado hoje.</p></article>`);
    if (state.remote && !hasPlusPlan()) {
      const aiCard = document.getElementById('aiMealForm')?.closest('article');
      if (aiCard) aiCard.outerHTML = plusUpgradeCard('Use a Nutri IA para calcular sua refeição automaticamente.');
    }
    let aiItems = [];
    document.getElementById('aiMealForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const feedback = document.getElementById('aiMealFeedback');
      const message = String(form.elements.aiMealText.value || '').trim();
      if (!message) {
        feedback.textContent = 'Digite os alimentos e quantidades antes de consultar.';
        feedback.hidden = false;
        form.elements.aiMealText.focus();
        return;
      }
      button.disabled = true;
      feedback.textContent = 'Consultando o Gemini...';
      feedback.hidden = false;
      try {
        aiItems = await searchAiFoodItems(message);
        document.getElementById('aiMealPreview').innerHTML = aiItems.map((item) => `<div class="activity-item"><div class="client-copy"><strong>${esc(item.name)}</strong><small>${item.quantity || '—'} ${esc(item.unit || '')} · ${Math.round(item.calories)} kcal · ${Math.round(item.protein)} g proteína · ${Math.round(item.carbs)} g carboidratos · fonte: Gemini</small></div><span class="status">Estimativa</span></div>`).join('');
        feedback.hidden = true;
        feedback.textContent = '';
        document.getElementById('confirmAiMeal').hidden = false;
      } catch (error) {
        feedback.textContent = error.name === 'AbortError'
          ? 'A consulta demorou demais. Verifique sua conexão e tente novamente.'
          : error.message || 'Não foi possível consultar a fonte nutricional.';
        document.getElementById('confirmAiMeal').hidden = true;
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById('confirmAiMeal')?.addEventListener('click', async () => {
      const form = document.getElementById('aiMealForm');
      const button = document.getElementById('confirmAiMeal');
      button.disabled = true;
      try {
        await dataService.addTrustedAiMeal({ category: form.elements.category.value, items: aiItems });
        remoteData.plan = await dataService.studentPlan();
        studentPlan();
      } catch (error) {
        const feedback = document.getElementById('aiMealFeedback');
        feedback.textContent = error.message || 'Não foi possível salvar a refeição.';
        feedback.hidden = false;
        button.disabled = false;
      }
    });
    const mealForm = document.getElementById('mealForm');
    const mealName = mealForm?.elements.mealName;
    const mealPreview = document.getElementById('mealAiPreview');
    let estimate = null;
    let selectedFoodId = '';
    let timer;
    const foodResultsById = new Map();
    mealName?.addEventListener('input', () => {
      clearTimeout(timer);
      estimate = null;
      selectedFoodId = '';
      const value = mealName.value.trim();
      mealPreview.textContent = value.length < 3 ? 'Digite o nome da refeição para consultar kcal e proteínas.' : 'Consultando Gemini...';
      if (value.length < 3) return;
      timer = setTimeout(async () => {
        try {
          const results = await dataService.searchFoodCatalog(value);
          foodResultsById.clear();
          results.forEach((food) => foodResultsById.set(String(food.id), food));
          document.getElementById('foodDiscovery').innerHTML = results.length
            ? `<section class="food-discovery-section"><h4>Resultados rápidos</h4><div class="food-results">${results.map(foodButton).join('')}</div></section>`
            : '<p class="empty-state">Nenhum alimento encontrado. Tente outro nome.</p>';
          bindFoodResults();
          mealPreview.textContent = results.length ? 'Selecione um resultado para preencher o alimento.' : 'Nenhum resultado encontrado.';
        } catch (error) {
          selectedFoodId = '';
          estimate = null;
          mealPreview.textContent = error.message || 'Não foi possível pesquisar o catálogo.';
        }
      }, 650);
    });
    function selectFoodResult(button) {
      selectedFoodId = String(button.dataset.foodId || '');
      mealName.value = button.dataset.foodName || '';
      const food = foodResultsById.get(selectedFoodId) || foods.find((item) => String(item.id) === selectedFoodId) || { calories: Number(button.dataset.foodCalories), protein_grams: Number(button.dataset.foodProtein), serving_size: 1, serving_unit: button.dataset.foodUnit };
      mealForm.elements.unit.value = 'porção';
      estimate = { calories: Number(food.calories), protein: Number(food.protein_grams) };
      document.querySelectorAll('.food-result-select').forEach((item) => item.classList.toggle('selected', item === button));
      mealPreview.textContent = `Selecionado: ${Math.round(Number(food.calories))} kcal · ${Math.round(Number(food.protein_grams))} g de proteína por ${Number(food.serving_size || 1).toLocaleString('pt-BR')} ${food.serving_unit || 'porção'}.`;
    }
    function bindFoodResults() {
      const discovery = document.getElementById('foodDiscovery');
      if (!discovery || discovery.dataset.bound === 'true') return;
      discovery.dataset.bound = 'true';
      const toggleFavorite = async (button) => {
        button.disabled = true;
        const nextFavorite = !button.classList.contains('is-favorite');
        try {
          await dataService.toggleFoodFavorite(button.dataset.foodFavorite, nextFavorite);
          button.textContent = nextFavorite ? '★' : '☆';
          button.classList.toggle('is-favorite', nextFavorite);
          button.setAttribute('aria-label', nextFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos');
        } catch (error) {
          mealPreview.textContent = error.message || 'Não foi possível salvar o favorito.';
        } finally {
          button.disabled = false;
        }
      };
      discovery.addEventListener('click', (event) => {
        const button = event.target.closest('.food-result-select');
        if (button) {
          event.preventDefault();
          event.stopPropagation();
          selectFoodResult(button);
          return;
        }
        const favoriteButton = event.target.closest('.food-favorite-button');
        if (favoriteButton) {
          event.preventDefault();
          event.stopPropagation();
          toggleFavorite(favoriteButton);
        }
      });
    }
    bindFoodResults();
    mealForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const feedback = document.getElementById('mealFeedback');
      button.disabled = true;
      feedback.hidden = true;
      try {
        const values = new FormData(form);
        if (!selectedFoodId) throw new Error('Selecione um alimento encontrado no catálogo antes de adicionar.');
        await dataService.addMeal({ name: values.get('mealName'), category: values.get('category'), foodId: selectedFoodId, servings: values.get('servings'), unit: values.get('unit') });
        remoteData.plan = await dataService.studentPlan();
        studentPlan();
      } catch (error) {
        feedback.textContent = error.message || 'Não foi possível registrar a refeição.';
        feedback.hidden = false;
      } finally {
        button.disabled = false;
      }
    });
    document.querySelectorAll('[data-food-action="edit"]').forEach((button) => button.addEventListener('click', async () => {
      const row = button.closest('.food-entry');
      const food = foods.find((item) => item.id === row?.dataset.foodId);
      if (!row || !food) {
        window.alert('Não foi possível identificar o alimento deste registro. Atualize a página e tente novamente.');
        return;
      }
      if (row.dataset.editing === 'true') return;
      row.dataset.editing = 'true';
      row.innerHTML = `<form class="food-entry-edit-form"><label>Quantidade<input name="quantity" type="number" min="0.01" step="0.01" value="${esc(button.dataset.quantity || '1')}" required></label><label>Unidade<select name="unit">${unitOptions.map((unit) => `<option value="${esc(unit)}"${unit === (button.dataset.unit || food.serving_unit || 'porção') ? ' selected' : ''}>${esc(unit)}</option>`).join('')}</select></label><label>Refeição<select name="category">${categoryOptions.map((category) => `<option value="${esc(category)}"${category === (button.dataset.category || 'Outras') ? ' selected' : ''}>${esc(category)}</option>`).join('')}</select></label><div class="food-entry-edit-actions"><button class="primary-button" type="submit">Salvar</button><button class="outline-button" type="button" data-edit-cancel>Cancelar</button></div><p class="form-message" data-edit-feedback hidden></p></form>`;
      const form = row.querySelector('form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const saveButton = form.querySelector('button[type="submit"]');
        const feedback = form.querySelector('[data-edit-feedback]');
        saveButton.disabled = true;
        feedback.hidden = true;
        try {
          const values = new FormData(form);
          await dataService.updateMealEntry({ entryId: row.dataset.entryId, mealId: row.dataset.mealId, foodId: food.id, quantity: values.get('quantity'), unit: values.get('unit'), category: values.get('category') });
          remoteData.plan = await dataService.studentPlan();
          studentPlan();
        } catch (error) {
          feedback.textContent = error.message || 'Não foi possível editar o alimento.';
          feedback.hidden = false;
          saveButton.disabled = false;
        }
      });
      form.querySelector('[data-edit-cancel]')?.addEventListener('click', () => studentPlan());
    }));
    document.querySelectorAll('[data-food-action="delete"]').forEach((button) => button.addEventListener('click', async () => {
      const row = button.closest('.food-entry');
      if (!row) return;
      if (!row.dataset.entryId || !row.dataset.mealId) {
        window.alert('Não foi possível identificar este registro. Atualize a página e tente novamente.');
        return;
      }
      if (button.dataset.deleteConfirmed !== 'true') {
        button.dataset.deleteConfirmed = 'true';
        button.textContent = 'Confirmar remoção';
        window.setTimeout(() => {
          if (button.isConnected && button.dataset.deleteConfirmed === 'true') {
            button.dataset.deleteConfirmed = 'false';
            button.textContent = 'Remover';
          }
        }, 4000);
        return;
      }
      button.disabled = true;
      try {
        await dataService.deleteMealEntry({ entryId: row.dataset.entryId, mealId: row.dataset.mealId });
        remoteData.plan = await dataService.studentPlan();
        studentPlan();
      } catch (error) {
        window.alert(error.message || 'Não foi possível remover o alimento.');
        button.disabled = false;
      }
    }));
  }
  function studentAccount() {
    const profile = remoteData.profile || {};
    const name = profile.full_name || document.getElementById('userName')?.textContent || 'Aluno';
    const email = profile.email || '';
    const avatar = profile.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="Foto de perfil de ${esc(name)}" />` : esc(name.charAt(0).toUpperCase());
    const avatarClass = profile.avatar_url ? ' has-photo' : '';
    shell('Meu perfil', 'MINHA CONTA', `<article class="card profile-hero"><div><span class="eyebrow">CONTA NUTRILEV</span><h2>${esc(name)}</h2><p>Aluno Nutrilev${email ? ` · ${esc(email)}` : ''}</p></div><div class="student-avatar student-avatar-large${avatarClass}">${avatar}</div></article><article class="card section-card profile-edit-card">${cardHeading('Dados pessoais')}<form id="profilePhotoForm" class="profile-photo-form"><div class="student-avatar student-avatar-medium${avatarClass}">${avatar}</div><div><label class="outline-button profile-photo-button">Escolher foto<input id="profilePhotoInput" type="file" accept="image/png,image/jpeg,image/webp" hidden /></label><p class="admin-copy">JPG, PNG ou WebP até 5 MB.</p></div></form><form id="profileForm" class="settings-list"><label>Nome completo<input name="full_name" type="text" value="${esc(name)}" autocomplete="name" required minlength="2" /></label><label>E-mail<input type="email" value="${esc(email || 'E-mail da conta')}" disabled /></label><p class="form-message" id="profileFeedback" hidden></p><button class="primary-button" type="submit">Salvar perfil <span>→</span></button></form></article><article class="card section-card"><div class="card-heading"><h3>Usar no aplicativo</h3></div><p class="admin-copy">Prefere usar o Nutrilev instalado no Android? Baixe o APK pela sua conta. O link é temporário e só funciona para assinaturas aprovadas.</p><p class="form-message" id="apkDownloadFeedback" hidden></p><button class="outline-button" type="button" id="downloadApkButton">Baixar APK <span>↓</span></button></article><article class="card section-card"><div class="card-heading"><h3>Segurança</h3></div><p class="admin-copy">Sua sessão é mantida com segurança neste dispositivo e sincronizada com a sua conta Nutrilev.</p><button class="outline-button" type="button" id="profileLogoutButton">Sair da conta</button></article>`);
    document.getElementById('downloadApkButton')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const feedback = document.getElementById('apkDownloadFeedback');
      const downloadWindow = window.open('', '_blank');
      button.disabled = true;
      feedback.hidden = true;
      try {
        const downloadUrl = await dataService.downloadApk();
        if (downloadWindow) {
          downloadWindow.location.href = downloadUrl;
        } else {
          window.location.assign(downloadUrl);
        }
      } catch (error) {
        downloadWindow?.close();
        feedback.textContent = error.message || 'Não foi possível preparar o download do APK.';
        feedback.hidden = false;
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById('profilePhotoInput')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const feedback = document.getElementById('profileFeedback');
      feedback.textContent = 'Enviando foto...';
      feedback.className = 'form-message';
      feedback.hidden = false;
      try {
        const updated = await dataService.uploadProfilePhoto(file);
        remoteData.profile = { ...remoteData.profile, ...updated, email };
        setUserIdentity({ user_metadata: { full_name: updated.full_name, avatar_url: updated.avatar_url } });
        studentAccount();
      } catch (error) {
        feedback.textContent = error.message || 'Não foi possível enviar a foto.';
        feedback.hidden = false;
      }
    });
    document.getElementById('profileForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const feedback = document.getElementById('profileFeedback');
      button.disabled = true;
      feedback.hidden = true;
      try {
        const fullName = new FormData(form).get('full_name');
        const updated = await dataService.updateProfile({ full_name: fullName });
        remoteData.profile = { ...remoteData.profile, ...updated, email };
        setUserIdentity({ user_metadata: { full_name: updated.full_name } });
        feedback.textContent = 'Perfil atualizado com sucesso.';
        feedback.className = 'form-message success';
        feedback.hidden = false;
        studentAccount();
      } catch (error) {
        feedback.textContent = error.message || 'Não foi possível atualizar o perfil.';
        feedback.className = 'form-message';
        feedback.hidden = false;
        button.disabled = false;
      }
    });
    document.getElementById('profileLogoutButton')?.addEventListener('click', () => document.getElementById('logoutButton').click());
  }

  function studentAssistant() {
    if (!hasBenefit('nutri_ai')) {
      shell('Nutri IA', 'ASSISTENTE NUTRICIONAL', `<article class="card upgrade-card"><span class="eyebrow">RECURSO DO NUTRILEV PLUS</span><h2>Leve sua rotina mais longe com a Nutri IA.</h2><p class="admin-copy">No plano Free, você organiza refeições, água e metas básicas. Assine o Plus para conversar com a IA e receber sugestões baseadas na sua rotina.</p><a class="primary-button" href="landing.html#planos">Conhecer o Nutrilev Plus <span>→</span></a></article>`);
      return;
    }
    shell('Nutri IA', 'ASSISTENTE NUTRICIONAL', `<article class="card section-card"><div class="card-heading"><h3>Converse com o Nutri IA</h3></div><p class="admin-copy">Faça perguntas sobre sua rotina. Quando autorizado, o assistente usa somente os dados da sua conta Nutrilev para personalizar a resposta.</p><div class="ai-quick-prompts"><button class="outline-button" type="button" data-ai-prompt="Posso comer pizza hoje?">Posso comer pizza hoje?</button><button class="outline-button" type="button" data-ai-prompt="O que posso comer agora?">O que posso comer agora?</button><button class="outline-button" type="button" data-ai-prompt="Quanto de proteína ainda falta?">Quanto de proteína ainda falta?</button><button class="outline-button" type="button" data-ai-prompt="Me dê uma opção de jantar.">Opção de jantar</button><button class="outline-button" type="button" data-ai-prompt="Tenho frango, arroz e ovos. O que posso preparar?">Tenho frango, arroz e ovos</button></div><form id="nutriAiForm" class="settings-list" style="margin-top:20px"><label for="nutriAiQuestion">Sua pergunta<textarea id="nutriAiQuestion" name="question" rows="4" required placeholder="Ex.: Quanto de proteína ainda falta?"></textarea></label><label class="ai-context-consent"><input type="checkbox" name="useContext" checked /> Usar meus dados atuais para personalizar a resposta</label><p class="form-message" id="nutriAiFeedback" hidden></p><button class="primary-button" type="submit" id="nutriAiSubmit">Perguntar ao Nutri IA <span>→</span></button></form></article><article class="card side-card"><div class="card-heading"><h3>Resposta</h3></div><div id="nutriAiAnswer" class="empty-state">A resposta aparecerá aqui depois da sua pergunta.</div><p class="admin-copy">O Nutri IA oferece orientação geral e não substitui avaliação médica ou nutricional profissional.</p></article>`);
    document.querySelectorAll('[data-ai-prompt]').forEach((button) => button.addEventListener('click', () => {
      document.getElementById('nutriAiQuestion').value = button.dataset.aiPrompt;
      document.getElementById('nutriAiQuestion').focus();
    }));
    document.getElementById('nutriAiForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('nutriAiQuestion');
      const submit = document.getElementById('nutriAiSubmit');
      const answer = document.getElementById('nutriAiAnswer');
      const feedback = document.getElementById('nutriAiFeedback');
      if (!state.remote) {
        feedback.textContent = 'Entre na sua conta para conversar com o Nutri IA.';
        feedback.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Consultando...';
      feedback.hidden = true;
      answer.className = 'empty-state';
      answer.textContent = 'O Nutri IA está analisando sua pergunta...';
      try {
        const session = await client.auth.getSession();
        const accessToken = session.data?.session?.access_token;
        if (!accessToken) throw new Error('Sua sessão expirou. Entre novamente para usar o Nutri IA.');
          const useContext = document.querySelector('[name="useContext"]')?.checked !== false;
          const plan = useContext ? (remoteData.plan || {}) : {};
          const entries = Array.isArray(plan.entries) ? plan.entries : [];
          const goals = Array.isArray(plan.goals) ? plan.goals : [];
          const calorieGoal = goals.find((goal) => goal.type === 'calories')?.target_value;
          const proteinGoal = goals.find((goal) => goal.type === 'protein')?.target_value;
          const caloriesConsumed = entries.reduce((sum, entry) => sum + Number(entry.calories || 0), 0);
          const proteinConsumed = entries.reduce((sum, entry) => sum + Number(entry.protein_grams || 0), 0);
          const profileContext = useContext ? {
            authorization_granted: true,
            goals: { calories: calorieGoal || null, protein: proteinGoal || null },
            today: { calories_consumed: caloriesConsumed, protein_consumed: proteinConsumed, calories_remaining: calorieGoal == null ? null : Math.max(0, Number(calorieGoal) - caloriesConsumed), protein_remaining: proteinGoal == null ? null : Math.max(0, Number(proteinGoal) - proteinConsumed), meals: plan.meals?.map((meal) => meal.name) || [] },
            hydration: { consumed_ml: (remoteData.hydration || []).filter((entry) => localDayKey(entry.consumed_at) === localDayKey()).reduce((sum, entry) => sum + Number(entry.amount_ml || 0), 0), goal_ml: 2500 },
          } : { authorization_granted: false };
        const response = await fetch(`${window.Nutrilev.config.supabaseUrl}/functions/v1/nutri-ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
          body: JSON.stringify({ action: 'chat', message: input.value.trim(), profile: profileContext }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `A IA respondeu com HTTP ${response.status}.`);
        answer.className = 'admin-copy';
        answer.textContent = payload.description || payload.answer || 'Não foi possível obter uma resposta.';
      } catch (error) {
        answer.className = 'empty-state';
        answer.textContent = error.message || 'Não foi possível consultar o Nutri IA.';
      } finally {
        submit.disabled = false;
        submit.innerHTML = 'Perguntar ao Nutri IA <span>→</span>';
      }
    });
  }
  function coachOverview() {
    const students = state.remote ? (remoteData.students || []) : [];
    const workouts = remoteData.workouts || [];
    shell('Acompanhe seus alunos', 'COACH / PERSONAL', `<div class="kpi-grid"><article class="card"><span class="kpi-label">Alunos ativos</span><div class="kpi-number">${students.length}</div><span class="metric-meta">Dados da sua academia</span></article><article class="card"><span class="kpi-label">Treinos criados</span><div class="kpi-number">${workouts.length}</div><span class="metric-meta">Fichas cadastradas</span></article></div><article class="card table-card">${cardHeading('Alunos que precisam de atenção','clients')}<div class="client-list">${students.length ? students.map((student) => `<div class="client-item"><div class="user-chip"><span>${esc(student.initials || 'A')}</span></div><div class="client-copy"><strong>${esc(student.name)}</strong><small>${esc(student.goal || 'Sem objetivo cadastrado')}</small></div><span class="status">${esc(student.status || 'Ativo')}</span></div>`).join('') : '<p class="empty-state">Você ainda não possui alunos vinculados.</p>'}</div></article><article class="card section-card">${cardHeading('Adesão dos alunos')}<p class="empty-state">Os indicadores aparecerão quando seus alunos começarem a registrar atividades.</p></article>`);
  }
  function pollockBodyFat({ sex, age, chest, abdomen, thigh }) {
    const sum = Number(chest) + Number(abdomen) + Number(thigh);
    if (!['male', 'female'].includes(sex) || !Number.isFinite(sum) || !Number.isFinite(Number(age))) return null;
    const density = sex === 'male'
      ? 1.10938 - (0.0008267 * sum) + (0.0000016 * sum * sum) - (0.0002574 * Number(age))
      : 1.0994921 - (0.0009929 * sum) + (0.0000023 * sum * sum) - (0.0001392 * Number(age));
    return { sum, percentage: Math.max(0, Math.min(60, (495 / density) - 450)) };
  }
  function studentProfile(student) {
    const weightHistory = student.weightHistory?.length ? student.weightHistory : [0];
    const maxWeight = Math.max(...weightHistory);
    const minWeight = Math.min(...weightHistory);
    const weightRange = maxWeight - minWeight || 1;
    const chart = student.weightHistory?.length ? student.weightHistory.map((weight, index) => `<div class="progress-chart-column"><span class="progress-chart-value">${weight.toLocaleString('pt-BR')} kg</span><span class="progress-chart-bar" style="height:${Math.max(28, ((weight - minWeight) / weightRange) * 62 + 28)}%"></span><small>${student.weightLabels[index]}</small></div>`).join('') : '<p class="empty-state">Nenhuma avaliação de peso registrada.</p>';
    const observations = [];
    let latestWorkoutDetails = null;
    try { latestWorkoutDetails = student.latestWorkoutDetails ? JSON.parse(student.latestWorkoutDetails) : null; } catch (error) { console.error('Invalid workout log details', error); }
    const executionSummary = latestWorkoutDetails?.exercises?.filter((item) => item.completed).map((item) => `${item.name}: ${item.load_kg || 0} kg · ${item.repetitions || 0} reps · ${item.sets_completed || 0} séries`).join(' | ');
    return `<article class="card profile-hero"><div><span class="eyebrow">ACOMPANHAMENTO INDIVIDUAL</span><h2>${esc(student.name)}</h2><p>${esc(student.goal)} · Entrada em ${esc(student.joinedAt)} · Último treino: ${esc(student.lastWorkout)}.</p></div><div class="student-avatar student-avatar-large">${esc(student.initials)}</div><span class="status ${student.status === 'Atenção' ? 'pending' : ''}">${esc(student.status)}</span></article>
      <article class="card profile-info-card">${cardHeading('Informações pessoais')}<div class="profile-facts"><div><span>Objetivo</span><strong>${esc(student.goal)}</strong></div><div><span>Peso</span><strong>${esc(student.weight)}</strong></div><div><span>Altura</span><strong>${esc(student.height)}</strong></div><div><span>Idade</span><strong>${esc(student.age)}</strong></div><div><span>Data de entrada</span><strong>${esc(student.joinedAt)}</strong></div><div><span>Status</span><strong>${esc(student.status)}</strong></div></div></article>
      <article class="card section-card profile-evolution">${cardHeading('Evolução')}<div class="profile-chart">${chart}</div><div class="profile-chart-legend"><span>Peso ao longo dos últimos registros</span><strong>${esc(student.weight)} atual</strong></div><div class="measurement-row"><span><strong>Medidas</strong><small>${esc(student.measures)}</small></span><span><strong>Histórico</strong><small>${student.weightHistory?.length || 0} avaliações registradas</small></span></div></article>
      <article class="card side-card">${cardHeading('Resumo de evolução')}<div class="profile-stat-list"><div><span>Variação de peso</span><strong>${student.weightHistory?.length > 1 ? (student.weightHistory[student.weightHistory.length - 1] - student.weightHistory[0]).toLocaleString('pt-BR', { signDisplay: 'always' }) + ' kg' : 'Sem dados'}</strong></div><div><span>Última avaliação</span><strong>${student.weightHistory?.length ? student.weightLabels[student.weightLabels.length - 1] : 'Sem registros'}</strong></div><div><span>Meta atual</span><strong>${esc(student.goal)}</strong></div></div></article>
      <article class="card table-card profile-workouts">${cardHeading('Treinos', 'workouts')}<div class="profile-workout-summary"><div><span>Treino atual</span><strong>${esc(student.currentWorkout)}</strong></div><div><span>Histórico</span><strong>${student.workouts.length} exercícios registrados</strong></div></div><div class="workout-list">${student.workouts.map(([name, details]) => `<div class="workout-row"><div><strong>${esc(name)}</strong><small>${esc(details)}</small></div><span class="status">Atribuído</span></div>`).join('')}</div>${executionSummary ? `<p class="admin-copy"><strong>Última execução:</strong> ${esc(executionSummary)}</p>` : '<p class="empty-state">Nenhum detalhe de execução registrado.</p>'}</article>
      <article class="card section-card">${cardHeading('Frequência')}<div class="frequency-grid"><div><span>Último acesso</span><strong>${esc(student.lastAccess)}</strong></div><div><span>Dias treinados</span><strong>${esc(student.weeklyFrequency)}</strong></div><div><span>Frequência semanal</span><strong>${esc(student.frequency)}</strong></div><div><span>Frequência mensal</span><strong>${esc(student.monthlyFrequency)}</strong></div></div><p class="empty-state">O gráfico será exibido quando houver histórico diário real disponível.</p></article>
      <article class="card table-card physical-assessment-card">${cardHeading('Nova avaliação física')}<p class="admin-copy">Registre perímetros e use o protocolo Pollock de 3 dobras para estimar o percentual de gordura.</p><form class="assessment-form" id="assessmentForm" data-student-id="${student.id}"><div class="assessment-grid"><label>Sexo<select name="sex" required><option value="">Selecionar</option><option value="male">Masculino</option><option value="female">Feminino</option></select></label><label>Idade<input name="age" type="number" min="10" max="120" required /></label><label>Peso (kg)<input name="weight" type="number" min="1" step="0.01" required value="${student.weight !== 'Sem registro' ? parseFloat(student.weight) || '' : ''}" /></label><label>Altura (cm)<input name="height" type="number" min="1" step="0.1" value="${student.height !== 'Sem registro' ? parseFloat(student.height) || '' : ''}" /></label></div><h4>Perímetros (cm)</h4><div class="assessment-grid"><label>Tórax<input name="chest_cm" type="number" step="0.1" /></label><label>Cintura<input name="waist_cm" type="number" step="0.1" /></label><label>Abdômen<input name="abdomen_cm" type="number" step="0.1" /></label><label>Quadril<input name="hip_cm" type="number" step="0.1" /></label><label>Braço direito<input name="arm_right_cm" type="number" step="0.1" /></label><label>Braço esquerdo<input name="arm_left_cm" type="number" step="0.1" /></label><label>Coxa direita<input name="thigh_right_cm" type="number" step="0.1" /></label><label>Coxa esquerda<input name="thigh_left_cm" type="number" step="0.1" /></label><label>Panturrilha direita<input name="calf_right_cm" type="number" step="0.1" /></label><label>Panturrilha esquerda<input name="calf_left_cm" type="number" step="0.1" /></label></div><h4>Dobras cutâneas Pollock (mm)</h4><div class="assessment-grid"><label>Peitoral<input name="skinfold_chest_mm" type="number" step="0.1" required /></label><label>Abdominal<input name="skinfold_abdominal_mm" type="number" step="0.1" required /></label><label>Coxa<input name="skinfold_thigh_mm" type="number" step="0.1" required /></label></div><textarea name="assessment_notes" rows="2" placeholder="Observações da avaliação"></textarea><p class="form-message" id="assessmentFeedback" hidden></p><button class="primary-button" type="submit">Calcular e salvar avaliação</button></form></article><article class="card side-card observations-card">${cardHeading('Observações privadas')}<p class="private-note">Visível somente para o Coach e a equipe autorizada.</p><form class="observation-form" data-student-id="${student.id}"><textarea name="observation" rows="3" required placeholder="Escreva uma observação sobre este aluno..."></textarea><button class="primary-button" type="submit">Salvar observação</button></form><div class="observation-list">${observations.length ? observations.map((observation) => `<div class="observation-item"><p>${esc(observation.text)}</p><small>${esc(observation.date)}</small></div>`).join('') : '<p class="empty-state">Nenhuma observação adicionada.</p>'}</div></article>`;
  }
  function bindStudentProfile(student) {
    const assessmentForm = document.getElementById('assessmentForm');
    assessmentForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const feedback = document.getElementById('assessmentFeedback');
      const values = new FormData(form);
      const result = pollockBodyFat({ sex: values.get('sex'), age: values.get('age'), chest: values.get('skinfold_chest_mm'), abdomen: values.get('skinfold_abdominal_mm'), thigh: values.get('skinfold_thigh_mm') });
      if (!result) { feedback.textContent = 'Preencha sexo, idade e as três dobras cutâneas.'; feedback.hidden = false; return; }
      const weight = Number(values.get('weight'));
      const payload = Object.fromEntries(['sex', 'age', 'weight', 'height', 'chest_cm', 'waist_cm', 'abdomen_cm', 'hip_cm', 'arm_right_cm', 'arm_left_cm', 'thigh_right_cm', 'thigh_left_cm', 'calf_right_cm', 'calf_left_cm', 'skinfold_chest_mm', 'skinfold_abdominal_mm', 'skinfold_thigh_mm', 'assessment_notes'].map((name) => [name, values.get(name)]));
      try {
        await dataService.addStudentMeasurement(student.id, { sex: payload.sex, age_years: Number(payload.age), weight_kg: weight, height_cm: payload.height ? Number(payload.height) : null, chest_cm: Number(payload.chest_cm) || null, waist_cm: Number(payload.waist_cm) || null, abdomen_cm: Number(payload.abdomen_cm) || null, hip_cm: Number(payload.hip_cm) || null, arm_right_cm: Number(payload.arm_right_cm) || null, arm_left_cm: Number(payload.arm_left_cm) || null, thigh_right_cm: Number(payload.thigh_right_cm) || null, thigh_left_cm: Number(payload.thigh_left_cm) || null, calf_right_cm: Number(payload.calf_right_cm) || null, calf_left_cm: Number(payload.calf_left_cm) || null, skinfold_chest_mm: Number(payload.skinfold_chest_mm), skinfold_abdominal_mm: Number(payload.skinfold_abdominal_mm), skinfold_thigh_mm: Number(payload.skinfold_thigh_mm), skinfold_sum_mm: result.sum, body_fat_percentage: result.percentage, fat_mass_kg: weight * result.percentage / 100, lean_mass_kg: weight * (1 - result.percentage / 100), body_fat_method: 'Pollock 3 dobras', notes: payload.assessment_notes || null });
        remoteData.students = await dataService.coachStudentDetails();
        coachSection();
      } catch (error) { feedback.textContent = error.message || 'Não foi possível salvar a avaliação.'; feedback.hidden = false; }
    });
    const form = document.querySelector('.observation-form');
    if (!form) return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const feedback = form.querySelector('.form-message') || document.getElementById('observationFeedback');
      if (feedback) {
        feedback.textContent = 'Este recurso aguarda a tabela de observações no Supabase e não salva dados localmente.';
        feedback.hidden = false;
      }
    });
  }
  function workoutForm(exercise = {}) {
    return `<div class="exercise-form-row"><input name="exerciseName" required placeholder="Nome do exercício" value="${esc(exercise.name || '')}" aria-label="Nome do exercício" /><input name="sets" type="number" min="1" value="${exercise.sets || ''}" required aria-label="Séries" /><input name="reps" type="number" min="1" value="${exercise.reps || ''}" required aria-label="Repetições" /><input name="load" type="text" placeholder="Ex.: 20 kg" value="${esc(exercise.load || '')}" aria-label="Carga inicial" /><input name="rest" type="text" placeholder="Ex.: 60 s" value="${esc(exercise.rest || '')}" aria-label="Intervalo" /><div class="exercise-order"><button type="button" class="move-exercise" data-direction="up" aria-label="Mover exercício para cima">↑</button><button type="button" class="move-exercise" data-direction="down" aria-label="Mover exercício para baixo">↓</button></div><button class="remove-exercise" type="button" aria-label="Remover exercício">×</button></div>`;
  }
  function getSavedWorkouts() {
    return state.remote ? (remoteData.workouts || []) : [];
  }
  function renderSavedWorkouts() {
    const saved = state.remote ? (remoteData.workouts || []) : getSavedWorkouts();
    return saved.length ? saved.map((workout) => `<div class="saved-workout"><div><strong>${esc(workout.name)}</strong><small>${esc(workout.muscles)} · ${workout.exercises.length} exercício(s)${workout.notes ? ` · ${esc(workout.notes)}` : ''}</small></div><div class="saved-workout-actions"><button class="outline-button" type="button" data-workout-action="edit" data-workout-id="${workout.id}">Editar</button><button class="outline-button" type="button" data-workout-action="duplicate" data-workout-id="${workout.id}">Duplicar</button><button class="outline-button danger-button" type="button" data-workout-action="delete" data-workout-id="${workout.id}">Excluir</button></div></div>`).join('') : '<p class="empty-state">Nenhuma ficha criada ainda.</p>';
  }
  function workoutEditor(workout = {}) {
    const studentsOptions = remoteData.coachStudents.map((student) => `<option value="${esc(student.id)}">${esc(student.full_name || 'Aluno')}</option>`).join('');
    return `<article class="card table-card workout-builder"><div class="card-heading"><h3>${workout.id ? 'Editar ficha de treino' : 'Nova ficha de treino'}</h3><button class="outline-button" id="cancelWorkoutEdit" type="button" ${workout.id ? '' : 'hidden'}>Cancelar</button></div><form id="workoutForm" data-workout-id="${workout.id || ''}"><div class="workout-fields"><label>Nome do treino<input name="workoutName" required value="${esc(workout.name || '')}" placeholder="Nome do treino" /></label><label>Grupo muscular<input name="muscles" required value="${esc(workout.muscles || '')}" placeholder="Grupo muscular" /></label></div><label class="workout-notes-label">Observações<textarea name="notes" rows="2" placeholder="Orientações para este treino...">${esc(workout.notes || '')}</textarea></label><label>Enviar ficha para aluno<select name="studentId"><option value="">Salvar sem atribuir agora</option>${studentsOptions}</select></label><div class="card-heading exercise-heading"><h3>Exercícios</h3><button class="outline-button" id="addExercise" type="button">+ Adicionar exercício</button></div><div class="exercise-list" id="exerciseList">${(workout.exercises || []).map((exercise) => workoutForm(exercise)).join('')}</div><p class="form-message success" id="workoutFeedback" hidden></p><button class="primary-button" type="submit">Salvar ficha de treino →</button></form></article>`;
  }
  function bindWorkoutCreator() {
    const form = document.getElementById('workoutForm');
    const exerciseList = document.getElementById('exerciseList');
    if (!form || !exerciseList) return;
    document.getElementById('addExercise').addEventListener('click', () => {
      exerciseList.insertAdjacentHTML('beforeend', workoutForm());
    });
    exerciseList.addEventListener('click', (event) => {
      if (event.target.classList.contains('remove-exercise')) {
        const rows = exerciseList.querySelectorAll('.exercise-form-row');
        if (rows.length > 1) event.target.closest('.exercise-form-row').remove();
      }
      if (event.target.classList.contains('move-exercise')) {
        const row = event.target.closest('.exercise-form-row');
        const target = event.target.dataset.direction === 'up' ? row.previousElementSibling : row.nextElementSibling;
        if (target) event.target.dataset.direction === 'up' ? exerciseList.insertBefore(row, target) : exerciseList.insertBefore(target, row);
      }
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const rows = [...exerciseList.querySelectorAll('.exercise-form-row')];
      const exercises = rows.map((row) => ({
        name: row.querySelector('[name="exerciseName"]').value.trim(),
        sets: row.querySelector('[name="sets"]').value,
        reps: row.querySelector('[name="reps"]').value,
        load: row.querySelector('[name="load"]').value.trim() || 'A definir',
        rest: row.querySelector('[name="rest"]').value.trim() || '60 s',
      }));
      const saved = getSavedWorkouts();
      const workoutId = form.dataset.workoutId;
      const workout = { id: workoutId || `workout-${Date.now()}`, name: values.get('workoutName'), muscles: values.get('muscles'), notes: values.get('notes').trim(), exercises, createdAt: new Date().toLocaleDateString('pt-BR') };
      if (state.remote) {
        try {
          const savedWorkout = await dataService.saveWorkout(workout, workoutId);
          const studentId = values.get('studentId');
          if (studentId) await dataService.assignWorkout(savedWorkout.id, studentId);
          if (!workoutId) remoteData.workouts.unshift({ ...workout, id: savedWorkout.id });
          else remoteData.workouts = remoteData.workouts.map((item) => item.id === workoutId ? workout : item);
          coachSection();
        } catch (error) {
          const feedback = document.getElementById('workoutFeedback');
          feedback.textContent = error.message || 'Não foi possível salvar a ficha.';
          feedback.hidden = false;
        }
        return;
      }
      const feedback = document.getElementById('workoutFeedback');
      feedback.textContent = 'Faça login para salvar a ficha no Supabase.';
      feedback.hidden = false;
      coachSection();
    });
    document.getElementById('cancelWorkoutEdit')?.addEventListener('click', () => coachSection());
    document.querySelectorAll('[data-workout-action]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.workoutId;
      const saved = state.remote ? (remoteData.workouts || []) : getSavedWorkouts();
      const workout = saved.find((item) => item.id === id);
      if (button.dataset.workoutAction === 'edit' && workout) {
        document.getElementById('workoutEditorMount').innerHTML = workoutEditor(workout);
        bindWorkoutCreator();
      } else if (button.dataset.workoutAction === 'duplicate' && workout) {
        const duplicate = { ...workout, id: `workout-${Date.now()}`, name: `${workout.name} (cópia)`, createdAt: new Date().toLocaleDateString('pt-BR') };
        if (state.remote) {
          dataService.saveWorkout(duplicate).then((savedWorkout) => {
            remoteData.workouts = [{ ...duplicate, id: savedWorkout.id }, ...saved];
            coachSection();
          }).catch((error) => {
            const feedback = document.getElementById('workoutFeedback');
            if (feedback) { feedback.textContent = error.message || 'Não foi possível duplicar a ficha.'; feedback.hidden = false; }
          });
        } else {
          const feedback = document.getElementById('workoutFeedback');
          if (feedback) { feedback.textContent = 'Faça login para duplicar a ficha no Supabase.'; feedback.hidden = false; }
        }
      } else if (button.dataset.workoutAction === 'delete' && workout && window.confirm(`Excluir a ficha "${workout.name}"?`)) {
        if (state.remote) {
          dataService.deleteWorkout(id).then(() => { remoteData.workouts = saved.filter((item) => item.id !== id); coachSection(); });
          return;
        }
        const feedback = document.getElementById('workoutFeedback');
        if (feedback) { feedback.textContent = 'Faça login para excluir a ficha no Supabase.'; feedback.hidden = false; }
      }
    }));
  }
  function coachSection() {
    const coachStudents = state.remote ? (remoteData.students || []) : students;
    if (page().startsWith('students/')) {
      const student = coachStudents.find((item) => item.id === page().split('/')[1]) || coachStudents[0];
      if (!student) {
        shell('Meus alunos', 'ALUNOS', '<article class="card section-card"><p class="empty-state">Você ainda não possui alunos vinculados.</p></article>');
        return;
      }
      shell(student.name, 'PERFIL DO ALUNO', studentProfile(student));
      bindStudentProfile(student);
      return;
    }
    const sections = {
      clients: ['Meus alunos', 'ALUNOS', `<article class="card table-card">${cardHeading('Sua carteira de alunos')}<div class="student-toolbar"><input id="studentSearch" type="search" placeholder="Buscar aluno..." aria-label="Buscar aluno" /><select id="studentStatus" aria-label="Filtrar por status"><option value="">Todos os status</option><option>Ativa</option><option>Atenção</option><option>Novo</option></select><select id="studentSort" aria-label="Ordenar alunos"><option value="name">Ordenar: nome</option><option value="status">Ordenar: status</option><option value="frequency">Ordenar: frequência</option></select></div><form id="coachInviteStudentForm" class="invite-student-form"><input name="email" type="email" required placeholder="E-mail do novo aluno" aria-label="E-mail do novo aluno" /><button class="primary-button" type="submit">Convidar aluno</button></form><p class="form-message success" id="coachInviteFeedback" hidden></p><div class="student-table" id="studentTable">${renderStudents(coachStudents)}</div></article>`],
      workouts: ['Treinos', 'CRIAR FICHAS', `<div id="workoutEditorMount">${workoutEditor()}</div><article class="card table-card">${cardHeading('Fichas criadas')}<div class="saved-workouts" id="savedWorkouts">${renderSavedWorkouts()}</div></article>`],
      exercises: ['Exercícios', 'BIBLIOTECA', exercisesView()],
      evolution: ['Evolução', 'ACOMPANHAMENTO', coachEvolutionView()],
      notifications: ['Notificações', 'CENTRAL DE AVISOS', notificationsView()],
      profile: ['Perfil', 'MINHA CONTA', coachProfileView()],
    };
    const [title, eyebrow, content] = sections[page()] || sections.clients;
    shell(title, eyebrow, content);
    if (page() === 'clients') bindStudentFilters();
    if (page() === 'clients') bindCoachStudentInvite();
    if (page() === 'workouts') bindWorkoutCreator();
    if (page() === 'profile') bindCoachProfile();
    if (page() === 'exercises') bindExercises();
    if (page() === 'evolution') bindCoachEvolution();
    if (page() === 'notifications') bindNotifications();
  }
  function notificationsView() {
    const notifications = remoteData.notifications || [];
    const unread = notifications.filter((item) => !item.read_at).length;
    return `<article class="card table-card">${cardHeading('Suas notificações')}<div class="notification-toolbar"><span class="status">${unread} não lida(s)</span><button class="outline-button" type="button" id="markAllNotifications">Marcar todas como lidas</button></div><div class="activity-list" id="notificationList">${notifications.length ? notifications.map((item) => `<div class="activity-item notification-item ${item.read_at ? '' : 'notification-unread'}" data-notification-id="${item.id}"><span class="notification-dot">${item.read_at ? '○' : '●'}</span><div class="client-copy"><strong>${esc(item.title)}</strong><small>${esc(item.body || '')} · ${new Date(item.created_at).toLocaleString('pt-BR')}</small></div>${item.read_at ? '<span class="status">Lida</span>' : '<button class="outline-button" type="button" data-notification-read>Marcar como lida</button>'}</div>`).join('') : '<p class="empty-state">Você não possui notificações no momento.</p>'}</div></article>`;
  }
  function bindNotifications() {
    document.getElementById('markAllNotifications')?.addEventListener('click', async () => {
      await dataService.markAllNotificationsRead();
      remoteData.notifications = await dataService.notifications();
      coachSection();
    });
    document.querySelectorAll('[data-notification-read]').forEach((button) => button.addEventListener('click', async () => {
      const item = button.closest('[data-notification-id]');
      await dataService.markNotificationRead(item.dataset.notificationId);
      remoteData.notifications = await dataService.notifications();
      coachSection();
    }));
  }
  function coachEvolutionView() {
    const data = remoteData.evolution || [];
    const selected = data[0];
    const measurements = selected?.measurements || [];
    const latest = measurements[measurements.length - 1];
    const previous = measurements[measurements.length - 2];
    const weightDelta = latest?.weight_kg != null && previous?.weight_kg != null ? Number(latest.weight_kg) - Number(previous.weight_kg) : null;
    const recentLogs = (selected?.logs || []).filter((log) => new Date(log.performed_at).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000);
    return `<article class="card table-card">${cardHeading('Evolução dos alunos')}<div class="evolution-toolbar"><label>Aluno<select id="evolutionStudent">${data.length ? data.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('') : '<option value="">Nenhum aluno</option>'}</select></label><label>Período<select id="evolutionPeriod"><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Último ano</option></select></label></div><div id="evolutionContent">${renderCoachEvolution(selected, weightDelta, recentLogs)}</div></article>`;
  }
  function renderCoachEvolution(student, weightDelta, recentLogs) {
    if (!student) return '<p class="empty-state">Nenhum aluno vinculado ou nenhuma evolução registrada ainda.</p>';
    const measurements = student.measurements || [];
    const chartItems = measurements.filter((item) => item.weight_kg != null).slice(-8);
    const max = chartItems.length ? Math.max(...chartItems.map((item) => Number(item.weight_kg))) : 1;
    const chart = chartItems.length ? chartItems.map((item) => `<div class="progress-chart-column"><span class="progress-chart-value">${Number(item.weight_kg).toLocaleString('pt-BR')} kg</span><span class="progress-chart-bar" style="height:${Math.max(28, Number(item.weight_kg) / max * 80)}%"></span><small>${new Date(item.measured_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</small></div>`).join('') : '<p class="empty-state">Nenhuma avaliação corporal registrada.</p>';
    const latest = measurements[measurements.length - 1];
    return `<div class="kpi-grid evolution-kpis"><article class="card"><span class="kpi-label">Peso atual</span><div class="kpi-number">${latest?.weight_kg != null ? `${Number(latest.weight_kg).toLocaleString('pt-BR')} kg` : '—'}</div></article><article class="card"><span class="kpi-label">Variação</span><div class="kpi-number">${weightDelta == null ? '—' : `${weightDelta > 0 ? '+' : ''}${weightDelta.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`}</div></article><article class="card"><span class="kpi-label">% gordura atual</span><div class="kpi-number">${latest?.body_fat_percentage != null ? `${Number(latest.body_fat_percentage).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '—'}</div></article><article class="card"><span class="kpi-label">Treinos no período</span><div class="kpi-number">${recentLogs.length}</div></article></div><article class="card section-card">${cardHeading('Peso ao longo do tempo')}<div class="profile-chart">${chart}</div></article><article class="card side-card">${cardHeading('Última composição corporal')}<div class="profile-stat-list"><div><span>Aluno</span><strong>${esc(student.name)}</strong></div><div><span>Massa gorda</span><strong>${latest?.fat_mass_kg != null ? `${Number(latest.fat_mass_kg).toLocaleString('pt-BR')} kg` : '—'}</strong></div><div><span>Massa magra</span><strong>${latest?.lean_mass_kg != null ? `${Number(latest.lean_mass_kg).toLocaleString('pt-BR')} kg` : '—'}</strong></div><div><span>Avaliações</span><strong>${measurements.length}</strong></div></div></article>`;
  }
  function bindCoachEvolution() {
    const studentSelect = document.getElementById('evolutionStudent');
    const periodSelect = document.getElementById('evolutionPeriod');
    const render = () => {
      const student = (remoteData.evolution || []).find((item) => item.id === studentSelect.value);
      const days = Number(periodSelect.value);
      const logs = (student?.logs || []).filter((log) => new Date(log.performed_at).getTime() >= Date.now() - days * 24 * 60 * 60 * 1000);
      const measurements = student?.measurements || [];
      const latest = measurements[measurements.length - 1];
      const previous = measurements[measurements.length - 2];
      const delta = latest?.weight_kg != null && previous?.weight_kg != null ? Number(latest.weight_kg) - Number(previous.weight_kg) : null;
      document.getElementById('evolutionContent').innerHTML = renderCoachEvolution(student, delta, logs);
    };
    studentSelect?.addEventListener('change', render);
    periodSelect?.addEventListener('change', render);
  }
  function exercisesView() {
    const exercises = remoteData.exercises || [];
    return `<article class="card table-card">${cardHeading('Biblioteca de exercícios')}<form id="exerciseForm" class="exercise-library-form"><input name="name" required placeholder="Nome do exercício" aria-label="Nome do exercício" /><input name="muscleGroup" placeholder="Grupo muscular" aria-label="Grupo muscular" /><input name="instructions" placeholder="Instruções (opcional)" aria-label="Instruções" /><button class="primary-button" type="submit">Adicionar exercício</button></form><p class="form-message" id="exerciseFeedback" hidden></p><div class="exercise-library-toolbar"><input id="exerciseSearch" type="search" placeholder="Buscar exercício..." aria-label="Buscar exercício" /><select id="exerciseFilter" aria-label="Filtrar por grupo muscular"><option value="">Todos os grupos</option>${[...new Set(exercises.map((item) => item.muscle_group).filter(Boolean))].sort().map((group) => `<option value="${esc(group)}">${esc(group)}</option>`).join('')}</select></div><div class="activity-list" id="exerciseLibraryList">${renderExercises(exercises)}</div></article>`;
  }
  function renderExercises(items) {
    return items.length ? items.map((exercise) => `<div class="activity-item exercise-library-row" data-exercise-id="${exercise.id}"><span class="exercise-library-icon">◇</span><div class="client-copy"><strong>${esc(exercise.name)}</strong><small>${esc(exercise.muscle_group || 'Grupo não informado')}${exercise.instructions ? ` · ${esc(exercise.instructions)}` : ''}</small></div><span class="status">${exercise.created_by ? 'Personalizado' : 'Disponível'}</span>${exercise.created_by === remoteData.profile?.id ? `<button class="outline-button" type="button" data-exercise-action="edit" data-exercise-id="${exercise.id}">Editar</button><button class="outline-button danger-button" type="button" data-exercise-action="delete" data-exercise-id="${exercise.id}">Excluir</button>` : ''}</div>`).join('') : '<p class="empty-state">Nenhum exercício encontrado.</p>';
  }
  function bindExercises() {
    const form = document.getElementById('exerciseForm');
    const list = document.getElementById('exerciseLibraryList');
    let editingId = null;
    const update = () => {
      const query = document.getElementById('exerciseSearch').value.toLowerCase();
      const group = document.getElementById('exerciseFilter').value;
      list.innerHTML = renderExercises((remoteData.exercises || []).filter((item) => (!query || item.name.toLowerCase().includes(query)) && (!group || item.muscle_group === group)));
    };
    ['exerciseSearch', 'exerciseFilter'].forEach((id) => document.getElementById(id).addEventListener('input', update));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const feedback = document.getElementById('exerciseFeedback');
      try {
        const values = new FormData(form);
        const changes = { name: values.get('name'), muscle_group: values.get('muscleGroup'), instructions: values.get('instructions') };
        const saved = editingId ? await dataService.updateExercise(editingId, changes) : await dataService.createExercise(changes);
        remoteData.exercises = editingId ? remoteData.exercises.map((item) => item.id === editingId ? saved : item) : [...remoteData.exercises, saved].sort((a, b) => a.name.localeCompare(b.name));
        editingId = null;
        form.reset();
        feedback.textContent = 'Exercício salvo na biblioteca.';
        feedback.className = 'form-message success';
        feedback.hidden = false;
        update();
      } catch (error) { feedback.textContent = error.message || 'Não foi possível adicionar o exercício.'; feedback.className = 'form-message'; feedback.hidden = false; }
    });
    list.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-exercise-action]');
      if (!button) return;
      const exercise = remoteData.exercises.find((item) => item.id === button.dataset.exerciseId);
      if (!exercise) return;
      try {
        if (button.dataset.exerciseAction === 'edit') {
          editingId = exercise.id;
          form.elements.name.value = exercise.name;
          form.elements.muscleGroup.value = exercise.muscle_group || '';
          form.elements.instructions.value = exercise.instructions || '';
          form.elements.name.focus();
          return;
        }
        if (button.dataset.exerciseAction === 'delete' && window.confirm(`Excluir o exercício "${exercise.name}"?`)) {
          await dataService.deleteExercise(exercise.id);
          remoteData.exercises = remoteData.exercises.filter((item) => item.id !== exercise.id);
          update();
        }
      } catch (error) {
        const feedback = document.getElementById('exerciseFeedback');
        feedback.textContent = error.message || 'Não foi possível excluir o exercício.';
        feedback.hidden = false;
      }
    });
  }
  function bindCoachStudentInvite() {
    const form = document.getElementById('coachInviteStudentForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const feedback = document.getElementById('coachInviteFeedback');
      const button = form.querySelector('button');
      button.disabled = true;
      feedback.hidden = true;
      try {
        const invitation = await dataService.invite(await dataService.gymId(), form.elements.email.value.trim().toLowerCase(), 'email');
        form.reset();
        feedback.textContent = `Convite criado. Envie este código ao aluno: ${invitation.code}`;
        feedback.className = 'form-message success';
        feedback.hidden = false;
      } catch (error) {
        feedback.textContent = error.message || 'Não foi possível criar o convite.';
        feedback.className = 'form-message';
        feedback.hidden = false;
      } finally {
        button.disabled = false;
      }
    });
  }
  function coachProfileView() {
    const profile = remoteData.profile || { full_name: 'Coach', email: '', academyName: 'Nenhuma academia vinculada', role: 'coach' };
    const role = roleLabels[normalizeRole(profile.role)] || 'Coach / Personal';
    return `<article class="card section-card"><div class="card-heading"><h3>Dados do perfil</h3><span class="status">Conta ativa</span></div><form id="coachProfileForm" class="settings-list"><label>Nome completo<input name="fullName" required minlength="2" value="${esc(profile.full_name || '')}" /></label><label>E-mail<input type="email" value="${esc(profile.email)}" readonly /></label><label>Função<input value="${esc(role)}" readonly /></label><label>Academia<input value="${esc(profile.academyName)}" readonly /></label><p class="form-message" id="profileFeedback" hidden></p><button class="primary-button" type="submit">Salvar alterações</button></form></article><article class="card side-card">${cardHeading('Resumo da conta')}<div class="profile-facts"><div><span>Alunos ativos</span><strong>${(remoteData.students || []).filter((student) => student.status === 'Ativa').length}</strong></div><div><span>Fichas criadas</span><strong>${(remoteData.workouts || []).length}</strong></div><div><span>Academia</span><strong>${esc(profile.academyName)}</strong></div></div></article>`;
  }
  function bindCoachProfile() {
    const form = document.getElementById('coachProfileForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const feedback = document.getElementById('profileFeedback');
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      feedback.hidden = true;
      try {
        const updated = await dataService.updateProfile({ full_name: form.elements.fullName.value });
        remoteData.profile = { ...remoteData.profile, ...updated };
        setUserIdentity({ user_metadata: { full_name: updated.full_name }, email: remoteData.profile.email });
        feedback.textContent = 'Perfil atualizado com sucesso.';
        feedback.className = 'form-message success';
        feedback.hidden = false;
      } catch (error) {
        feedback.textContent = error.message || 'Não foi possível atualizar o perfil.';
        feedback.className = 'form-message';
        feedback.hidden = false;
      } finally {
        button.disabled = false;
      }
    });
  }
  function renderStudents(items) {
    return items.map((student) => {
      const studentId = esc(student.id);
      return `<article class="student-row"><a class="student-identity" href="#/students/${studentId}"><span class="student-avatar">${esc(student.initials)}</span><span><strong>${esc(student.name)}</strong><small>${esc(student.goal)}</small></span></a><span class="status ${student.status === 'Atenção' ? 'pending' : ''}">${esc(student.status)}</span><span>${esc(student.lastWorkout)}</span><span>${esc(student.frequency)}</span><span>${esc(student.goal)}</span><div class="student-actions"><a class="outline-button" href="#/students/${studentId}">Abrir</a><button class="outline-button" type="button" data-student-action="message">Mensagem</button></div></article>`;
    }).join('');
  }
  function bindStudentFilters() {
    const update = () => {
      const query = document.getElementById('studentSearch').value.toLowerCase();
      const status = document.getElementById('studentStatus').value;
      const sort = document.getElementById('studentSort').value;
      const currentStudents = state.remote ? (remoteData.students || []) : students;
      const filtered = currentStudents.filter((student) => (!query || `${student.name} ${student.goal}`.toLowerCase().includes(query)) && (!status || student.status === status)).sort((a, b) => sort === 'frequency' ? b.frequency.localeCompare(a.frequency) : sort === 'status' ? a.status.localeCompare(b.status) : a.name.localeCompare(b.name));
      document.getElementById('studentTable').innerHTML = renderStudents(filtered);
    };
    ['studentSearch', 'studentStatus', 'studentSort'].forEach((id) => document.getElementById(id).addEventListener('input', update));
  }
  function adminOverview() {
    const stats = remoteData.adminStats;
    const gym = remoteData.gym;
    if (!stats) {
      shell('Dashboard administrativo', 'ADMINISTRAÇÃO', '<article class="card state-card"><strong>Dados da academia indisponíveis.</strong><p>Os indicadores serão exibidos após a sincronização com o Supabase.</p></article>');
      return;
    }
    shell('Dashboard', 'VISÃO GERAL DA ACADEMIA', `<article class="card welcome-card"><div><span class="eyebrow">${esc(gym?.name || 'Academia')}</span><h2>Gestão da sua academia.</h2><p>Indicadores carregados do Supabase.</p></div></article><div class="kpi-grid"><article class="card"><span class="kpi-label">Alunos ativos</span><div class="kpi-number">${stats.members}</div></article><article class="card"><span class="kpi-label">Coaches ativos</span><div class="kpi-number">${stats.coaches}</div></article><article class="card"><span class="kpi-label">Fichas ativas</span><div class="kpi-number">${stats.workouts}</div></article><article class="card"><span class="kpi-label">Check-ins</span><div class="kpi-number">${stats.checkins}</div></article></div><article class="card table-card">${cardHeading('Atividade recente')}<p class="empty-state">Use a área de check-ins para consultar os eventos reais recebidos.</p></article>`);
  }
  function getAdminStudents() {
    return state.remote ? (remoteData.students || []) : [];
  }
  function adminMembersView() {
    const adminStudents = getAdminStudents();
    return `<article class="card table-card admin-members-card">${cardHeading('Gestão de alunos')}<div class="admin-member-toolbar"><div><p class="admin-copy">O vínculo com a academia é separado do histórico pessoal do usuário. Desvincular remove apenas o acesso à academia e preserva todos os dados do Nutrilev.</p></div><form id="inviteStudentForm" class="invite-student-form"><input name="email" type="email" required placeholder="E-mail do aluno" aria-label="E-mail do aluno" /><button class="primary-button" type="submit">Convidar aluno</button></form><p class="form-message success" id="inviteFeedback" hidden></p></div><div class="admin-member-header"><span>Aluno</span><span>Status da conta</span><span>Vínculo</span><span>Frequência</span><span>Ações</span></div><div class="admin-list">${adminStudents.length ? adminStudents.map((student) => `<div class="admin-list-row admin-member-row" data-student-id="${student.id}"><div class="student-identity"><span class="student-avatar">${esc(student.initials)}</span><span><strong>${esc(student.name)}</strong><small>${esc(student.goal)} · ${esc(student.weight)} · ${esc(student.height)}</small></span></div><span class="status ${student.accountStatus === 'inactive' ? 'pending' : ''}">${student.accountStatus === 'inactive' ? 'Inativo' : 'Ativo'}</span><span class="status ${student.linked ? '' : 'pending'}">${student.linked ? 'Vinculado' : 'Desvinculado'}</span><span>${esc(student.frequency)}</span><div class="admin-member-actions"><button class="outline-button" type="button" data-member-action="details" data-student-id="${student.id}">Informações</button><button class="outline-button" type="button" data-member-action="toggle" data-student-id="${student.id}">${student.accountStatus === 'inactive' ? 'Ativar' : 'Desativar'}</button><button class="outline-button" type="button" data-member-action="${student.linked ? 'unlink' : 'link'}" data-student-id="${student.id}">${student.linked ? 'Desvincular' : 'Vincular'}</button></div></div>`).join('') : '<p class="empty-state">Nenhum aluno real cadastrado nesta academia.</p>'}</div><div class="admin-member-detail" id="adminMemberDetail" hidden></div></article>`;
  }
  function bindAdminMembers() {
    if (document.documentElement.dataset.adminHandlers === 'bound') return;
    document.documentElement.dataset.adminHandlers = 'bound';
    document.addEventListener('submit', async (event) => {
      if (!event.target.matches('#inviteStudentForm')) return;
      event.preventDefault();
      const email = event.target.elements.email.value.trim().toLowerCase();
      if (state.remote) {
        try { await dataService.invite(await dataService.gymId(), email); event.target.reset(); adminSection(); }
        catch (error) { const feedback = document.getElementById('inviteFeedback'); if (feedback) { feedback.textContent = error.message || 'Não foi possível enviar o convite.'; feedback.hidden = false; } }
        return;
      }
      const feedback = document.getElementById('inviteFeedback');
      if (feedback) { feedback.textContent = 'Entre na sua conta para criar o convite no Supabase.'; feedback.hidden = false; }
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-member-action]');
      if (!button) return;
      const adminStudents = getAdminStudents();
      const student = adminStudents.find((item) => item.id === button.dataset.studentId);
      if (!student) return;
      if (button.dataset.memberAction === 'details') {
        const detail = document.getElementById('adminMemberDetail');
        detail.innerHTML = `<div><strong>${esc(student.name)}</strong><small>Informações básicas e frequência</small></div><div><span>Objetivo</span><strong>${esc(student.goal)}</strong></div><div><span>Peso / altura</span><strong>${esc(student.weight)} · ${esc(student.height)}</strong></div><div><span>Frequência</span><strong>${esc(student.frequency)}</strong></div><div><span>Histórico pessoal</span><strong>Preservado no Nutrilev</strong></div><button class="outline-button" type="button" data-close-member-detail>Fechar</button>`;
        detail.hidden = false;
        return;
      }
      if (button.dataset.memberAction === 'toggle') student.accountStatus = student.accountStatus === 'inactive' ? 'active' : 'inactive';
      if (button.dataset.memberAction === 'unlink' && !window.confirm(`Desvincular ${student.name} da academia? O histórico pessoal será preservado.`)) return;
      if (button.dataset.memberAction === 'unlink') student.linked = false;
      if (button.dataset.memberAction === 'link') student.linked = true;
      if (state.remote && ['toggle', 'unlink', 'link'].includes(button.dataset.memberAction)) {
        try { await dataService.updateMembership(student.id, student.gymId, student.linked ? 'active' : 'removed'); remoteData.students = await dataService.adminStudents(); adminSection(); }
        catch (error) { console.error(error); }
        return;
      }
      student.personalHistoryPreserved = true;
      const feedback = document.getElementById('inviteFeedback');
      if (feedback) { feedback.textContent = 'Entre na sua conta para atualizar alunos no Supabase.'; feedback.hidden = false; }
    });
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-member-detail]')) document.getElementById('adminMemberDetail').hidden = true;
    });
  }
  function getAdminCoaches() {
    return state.remote ? (remoteData.coaches || []) : [];
  }
  function adminCoachesView() {
    const coaches = getAdminCoaches();
    return `<article class="card table-card admin-coaches-card">${cardHeading('Gerenciamento de coaches')}<div class="admin-member-toolbar"><p class="admin-copy">O vínculo do Coach com a academia é separado da conta pessoal e do histórico profissional no Nutrilev.</p><form id="inviteCoachForm" class="invite-student-form"><input name="email" type="email" required placeholder="E-mail do Coach" aria-label="E-mail do Coach" /><button class="primary-button" type="submit">Criar convite</button></form><p class="form-message success" id="coachInviteFeedback" hidden></p></div><div class="admin-coach-list">${coaches.length ? coaches.map((coach) => `<div class="admin-coach-row" data-coach-id="${coach.id}"><div class="admin-coach-main"><span class="student-avatar">${esc(coach.name.split(' ').map((part) => part[0]).slice(0, 2).join(''))}</span><div><strong>${esc(coach.name)}</strong><small>${esc(coach.email)}</small></div></div><span class="status ${coach.status !== 'active' ? 'pending' : ''}">${coach.status === 'active' ? 'Ativo' : 'Convite pendente'}</span><span class="status ${coach.linked ? '' : 'pending'}">${coach.linked ? 'Na academia' : 'Removido'}</span><button class="outline-button" type="button" data-coach-action="students" data-coach-id="${coach.id}">${coach.students} alunos</button><button class="outline-button" type="button" data-coach-action="permissions" data-coach-id="${coach.id}">Permissões</button><button class="outline-button" type="button" data-coach-action="toggle" data-coach-id="${coach.id}">${coach.status === 'active' ? 'Desativar' : 'Ativar'}</button><button class="outline-button danger-button" type="button" data-coach-action="${coach.linked ? 'remove' : 'add'}" data-coach-id="${coach.id}">${coach.linked ? 'Remover da academia' : 'Adicionar à academia'}</button></div>`).join('') : '<p class="empty-state">Nenhum coach real cadastrado nesta academia.</p>'}</div><div class="admin-coach-panel" id="adminCoachPanel" hidden></div></article>`;
  }
  function adminOverview() {
    const stats = remoteData.adminStats || { members: 0, coaches: 0, workouts: 0, checkins: 0, completedWorkouts: 0 };
    const gym = remoteData.gym;
    const students = state.remote ? (remoteData.students || []) : [];
    const activeStudents = students.filter((student) => student.linked && student.accountStatus === 'active').length;
    const recentCheckins = (remoteData.checkins || []).slice(0, 5);
    shell('Dashboard', 'VISÃO GERAL DA ACADEMIA', `<article class="card welcome-card"><div><span class="eyebrow">${esc(gym?.name || 'Academia')}</span><h2>Gestão real da sua academia.</h2><p>Acompanhe alunos, coaches, treinos e acessos com dados sincronizados no Supabase.</p></div><div class="welcome-illustration">▣</div></article><div class="kpi-grid"><article class="card"><span class="kpi-label">Alunos ativos</span><div class="kpi-number">${activeStudents}</div><small class="metric-meta">Vínculos ativos</small></article><article class="card"><span class="kpi-label">Coaches ativos</span><div class="kpi-number">${stats.coaches}</div><small class="metric-meta">Equipe cadastrada</small></article><article class="card"><span class="kpi-label">Fichas ativas</span><div class="kpi-number">${stats.workouts}</div><small class="metric-meta">Treinos publicados</small></article><article class="card"><span class="kpi-label">Check-ins</span><div class="kpi-number">${stats.checkins}</div><small class="metric-meta">Eventos registrados</small></article></div><article class="card table-card">${cardHeading('Atividade recente')}<div class="admin-list">${recentCheckins.length ? recentCheckins.map((checkin) => `<div class="admin-list-row"><div><strong>${esc(checkin.name)}</strong><small>${esc(checkin.timestamp)} · ${esc(checkinSourceLabels[checkin.source] || checkin.source)}</small></div><span class="status">Registrado</span></div>`).join('') : '<p class="empty-state">Nenhum check-in registrado ainda.</p>'}</div></article><article class="card section-card">${cardHeading('Próximas ações')}<div class="activity-list"><div class="activity-item"><div class="client-copy"><strong>Alunos</strong><small>${activeStudents ? `${activeStudents} aluno(s) ativo(s) na academia.` : 'Nenhum aluno vinculado ainda.'}</small></div><a class="outline-button" href="#/members">Gerenciar</a></div><div class="activity-item"><div class="client-copy"><strong>Convites</strong><small>Crie um código para novos alunos.</small></div><a class="outline-button" href="#/gym">Abrir academia</a></div></div></article>`);
  }
  function adminAcademyView() {
    return `<article class="card section-card academy-admin-card">${cardHeading('Convites da academia')}<p class="admin-copy">Gere códigos para que alunos solicitem vínculo. Os convites são armazenados no Supabase e nunca em dados locais de demonstração.</p><button class="primary-button" id="generateAcademyInvite" type="button">Gerar novo código</button><p class="form-message success" id="academyInviteFeedback" hidden></p><div class="academy-invite-list" id="academyInviteList"><p class="empty-state">Os convites existentes serão carregados do Supabase.</p></div></article><article class="card side-card">${cardHeading('Canais preparados')}<div class="channel-list"><span><b>▣</b> Código</span><span><b>↗</b> Link de convite <em>Em breve</em></span><span><b>▦</b> QR Code <em>Em breve</em></span><span><b>✉</b> E-mail <em>Em breve</em></span></div></article>`;
  }
  function bindAdminAcademy() {
    const button = document.getElementById('generateAcademyInvite');
    if (!button) return;
    button.addEventListener('click', async () => {
      if (state.remote) {
        try {
          const invitation = await dataService.invite(await dataService.gymId(), '', 'code');
          document.getElementById('academyInviteFeedback').textContent = `Código gerado: ${invitation.code}`;
          document.getElementById('academyInviteFeedback').hidden = false;
        } catch (error) {
          const feedback = document.getElementById('academyInviteFeedback');
          feedback.textContent = error.message || 'Não foi possível gerar o código.';
          feedback.hidden = false;
        }
        return;
      }
      document.getElementById('academyInviteFeedback').textContent = 'Faça login para gerar o convite no Supabase.';
      document.getElementById('academyInviteFeedback').hidden = false;
    });
  }
  function bindAdminCoaches() {
    if (document.documentElement.dataset.adminCoachHandlers === 'bound') return;
    document.documentElement.dataset.adminCoachHandlers = 'bound';
    document.addEventListener('submit', async (event) => {
      if (!event.target.matches('#inviteCoachForm')) return;
      event.preventDefault();
      const email = event.target.elements.email.value.trim().toLowerCase();
      if (state.remote) {
        try {
          await dataService.invite(await dataService.gymId(), email, 'email');
          event.target.reset();
          adminSection();
        } catch (error) {
          const feedback = document.getElementById('coachInviteFeedback');
          if (feedback) { feedback.textContent = error.message || 'Não foi possível criar o convite.'; feedback.hidden = false; }
        }
        return;
      }
      const feedback = document.getElementById('coachInviteFeedback');
      if (feedback) { feedback.textContent = 'Entre na sua conta para criar o convite no Supabase.'; feedback.hidden = false; }
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-coach-action]');
      if (!button) return;
      const coaches = getAdminCoaches();
      const coach = coaches.find((item) => item.id === button.dataset.coachId);
      if (!coach) return;
      const panel = document.getElementById('adminCoachPanel');
      if (button.dataset.coachAction === 'students') {
        panel.innerHTML = `<strong>${esc(coach.name)}</strong><span>Alunos vinculados à academia: <b>${coach.students}</b></span><small>A gestão do vínculo não apaga o histórico pessoal do Coach.</small><button class="outline-button" type="button" data-close-coach-panel>Fechar</button>`;
        panel.hidden = false;
        return;
      }
      if (button.dataset.coachAction === 'permissions') {
        const permissions = [['students', 'Gerenciar alunos'], ['workouts', 'Criar e editar treinos'], ['evolution', 'Visualizar evolução'], ['messages', 'Enviar mensagens']];
        panel.innerHTML = `<strong>Permissões de ${esc(coach.name)}</strong><div class="coach-permission-list">${permissions.map(([id, label]) => `<label><input type="checkbox" data-permission="${id}" ${coach.permissions.includes(id) ? 'checked' : ''} /> ${label}</label>`).join('')}</div><button class="primary-button" type="button" data-save-permissions data-coach-id="${coach.id}">Salvar permissões</button><button class="outline-button" type="button" data-close-coach-panel>Cancelar</button>`;
        panel.hidden = false;
        return;
      }
      if (button.dataset.coachAction === 'toggle') coach.status = coach.status === 'active' ? 'inactive' : 'active';
      if (button.dataset.coachAction === 'remove' && !window.confirm(`Remover ${coach.name} da academia? O histórico pessoal será preservado.`)) return;
      if (button.dataset.coachAction === 'remove') coach.linked = false;
      if (button.dataset.coachAction === 'add') coach.linked = true;
      if (state.remote) {
        try {
          await dataService.updateCoach(coach.id, {
            active: coach.status === 'active' && coach.linked,
            permissions: coach.permissions,
            gym_id: coach.gymId,
          });
          remoteData.coaches = await dataService.adminCoaches();
          adminSection();
        } catch (error) {
          console.error('Coach update failed', error);
        }
        return;
      }
      const feedback = document.getElementById('coachInviteFeedback');
      if (feedback) { feedback.textContent = 'Entre na sua conta para atualizar coaches no Supabase.'; feedback.hidden = false; }
    });
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-coach-panel]')) document.getElementById('adminCoachPanel').hidden = true;
      const save = event.target.closest('[data-save-permissions]');
      if (!save) return;
      const coaches = getAdminCoaches();
      const coach = coaches.find((item) => item.id === save.dataset.coachId);
      coach.permissions = [...document.querySelectorAll('[data-permission]:checked')].map((input) => input.dataset.permission);
      if (state.remote) {
        dataService.updateCoach(coach.id, { permissions: coach.permissions }).then(async () => {
          remoteData.coaches = await dataService.adminCoaches();
          adminSection();
        }).catch((error) => console.error('Coach permissions update failed', error));
        return;
      }
      const feedback = document.getElementById('coachInviteFeedback');
      if (feedback) { feedback.textContent = 'Entre na sua conta para atualizar permissões no Supabase.'; feedback.hidden = false; }
    });
  }
  function adminSection() {
    const currentCheckins = state.remote ? (remoteData.checkins || []) : [];
    const sections = {
      members: ['Alunos', 'GESTÃO DE ALUNOS', adminMembersView()],
      coaches: ['Coaches', 'EQUIPE PROFISSIONAL', adminCoachesView()],
      gym: ['Academia', 'DADOS DA ACADEMIA', `${adminAcademyView()}<article class="card section-card">${cardHeading(remoteData.gym?.name || 'Academia')}<div class="profile-facts admin-facts"><div><span>Plano</span><strong>Não informado</strong></div><div><span>Membros</span><strong>${remoteData.adminStats?.members || 0}</strong></div><div><span>Coaches</span><strong>${remoteData.adminStats?.coaches || 0}</strong></div><div><span>Status</span><strong>${remoteData.gym?.active ? 'Ativa' : 'Inativa'}</strong></div></div></article>`],
      attendance: ['Frequência', 'ACOMPANHAMENTO DE PRESENÇA', `<article class="card section-card">${cardHeading('Check-ins registrados')}<div class="kpi-number">${currentCheckins.length}</div><span class="metric-meta">Eventos disponíveis no Supabase</span></article><article class="card side-card">${cardHeading('Origem dos check-ins')}<div class="source-summary">${Object.entries(checkinSourceLabels).map(([source, label]) => `<div><span>${label}</span><strong>${currentCheckins.filter((item) => item.source === source).length}</strong></div>`).join('')}</div><p class="admin-copy">A frequência será calculada conforme os eventos de acesso forem registrados.</p></article>`],
      checkins: ['Check-ins', 'EVENTOS DE ACESSO', `<article class="card table-card">${cardHeading('Check-ins recebidos')}<p class="admin-copy">O Nutrilev não realiza reconhecimento facial. Estes eventos são preparados para receber dados de academias e integrações externas.</p><div class="admin-list">${currentCheckins.map((checkin) => `<div class="admin-list-row"><div><strong>${esc(checkin.name)}</strong><small>${esc(checkin.timestamp)} · ${esc(checkinSourceLabels[checkin.source])}</small></div><code>${esc(checkin.externalId)}</code><span class="status">Registrado</span></div>`).join('')}</div></article><article class="card section-card">${cardHeading('Contrato de integração')}<div class="integration-flow"><span>Controle de acesso</span><b>→</b><span>API / Webhook</span><b>→</b><span>Nutrilev</span><b>→</b><span>Check-in do aluno</span></div><p class="admin-copy">Cada evento deve informar <code>user_id</code>, <code>gym_id</code>, <code>timestamp</code>, <code>source</code> e <code>external_id</code>.</p></article>`],
      reports: ['Relatórios', 'RELATÓRIOS DA ACADEMIA', `<div class="kpi-grid"><article class="card"><span class="kpi-label">Alunos ativos</span><div class="kpi-number">${remoteData.adminStats?.members || 0}</div></article><article class="card"><span class="kpi-label">Coaches ativos</span><div class="kpi-number">${remoteData.adminStats?.coaches || 0}</div></article><article class="card"><span class="kpi-label">Treinos ativos</span><div class="kpi-number">${remoteData.adminStats?.workouts || 0}</div></article><article class="card"><span class="kpi-label">Check-ins</span><div class="kpi-number">${remoteData.adminStats?.checkins || 0}</div></article></div><article class="card table-card">${cardHeading('Relatórios')}<p class="empty-state">Os relatórios serão disponibilizados quando houver dados suficientes na academia.</p></article>`],
      settings: ['Configurações', 'PREFERÊNCIAS DA ACADEMIA', `<article class="card section-card">${cardHeading('Dados da academia')}<div class="settings-list"><label>Nome da academia<input value="${esc(remoteData.gym?.name || '')}" readonly /></label><label>E-mail administrativo<input type="email" value="${esc(remoteData.gym?.email || '')}" readonly /></label><p class="admin-copy">Esses dados são gerenciados no cadastro da academia.</p></div></article>`],
    };
    const [title, eyebrow, content] = sections[page()] || sections.members;
    shell(title, eyebrow, content);
    if (page() === 'members') bindAdminMembers();
    if (page() === 'coaches') bindAdminCoaches();
    if (page() === 'gym') bindAdminAcademy();
  }
  function render() {
    if (state.dataError && state.remote && !remoteData.plan && !remoteData.workouts && !remoteData.students) {
      shell('Nutrilev', 'ERRO DE CONEXÃO', errorState(navigator.onLine ? 'O servidor não respondeu. Tente novamente.' : 'Verifique sua conexão e tente novamente.'));
      return;
    }
    if (state.role === 'student') {
      if (page() === 'assistant') {
        studentAssistant();
      } else if (page() === 'plan') {
        studentPlan();
      } else if (page() === 'hydration') {
        studentHydration();
      } else if (page() === 'academy-invite') {
        shell('Minha Academia', 'VÍNCULO COM A ACADEMIA', studentAcademy());
        bindStudentAcademy();
      } else if (page() === 'academy-details') {
        if (state.remote && remoteData.academyDetails === null && navigator.onLine) {
          shell('Minha Academia', 'CARREGANDO DADOS', '<div class="dashboard-grid loading-state" aria-label="Carregando dados da academia"><article class="card skeleton-card skeleton-section"><span></span><span></span><span></span><span></span></article></div>');
          dataService.studentAcademyDetails().then((details) => {
            remoteData.academyDetails = details;
            render();
          }).catch((error) => {
            console.error('Academy details load failed', error);
            studentAcademyDetails();
          });
        } else {
          studentAcademyDetails();
        }
      } else if (page() === 'academy' && window.NUTRILEV_MOBILE_APP) {
        studentWorkout();
      } else if (page() === 'progress') {
        studentProgress();
      } else if (page() === 'academy') {
        shell('Minha Academia', 'VÍNCULO COM A ACADEMIA', studentAcademy());
        bindStudentAcademy();
      } else if (page() === 'profile') {
        studentAccount();
      } else studentOverview();
    }
    else if (state.role === 'coach') {
      if (page() === 'overview') coachOverview();
      else coachSection();
    }
    else if (state.role === 'admin') {
      if (page() === 'overview') adminOverview();
      else adminSection();
    }
    document.querySelectorAll('[data-action="assistant"]').forEach((button) => button.addEventListener('click', () => { location.hash = '#/assistant'; }));
    document.querySelectorAll('[data-action="retry-data"]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Tentando...';
      state.dataError = null;
      await checkSession();
      render();
    }));
    document.querySelectorAll('[data-action="water"]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const entry = await dataService.addHydration(Number(button.dataset.waterAmount) || 250);
        remoteData.hydration = [...(remoteData.hydration || []), entry];
        render();
      } catch (error) {
        button.disabled = false;
        button.textContent = error.message || 'Não foi possível registrar água';
      }
    }));
  }
  async function checkSession() {
    const authOverlay = document.getElementById('authOverlay');
    if (!client) {
      if (window.NUTRILEV_MOBILE_APP && authOverlay) {
        authOverlay.hidden = false;
        const message = document.getElementById('authMessage');
        if (message) {
          message.textContent = 'O serviço de autenticação não está disponível.';
          message.hidden = false;
        }
      }
      return;
    }
    const { data } = await client.auth.getSession();
    if (!data.session) {
      state.remote = false;
      if (loginInProgress) return;
      if (window.NUTRILEV_MOBILE_APP && authOverlay) {
        authOverlay.hidden = false;
      }
      return;
    }
    if (new URLSearchParams(window.location.search).get('guarded') === '1') {
      if (!data.session) {
        const loginPath = window.location.pathname.includes('/app/')
          || window.location.pathname.includes('/coach/')
          || window.location.pathname.includes('/admin/')
          ? '../login.html'
          : 'login.html';
        window.top.location.href = loginPath;
        return;
      }
      const { data: profile, error } = await client.from('profiles').select('role').eq('id', data.session.user.id).maybeSingle();
      const profileRole = normalizeRole(profile?.role);
      if (error || profileRole !== queryRole) {
        const safeRoute = profileRole === 'gym_admin' ? 'admin' : profileRole === 'coach' ? 'coach' : 'app';
        window.top.location.href = `../${safeRoute}/`;
        return;
      }
    }
    if (data.session) {
      state.remote = true;
      const { data: authenticatedProfile } = await client.from('profiles').select('role').eq('id', data.session.user.id).maybeSingle();
      if (window.NUTRILEV_MOBILE_APP && normalizeRole(authenticatedProfile?.role || 'student') !== 'student') {
        await client.auth.signOut();
        const message = document.getElementById('authMessage');
        if (message) {
          message.textContent = 'Este aplicativo é exclusivo para alunos. Acesse a plataforma web para usar a área de Coach ou Administrador.';
          message.hidden = false;
        }
        document.getElementById('authOverlay').hidden = false;
        return;
      }
      if (!forcedRole) {
        const { data: currentProfile } = await client.from('profiles').select('role').eq('id', data.session.user.id).maybeSingle();
        state.role = visualRole(normalizeRole(currentProfile?.role || 'student'));
        roleSelect.value = state.role;
      } else if (window.NUTRILEV_MOBILE_APP) {
        document.getElementById('authOverlay').hidden = true;
      }
      setUserIdentity(data.session.user);
      const hasCachedData = state.role === 'student' && loadOfflineCache(data.session.user.id);
      if (hasCachedData) render();
      try {
        if (state.role === 'student') {
          const requiredStudentData = [
            ['profile', dataService.studentProfile(), null],
            ['membership', dataService.membership(), null],
          ];
          const requiredResults = await Promise.all(requiredStudentData.map(async ([name, request, fallback]) => {
            try {
              return [name, await request];
            } catch (error) {
              console.error(`Student data load failed: ${name}`, error);
              return [name, fallback];
            }
          }));
          const requiredData = Object.fromEntries(requiredResults);
          const profile = requiredData.profile;
          const membership = requiredData.membership;
          const optionalStudentData = [
            ['subscription', dataService.subscription(), { plan: 'free', status: 'active' }],
            ['workouts', dataService.assignedWorkouts(), []],
            ['progress', dataService.studentProgress(), { measurements: [], workoutLogs: [], goals: [] }],
            ['plan', dataService.studentPlan(), { entries: [], meals: [], goals: [], foods: [] }],
            ['hydration', dataService.hydrationHistory(), []],
          ];
          const optionalResults = await Promise.all(optionalStudentData.map(async ([name, request, fallback]) => {
            try {
              return [name, await request];
            } catch (error) {
              console.error(`Optional student data load failed: ${name}`, error);
              return [name, fallback];
            }
          }));
          const optionalData = Object.fromEntries(optionalResults);
          remoteData.profile = profile;
          remoteData.membership = membership;
          remoteData.subscription = optionalData.subscription;
          remoteData.workouts = optionalData.workouts;
          remoteData.progress = optionalData.progress;
          remoteData.plan = optionalData.plan;
          remoteData.hydration = optionalData.hydration;
          remoteData.notifications = await dataService.notifications();
          remoteData.academyDetails = null;
          setUserIdentity({ ...data.session.user, user_metadata: { ...data.session.user.user_metadata, full_name: profile?.full_name || data.session.user.user_metadata?.full_name } });
        } else {
          remoteData.membership = await dataService.membership();
          remoteData.workouts = await dataService.workouts();
        }
        if (state.role === 'coach') {
          remoteData.profile = await dataService.coachProfile();
          remoteData.coachStudents = await dataService.coachStudents();
          remoteData.students = await dataService.coachStudentDetails();
          remoteData.exercises = await dataService.exercises();
          remoteData.evolution = await dataService.coachEvolution();
          remoteData.notifications = await dataService.notifications();
        }
        if (state.role === 'admin') {
          remoteData.students = await dataService.adminStudents();
          remoteData.coaches = await dataService.adminCoaches();
          remoteData.checkins = await dataService.checkins();
          remoteData.gym = await dataService.adminGym();
          remoteData.adminStats = await dataService.adminStats();
        }
        saveOfflineCache(data.session.user.id);
      } catch (error) {
        state.dataError = error;
        console.error('Platform data load failed', error);
        if (!navigator.onLine && state.role === 'student' && loadOfflineCache(data.session.user.id)) {
          console.info('Loaded the latest synchronized student data from offline cache');
        }
        if (!state.dataError) state.dataError = null;
      }
      if (state.role === 'student' && navigator.onLine) {
        try {
          const synced = await dataService.syncOfflineActions();
          if (synced) remoteData.hydration = await dataService.hydrationHistory();
        } catch (error) {
          console.error('Offline synchronization failed', error);
        }
      }
      if (state.role === 'student') {
        window.Nutrilev.services.pushNotifications?.register().catch((error) => console.error('Push setup failed', error));
      }
    }
  }
  const roleSelect = document.getElementById('roleSelect');
  if (roleSelect) {
    roleSelect.value = state.role;
  }
  if (forcedRole && roleSelect) {
    roleSelect.disabled = true;
    roleSelect.closest('.role-picker')?.setAttribute('aria-label', 'Perfil autorizado');
  } else if (roleSelect) {
    roleSelect.addEventListener('change', (event) => { state.role = event.target.value; localStorage.setItem('nutrilev.platformRole', state.role); render(); });
  }
  const menuButton = document.getElementById('menuButton');
  const sidebar = document.getElementById('sidebar');
  const closeMobileMenu = () => {
    sidebar?.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', 'Abrir menu');
  };
  menuButton?.setAttribute('aria-expanded', 'false');
  menuButton?.addEventListener('click', () => {
    const isOpen = sidebar?.classList.toggle('open') || false;
    menuButton?.setAttribute('aria-expanded', String(isOpen));
    menuButton?.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
  });
  document.getElementById('mainNav')?.addEventListener('click', closeMobileMenu);
  document.addEventListener('click', (event) => {
    if (!sidebar?.classList.contains('open')) return;
    const target = event.target;
    if (target instanceof Node && !sidebar.contains(target) && target !== menuButton) closeMobileMenu();
  });
  document.getElementById('loginLink')?.addEventListener('click', () => { document.getElementById('authOverlay').hidden = false; });
  document.getElementById('closeAuth')?.addEventListener('click', async () => {
    if (window.NUTRILEV_MOBILE_APP && client) {
      const { data } = await client.auth.getSession();
      if (!data.session) return;
    }
    document.getElementById('authOverlay').hidden = true;
  });
  document.getElementById('logoutButton').addEventListener('click', async () => {
    const session = client ? await client.auth.getSession() : null;
    const userId = session?.data?.session?.user?.id;
    if (client) await client.auth.signOut();
    if (userId) {
      localStorage.removeItem(offlineCacheKey(userId));
      localStorage.removeItem(`nutrilev.offline.queue.${userId}`);
    }
    if (window.NUTRILEV_MOBILE_APP) {
      document.getElementById('authOverlay').hidden = false;
      document.getElementById('dashboard').setAttribute('aria-busy', 'true');
      return;
    }
    window.location.href = 'login.html';
  });
  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => {
    const mode = button.dataset.authMode;
    document.querySelectorAll('[data-auth-mode]').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('[data-auth-panel]').forEach((panel) => { panel.hidden = panel.dataset.authPanel !== mode; });
  }));
  document.getElementById('loginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('authMessage');
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    const values = new FormData(event.currentTarget);
    if (!client) { message.textContent = 'O serviço de autenticação não está disponível.'; message.hidden = false; return; }
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    loginInProgress = true;
    message.textContent = 'Entrando...';
    message.className = 'form-message';
    message.hidden = false;
    try {
      const { error } = await client.auth.signInWithPassword({ email: values.get('email'), password: values.get('password') });
      if (error) { message.textContent = error.message || 'Não foi possível entrar.'; return; }
      await checkSession();
      document.getElementById('authOverlay').hidden = true;
      render();
    } catch (error) {
      console.error('Login session initialization failed', error);
      message.textContent = error.message || 'Não foi possível carregar sua área.';
    } finally {
      loginInProgress = false;
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
    }
  });
  document.getElementById('signupForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('signupMessage');
    const values = new FormData(event.currentTarget);
    if (!client) { message.textContent = 'O serviço de autenticação não está disponível.'; message.hidden = false; return; }
    const { data, error } = await client.auth.signUp({ email: String(values.get('email')).trim(), password: String(values.get('password')), options: { data: { full_name: String(values.get('full_name')).trim(), role: 'student' } } });
    if (error) { message.textContent = error.message || 'Não foi possível criar sua conta.'; message.hidden = false; return; }
    if (!data.session) { message.textContent = 'Conta criada. Confirme seu e-mail para entrar.'; message.className = 'form-message success'; message.hidden = false; return; }
    await checkSession();
    document.getElementById('authOverlay').hidden = true;
    setUserIdentity(data.user);
    render();
  });
  document.getElementById('recoveryForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('recoveryMessage');
    const values = new FormData(event.currentTarget);
    if (!client) { message.textContent = 'O serviço de autenticação não está disponível.'; message.hidden = false; return; }
    const { error } = await client.auth.resetPasswordForEmail(String(values.get('email')).trim());
    if (error) { message.textContent = error.message || 'Não foi possível enviar o link de recuperação.'; message.hidden = false; return; }
    message.textContent = 'Link enviado. Verifique seu e-mail para redefinir a senha.';
    message.className = 'form-message success';
    message.hidden = false;
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('online', async () => {
    try {
      const synced = await dataService.syncOfflineActions();
      if (synced) remoteData.hydration = await dataService.hydrationHistory();
      await checkSession();
      render();
    } catch (error) {
      console.error('Connection recovery synchronization failed', error);
    }
  });
  window.addEventListener('offline', render);
  window.addEventListener('focus', refreshStudentData);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleMidnightRefresh();
      refreshStudentData();
    }
  });
  scheduleMidnightRefresh();
  checkSession().finally(render);
}());
