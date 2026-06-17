-- Spectating: let any signed-in user READ duels so they can watch friends' live
-- shootouts. This is safe — picks live in duel_secrets (no grants, no policies,
-- never readable), and the duels row only ever exposes a kick after the referee
-- resolves it into the public `rounds`. Ending/canceling/picking still go through
-- the security-definer functions, which reject non-participants.
drop policy if exists duels_select on public.duels;
create policy duels_select on public.duels
  for select to authenticated
  using (true);
