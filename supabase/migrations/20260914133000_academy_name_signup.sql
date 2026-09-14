alter table public.pending_signups
  add column if not exists academy_name text;

alter table public.pending_signups
  drop constraint if exists pending_signups_academy_name_check;

alter table public.pending_signups
  add constraint pending_signups_academy_name_check
  check (
    plan not in ('academy-start', 'academy-pro', 'academy-business', 'enterprise')
    or length(trim(coalesce(academy_name, ''))) >= 2
  );
