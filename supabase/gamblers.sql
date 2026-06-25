-- Gamblers: a fake-money side game, fun only -- no tournament points.
-- Everyone starts at $1000.
--
-- SUPERSEDED: the bet/parlay tables and RPCs defined below (gambler_bets,
-- gambler_parlays, gambler_place_bet, gambler_place_parlay) have been
-- replaced by the generalized market shape in supabase/gambler-markets.sql
-- (gambler_bets_v2, gambler_parlay_tickets/legs, gambler_place_bet [new
-- signature], gambler_place_parlay_v2), which adds stat markets (corners,
-- shots, cards, possession, fouls) and N-leg mixed parlays. Run THIS file
-- first (it still creates gambler_balances and gambler_credit, which are
-- still in use), then gambler-markets.sql, which renames gambler_bets ->
-- gambler_bets_legacy and gambler_parlays -> gambler_parlays_legacy after
-- backfilling the new tables.
--
-- Bets lock 10 minutes before kickoff (same window predictions already use,
-- see LOCK_MS in src/lib/types.ts) and settle once the relevant match(es)
-- finish (see src/lib/gamblers.ts, called from the sync cron).
--
-- Run this whole file once in the Supabase SQL editor (it is idempotent).

create table if not exists public.gambler_balances (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance numeric not null default 1000,
  updated_at timestamptz not null default now()
);

create table if not exists public.gambler_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id bigint not null references public.matches (id) on delete cascade,
  kind text not null check (kind in ('winner', 'exact_score')),
  pick text check (pick in ('home', 'draw', 'away')), -- kind = 'winner'
  pick_home_score int check (pick_home_score >= 0),    -- kind = 'exact_score'
  pick_away_score int check (pick_away_score >= 0),
  amount numeric not null check (amount > 0),
  payout_multiplier numeric not null, -- captured at bet time (1.5 or 3)
  status text not null default 'pending', -- pending | won | lost
  payout numeric, -- total credited back if won; set on settlement
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, match_id, kind)
);

create table if not exists public.gambler_parlays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id_1 bigint not null references public.matches (id) on delete cascade,
  pick_1 text not null check (pick_1 in ('home', 'draw', 'away')),
  match_id_2 bigint not null references public.matches (id) on delete cascade,
  pick_2 text not null check (pick_2 in ('home', 'draw', 'away')),
  amount numeric not null check (amount > 0),
  payout_multiplier numeric not null, -- captured at bet time (2.25 today; may change later)
  status text not null default 'pending', -- pending | won | lost
  payout numeric,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check (match_id_1 <> match_id_2)
);

alter table public.gambler_balances enable row level security;
alter table public.gambler_bets enable row level security;
alter table public.gambler_parlays enable row level security;

revoke all on public.gambler_balances from anon, authenticated;
revoke all on public.gambler_bets from anon, authenticated;
revoke all on public.gambler_parlays from anon, authenticated;

-- Balances and bets are all public within the group (it's a leaderboard, no
-- private financial data) -- reads are plain policies; writes only through
-- the security-definer functions below.
drop policy if exists gambler_balances_select on public.gambler_balances;
create policy gambler_balances_select on public.gambler_balances
  for select to authenticated using (true);
grant select on public.gambler_balances to authenticated;

drop policy if exists gambler_bets_select on public.gambler_bets;
create policy gambler_bets_select on public.gambler_bets
  for select to authenticated using (true);
grant select on public.gambler_bets to authenticated;

drop policy if exists gambler_parlays_select on public.gambler_parlays;
create policy gambler_parlays_select on public.gambler_parlays
  for select to authenticated using (true);
grant select on public.gambler_parlays to authenticated;

-- ---------------------------------------------------------------------------
-- Place a bet: validates the lock window and balance, then debits
-- immediately (a "pending" bet already cost you the stake; settlement only
-- ever credits, never debits again).
-- ---------------------------------------------------------------------------

