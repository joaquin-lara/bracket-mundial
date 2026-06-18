-- Bracket Mundial: per-team disciplinary record for the fair-play tiebreaker.
-- Run this whole file once in the Supabase SQL editor, after schema.sql.
-- It is idempotent. Any signed-in player can read and update the counts; the
-- app turns them into FIFA fair-play points.

create table if not exists public.discipline (
  team_code text primary key,
  yellow int not null default 0 check (yellow >= 0),
  second_yellow int not null default 0 check (second_yellow >= 0),
  direct_red int not null default 0 check (direct_red >= 0),
  yellow_direct_red int not null default 0 check (yellow_direct_red >= 0),
  updated_at timestamptz not null default now()
);

-- Any logged-in player may read and edit the card counts (no column-level
-- secrets here, unlike predictions), so a plain upsert is enough.
revoke all on public.discipline from anon, authenticated;
grant select, insert, update on public.discipline to authenticated;

alter table public.discipline enable row level security;

drop policy if exists discipline_select on public.discipline;
create policy discipline_select on public.discipline
  for select to authenticated using (true);

drop policy if exists discipline_insert on public.discipline;
create policy discipline_insert on public.discipline
  for insert to authenticated with check (true);

drop policy if exists discipline_update on public.discipline;
create policy discipline_update on public.discipline
  for update to authenticated using (true) with check (true);

-- Keep updated_at fresh on edits (touch_updated_at() is defined in schema.sql).
drop trigger if exists discipline_touch on public.discipline;
create trigger discipline_touch
  before update on public.discipline
  for each row execute function public.touch_updated_at();
