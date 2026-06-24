-- Bracket Mundial: new-player sign-up + admin approval.
-- Run this whole file once in the Supabase SQL editor, AFTER schema.sql.
-- It is idempotent (safe to re-run).
--
-- What it adds:
--   * profiles.status      -- 'approved' | 'pending' | 'rejected'
--   * profiles.flag_code   -- FIFA TLA the new player picked (e.g. 'BRA')
--   * profiles.color       -- accent color for their avatar/charts
--   * a rewritten signup trigger that marks self-sign-ups 'pending'
--     (only the four founders + the guest account are auto-approved)
--   * approve_signup(target, decision) -- only the four admins may call it
--   * predictions can only be made by APPROVED players (enforced in RLS)
--   * standings view shows APPROVED players only

-- ---------------------------------------------------------------------------
-- 1. New profile columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists status text not null default 'approved',
  add column if not exists flag_code text,
  add column if not exists color text;

-- Anyone who already has a profile (the four founders) stays approved.
update public.profiles set status = 'approved' where status is null;

-- Keep status to a known set.
alter table public.profiles drop constraint if exists profiles_status_chk;
alter table public.profiles
  add constraint profiles_status_chk
  check (status in ('approved', 'pending', 'rejected'));

-- ---------------------------------------------------------------------------
-- 2. Who is a founder / admin (authoritative server-side list)
-- ---------------------------------------------------------------------------
-- These emails are derived from the fixed roster in src/lib/players.ts.
-- New sign-ups can never use these emails (the addresses are already taken),
-- so a self-sign-up can never auto-approve itself.

create or replace function public.is_admin_email(addr text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(addr, '')) in (
    'carlos@bracketmundial.app',
    'sebas@bracketmundial.app',
    'mauri@bracketmundial.app',
    'joaquin@bracketmundial.app'
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Rewritten signup trigger
-- ---------------------------------------------------------------------------
-- Founders + guest are auto-approved. Everyone else starts 'pending'.
-- flag_code / color come from the sign-up form metadata (cosmetic only).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_founder boolean :=
    public.is_admin_email(new.email)
    or lower(new.email) = 'guest@bracketmundial.app';
begin
  insert into public.profiles (id, display_name, status, flag_code, color)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    case when is_founder then 'approved' else 'pending' end,
    nullif(new.raw_user_meta_data ->> 'flag_code', ''),
    nullif(new.raw_user_meta_data ->> 'color', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. Approval RPC (only an admin may approve/reject)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can write any profile row, but it checks the CALLER
-- is one of the four admins first. Clients call:
--   supabase.rpc('approve_signup', { target: <uuid>, decision: 'approved' })

create or replace function public.approve_signup(target uuid, decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text;
begin
  select email into caller_email from auth.users where id = auth.uid();

  if not public.is_admin_email(caller_email) then
    raise exception 'Only admins can approve sign-ups.';
  end if;
  if decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;

  update public.profiles
     set status = decision
   where id = target
     and status = 'pending';  -- only act on still-pending requests
end;
$$;

grant execute on function public.approve_signup(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Predictions: approved players only
-- ---------------------------------------------------------------------------
-- Re-create the insert/update locks with an extra "must be approved" clause,
-- so a pending user cannot make picks even by calling the API directly.

drop policy if exists predictions_insert_lock on public.predictions;
create policy predictions_insert_lock on public.predictions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles pf
      where pf.id = auth.uid() and pf.status = 'approved'
    )
    and exists (
      select 1 from public.matches m
      where m.id = match_id and m.kickoff > now() + interval '10 minutes'
    )
  );

drop policy if exists predictions_update_lock on public.predictions;
create policy predictions_update_lock on public.predictions
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles pf
      where pf.id = auth.uid() and pf.status = 'approved'
    )
    and exists (
      select 1 from public.matches m
      where m.id = match_id and m.kickoff > now() + interval '10 minutes'
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Standings view: approved players only
-- ---------------------------------------------------------------------------

create or replace view public.standings
with (security_invoker = true) as
select
  p.id as user_id,
  p.display_name,
  coalesce(sum(pr.points), 0)::int as total,
  count(pr.points)::int as games_scored
from public.profiles p
left join public.predictions pr on pr.user_id = p.id
where p.status = 'approved'
group by p.id, p.display_name
order by total desc, games_scored desc, p.display_name asc;

grant select on public.standings to authenticated;