create or replace function public.gambler_place_bet(
  p_match_id bigint,
  p_kind text,
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
  if p_kind not in ('winner', 'exact_score') then raise exception 'bad bet kind'; end if;
  if p_kind = 'winner' and p_pick not in ('home', 'draw', 'away') then
    raise exception 'bad pick';
  end if;
  if p_kind = 'exact_score' and (p_pick_home_score is null or p_pick_away_score is null
     or p_pick_home_score < 0 or p_pick_away_score < 0) then
    raise exception 'bad scoreline';
  end if;

  select (display_name = 'Guest') into v_is_guest from profiles where id = uid;
  if v_is_guest then raise exception 'guests are watch-only here'; end if;

  select kickoff into v_kickoff from matches where id = p_match_id for update;
  if not found then raise exception 'match not found'; end if;
  if v_kickoff <= now() + interval '10 minutes' then
    raise exception 'betting is closed for this match';
  end if;

  insert into gambler_balances (user_id) values (uid) on conflict (user_id) do nothing;
  select balance into v_balance from gambler_balances where user_id = uid for update;
  if v_balance < p_amount then raise exception 'insufficient balance'; end if;

  v_multiplier := case when p_kind = 'winner' then 1.5 else 3 end;

  insert into gambler_bets
    (user_id, match_id, kind, pick, pick_home_score, pick_away_score, amount, payout_multiplier)
  values
    (uid, p_match_id, p_kind, p_pick, p_pick_home_score, p_pick_away_score, p_amount, v_multiplier);

  update gambler_balances set balance = balance - p_amount, updated_at = now() where user_id = uid;
end;
$$;

revoke execute on function public.gambler_place_bet(bigint, text, text, int, int, numeric) from public;
grant execute on function public.gambler_place_bet(bigint, text, text, int, int, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Place a 2-leg parlay across two different matches (winner picks only).
-- Multiplier is fixed at 2.25 (1.5 x 1.5) for now -- captured per-row so a
-- future reward change never touches already-placed parlays.
-- ---------------------------------------------------------------------------

create or replace function public.gambler_place_parlay(
  p_match_id_1 bigint,
  p_pick_1 text,
  p_match_id_2 bigint,
  p_pick_2 text,
  p_amount numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_balance numeric;
  v_kickoff_1 timestamptz;
  v_kickoff_2 timestamptz;
  v_is_guest boolean;
  v_multiplier numeric := 2.25;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_amount <= 0 or p_amount != trunc(p_amount) then
    raise exception 'bet must be a positive whole dollar amount';
  end if;
  if p_match_id_1 = p_match_id_2 then raise exception 'pick two different matches'; end if;
  if p_pick_1 not in ('home', 'draw', 'away') or p_pick_2 not in ('home', 'draw', 'away') then
    raise exception 'bad pick';
  end if;

  select (display_name = 'Guest') into v_is_guest from profiles where id = uid;
  if v_is_guest then raise exception 'guests are watch-only here'; end if;

  select kickoff into v_kickoff_1 from matches where id = p_match_id_1 for update;
  if not found then raise exception 'match not found'; end if;
  select kickoff into v_kickoff_2 from matches where id = p_match_id_2 for update;
  if not found then raise exception 'match not found'; end if;
  if v_kickoff_1 <= now() + interval '10 minutes' or v_kickoff_2 <= now() + interval '10 minutes' then
    raise exception 'betting is closed for one of these matches';
  end if;

  insert into gambler_balances (user_id) values (uid) on conflict (user_id) do nothing;
  select balance into v_balance from gambler_balances where user_id = uid for update;
  if v_balance < p_amount then raise exception 'insufficient balance'; end if;

  insert into gambler_parlays
    (user_id, match_id_1, pick_1, match_id_2, pick_2, amount, payout_multiplier)
  values
    (uid, p_match_id_1, p_pick_1, p_match_id_2, p_pick_2, p_amount, v_multiplier);

  update gambler_balances set balance = balance - p_amount, updated_at = now() where user_id = uid;
end;
$$;

revoke execute on function public.gambler_place_parlay(bigint, text, bigint, text, numeric) from public;
grant execute on function public.gambler_place_parlay(bigint, text, bigint, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Credit a settled win. Server-only: no grant to authenticated/anon, so this
-- is only reachable via the service-role key (src/lib/gamblers.ts).
-- ---------------------------------------------------------------------------

create or replace function public.gambler_credit(p_user uuid, p_amount numeric)
returns void
language sql security definer set search_path = public as $$
  update gambler_balances set balance = balance + p_amount, updated_at = now()
  where user_id = p_user;
$$;

revoke all on function public.gambler_credit(uuid, numeric) from public, anon, authenticated;
