-- Generalized Gamblers markets: corner kicks, shots (on/off/total/blocked/
-- inside box/outside box), fouls, yellow/red cards, possession -- plus
-- mixed-market parlays of up to 4 legs. Supersedes the bet/parlay shape in
-- gamblers.sql: winner/exact_score are migrated into this same generalized
-- table so settlement only has one code path (see src/lib/gamblers.ts).
--
-- One row = one prediction on one match ("a leg"), usable standalone
-- (gambler_bets_v2) or inside a parlay (gambler_parlay_legs):
--   market     : 'winner' | 'exact_score' | 'corners' | 'shots_on_goal' |
--                'shots_off_goal' | 'total_shots' | 'blocked_shots' |
--                'shots_inside_box' | 'shots_outside_box' | 'fouls' |
--                'yellow_cards' | 'red_cards' | 'possession'
--   side       : 'home' | 'away' | 'total' -- null for winner/exact_score;
--                'total' is invalid for possession (the two sides already
--                sum to ~100, so a combined line is meaningless)
--   comparator : 'over' | 'under' | 'eq'   -- 'eq' only for exact_score
--   line       : the fixed threshold for this market (see gambler_market_odds);
--                null for winner/exact_score
--   pick                          : 'home' | 'draw' | 'away' -- winner only
--   pick_home_score/pick_away_score                          -- exact_score only
--
-- Stats come from API-Football, fetched once a match is FINISHED (see
-- src/lib/statsSync.ts, supabase/match-stats.sql); a stat-market leg stays
-- pending until matches.match_stats is populated, not just FINISHED.
--
-- Run this whole file once in the Supabase SQL editor (it is idempotent).

-- ---------------------------------------------------------------------------
-- Market catalogue + fixed odds. Single source of truth for lines and
-- multipliers -- both the RPCs below and the frontend read this table
-- instead of hardcoding numbers, so tuning a market never requires a code
-- change. Lines/multipliers are placeholders, tunable in place.
-- ---------------------------------------------------------------------------

-- A plain `primary key (market, line)` won't work: PK columns are implicitly
-- NOT NULL in Postgres, but winner/exact_score intentionally have line =
-- null (no threshold concept). So this uses a surrogate id plus a null-safe
-- unique index (coalescing line to a sentinel) for ON CONFLICT to target.
create table if not exists public.gambler_market_odds (
  id bigint generated always as identity primary key,
  market text not null,
  line numeric,
  payout_multiplier numeric not null
);

create unique index if not exists gambler_market_odds_market_line_idx
  on public.gambler_market_odds (market, (coalesce(line, -1)));

insert into public.gambler_market_odds (market, line, payout_multiplier) values
  ('winner', null, 1.5),
  ('exact_score', null, 3),
  ('corners', 9.5, 1.8),
  ('shots_on_goal', 4.5, 1.8),
  ('shots_off_goal', 5.5, 1.8),
  ('total_shots', 22.5, 1.8),
  ('blocked_shots', 3.5, 1.8),
  ('shots_inside_box', 8.5, 1.8),
  ('shots_outside_box', 6.5, 1.8),
  ('fouls', 21.5, 1.8),
  ('yellow_cards', 3.5, 1.8),
  ('red_cards', 0.5, 4.0),
  ('possession', 55.5, 1.8)
on conflict (market, (coalesce(line, -1))) do nothing;

alter table public.gambler_market_odds enable row level security;
revoke all on public.gambler_market_odds from anon, authenticated;
drop policy if exists gambler_market_odds_select on public.gambler_market_odds;
create policy gambler_market_odds_select on public.gambler_market_odds
  for select to authenticated using (true);
grant select on public.gambler_market_odds to authenticated;

-- ---------------------------------------------------------------------------
-- Standalone bets (generalized; supersedes gambler_bets).
-- ---------------------------------------------------------------------------

create table if not exists public.gambler_bets_v2 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id bigint not null references public.matches (id) on delete cascade,
  market text not null check (market in (
    'winner', 'exact_score', 'corners', 'shots_on_goal', 'shots_off_goal',
    'total_shots', 'blocked_shots', 'shots_inside_box', 'shots_outside_box',
    'fouls', 'yellow_cards', 'red_cards', 'possession'
  )),
  side text check (side in ('home', 'away', 'total')),
  comparator text check (comparator in ('over', 'under', 'eq')),
  line numeric,
  pick text check (pick in ('home', 'draw', 'away')),
  pick_home_score int check (pick_home_score >= 0),
  pick_away_score int check (pick_away_score >= 0),
  amount numeric not null check (amount > 0),
  payout_multiplier numeric not null,
  status text not null default 'pending', -- pending | won | lost
  payout numeric,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, match_id, market, side),
  constraint gambler_bets_v2_shape check (
    (market = 'winner' and pick is not null and pick_home_score is null and pick_away_score is null and line is null)
    or (market = 'exact_score' and pick is null and pick_home_score is not null and pick_away_score is not null and line is null)
    or (market not in ('winner', 'exact_score') and pick is null and pick_home_score is null and pick_away_score is null
        and side is not null and comparator in ('over', 'under') and line is not null
        and not (market = 'possession' and side = 'total'))
  )
);

