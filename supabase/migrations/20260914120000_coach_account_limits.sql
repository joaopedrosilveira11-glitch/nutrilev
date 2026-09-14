create table if not exists public.coach_invitations (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  email text not null,
  code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists coach_invitations_gym_status_idx
  on public.coach_invitations (gym_id, status);

alter table public.coach_invitations enable row level security;

drop policy if exists "Academy admins can read coach invitations" on public.coach_invitations;
create policy "Academy admins can read coach invitations"
  on public.coach_invitations for select to authenticated
  using (
    gym_id = (
      select p.academy_id
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('gym_admin', 'gym_owner', 'super_admin')
    )
  );

create or replace function public.coach_plan_limit(target_plan text)
returns integer
language sql
immutable
as $$
  select case target_plan
    when 'academy-start' then 1
    when 'academy-pro' then 3
    when 'academy-business' then 10
    when 'enterprise' then 1000000
    else 0
  end;
$$;

create or replace function public.create_coach_invitation(target_gym_id uuid, coach_email text)
returns table (id uuid, code text, email text, expires_at timestamptz, used integer, limit_count integer, plan text)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_profile public.profiles%rowtype;
  active_plan text;
  plan_limit integer;
  used_count integer;
  invitation_code text;
begin
  select *
    into actor_profile
  from public.profiles
  where profiles.id = auth.uid()
    and profiles.role in ('gym_admin', 'gym_owner', 'super_admin')
    and profiles.academy_id = target_gym_id;

  if actor_profile.id is null then
    raise exception 'Apenas administradores da academia podem criar contas Coach';
  end if;

  select s.plan
    into active_plan
  from public.subscriptions s
  join public.profiles p on p.id = s.user_id
  where p.id = auth.uid()
    and p.academy_id = target_gym_id
    and s.status in ('trialing', 'active')
  order by s.created_at desc
  limit 1;

  if active_plan is null then
    select ap.plan
      into active_plan
    from public.apk_purchases ap
    where ap.user_id = auth.uid()
      and ap.status = 'approved'
    order by ap.approved_at desc nulls last
    limit 1;
  end if;

  active_plan := coalesce(active_plan, 'free');
  plan_limit := public.coach_plan_limit(active_plan);
  if plan_limit = 0 then
    raise exception 'O plano atual não permite contas Coach';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_gym_id::text, 0));
  update public.coach_invitations
  set status = 'expired'
  where gym_id = target_gym_id
    and status = 'pending'
    and expires_at < now();

  select count(*)::integer
    into used_count
  from public.coaches
  where coaches.gym_id = target_gym_id
    and coaches.active = true;

  used_count := used_count + (
    select count(*)::integer
    from public.coach_invitations ci
    where ci.gym_id = target_gym_id
      and ci.status = 'pending'
      and ci.expires_at >= now()
  );

  if used_count >= plan_limit then
    raise exception 'Limite de % Coach(s) atingido para o plano %', plan_limit, active_plan;
  end if;

  invitation_code := 'COACH-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
  insert into public.coach_invitations (gym_id, email, code, created_by)
  values (target_gym_id, lower(trim(coach_email)), invitation_code, auth.uid())
  returning coach_invitations.id, coach_invitations.code, coach_invitations.email,
    coach_invitations.expires_at
    into id, code, email, expires_at;

  used := used_count + 1;
  limit_count := plan_limit;
  plan := active_plan;
  return next;
end;
$$;

create or replace function public.accept_coach_invitation(invitation_code text)
returns public.coach_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.coach_invitations%rowtype;
  current_email text;
begin
  select *
    into invitation
  from public.coach_invitations
  where code = upper(trim(invitation_code))
    and status = 'pending'
    and expires_at >= now()
  for update;

  if invitation.id is null then
    raise exception 'Convite de Coach inválido ou expirado';
  end if;

  select lower(email) into current_email from auth.users where id = auth.uid();
  if current_email <> lower(invitation.email) then
    raise exception 'O convite foi enviado para outro e-mail';
  end if;

  update public.profiles
  set role = 'coach', academy_id = invitation.gym_id, updated_at = now()
  where id = auth.uid();

  insert into public.coaches (id, gym_id, active)
  values (auth.uid(), invitation.gym_id, true)
  on conflict (id) do update
    set gym_id = excluded.gym_id, active = true, updated_at = now();

  update public.coach_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = invitation.id;

  invitation.status := 'accepted';
  invitation.accepted_by := auth.uid();
  invitation.accepted_at := now();
  return invitation;
end;
$$;

revoke all on function public.coach_plan_limit(text) from public, anon;
revoke all on function public.create_coach_invitation(uuid, text) from public, anon;
revoke all on function public.accept_coach_invitation(text) from public, anon;
grant execute on function public.coach_plan_limit(text) to authenticated;
grant execute on function public.create_coach_invitation(uuid, text) to authenticated;
grant execute on function public.accept_coach_invitation(text) to authenticated;
