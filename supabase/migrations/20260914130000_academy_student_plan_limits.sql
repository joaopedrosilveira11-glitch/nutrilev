create or replace function public.academy_student_plan_limit(target_plan text)
returns integer
language sql
immutable
as $$
  select case target_plan
    when 'academy-start' then 100
    when 'academy-pro' then 200
    when 'academy-business' then 500
    when 'enterprise' then 1000000
    else 0
  end;
$$;

create or replace function public.enforce_academy_student_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_plan text;
  student_limit integer;
  active_students integer;
begin
  if new.status <> 'active' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.gym_id::text, 1));

  select s.plan
    into active_plan
  from public.subscriptions s
  where s.gym_id = new.gym_id
    and s.status in ('trialing', 'active')
  order by s.created_at desc
  limit 1;

  active_plan := coalesce(active_plan, 'free');
  student_limit := public.academy_student_plan_limit(active_plan);

  select count(*)::integer
    into active_students
  from public.gym_members
  where gym_id = new.gym_id
    and status = 'active'
    and user_id <> new.user_id;

  if active_students >= student_limit then
    raise exception 'Limite de % aluno(s) atingido para o plano %', student_limit, active_plan;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_academy_student_limit on public.gym_members;
create trigger enforce_academy_student_limit
before insert or update of status, gym_id, user_id on public.gym_members
for each row execute function public.enforce_academy_student_limit();

revoke all on function public.academy_student_plan_limit(text) from public, anon;
revoke all on function public.enforce_academy_student_limit() from public, anon;
grant execute on function public.academy_student_plan_limit(text) to authenticated;

do $$
declare
  admin_user_id uuid;
  admin_gym_id uuid;
begin
  select u.id, p.academy_id
    into admin_user_id, admin_gym_id
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = 'adrenalina@gmail.com'
    and p.role in ('gym_admin', 'gym_owner', 'super_admin')
  limit 1;

  if admin_user_id is null or admin_gym_id is null then
    raise exception 'Conta administrativa adrenalina@gmail.com não encontrada ou sem academia';
  end if;

  update public.subscriptions
  set plan = 'academy-start',
      status = 'active',
      gym_id = admin_gym_id,
      updated_at = now()
  where id = (
    select s.id
    from public.subscriptions s
    where s.user_id = admin_user_id or s.gym_id = admin_gym_id
    order by s.created_at desc
    limit 1
  );

  if not found then
    insert into public.subscriptions (
      user_id, gym_id, plan, status, provider, current_period_start
    ) values (
      admin_user_id, admin_gym_id, 'academy-start', 'active', 'manual', now()
    );
  end if;
end;
$$;