alter table public.gambler_bets_v2 enable row level security;
revoke all on public.gambler_bets_v2 from anon, authenticated;
drop policy if exists gambler_bets_v2_select on public.gambler_bets_v2;
create policy gambler_bets_v2_select on public.gambler_bets_v2
  for select to authenticated using (true);
grant select on public.gambler_bets_v2 to authenticated;

-- Backfill from the legacy table (kind -> market, values already match).
insert into public.gambler_bets_v2
  (id, user_id, match_id, market, pick, pick_home_score, pick_away_score,
   amount, payout_multiplier, status, payout, created_at, settled_at)
select id, user_id, match_id, kind, pick, pick_home_score, pick_away_score,
       amount, payout_multiplier, status, payout, created_at, settled_at
from public.gambler_bets
on conflict (user_id, match_id, market, side) do nothing;

-- ---------------------------------------------------------------------------
-- Parlays: a ticket (the stake + total multiplier) plus 2-4 legs, each using
-- the same generalized leg shape as gambler_bets_v2. All-or-nothing payout.
-- Legs may share a match (same-game parlays) -- correlation between legs is
-- intentionally not modeled; this is a fun fake-money app, not a real book.
-- ---------------------------------------------------------------------------

create table if not exists public.gambler_parlay_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric not null check (amount > 0),
  payout_multiplier numeric not null, -- product of every leg's multiplier, captured at placement
  status text not null default 'pending', -- pending | won | lost
  payout numeric,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create table if not exists public.gambler_parlay_legs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.gambler_parlay_tickets (id) on delete cascade,
  match_id bigint not null references public.matches (id) on delete cascade,
  market text not null check (market in (
    'winner', 'exact_score', 'corners', 'shots_on_goal', 'shots_off_goal',
    'total_shots', 'blocked_shots', 'shots_inside_box', 'shots_outside_box',
    'fouls', 'yellow_cards', 'red_cards', 'possession'
  )),
  side text check (side in ('home', 'away', 'total')),
  comparator text check (comparator in ('over', 'under', 'eq')),
  line numeric,
  pick text check (pick in ('home', 'draw', 'away')),
  pick_home_score int check (pick_home_score >= 0),
  pick_away_score int check (pick_away_score >= 0),
  payout_multiplier numeric not null, -- this leg's multiplier, captured at placement
  status text not null default 'pending', -- pending | won | lost (per-leg, for history display)
  leg_index int not null,
  constraint gambler_parlay_legs_shape check (
    (market = 'winner' and pick is not null and pick_home_score is null and pick_away_score is null and line is null)
    or (market = 'exact_score' and pick is null and pick_home_score is not null and pick_away_score is not null and line is null)
    or (market not in ('winner', 'exact_score') and pick is null and pick_home_score is null and pick_away_score is null
        and side is not null and comparator in ('over', 'under') and line is not null
        and not (market = 'possession' and side = 'total'))
  )
);

alter table public.gambler_parlay_tickets enable row level security;
alter table public.gambler_parlay_legs enable row level security;
revoke all on public.gambler_parlay_tickets from anon, authenticated;
revoke all on public.gambler_parlay_legs from anon, authenticated;

drop policy if exists gambler_parlay_tickets_select on public.gambler_parlay_tickets;
create policy gambler_parlay_tickets_select on public.gambler_parlay_tickets
  for select to authenticated using (true);
grant select on public.gambler_parlay_tickets to authenticated;

drop policy if exists gambler_parlay_legs_select on public.gambler_parlay_legs;
create policy gambler_parlay_legs_select on public.gambler_parlay_legs
  for select to authenticated using (true);
grant select on public.gambler_parlay_legs to authenticated;

-- Backfill from the legacy 2-leg parlay table.
insert into public.gambler_parlay_tickets (id, user_id, amount, payout_multiplier, status, payout, created_at, settled_at)
select id, user_id, amount, payout_multiplier, status, payout, created_at, settled_at
from public.gambler_parlays
on conflict (id) do nothing;

