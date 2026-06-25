-- gambler_market_odds gains a `side` column: a per-team value and a
-- match-total value differ by roughly 2x for most stat markets (e.g. ~5
-- corners for one team vs ~10-11 combined), so sharing one line across
-- home/away/total made several side+market combinations near-guaranteed
-- bets (see chat: "is this realistic for a World Cup match"). Each
-- (market, side) pair now gets its own line, calibrated separately for a
-- single team vs the match combined.
--
-- Run once in the Supabase SQL editor (idempotent: safe to re-run).

alter table public.gambler_market_odds add column if not exists side text check (side in ('home', 'away', 'total'));

drop index if exists gambler_market_odds_market_line_idx;
create unique index if not exists gambler_market_odds_market_side_line_idx
  on public.gambler_market_odds (market, (coalesce(side, '')), (coalesce(line, -1)));

-- Replace the old single-line-per-market stat rows with side-aware ones.
-- winner/exact_score are untouched (side is always null for those).
delete from public.gambler_market_odds where market not in ('winner', 'exact_score');

insert into public.gambler_market_odds (market, side, line, payout_multiplier) values
  ('corners', 'home', 4.5, 1.8),
  ('corners', 'away', 4.5, 1.8),
  ('corners', 'total', 10.5, 1.8),
  ('shots_on_goal', 'home', 4.5, 1.8),
  ('shots_on_goal', 'away', 4.5, 1.8),
  ('shots_on_goal', 'total', 9.5, 1.8),
  ('shots_off_goal', 'home', 5.5, 1.8),
  ('shots_off_goal', 'away', 5.5, 1.8),
  ('shots_off_goal', 'total', 10.5, 1.8),
  ('total_shots', 'home', 12.5, 1.8),
  ('total_shots', 'away', 12.5, 1.8),
  ('total_shots', 'total', 24.5, 1.8),
  ('blocked_shots', 'home', 2.5, 1.8),
  ('blocked_shots', 'away', 2.5, 1.8),
  ('blocked_shots', 'total', 5.5, 1.8),
  ('shots_inside_box', 'home', 7.5, 1.8),
  ('shots_inside_box', 'away', 7.5, 1.8),
  ('shots_inside_box', 'total', 15.5, 1.8),
  ('shots_outside_box', 'home', 4.5, 1.8),
  ('shots_outside_box', 'away', 4.5, 1.8),
  ('shots_outside_box', 'total', 9.5, 1.8),
  ('fouls', 'home', 11.5, 1.8),
  ('fouls', 'away', 11.5, 1.8),
  ('fouls', 'total', 22.5, 1.8),
  ('yellow_cards', 'home', 1.5, 1.8),
  ('yellow_cards', 'away', 1.5, 1.8),
  ('yellow_cards', 'total', 3.5, 1.8),
  -- Red cards are rare for a single team, rarer still to call which side --
  -- a "total" red card (either team) is roughly twice as likely as one
  -- specific team's, so it pays less.
  ('red_cards', 'home', 0.5, 5.0),
  ('red_cards', 'away', 0.5, 5.0),
  ('red_cards', 'total', 0.5, 3.0),
  ('possession', 'home', 55.5, 1.8),
  ('possession', 'away', 55.5, 1.8)
on conflict (market, (coalesce(side, '')), (coalesce(line, -1))) do nothing;

-- ---------------------------------------------------------------------------
-- Multiplier lookup is now side-aware too.
-- ---------------------------------------------------------------------------

drop function if exists public.gambler_leg_multiplier(text, numeric);

create or replace function public.gambler_leg_multiplier(p_market text, p_side text, p_line numeric)
returns numeric
language sql stable as $$
  select payout_multiplier from public.gambler_market_odds
  where market = p_market
    and coalesce(side, '') = coalesce(p_side, '')
    and (line = p_line or (line is null and p_line is null));
$$;

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

  v_multiplier := gambler_leg_multiplier(p_market, p_side, p_line);
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

create or replace function public.gambler_place_parlay_v2(
  p_legs jsonb,
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

    v_multiplier := gambler_leg_multiplier(v_leg->>'market', v_leg->>'side', (v_leg->>'line')::numeric);
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
      gambler_leg_multiplier(v_leg->>'market', v_leg->>'side', (v_leg->>'line')::numeric), v_idx
    );
  end loop;

  update gambler_balances set balance = balance - p_amount, updated_at = now() where user_id = uid;
end;
$$;
