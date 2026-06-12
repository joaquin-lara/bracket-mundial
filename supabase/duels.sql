-- Penalty shootout duels. Run this whole file once in the Supabase SQL
-- editor (it is idempotent). Bragging rights only — no tournament points.
--
-- Anti-cheat design: picks are stored in duel_secrets, which NO client can
-- read (no grants, no realtime). All game writes go through the
-- security-definer functions below, which act as the referee: they validate
-- turns, resolve kicks only when both picks are in, and reveal history via
-- the public `rounds` json on the duels row.

create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  challenger uuid not null references auth.users (id) on delete cascade,
  opponent uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending', -- pending | active | declined | finished
  kick int not null default 1, -- 1-based; odd kicks: challenger shoots
  challenger_score int not null default 0,
  opponent_score int not null default 0,
  rounds jsonb not null default '[]'::jsonb,
  shooter_picked boolean not null default false,
  keeper_picked boolean not null default false,
  winner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (challenger <> opponent)
);

create table if not exists public.duel_secrets (
  duel_id uuid not null references public.duels (id) on delete cascade,
  kick int not null,
  user_id uuid not null,
  pick text not null check (pick in ('left', 'center', 'right')),
  primary key (duel_id, kick, user_id)
);

alter table public.duels enable row level security;
alter table public.duel_secrets enable row level security;

revoke all on public.duels from anon, authenticated;
revoke all on public.duel_secrets from anon, authenticated;

-- Participants can read their duels (no secret columns exist on this table).
drop policy if exists duels_select on public.duels;
create policy duels_select on public.duels
  for select to authenticated
  using (auth.uid() in (challenger, opponent));

grant select on public.duels to authenticated;
-- duel_secrets: no policies, no grants. Referee functions only.

-- ---------------------------------------------------------------------------
-- Referee functions
-- ---------------------------------------------------------------------------

create or replace function public.duel_create(p_opponent uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  nid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_opponent = uid then raise exception 'you cannot duel yourself'; end if;
  if not exists (select 1 from profiles where id = p_opponent) then
    raise exception 'unknown opponent';
  end if;
  if exists (
    select 1 from duels
    where status in ('pending', 'active')
      and ((challenger = uid and opponent = p_opponent)
        or (challenger = p_opponent and opponent = uid))
  ) then
    raise exception 'you already have an open duel with this player';
  end if;
  insert into duels (challenger, opponent) values (uid, p_opponent) returning id into nid;
  return nid;
end;
$$;

create or replace function public.duel_respond(p_duel uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d duels%rowtype;
begin
  select * into d from duels where id = p_duel for update;
  if not found then raise exception 'duel not found'; end if;
  if auth.uid() <> d.opponent then raise exception 'only the challenged player can respond'; end if;
  if d.status <> 'pending' then raise exception 'duel is not pending'; end if;
  update duels
  set status = case when p_accept then 'active' else 'declined' end,
      updated_at = now()
  where id = p_duel;
end;
$$;

create or replace function public.duel_submit_pick(p_duel uuid, p_pick text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d duels%rowtype;
  uid uuid := auth.uid();
  v_shooter uuid;
  v_keeper uuid;
  is_shooter boolean;
  s_pick text;
  k_pick text;
  v_goal boolean;
  ch_taken int;
  op_taken int;
  done boolean := false;
  v_winner uuid := null;
  ch_score int;
  op_score int;
begin
  if p_pick not in ('left', 'center', 'right') then raise exception 'bad pick'; end if;
  select * into d from duels where id = p_duel for update;
  if not found then raise exception 'duel not found'; end if;
  if uid is null or (uid <> d.challenger and uid <> d.opponent) then
    raise exception 'not your duel';
  end if;
  if d.status <> 'active' then raise exception 'duel is not active'; end if;

  if d.kick % 2 = 1 then v_shooter := d.challenger; else v_shooter := d.opponent; end if;
  if v_shooter = d.challenger then v_keeper := d.opponent; else v_keeper := d.challenger; end if;
  is_shooter := (uid = v_shooter);

  begin
    insert into duel_secrets (duel_id, kick, user_id, pick) values (p_duel, d.kick, uid, p_pick);
  exception when unique_violation then
    raise exception 'you already picked for this kick';
  end;

  update duels set
    shooter_picked = shooter_picked or is_shooter,
    keeper_picked = keeper_picked or (not is_shooter),
    updated_at = now()
  where id = p_duel;

  select pick into s_pick from duel_secrets where duel_id = p_duel and kick = d.kick and user_id = v_shooter;
  select pick into k_pick from duel_secrets where duel_id = p_duel and kick = d.kick and user_id = v_keeper;
  if s_pick is null or k_pick is null then return; end if;

  -- both picks in: resolve the kick
  v_goal := (s_pick <> k_pick);
  ch_score := d.challenger_score;
  op_score := d.opponent_score;
  if v_goal then
    if v_shooter = d.challenger then ch_score := ch_score + 1; else op_score := op_score + 1; end if;
  end if;

  -- win logic: regulation is 5 kicks each (kicks 1..10), then sudden death
  if d.kick <= 10 then
    ch_taken := (d.kick + 1) / 2; -- challenger shoots odd kicks
    op_taken := d.kick / 2;
    if ch_score > op_score + (5 - op_taken) then done := true; v_winner := d.challenger; end if;
    if op_score > ch_score + (5 - ch_taken) then done := true; v_winner := d.opponent; end if;
    if not done and d.kick = 10 and ch_score <> op_score then
      done := true;
      v_winner := case when ch_score > op_score then d.challenger else d.opponent end;
    end if;
  else
    if d.kick % 2 = 0 and ch_score <> op_score then
      done := true;
      v_winner := case when ch_score > op_score then d.challenger else d.opponent end;
    end if;
  end if;

  update duels set
    challenger_score = ch_score,
    opponent_score = op_score,
    rounds = rounds || jsonb_build_object(
      'kick', d.kick, 'shooter', v_shooter, 'shot', s_pick, 'dive', k_pick, 'goal', v_goal
    ),
    kick = d.kick + 1,
    shooter_picked = false,
    keeper_picked = false,
    status = case when done then 'finished' else status end,
    winner = v_winner,
    updated_at = now()
  where id = p_duel;
end;
$$;

revoke execute on function public.duel_create(uuid) from public;
revoke execute on function public.duel_respond(uuid, boolean) from public;
revoke execute on function public.duel_submit_pick(uuid, text) from public;
grant execute on function public.duel_create(uuid) to authenticated;
grant execute on function public.duel_respond(uuid, boolean) to authenticated;
grant execute on function public.duel_submit_pick(uuid, text) to authenticated;

-- Realtime: push duel row changes to participants (RLS applies).
do $$ begin
  alter publication supabase_realtime add table public.duels;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Cancel: either participant can end a pending or active duel for both.
-- ---------------------------------------------------------------------------

alter table public.duels add column if not exists canceled_by uuid;

create or replace function public.duel_cancel(p_duel uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d duels%rowtype;
begin
  select * into d from duels where id = p_duel for update;
  if not found then raise exception 'duel not found'; end if;
  if auth.uid() <> d.challenger and auth.uid() <> d.opponent then
    raise exception 'not your duel';
  end if;
  if d.status not in ('pending', 'active') then
    raise exception 'duel is already over';
  end if;
  update duels
  set status = 'canceled', canceled_by = auth.uid(), updated_at = now()
  where id = p_duel;
end;
$$;

revoke execute on function public.duel_cancel(uuid) from public;
grant execute on function public.duel_cancel(uuid) to authenticated;