insert into public.gambler_parlay_legs (ticket_id, match_id, market, pick, payout_multiplier, status, leg_index)
select id, match_id_1, 'winner', pick_1, 1.5, status, 1 from public.gambler_parlays
union all
select id, match_id_2, 'winner', pick_2, 1.5, status, 2 from public.gambler_parlays;

-- ---------------------------------------------------------------------------
-- Shared leg validation, used by both placement RPCs below so the
-- market-shape rules live in exactly one place.
-- ---------------------------------------------------------------------------

create or replace function public.gambler_validate_leg(
  p_market text, p_side text, p_comparator text, p_line numeric,
  p_pick text, p_pick_home_score int, p_pick_away_score int
) returns void
language plpgsql as $$
begin
  if p_market not in (
    'winner', 'exact_score', 'corners', 'shots_on_goal', 'shots_off_goal',
    'total_shots', 'blocked_shots', 'shots_inside_box', 'shots_outside_box',
    'fouls', 'yellow_cards', 'red_cards', 'possession'
  ) then
    raise exception 'bad market';
  end if;

  if p_market = 'winner' then
    if p_pick not in ('home', 'draw', 'away') then raise exception 'bad pick'; end if;
    if p_pick_home_score is not null or p_pick_away_score is not null then raise exception 'unexpected score for winner'; end if;
  elsif p_market = 'exact_score' then
    if p_pick_home_score is null or p_pick_away_score is null
       or p_pick_home_score < 0 or p_pick_away_score < 0 then
      raise exception 'bad scoreline';
    end if;
    if p_pick is not null then raise exception 'unexpected pick for exact_score'; end if;
  else
    if p_side not in ('home', 'away', 'total') then raise exception 'bad side'; end if;
    if p_market = 'possession' and p_side = 'total' then raise exception 'possession has no total side'; end if;
    if p_comparator not in ('over', 'under') then raise exception 'bad comparator'; end if;
    if p_line is null then raise exception 'missing line'; end if;
    if p_pick is not null or p_pick_home_score is not null or p_pick_away_score is not null then
      raise exception 'unexpected pick for stat market';
    end if;
  end if;
end;
$$;

create or replace function public.gambler_leg_multiplier(p_market text, p_line numeric)
returns numeric
language sql stable as $$
  select payout_multiplier from public.gambler_market_odds
  where market = p_market and (line = p_line or (line is null and p_line is null));
$$;

-- ---------------------------------------------------------------------------
-- Place a standalone bet on any market. Drops the old (p_match_id, p_kind,
-- p_pick, p_pick_home_score, p_pick_away_score, p_amount) overload of
-- gambler_place_bet -- its body referenced gambler_bets, which is renamed to
-- gambler_bets_legacy below, so it can no longer run correctly anyway.
-- ---------------------------------------------------------------------------

drop function if exists public.gambler_place_bet(bigint, text, text, int, int, numeric);
drop function if exists public.gambler_place_parlay(bigint, text, bigint, text, numeric);

