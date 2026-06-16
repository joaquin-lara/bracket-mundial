-- Web Push: subscriptions + per-match notification de-duplication.
-- Apply in the Supabase SQL editor (safe to re-run).

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- A user can see and remove only their own subscriptions. Inserts are written by
-- the server with the service-role key (which bypasses RLS), so no insert policy
-- is needed; these cover the client reading/cleaning up its own rows.
drop policy if exists push_sub_select_own on public.push_subscriptions;
create policy push_sub_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists push_sub_delete_own on public.push_subscriptions;
create policy push_sub_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- De-dup flags so the cron sends each alert once per match.
alter table public.matches add column if not exists notif_pre boolean not null default false;        -- 10-min reminder sent
alter table public.matches add column if not exists notif_start boolean not null default false;      -- kickoff alert sent
alter table public.matches add column if not exists notif_home_score int not null default 0;         -- last-notified home goals
alter table public.matches add column if not exists notif_away_score int not null default 0;         -- last-notified away goals
