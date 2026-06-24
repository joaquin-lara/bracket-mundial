-- Bracket Mundial: profile editing (name + flag) and self-service account
-- deletion. Run this whole file once in the Supabase SQL editor, AFTER
-- schema.sql and signups.sql. It is idempotent (safe to re-run).
--
-- What it adds:
--   * profiles.founder_slot -- stable id for the four founders so they can be
--     renamed without breaking standings/home (which used to match by name)
--   * lets a player update their own flag_code / color
--   * delete_my_account() -- a player can permanently delete their own account

-- ---------------------------------------------------------------------------
-- 1. founder_slot: which fixed roster slot a profile is (NULL for new players)
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists founder_slot text;

-- Backfill the four existing founders from their login email.
update public.profiles p
set founder_slot = case lower(au.email)
  when 'carlos@bracketmundial.app'  then 'Carlos'
  when 'sebas@bracketmundial.app'   then 'Sebas'
  when 'mauri@bracketmundial.app'   then 'Mauri'
  when 'joaquin@bracketmundial.app' then 'Joaquin'
  else null
end
from auth.users au
where au.id = p.id and public.is_admin_email(au.email);

-- ---------------------------------------------------------------------------
-- 2. Signup trigger: also stamp founder_slot for the founders
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_founder boolean :=
    public.is_admin_email(new.email)
    or lower(new.email) = 'guest@bracketmundial.app';
  slot text := case lower(new.email)
    when 'carlos@bracketmundial.app'  then 'Carlos'
    when 'sebas@bracketmundial.app'   then 'Sebas'
    when 'mauri@bracketmundial.app'   then 'Mauri'
    when 'joaquin@bracketmundial.app' then 'Joaquin'
    else null
  end;
begin
  insert into public.profiles (id, display_name, status, flag_code, color, founder_slot)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    case when is_founder then 'approved' else 'pending' end,
    nullif(new.raw_user_meta_data ->> 'flag_code', ''),
    nullif(new.raw_user_meta_data ->> 'color', ''),
    slot
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. Let a player edit their own flag + color (name was already editable)
-- ---------------------------------------------------------------------------
-- RLS policy profiles_update_own (from schema.sql) already restricts updates
-- to the caller's own row. Status and founder_slot are intentionally NOT
-- granted, so a player can never approve themselves or change their slot.

grant update (flag_code, color) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Self-service account deletion
-- ---------------------------------------------------------------------------
-- Deleting the auth.users row cascades to profiles, predictions, duels,
-- achievements and push subscriptions (all FK'd with on delete cascade).

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in.';
  end if;
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;
