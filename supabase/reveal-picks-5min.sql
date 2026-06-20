-- Reveal other players' picks 5 minutes before kickoff (was: at kickoff).
-- Picks already lock 10 minutes before kickoff, so by the 5-minute mark every
-- pick is final and there is no copying window. Run once in the Supabase SQL
-- editor. Idempotent (also folded into schema.sql).

drop policy if exists predictions_select on public.predictions;
create policy predictions_select on public.predictions
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.matches m
      where m.id = match_id and m.kickoff <= now() + interval '5 minutes'
    )
  );
