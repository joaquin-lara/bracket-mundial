-- Fix: gambler_place_bet and gambler_place_parlay_v2 were calling the old
-- 2-param gambler_leg_multiplier(text, numeric) which no longer exists after
-- market-odds-by-side.sql upgraded it to 3 params (text, text, numeric).
-- gambler-cancel-and-dupes.sql ran last and clobbered the correct version.
-- This patch restores both functions with the right 3-param calls and the
-- duplicate guards from gambler-cancel-and-dupes.sql. Run once in the editor.

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

revoke execute on function public.gambler_place_bet(bigint, text, text, text, numeric, text, int, int, numeric) from public;
grant execute on function public.gambler_place_bet(bigint, text, text, text, numeric, text, int, int, numeric) to authenticated;

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

  for v_leg in select * from jsonb_array_elements(p_legs)
  loop
    perform gambler_validate_leg(
      v_leg->>'market', v_leg->>'side', v_leg->>'comparator', (v_leg->>'line')::numeric,
      v_leg->>'pick', (v_leg->>'pick_home_score')::int, (v_leg->>'pick_away_score')::int
    );

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

revoke execute on function public.gambler_place_parlay_v2(jsonb, numeric) from public;
grant execute on function public.gambler_place_parlay_v2(jsonb, numeric) to authenticated;

notify pgrst, 'reload schema';
