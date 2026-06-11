-- Bracket Mundial: schema, RLS policies, standings view, signup trigger.
-- Run this whole file once in the Supabase SQL editor. It is idempotent.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id bigint primary key, -- football-data.org match id; re-syncs upsert on it
  home_team text not null,
  away_team text not null,
  home_code text,
  away_code text,
  kickoff timestamptz not null,
  stage text not null default 'GROUP_STAGE',
  group_name text,
  status text not null default 'SCHEDULED',
  home_score int,
  away_score int,
  scored boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id bigint not null references public.matches (id) on delete cascade,
  pred_home int not null check (pred_home between 0 and 99),
  pred_away int not null check (pred_away between 0 and 99),
  points int, -- null until the match is scored by the sync job
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);

create index if not exists predictions_match_id_idx on public.predictions (match_id);
create index if not exists matches_kickoff_idx on public.matches (kickoff);

-- ---------------------------------------------------------------------------
-- Signup trigger: auto-create a profile row, display_name from user metadata
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep predictions.updated_at fresh on edits
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists predictions_touch_updated_at on public.predictions;
create trigger predictions_touch_updated_at
  before update on public.predictions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges (column-level: clients can never write points or scores)
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon, authenticated;
revoke all on public.matches from anon, authenticated;
revoke all on public.predictions from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.matches to authenticated;
grant select on public.predictions to authenticated;
grant insert (user_id, match_id, pred_home, pred_away) on public.predictions to authenticated;
grant update (pred_home, pred_away) on public.predictions to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.predictions enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated using (true);
-- No insert/update/delete policies on matches: only the sync job
-- (service-role key, bypasses RLS) writes fixtures and results.

-- A user always sees their own predictions; others' predictions only
-- after kickoff has passed (prevents copying).
drop policy if exists predictions_select on public.predictions;
create policy predictions_select on public.predictions
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.matches m
      where m.id = match_id and m.kickoff <= now()
    )
  );

-- THE LOCK. Insert/update allowed only on own rows and only while the
-- match kicks off more than 10 minutes from now. This rejects late writes
-- even from direct API calls that bypass the UI.
drop policy if exists predictions_insert_lock on public.predictions;
create policy predictions_insert_lock on public.predictions
  for insert to authenticated
  with check (
    user_id = auth.uid()
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
      select 1 from public.matches m
      where m.id = match_id and m.kickoff > now() + interval '10 minutes'
    )
  );

-- ---------------------------------------------------------------------------
-- Standings view (leaderboard reads from this)
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
group by p.id, p.display_name
order by total desc, games_scored desc, p.display_name asc;

grant select on public.standings to authenticated;
