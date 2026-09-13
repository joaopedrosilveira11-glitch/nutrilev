(function () {
  const services = window.Nutrilev.services;
  const client = services.supabase;
  const isMissingTableError = (error, table) => error && (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    String(error.message || '').toLowerCase().includes(`could not find the table 'public.${table}'`)
  );
  const offlineQueueKey = (userId) => `nutrilev.offline.queue.${userId}`;
  const readOfflineQueue = (userId) => JSON.parse(localStorage.getItem(offlineQueueKey(userId)) || '[]');
  const writeOfflineQueue = (userId, queue) => localStorage.setItem(offlineQueueKey(userId), JSON.stringify(queue));
  const nutritionMultiplier = (food, unit, quantity) => {
    const selected = String(unit || food?.serving_unit || 'porção').toLowerCase();
    const base = String(food?.serving_unit || 'porção').toLowerCase();
    const servingSize = Number(food?.serving_size);
    if (!Number.isFinite(servingSize) || servingSize <= 0 || selected === 'porção') return quantity;
    const unitToGrams = { g: 1, kg: 1000 };
    const unitToMilliliters = { ml: 1, l: 1000 };
    if (unitToGrams[selected] && unitToGrams[base]) return quantity * unitToGrams[selected] / servingSize;
    if (unitToMilliliters[selected] && unitToMilliliters[base]) return quantity * unitToMilliliters[selected] / servingSize;
    if (selected === base) return quantity;
    return quantity;
  };
  const api = {
    enabled: () => Boolean(client),
    async user() {
      if (!client) return null;
      const { data } = await client.auth.getUser();
      return data.user || null;
    },
    async subscription() {
      const user = await api.user();
      if (!user) return { plan: 'free', status: 'active' };
      const { data, error } = await client.from('subscriptions').select('plan, status, current_period_end').eq('user_id', user.id).in('status', ['trialing', 'active']).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error && !isMissingTableError(error, 'subscriptions')) throw error;
      if (data) return data;
      const purchase = await client.from('apk_purchases').select('plan, status, approved_at').eq('user_id', user.id).maybeSingle();
      if (purchase.error && !isMissingTableError(purchase.error, 'apk_purchases')) throw purchase.error;
      if (purchase.data?.status === 'approved') {
        return { plan: purchase.data.plan || 'plus', status: 'active', current_period_end: null };
      }
      return { plan: 'free', status: 'active' };
    },
    async notifications() {
      const user = await api.user();
      if (!user) return [];
      const { data, error } = await client.from('notifications').select('id, title, body, is_read, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []).map((item) => ({ ...item, read_at: item.is_read ? item.created_at : null }));
    },
    async markNotificationRead(id) {
      const user = await api.user();
      const { error } = await client.from('notifications').update({ is_read: true, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    async markAllNotificationsRead() {
      const user = await api.user();
      const { error } = await client.from('notifications').update({ is_read: true, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('is_read', false);
      if (error) throw error;
    },
    async coachProfile() {
      const user = await api.user();
      if (!user) return null;
      const profile = await client.from('profiles').select('id, full_name, role, academy_id').eq('id', user.id).single();
      if (profile.error) throw profile.error;
      const gym = profile.data.academy_id
        ? await client.from('gyms').select('id, name, email').eq('id', profile.data.academy_id).maybeSingle()
        : { data: null, error: null };
      if (gym.error) throw gym.error;
      return { ...profile.data, email: user.email || '', academyName: gym.data?.name || 'Nenhuma academia vinculada' };
    },
    async updateProfile(changes) {
      const user = await api.user();
      if (!user) throw new Error('Faça login para editar seu perfil.');
      const fullName = String(changes.full_name || '').trim();
      if (fullName.length < 2) throw new Error('Informe um nome válido.');
      const { data, error } = await client.from('profiles').update({ full_name: fullName, updated_at: new Date().toISOString() }).eq('id', user.id).select('id, full_name, role, academy_id, avatar_url').single();
      if (error) throw error;
      return data;
    },
    async uploadProfilePhoto(file) {
      const user = await api.user();
      if (!user) throw new Error('Faça login para alterar sua foto.');
      if (!(file instanceof File) || !file.type.startsWith('image/')) throw new Error('Selecione uma imagem válida.');
      if (file.size > 5 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 5 MB.');
      const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const upload = await client.storage.from('profile-avatars').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
      if (upload.error) throw upload.error;
      const publicUrl = client.storage.from('profile-avatars').getPublicUrl(path).data.publicUrl;
      const { data, error } = await client.from('profiles').update({ avatar_url: publicUrl, updated_at: new Date().toISOString() }).eq('id', user.id).select('id, full_name, role, academy_id, avatar_url').single();
      if (error) throw error;
      return data;
    },
    async membership() {
      const user = await api.user();
      if (!user) return null;
      const { data, error } = await client.from('gym_members').select('*').eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const gym = await client.from('gyms').select('name').eq('id', data.gym_id).maybeSingle();
      if (gym.error) throw gym.error;
      return { ...data, gymName: gym.data?.name || 'Academia' };
    },
    async studentProfile() {
      const user = await api.user();
      if (!user) return null;
      const { data, error } = await client.from('profiles').select('id, full_name, role, academy_id, avatar_url, updated_at').eq('id', user.id).maybeSingle();
      if (error) throw error;
      return data ? { ...data, email: user.email || '' } : null;
    },
    async studentAcademyDetails() {
      const user = await api.user();
      if (!user) return null;
      const membership = await client.from('gym_members').select('*').eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (membership.error) throw membership.error;
      if (!membership.data) return null;
      const gym = await client.from('gyms').select('id, name, logo_url').eq('id', membership.data.gym_id).maybeSingle();
      if (gym.error) throw gym.error;
      const [coaches, checkins, workouts, logs] = await Promise.all([
        client.from('profiles').select('id, full_name').eq('academy_id', membership.data.gym_id).eq('role', 'coach').order('full_name').limit(1),
        client.from('checkins').select('id, timestamp, source, external_id').eq('user_id', user.id).eq('gym_id', membership.data.gym_id).order('timestamp', { ascending: false }).limit(90),
        client.from('workout_assignments').select('workout_id, workouts(name, muscle_group)').eq('student_id', user.id).eq('active', true).limit(1),
        client.from('workout_logs').select('performed_at, workouts!inner(gym_id)').eq('user_id', user.id).eq('workouts.gym_id', membership.data.gym_id).order('performed_at', { ascending: false }).limit(30),
      ]);
      for (const result of [coaches, checkins, workouts, logs]) if (result.error) throw result.error;
      const recentLogs = logs.data || [];
      return {
        ...membership.data,
        gymName: gym.data?.name || 'Academia',
        gymLogo: gym.data?.logo_url || '',
        coachName: coaches.data?.[0]?.full_name || 'A definir',
        currentWorkout: workouts.data?.[0]?.workouts?.name || 'Não definido',
        frequency: `${recentLogs.filter((log) => new Date(log.performed_at).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000).length} treinos nos últimos 30 dias`,
        checkins: (checkins.data || []).map((checkin) => ({ ...checkin, timestampLabel: new Date(checkin.timestamp).toLocaleString('pt-BR') })),
        lastCheckin: checkins.data?.[0] ? new Date(checkins.data[0].timestamp).toLocaleString('pt-BR') : 'Sem registros',
        evolution: recentLogs.length ? `${recentLogs.length} treino(s) registrado(s)` : 'Sem registros',
      };
    },
    async acceptInvitation(code) {
      const { data, error } = await client.rpc('accept_gym_invitation', { invitation_code: code });
      if (error) throw error;
      const gym = await client.from('gyms').select('name').eq('id', data.gym_id).maybeSingle();
      if (gym.error) throw gym.error;
      return { ...data, gymName: gym.data?.name || 'Academia' };
    },
    async workouts() {
      const user = await api.user();
      if (!user) return [];
      const { data, error } = await client.from('workouts').select('*, workout_exercises(*, exercises(name))').eq('coach_id', user.id).eq('active', true).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((workout) => ({
        id: workout.id, name: workout.name, muscles: workout.muscle_group || '', notes: workout.notes || '',
        createdAt: new Date(workout.created_at).toLocaleDateString('pt-BR'),
        exercises: (workout.workout_exercises || []).sort((a, b) => a.position - b.position).map((item) => ({
          name: item.exercises?.name || 'Exercício', sets: item.sets, reps: item.repetitions, load: item.initial_load, rest: item.rest_seconds,
        })),
      }));
    },
    async assignedWorkouts() {
      const user = await api.user();
      if (!user) return [];
      const { data, error } = await client.from('workout_assignments').select('workout_id, workouts(*, workout_exercises(*, exercises(name)))').eq('student_id', user.id).eq('active', true);
      if (error) throw error;
      return (data || []).map((row) => {
        const workout = row.workouts;
        return { id: workout.id, name: workout.name, muscles: workout.muscle_group || '', notes: workout.notes || '', exercises: (workout.workout_exercises || []).sort((a, b) => a.position - b.position).map((item) => ({ name: item.exercises?.name || 'Exercício', sets: item.sets, reps: item.repetitions, load: item.initial_load, rest: item.rest_seconds })) };
      });
    },
    async coachStudents() {
      const user = await api.user();
      const gymId = await api.gymId();
      if (!user || !gymId) return [];
      const memberships = await client.from('gym_members').select('user_id').eq('gym_id', gymId).eq('status', 'active');
      if (memberships.error) throw memberships.error;
      const ids = (memberships.data || []).map((item) => item.user_id);
      if (!ids.length) return [];
      const profiles = await client.from('profiles').select('id, full_name, role').in('id', ids).eq('role', 'student').order('full_name');
      if (profiles.error) throw profiles.error;
      return profiles.data || [];
    },
    async exercises() {
      const { data, error } = await client.from('exercises').select('id, name, muscle_group, instructions, created_by, created_at').order('name');
      if (error) throw error;
      return data || [];
    },
    async createExercise(exercise) {
      const user = await api.user();
      if (!user) throw new Error('Faça login para cadastrar um exercício.');
      const name = String(exercise.name || '').trim();
      if (!name) throw new Error('Informe o nome do exercício.');
      const { data, error } = await client.from('exercises').insert({ name, muscle_group: exercise.muscle_group || null, instructions: exercise.instructions || null, created_by: user.id }).select().single();
      if (error) throw error;
      return data;
    },
    async updateExercise(id, changes) {
      const user = await api.user();
      const { data, error } = await client.from('exercises').update({ name: changes.name, muscle_group: changes.muscle_group || null, instructions: changes.instructions || null }).eq('id', id).eq('created_by', user.id).select().single();
      if (error) throw error;
      return data;
    },
    async deleteExercise(id) {
      const user = await api.user();
      const { error } = await client.from('exercises').delete().eq('id', id).eq('created_by', user.id);
      if (error) throw error;
    },
    async coachStudentDetails() {
      const students = await api.coachStudents();
      return Promise.all(students.map(async (profile) => {
        const [measurements, logs, assignments] = await Promise.all([
          client.from('body_measurements').select('*').eq('user_id', profile.id).order('measured_at', { ascending: true }),
          client.from('workout_logs').select('performed_at, duration_seconds, workout_id, notes').eq('user_id', profile.id).order('performed_at', { ascending: false }).limit(30),
          client.from('workout_assignments').select('workout_id, workouts(name, muscle_group)').eq('student_id', profile.id).eq('active', true),
        ]);
        for (const result of [measurements, logs, assignments]) if (result.error) throw result.error;
        const history = measurements.data || [];
        const workoutLogs = logs.data || [];
        const latest = history[history.length - 1];
        const lastLog = workoutLogs[0];
        const lastThirtyDays = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const recentLogs = workoutLogs.filter((log) => new Date(log.performed_at).getTime() >= lastThirtyDays);
        const assigned = (assignments.data || []).map((item) => item.workouts).filter(Boolean);
        return {
          id: profile.id,
          name: profile.full_name || 'Aluno',
          initials: (profile.full_name || 'A').split(' ').map((part) => part[0]).slice(0, 2).join(''),
          goal: 'Acompanhamento',
          status: lastLog && (Date.now() - new Date(lastLog.performed_at).getTime() < 14 * 24 * 60 * 60 * 1000) ? 'Ativa' : 'Atenção',
          joinedAt: 'Não informado',
          lastWorkout: lastLog ? new Date(lastLog.performed_at).toLocaleDateString('pt-BR') : 'Sem registros',
          lastAccess: lastLog ? new Date(lastLog.performed_at).toLocaleDateString('pt-BR') : 'Sem registros',
          frequency: `${recentLogs.length} treino(s)`,
          weeklyFrequency: `${recentLogs.filter((log) => new Date(log.performed_at).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000).length} treino(s)`,
          monthlyFrequency: `${recentLogs.length} treino(s)`,
          weight: latest?.weight_kg ? `${latest.weight_kg} kg` : 'Sem registro',
          height: latest?.height_cm ? `${latest.height_cm} cm` : 'Sem registro',
          bodyFat: latest?.body_fat_percentage,
          fatMass: latest?.fat_mass_kg,
          leanMass: latest?.lean_mass_kg,
          assessmentDate: latest?.measured_at,
          age: 'Não informado',
          measures: latest ? `${latest.waist_cm || '—'} cm cintura · ${latest.hip_cm || '—'} cm quadril` : 'Sem medidas registradas',
          weightHistory: history.filter((item) => item.weight_kg != null).map((item) => Number(item.weight_kg)),
          weightLabels: history.filter((item) => item.weight_kg != null).map((item) => new Date(item.measured_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
          currentWorkout: assigned[0]?.name || 'Nenhum treino atribuído',
          workouts: assigned.map((workout) => [workout.name, workout.muscle_group || 'Ficha atribuída']),
          latestWorkoutDetails: lastLog?.notes || null,
        };
      }));
    },
    async coachEvolution() {
      const students = await api.coachStudents();
      return Promise.all(students.map(async (student) => {
        const [measurements, logs] = await Promise.all([
          client.from('body_measurements').select('measured_at, weight_kg, body_fat_percentage, fat_mass_kg, lean_mass_kg').eq('user_id', student.id).order('measured_at', { ascending: true }),
          client.from('workout_logs').select('performed_at, duration_seconds').eq('user_id', student.id).order('performed_at', { ascending: false }).limit(90),
        ]);
        if (measurements.error) throw measurements.error;
        if (logs.error) throw logs.error;
        return { id: student.id, name: student.full_name || 'Aluno', measurements: measurements.data || [], logs: logs.data || [] };
      }));
    },
    async assignWorkout(workoutId, studentId) {
      const { data, error } = await client.from('workout_assignments').upsert({ workout_id: workoutId, student_id: studentId, active: true }, { onConflict: 'workout_id,student_id' }).select().single();
      if (error) throw error;
      return data;
    },
    async studentProgress() {
      const user = await api.user();
      if (!user) return { measurements: [], workoutLogs: [], goals: [] };
      const [measurements, workoutLogs, goals] = await Promise.all([
        client.from('body_measurements').select('id, measured_at, weight_kg, height_cm, body_fat_percentage, fat_mass_kg, lean_mass_kg, body_fat_method, waist_cm, hip_cm, notes').eq('user_id', user.id).order('measured_at', { ascending: true }),
        client.from('workout_logs').select('id, performed_at, duration_seconds, notes, workout_id, workouts(name)').eq('user_id', user.id).order('performed_at', { ascending: false }).limit(30),
        client.from('goals').select('id, type, name, target_value, unit, status, starts_at, ends_at').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: false }),
      ]);
      if (measurements.error) throw measurements.error;
      if (workoutLogs.error) throw workoutLogs.error;
      if (goals.error) throw goals.error;
      return { measurements: measurements.data || [], workoutLogs: (workoutLogs.data || []).map((log) => ({ ...log, workout_name: log.workouts?.name || 'Treino' })), goals: goals.data || [] };
    },
    async finishWorkout({ workoutId, durationSeconds, exercises }) {
      const user = await api.user();
      if (!user || !workoutId) throw new Error('Não foi possível finalizar este treino.');
      const notes = JSON.stringify({ source: 'nutrilev-mobile', exercises: exercises || [] });
      const { data, error } = await client.from('workout_logs').insert({
        user_id: user.id,
        workout_id: workoutId,
        performed_at: new Date().toISOString(),
        duration_seconds: Math.max(0, Number(durationSeconds) || 0),
        notes,
      }).select('id, performed_at, duration_seconds, workout_id').single();
      if (error) throw error;
      return data;
    },
    async studentPlan() {
      const user = await api.user();
      if (!user) return { entries: [], meals: [], goals: [] };
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const [entries, meals, goals, foods] = await Promise.all([
        client.from('nutrition_entries').select('id, consumed_at, food_name, calories, protein_grams, source, source_id').eq('user_id', user.id).gte('consumed_at', start.toISOString()).order('consumed_at', { ascending: true }),
        client.from('meals').select('id, name, consumed_at, created_at').eq('user_id', user.id).gte('consumed_at', start.toISOString()).order('consumed_at', { ascending: true }),
        client.from('goals').select('type, name, target_value, unit').eq('user_id', user.id).eq('status', 'active').in('type', ['calories', 'protein']),
        client.from('foods').select('id, name, source_id, serving_size, serving_unit, calories, protein_grams').order('name').limit(100),
      ]);
      if (entries.error) throw entries.error;
      if (meals.error) throw meals.error;
      if (goals.error) throw goals.error;
      if (foods.error) throw foods.error;
      return { entries: entries.data || [], meals: meals.data || [], goals: goals.data || [], foods: foods.data || [] };
    },
    async hydrationToday() {
      const user = await api.user();
      if (!user) return [];
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const { data, error } = await client.from('hydration_entries').select('id, amount_ml, consumed_at').eq('user_id', user.id).gte('consumed_at', start.toISOString()).lt('consumed_at', end.toISOString()).order('consumed_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async hydrationHistory(days = 30) {
      const user = await api.user();
      if (!user) return [];
      const start = new Date();
      start.setDate(start.getDate() - Math.max(1, Number(days) || 30));
      const { data, error } = await client.from('hydration_entries').select('id, amount_ml, consumed_at').eq('user_id', user.id).gte('consumed_at', start.toISOString()).order('consumed_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async addHydration(amountMl = 250) {
      const user = await api.user();
      const amount = Number(amountMl);
      if (!user) throw new Error('Faça login para registrar água.');
      if (!Number.isInteger(amount) || amount <= 0) throw new Error('Informe uma quantidade de água válida.');
      if (!navigator.onLine) {
        const entry = { id: `offline-${Date.now()}`, amount_ml: amount, consumed_at: new Date().toISOString(), pending_sync: true };
        const queue = readOfflineQueue(user.id);
        queue.push({ type: 'hydration', payload: { amount_ml: amount } });
        writeOfflineQueue(user.id, queue);
        return entry;
      }
      const { data, error } = await client.from('hydration_entries').insert({ user_id: user.id, amount_ml: amount }).select('id, amount_ml, consumed_at').single();
      if (error) throw error;
      return data;
    },
    async syncOfflineActions() {
      const user = await api.user();
      if (!user || !navigator.onLine) return 0;
      const queue = readOfflineQueue(user.id);
      if (!queue.length) return 0;
      const pending = [];
      let synced = 0;
      for (const action of queue) {
        if (action.type !== 'hydration') continue;
        const { error } = await client.from('hydration_entries').insert({ user_id: user.id, ...action.payload });
        if (error) pending.push(action);
        else synced += 1;
      }
      writeOfflineQueue(user.id, pending);
      return synced;
    },
    async findFoodByName(name) {
      const normalized = name.trim().replace(/\s+/g, ' ');
      if (!normalized) return null;
      const { data, error } = await client.from('foods').select('id, name, source, source_id, serving_size, serving_unit, calories, protein_grams').ilike('name', normalized).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
    async searchFoodCatalog(query = '', limit = 20) {
      const user = await api.user();
      if (!user) throw new Error('Faça login para pesquisar alimentos.');
      const normalized = String(query).trim().replace(/\s+/g, ' ');
      let foodsQuery = client.from('foods').select('id, name, source, source_id, serving_size, serving_unit, calories, protein_grams').order('name').limit(limit);
      if (normalized) foodsQuery = foodsQuery.ilike('name', `%${normalized}%`);
      const [foodsResult, favoritesResult] = await Promise.all([
        foodsQuery,
        client.from('food_favorites').select('food_id').eq('user_id', user.id),
      ]);
      if (foodsResult.error) throw foodsResult.error;
      if (favoritesResult.error && !isMissingTableError(favoritesResult.error, 'food_favorites')) throw favoritesResult.error;
      const favoriteIds = new Set((favoritesResult.data || []).map((item) => item.food_id));
      return (foodsResult.data || []).map((food) => ({ ...food, favorite: favoriteIds.has(food.id) }));
    },
    async toggleFoodFavorite(foodId, favorite) {
      const user = await api.user();
      if (!user || !foodId) throw new Error('Não foi possível atualizar o favorito.');
      if (favorite) {
        const { error } = await client.from('food_favorites').upsert({ user_id: user.id, food_id: foodId }, { onConflict: 'user_id,food_id' });
        if (error && !isMissingTableError(error, 'food_favorites')) throw error;
      } else {
        const { error } = await client.from('food_favorites').delete().eq('user_id', user.id).eq('food_id', foodId);
        if (error && !isMissingTableError(error, 'food_favorites')) throw error;
      }
    },
    async addMeal({ name, category, foodId, servings, unit, estimatedCalories, estimatedProtein }) {
      const user = await api.user();
      if (!user) throw new Error('Faça login para registrar uma refeição.');
      const quantity = Number(servings);
      if (!name?.trim() || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Informe a refeição e uma quantidade válida.');
      let food = null;
      if (foodId) {
        const result = await client.from('foods').select('id, name, source, source_id, serving_size, serving_unit, calories, protein_grams').eq('id', foodId).single();
        if (result.error) throw result.error;
        food = result.data;
      }
      if (!food && (!Number.isFinite(Number(estimatedCalories)) || !Number.isFinite(Number(estimatedProtein)))) throw new Error('Selecione um alimento do catálogo ou aguarde a estimativa da IA.');
      if (!food) {
        const sourceId = `gemini-${name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`;
        const saved = await client.from('foods').upsert({
          name: name.trim(),
          source: 'integration',
          source_id: sourceId,
          created_by: user.id,
          serving_size: 1,
          serving_unit: 'porção',
          calories: Number(estimatedCalories),
          protein_grams: Number(estimatedProtein),
          is_verified: false,
          is_public: true,
        }, { onConflict: 'source,source_id' }).select('id, name, source, source_id, serving_size, serving_unit, calories, protein_grams').single();
        if (saved.error) throw saved.error;
        food = saved.data;
      }
      const consumedAt = new Date().toISOString();
      const { data: meal, error: mealError } = await client.from('meals').insert({ user_id: user.id, name: category?.trim() || name.trim(), consumed_at: consumedAt }).select('id').single();
      if (mealError) throw mealError;
      const multiplier = food ? nutritionMultiplier(food, unit, quantity) : quantity;
      const calories = (food ? Number(food.calories) : Number(estimatedCalories)) * multiplier;
      const protein = (food ? Number(food.protein_grams) : Number(estimatedProtein)) * multiplier;
      const { error: itemError } = await client.from('meal_items').insert({
        meal_id: meal.id,
        food_id: food.id,
        quantity,
        unit: unit?.trim() || food.serving_unit || 'porção',
        calories_kcal: calories,
        protein_g: protein,
        carbs_g: 0,
        fat_g: 0,
      });
      if (itemError) {
        const cleanup = await client.from('meals').delete().eq('id', meal.id);
        if (cleanup.error) throw cleanup.error;
        throw itemError;
      }
      const foodName = food?.name || name.trim();
      const { error: entryError } = await client.from('nutrition_entries').insert({
        user_id: user.id,
        consumed_at: consumedAt,
        food_name: `${foodName} (${quantity} ${unit?.trim() || food.serving_unit || 'porção'})`,
        calories,
        protein_grams: protein,
        source: food.source === 'integration' ? 'integration' : 'manual_verified',
        source_id: `${food.source_id}:${meal.id}`,
      });
      if (entryError) {
        const cleanup = await client.from('meals').delete().eq('id', meal.id);
        if (cleanup.error) throw cleanup.error;
        throw entryError;
      }
      return meal;
    },
    async addTrustedAiMeal({ category, items }) {
      const user = await api.user();
      if (!user || !Array.isArray(items) || !items.length) throw new Error('Nenhum alimento confirmado.');
      for (const item of items) {
        if (!item?.food_id || !Number.isFinite(Number(item.calories)) || !Number.isFinite(Number(item.protein)) || !Number.isFinite(Number(item.carbs))) {
          throw new Error('Todos os alimentos precisam ter dados nutricionais confirmados pela fonte.');
        }
        const sourceId = String(item.food_id);
        const saved = await client.from('foods').upsert({
          name: String(item.name),
          source: 'ai_generated',
          source_id: sourceId,
          created_by: user.id,
          serving_size: Number(item.quantity) || 100,
          serving_unit: String(item.unit || 'g'),
          calories: Number(item.calories),
          protein_grams: Number(item.protein),
          is_verified: true,
          is_public: true,
        }, { onConflict: 'source,source_id' }).select('id, name, source, source_id, serving_unit, calories, protein_grams').single();
        if (saved.error) throw saved.error;
        await api.addMeal({ name: String(item.name), category: category || item.meal_type || 'Outras', foodId: saved.data.id, servings: 1, unit: item.unit || saved.data.serving_unit });
      }
    },
    async updateMealEntry({ entryId, mealId, foodId, quantity, unit, category }) {
      const user = await api.user();
      const amount = Number(quantity);
      if (!user || !entryId || !mealId || !foodId || !Number.isFinite(amount) || amount <= 0) throw new Error('Informe uma quantidade válida.');
      const foodResult = await client.from('foods').select('name, source, source_id, serving_size, serving_unit, calories, protein_grams').eq('id', foodId).single();
      if (foodResult.error) throw foodResult.error;
      const food = foodResult.data;
      const multiplier = nutritionMultiplier(food, unit, amount);
      const calories = Number(food.calories || 0) * multiplier;
      const protein = Number(food.protein_grams || 0) * multiplier;
      const mealResult = await client.from('meals').update({ name: category?.trim() || 'Outras' }).eq('id', mealId).eq('user_id', user.id);
      if (mealResult.error) throw mealResult.error;
      const itemResult = await client.from('meal_items').update({ quantity: amount, unit: unit?.trim() || food.serving_unit || 'porção', calories_kcal: calories, protein_g: protein }).eq('meal_id', mealId).eq('food_id', foodId);
      if (itemResult.error) throw itemResult.error;
      const entryResult = await client.from('nutrition_entries').update({ food_name: `${food.name} (${amount} ${unit || food.serving_unit || 'porção'})`, calories, protein_grams: protein }).eq('id', entryId).eq('user_id', user.id).select('id, consumed_at, food_name, calories, protein_grams, source, source_id').single();
      if (entryResult.error) throw entryResult.error;
      return entryResult.data;
    },
    async deleteMealEntry({ entryId, mealId }) {
      const user = await api.user();
      if (!user || !entryId || !mealId) throw new Error('Não foi possível remover este alimento.');
      const entryResult = await client.from('nutrition_entries').delete().eq('id', entryId).eq('user_id', user.id).select('id');
      if (entryResult.error) throw entryResult.error;
      if (!entryResult.data?.length) throw new Error('O alimento não foi removido. Aplique as permissões de exclusão no Supabase e tente novamente.');
      const itemResult = await client.from('meal_items').delete().eq('meal_id', mealId).select('meal_id');
      if (itemResult.error) throw itemResult.error;
      const mealResult = await client.from('meals').delete().eq('id', mealId).eq('user_id', user.id).select('id');
      if (mealResult.error) throw mealResult.error;
      if (!mealResult.data?.length) throw new Error('O alimento foi removido, mas a refeição vinculada não pôde ser excluída.');
    },
    async addMeasurement(measurement) {
      const user = await api.user();
      if (!user) throw new Error('Faça login para registrar uma avaliação.');
      const { data, error } = await client.from('body_measurements').insert({ ...measurement, user_id: user.id }).select().single();
      if (error) throw error;
      return data;
    },
    async addStudentMeasurement(studentId, measurement) {
      const { data, error } = await client.from('body_measurements').insert({ ...measurement, user_id: studentId }).select().single();
      if (error) throw error;
      return data;
    },
    async saveWorkout(workout, existingId) {
      const user = await api.user();
      const gymId = await api.gymId();
      const payload = { name: workout.name, muscle_group: workout.muscles || null, notes: workout.notes || null, coach_id: user.id, gym_id: gymId, active: true };
      const result = existingId
        ? await client.from('workouts').update(payload).eq('id', existingId).select().single()
        : await client.from('workouts').insert(payload).select().single();
      if (result.error) throw result.error;
      const workoutId = result.data.id;
      const cleared = await client.from('workout_exercises').delete().eq('workout_id', workoutId);
      if (cleared.error) throw cleared.error;
      for (const [position, exercise] of (workout.exercises || []).entries()) {
        const { data: existing } = await client.from('exercises').select('id').ilike('name', exercise.name).maybeSingle();
        let exerciseId = existing?.id;
        if (!exerciseId) {
          const created = await client.from('exercises').insert({ name: exercise.name, created_by: user.id }).select('id').single();
          if (created.error) throw created.error;
          exerciseId = created.data.id;
        }
        const restSeconds = parseInt(String(exercise.rest || '').replace(/\D/g, ''), 10);
        const row = { workout_id: workoutId, exercise_id: exerciseId, position, sets: Number(exercise.sets) || 1, repetitions: Number(exercise.reps) || 1, initial_load: parseFloat(exercise.load) || null, rest_seconds: Number.isFinite(restSeconds) ? restSeconds : null };
        const savedExercise = await client.from('workout_exercises').insert(row);
        if (savedExercise.error) throw savedExercise.error;
      }
      return result.data;
    },
    async deleteWorkout(id) {
      const { error } = await client.from('workouts').update({ active: false }).eq('id', id);
      if (error) throw error;
    },
    async adminStudents() {
      const { data, error } = await client.from('gym_members').select('user_id, gym_id, status, created_at').order('created_at', { ascending: false });
      if (error) throw error;
      const ids = (data || []).map((row) => row.user_id);
      if (!ids.length) return [];
      const profiles = await client.from('profiles').select('id, full_name, role').in('id', ids);
      if (profiles.error) throw profiles.error;
      const byId = new Map((profiles.data || []).map((profile) => [profile.id, profile]));
      return (data || []).map((row) => ({ row, profile: byId.get(row.user_id) })).filter(({ profile }) => profile?.role === 'student').map(({ row, profile }) => ({ id: row.user_id, gymId: row.gym_id, name: profile.full_name || 'Aluno', email: '', status: row.status === 'active' ? 'Ativa' : 'Inativo', accountStatus: row.status === 'active' ? 'active' : 'inactive', linked: row.status === 'active', goal: 'Acompanhamento', frequency: '—', initials: (profile.full_name || 'A').split(' ').map((part) => part[0]).slice(0, 2).join('') }));
    },
    async gymId() {
      const user = await api.user();
      const { data, error } = await client.from('profiles').select('academy_id').eq('id', user.id).single();
      if (error) throw error;
      return data.academy_id;
    },
    async adminCoaches() {
      const { data, error } = await client.from('coaches').select('id, gym_id, active, permissions, created_at').order('created_at', { ascending: false });
      if (error) throw error;
      const ids = (data || []).map((row) => row.id);
      if (!ids.length) return [];
      const profiles = await client.from('profiles').select('id, full_name').in('id', ids);
      if (profiles.error) throw profiles.error;
      const byId = new Map((profiles.data || []).map((profile) => [profile.id, profile]));
      return (data || []).map((row) => ({ id: row.id, gymId: row.gym_id, name: byId.get(row.id)?.full_name || 'Coach', email: '', status: row.active ? 'active' : 'inactive', linked: row.active, students: 0, permissions: Object.keys(row.permissions || {}) }));
    },
    async adminGym() {
      const gymId = await api.gymId();
      if (!gymId) return null;
      const { data, error } = await client.from('gyms').select('id, name, legal_name, email, active, created_at').eq('id', gymId).single();
      if (error) throw error;
      return data;
    },
    async adminStats() {
      const gymId = await api.gymId();
      if (!gymId) return { members: 0, coaches: 0, workouts: 0, checkins: 0, completedWorkouts: 0 };
      const [members, coaches, workouts, checkins, completedWorkouts] = await Promise.all([
        client.from('gym_members').select('user_id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('status', 'active'),
        client.from('coaches').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('active', true),
        client.from('workouts').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('active', true),
        client.from('checkins').select('id', { count: 'exact', head: true }).eq('gym_id', gymId),
        client.from('workout_logs').select('id, workouts!inner(gym_id)', { count: 'exact', head: true }).eq('workouts.gym_id', gymId),
      ]);
      for (const result of [members, coaches, workouts, checkins, completedWorkouts]) if (result.error) throw result.error;
      return { members: members.count || 0, coaches: coaches.count || 0, workouts: workouts.count || 0, checkins: checkins.count || 0, completedWorkouts: completedWorkouts.count || 0 };
    },
    async updateCoach(id, changes) {
      const { error } = await client.from('coaches').update(changes).eq('id', id);
      if (error) throw error;
    },
    async updateMembership(userId, gymId, status) {
      const { error } = await client.from('gym_members').update({ status, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('gym_id', gymId);
      if (error) throw error;
    },
    async invite(gymId, email, method = 'email') {
      const user = await api.user();
      const code = `NUTRI-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const { data, error } = await client.from('gym_invitations').insert({ gym_id: gymId, code, created_by: user.id, method }).select().single();
      if (error) throw error;
      return data;
    },
    async checkins() {
      const { data, error } = await client.from('checkins').select('id, user_id, gym_id, timestamp, source, external_id').order('timestamp', { ascending: false }).limit(100);
      if (error) throw error;
      const ids = [...new Set((data || []).map((row) => row.user_id))];
      const profiles = ids.length ? await client.from('profiles').select('id, full_name').in('id', ids) : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const byId = new Map((profiles.data || []).map((profile) => [profile.id, profile]));
      return (data || []).map((row) => ({ name: byId.get(row.user_id)?.full_name || 'Aluno', timestamp: new Date(row.timestamp).toLocaleString('pt-BR'), source: row.source, externalId: row.external_id || row.id }));
    },
  };
  services.platformData = api;
}());
