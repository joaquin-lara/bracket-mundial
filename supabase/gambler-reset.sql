-- One-off reset for test data: clears every gambler bet/parlay and resets
-- everyone's balance back to the starting $1000. Run once in the Supabase
-- SQL editor. Not idempotent in the sense of "safe to re-run for new data"
-- -- it deletes whatever is there at the time you run it.

delete from public.gambler_parlay_legs;
delete from public.gambler_parlay_tickets;
delete from public.gambler_bets_v2;

update public.gambler_balances set balance = 1000, updated_at = now();
