-- Incremental migration: duplicate guard + cancel functions for the
-- Gamblers section. Safe to run on top of an existing gambler-markets.sql
-- install (everything here is create-or-replace / idempotent). Run the
-- whole file in the Supabase SQL editor.

-- Duplicate guard. A user may hold at most ONE pending prediction on a given
-- (match, market, side) -- counting standalone bets AND parlay legs together,
-- so the same outcome can't be doubled up across the two. winner/exact_score
-- carry side = null, so this collapses to one winner (and one exact_score) bet
-- per match: betting "home wins" blocks also betting "draw" or "away wins".
-- `is not distinct from` makes the null sides compare equal.
-- ---------------------------------------------------------------------------

create or replace function public.gambler_market_taken(
  p_uid uuid, p_match_id bigint, p_market text, p_side text
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gambler_bets_v2 b
    where b.user_id = p_uid and b.match_id = p_match_id
      and b.market = p_market and b.side is not distinct from p_side
      and b.status = 'pending'
  ) or exists (
    select 1 from public.gambler_parlay_legs l
    join public.gambler_parlay_tickets t on t.id = l.ticket_id
    where t.user_id = p_uid and t.status = 'pending'
      and l.match_id = p_match_id and l.market = p_market
      and l.side is not distinct from p_side
  );
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

  if gambler_market_taken(uid, p_match_id, p_market, p_side) then
    raise exception 'you already have a bet on this market for this match';
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
  v_seen_keys text[] := '{}';
  v_key text;
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

    -- No two legs in this parlay may target the same (match, market, side),
    -- and none may collide with a bet/leg already standing (same guard the
    -- standalone path uses), so a parlay can't be used to double an outcome.
    v_key := (v_leg->>'match_id') || '|' || (v_leg->>'market') || '|' || coalesce(v_leg->>'side', '');
    if v_key = any(v_seen_keys) then
      raise exception 'a parlay can''t pick the same market twice';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_key);
    if gambler_market_taken(uid, (v_leg->>'match_id')::bigint, v_leg->>'market', v_leg->>'side') then
      raise exception 'you already have a bet on one of these markets';
    end if;

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
-- Cancel a still-pending placement and refund the stake. Allowed only while
-- the bet is pending AND every match it touches is still open for betting
-- (locks 10 minutes before kickoff) -- you can't pull a bet once its match is
-- about to start or has already been settled.
-- ---------------------------------------------------------------------------

create or replace function public.gambler_cancel_bet(p_bet_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_amount numeric;
  v_match_id bigint;
  v_status text;
  v_kickoff timestamptz;
begin
  if uid is null then raise exception 'not signed in'; end if;

  select amount, match_id, status into v_amount, v_match_id, v_status
  from gambler_bets_v2 where id = p_bet_id and user_id = uid for update;
  if not found then raise exception 'bet not found'; end if;
  if v_status <> 'pending' then raise exception 'only pending bets can be removed'; end if;

  select kickoff into v_kickoff from matches where id = v_match_id;
  if v_kickoff <= now() + interval '10 minutes' then
    raise exception 'betting is closed for this match';
  end if;

  delete from gambler_bets_v2 where id = p_bet_id;
  update gambler_balances set balance = balance + v_amount, updated_at = now() where user_id = uid;
end;
$$;

revoke execute on function public.gambler_cancel_bet(uuid) from public;
grant execute on function public.gambler_cancel_bet(uuid) to authenticated;

create or replace function public.gambler_cancel_parlay(p_ticket_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_amount numeric;
  v_status text;
  v_locked int;
begin
  if uid is null then raise exception 'not signed in'; end if;

  select amount, status into v_amount, v_status
  from gambler_parlay_tickets where id = p_ticket_id and user_id = uid for update;
  if not found then raise exception 'parlay not found'; end if;
  if v_status <> 'pending' then raise exception 'only pending parlays can be removed'; end if;

  select count(*) into v_locked
  from gambler_parlay_legs l join matches m on m.id = l.match_id
  where l.ticket_id = p_ticket_id and m.kickoff <= now() + interval '10 minutes';
  if v_locked > 0 then raise exception 'betting is closed for one of these matches'; end if;

  delete from gambler_parlay_tickets where id = p_ticket_id; -- legs cascade
  update gambler_balances set balance = balance + v_amount, updated_at = now() where user_id = uid;
end;
$$;

revoke execute on function public.gambler_cancel_parlay(uuid) from public;
grant execute on function public.gambler_cancel_parlay(uuid) to authenticated;

-- Make PostgREST pick up the new functions immediately.
notify pgrst, 'reload schema';
