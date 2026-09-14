create or replace function public.is_academy_admin_for(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('gym_admin', 'gym_owner', 'super_admin')
      and academy_id = target_gym_id
  );
$$;

revoke all on function public.is_academy_admin_for(uuid) from public, anon;
grant execute on function public.is_academy_admin_for(uuid) to authenticated;

drop policy if exists "Academy admins can read academy memberships" on public.gym_members;
create policy "Academy admins can read academy memberships"
  on public.gym_members for select to authenticated
  using (public.is_academy_admin_for(gym_id));

drop policy if exists "Academy admins can update academy memberships" on public.gym_members;
create policy "Academy admins can update academy memberships"
  on public.gym_members for update to authenticated
  using (public.is_academy_admin_for(gym_id))
  with check (public.is_academy_admin_for(gym_id));

drop policy if exists "Academy admins can read academy profiles" on public.profiles;
create policy "Academy admins can read academy profiles"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.gym_members member
      where member.user_id = profiles.id
        and public.is_academy_admin_for(member.gym_id)
    )
  );
