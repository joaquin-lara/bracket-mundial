-- Bracket Mundial: achievements layer.
-- Run this whole file once in the Supabase SQL editor. It is idempotent.
--
-- Design mirrors the rest of the app:
--   * clients can READ achievements (everyone sees everyone's badges and the
--     reveal state) but never WRITE them — only the sync job, using the
--     service-role key, awards badges (so nobody can self-award).
--   * the feature stays invisible until the first *live* unlock: on the very
--     first evaluation we silently backfill what players already earned
--     (baseline = true, no banner); the first badge earned afterwards
--     (baseline = false) flips `achievements_state.revealed_at` and fires the
--     group-wide announcement.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.user_achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null,
  earned_at timestamptz not null default now(),
  baseline boolean not null default false, -- true = silent launch backfill
  match_id bigint,                         -- context, when relevant
  primary key (user_id, achievement_id)
);

create index if not exists user_achievements_earned_idx
  on public.user_achievements (earned_at desc);

-- Single-row feature state.
create table if not exists public.achievements_state (
  id int primary key default 1 check (id = 1),
  baseline_at timestamptz,        -- when the silent backfill ran
  revealed_at timestamptz,        -- when the first live unlock fired the reveal
  first_user uuid,                -- who set it off
  first_achievement text          -- what they earned
);

insert into public.achievements_state (id) values (1)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Privileges + RLS: read-only for clients, writes only via service role.
-- ---------------------------------------------------------------------------

revoke all on public.user_achievements from anon, authenticated;
revoke all on public.achievements_state from anon, authenticated;

grant select on public.user_achievements to authenticated;
grant select on public.achievements_state to authenticated;

alter table public.user_achievements enable row level security;
alter table public.achievements_state enable row level security;

drop policy if exists user_achievements_select on public.user_achievements;
create policy user_achievements_select on public.user_achievements
  for select to authenticated using (true);
-- No insert/update/delete policies: the service-role key bypasses RLS and is
-- the only writer.

drop policy if exists achievements_state_select on public.achievements_state;
create policy achievements_state_select on public.achievements_state
  for select to authenticated using (true);

-- Realtime: push new badges + the reveal flip to every client.
do $$ begin
  alter publication supabase_realtime add table public.user_achievements;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.achievements_state;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Duel visibility: make every duel's OUTCOME readable by the whole group.
-- Previously only the two participants could see a duel, so a Carlos-vs-Sebas
-- shootout was invisible to Mauri and Joaquin. The picks stay secret — those
-- live in `duel_secrets`, which has no grants and is untouched here, so the
-- anti-cheat design is unaffected.
-- ---------------------------------------------------------------------------

drop policy if exists duels_select on public.duels;
create policy duels_select on public.duels
  for select to authenticated using (true);