create or replace function public.gambler_place_bet(
  p_match_id bigint,
  p_market text,
  p_side text,
  p_comparator text,
  p_line numeric,
  p_pick text,
  p_pick_home_score int,
  p_pick_away_score int,
  p_amount numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_balance numeric;
  v_kickoff timestamptz;
  v_multiplier numeric;
  v_is_guest boolean;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_amount <= 0 or p_amount != trunc(p_amount) then
    raise exception 'bet must be a positive whole dollar amount';
  end if;

  perform gambler_validate_leg(p_market, p_side, p_comparator, p_line, p_pick, p_pick_home_score, p_pick_away_score);

  select (display_name = 'Guest') into v_is_guest from profiles where id = uid;
  if v_is_guest then raise exception 'guests are watch-only here'; end if;

  select kickoff into v_kickoff from matches where id = p_match_id for update;
  if not found then raise exception 'match not found'; end if;
  if v_kickoff <= now() + interval '10 minutes' then
    raise exception 'betting is closed for this match';
  end if;

  v_multiplier := gambler_leg_multiplier(p_market, p_line);
  if v_multiplier is null then raise exception 'no odds for this market/line'; end if;

  insert into gambler_balances (user_id) values (uid) on conflict (user_id) do nothing;
  select balance into v_balance from gambler_balances where user_id = uid for update;
  if v_balance < p_amount then raise exception 'insufficient balance'; end if;

  insert into gambler_bets_v2
    (user_id, match_id, market, side, comparator, line, pick, pick_home_score, pick_away_score, amount, payout_multiplier)
  values
    (uid, p_match_id, p_market, p_side, p_comparator, p_line, p_pick, p_pick_home_score, p_pick_away_score, p_amount, v_multiplier);

  update gambler_balances set balance = balance - p_amount, updated_at = now() where user_id = uid;
end;
$$;

revoke execute on function public.gambler_place_bet(bigint, text, text, text, numeric, text, int, int, numeric) from public;
grant execute on function public.gambler_place_bet(bigint, text, text, text, numeric, text, int, int, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Place a 2-4 leg parlay across any mix of markets/matches (same-game
-- parlays allowed). Replaces gambler_place_parlay.
-- ---------------------------------------------------------------------------

create or replace function public.gambler_place_parlay_v2(
  p_legs jsonb, -- [{match_id, market, side, comparator, line, pick, pick_home_score, pick_away_score}, ...]
  p_amount numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_balance numeric;
  v_is_guest boolean;
  v_total_multiplier numeric := 1;
  v_leg jsonb;
  v_kickoff timestamptz;
  v_multiplier numeric;
  v_ticket_id uuid;
  v_idx int := 0;
  v_leg_count int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_amount <= 0 or p_amount != trunc(p_amount) then
    raise exception 'bet must be a positive whole dollar amount';
  end if;

  v_leg_count := jsonb_array_length(p_legs);
  if v_leg_count < 2 or v_leg_count > 4 then raise exception 'parlays need 2-4 legs'; end if;

  select (display_name = 'Guest') into v_is_guest from profiles where id = uid;
  if v_is_guest then raise exception 'guests are watch-only here'; end if;

  -- Validate every leg and compute the combined multiplier before touching
  -- any balances, so a bad leg never leaves a partial debit behind.
  for v_leg in select * from jsonb_array_elements(p_legs)
  loop
    perform gambler_validate_leg(
      v_leg->>'market', v_leg->>'side', v_leg->>'comparator', (v_leg->>'line')::numeric,
      v_leg->>'pick', (v_leg->>'pick_home_score')::int, (v_leg->>'pick_away_score')::int
    );

    select kickoff into v_kickoff from matches where id = (v_leg->>'match_id')::bigint for update;
    if not found then raise exception 'match not found'; end if;
    if v_kickoff <= now() + interval '10 minutes' then
      raise exception 'betting is closed for one of these matches';
    end if;

    v_multiplier := gambler_leg_multiplier(v_leg->>'market', (v_leg->>'line')::numeric);
    if v_multiplier is null then raise exception 'no odds for this market/line'; end if;
    v_total_multiplier := v_total_multiplier * v_multiplier;
  end loop;

  insert into gambler_balances (user_id) values (uid) on conflict (user_id) do nothing;
  select balance into v_balance from gambler_balances where user_id = uid for update;
  if v_balance < p_amount then raise exception 'insufficient balance'; end if;

  insert into gambler_parlay_tickets (user_id, amount, payout_multiplier)
  values (uid, p_amount, v_total_multiplier)
  returning id into v_ticket_id;

  for v_leg in select * from jsonb_array_elements(p_legs)
  loop
    v_idx := v_idx + 1;
    insert into gambler_parlay_legs
      (ticket_id, match_id, market, side, comparator, line, pick, pick_home_score, pick_away_score, payout_multiplier, leg_index)
    values (
      v_ticket_id, (v_leg->>'match_id')::bigint, v_leg->>'market', v_leg->>'side', v_leg->>'comparator',
      (v_leg->>'line')::numeric, v_leg->>'pick', (v_leg->>'pick_home_score')::int, (v_leg->>'pick_away_score')::int,
      gambler_leg_multiplier(v_leg->>'market', (v_leg->>'line')::numeric), v_idx
    );
  end loop;

  update gambler_balances set balance = balance - p_amount, updated_at = now() where user_id = uid;
end;
$$;

revoke execute on function public.gambler_place_parlay_v2(jsonb, numeric) from public;
grant execute on function public.gambler_place_parlay_v2(jsonb, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Rename the legacy tables now that gambler_bets_v2/gambler_parlay_tickets
-- have a full backfill. Kept (not dropped) until the new path is confirmed
-- working end-to-end in production.
-- ---------------------------------------------------------------------------

alter table if exists public.gambler_bets rename to gambler_bets_legacy;
alter table if exists public.gambler_parlays rename to gambler_parlays_legacy;
