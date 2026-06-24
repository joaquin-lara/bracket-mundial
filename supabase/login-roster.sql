-- Bracket Mundial: let approved non-founder players log back in.
--
-- The login screen lists the four founders from code, but new players have no
-- code entry, so after approval they had no button to sign in with. This adds a
-- tiny read-only RPC the (unauthenticated) login page can call to list approved
-- new players by name + flag. It deliberately exposes ONLY display_name and
-- flag_code of approved, non-founder, non-guest players -- the same identity
-- shown on the public login screen, nothing sensitive.
--
-- Run this whole file once in the Supabase SQL editor, AFTER schema.sql,
-- signups.sql and profile.sql. It is idempotent (safe to re-run).

create or replace function public.login_players()
returns table (display_name text, flag_code text)
language sql
stable
security definer
set search_path = public
as $$
  select p.display_name, p.flag_code
  from public.profiles p
  where p.status = 'approved'
    and p.founder_slot is null      -- founders are already listed in the UI
    and p.display_name <> 'Guest'
  order by p.display_name asc;
$$;

-- The login page is reached while signed out, so anon must be able to call it.
grant execute on function public.login_players() to anon, authenticated;
