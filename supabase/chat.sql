-- Bracket Mundial: player-to-player chat.
--   * One shared group room ("El Vestuario") that every approved, non-guest
--     player is a member of.
--   * Private 1:1 DM threads, created on demand.
--   * Messages auto-expire 24 hours after they are sent.
--   * The shared guest account is blocked from reading or writing chat.
--
-- Mirrors the conventions in schema.sql / duels.sql: RLS on, column-level
-- grants, security-definer helper functions, tables added to the realtime
-- publication. Run this whole file once in the Supabase SQL editor AFTER
-- schema.sql, signups.sql and profile.sql. It is idempotent (safe to re-run).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Guest check: SQL mirror of isGuestEmail() in src/lib/players.ts. Used by
-- every chat policy so the view-only guest account can never chat.
-- ---------------------------------------------------------------------------
create or replace function public.is_guest(uid uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
    where u.id = uid and lower(u.email) = 'guest@bracketmundial.app'
  );
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A conversation is either the single group room or a DM between two users.
-- For DMs the pair is stored ordered (user_a < user_b) so each pair is unique.
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('group', 'dm')),
  user_a uuid references auth.users (id) on delete cascade,
  user_b uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (
    (kind = 'group' and user_a is null and user_b is null)
    or (kind = 'dm' and user_a is not null and user_b is not null and user_a < user_b)
  )
);

-- Exactly one group room.
insert into public.chat_conversations (kind)
select 'group'
where not exists (select 1 from public.chat_conversations where kind = 'group');

create unique index if not exists chat_conversations_dm_pair
  on public.chat_conversations (user_a, user_b) where kind = 'dm';

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index if not exists chat_messages_conv_idx
  on public.chat_messages (conversation_id, created_at);
create index if not exists chat_messages_expires_idx
  on public.chat_messages (expires_at);

-- One read watermark per (conversation, user). A message counts as "read" by a
-- user when their last_read_at >= the message's created_at. Powers both the
-- unread badge and the WhatsApp-style read receipts.
create table if not exists public.chat_reads (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Membership helper (security definer -> bypasses RLS, so policies that call
-- it never recurse back into chat_conversations' own policy).
-- ---------------------------------------------------------------------------
create or replace function public.chat_is_member(c uuid, uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when uid is null then false
    when public.is_guest(uid) then false
    else exists (
      select 1 from public.chat_conversations cc
      where cc.id = c
        and (cc.kind = 'group' or cc.user_a = uid or cc.user_b = uid)
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.chat_conversations from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
revoke all on public.chat_reads from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.chat_conversations to authenticated;
grant select, insert (conversation_id, sender_id, body) on public.chat_messages to authenticated;
grant select, insert (conversation_id, user_id, last_read_at), update (last_read_at)
  on public.chat_reads to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;

-- Conversations: you can see the group room and any DM you are part of.
drop policy if exists chat_conv_select on public.chat_conversations;
create policy chat_conv_select on public.chat_conversations
  for select to authenticated
  using (public.chat_is_member(id, auth.uid()));
-- No client insert policy: DMs are created via chat_open_dm(); the group row
-- is seeded above.

-- Messages: members only, and only the last 24 hours (older ones are pending
-- deletion by the cleanup job but stay invisible immediately).
drop policy if exists chat_msg_select on public.chat_messages;
create policy chat_msg_select on public.chat_messages
  for select to authenticated
  using (
    created_at > now() - interval '24 hours'
    and public.chat_is_member(conversation_id, auth.uid())
  );

drop policy if exists chat_msg_insert on public.chat_messages;
create policy chat_msg_insert on public.chat_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and not public.is_guest(auth.uid())
    and public.chat_is_member(conversation_id, auth.uid())
  );

-- Reads: members can see every member's watermark in their shared
-- conversations (needed to render "Read" / "Seen by"), but write only their own.
drop policy if exists chat_reads_select on public.chat_reads;
create policy chat_reads_select on public.chat_reads
  for select to authenticated
  using (public.chat_is_member(conversation_id, auth.uid()));

drop policy if exists chat_reads_insert on public.chat_reads;
create policy chat_reads_insert on public.chat_reads
  for insert to authenticated
  with check (user_id = auth.uid() and public.chat_is_member(conversation_id, auth.uid()));

drop policy if exists chat_reads_update on public.chat_reads;
create policy chat_reads_update on public.chat_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Find-or-create a DM thread with another player.
-- ---------------------------------------------------------------------------
create or replace function public.chat_open_dm(p_other uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a uuid;
  b uuid;
  cid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if public.is_guest(uid) then raise exception 'guests cannot chat'; end if;
  if p_other = uid then raise exception 'cannot DM yourself'; end if;
  if public.is_guest(p_other) then raise exception 'cannot DM the guest account'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'unknown player';
  end if;

  if uid < p_other then a := uid; b := p_other; else a := p_other; b := uid; end if;

  select id into cid from public.chat_conversations
   where kind = 'dm' and user_a = a and user_b = b;
  if cid is null then
    insert into public.chat_conversations (kind, user_a, user_b)
    values ('dm', a, b) returning id into cid;
  end if;
  return cid;
end;
$$;

revoke execute on function public.chat_open_dm(uuid) from public;
grant execute on function public.chat_open_dm(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (postgres_changes respects RLS, so each client only receives the
-- messages and read-receipts it is allowed to see).
-- ---------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.chat_reads;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 24-hour cleanup. The 24h filter in the select policy already hides expired
-- messages instantly; this job just keeps the table small. Requires the
-- pg_cron extension (enable it under Database > Extensions in Supabase). If
-- pg_cron is unavailable the chat still works correctly via the filter.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'chat-cleanup') then
      perform cron.unschedule('chat-cleanup');
    end if;
    perform cron.schedule(
      'chat-cleanup',
      '*/15 * * * *',
      $cron$delete from public.chat_messages where expires_at < now()$cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron not configured; relying on the 24h select filter only';
end $$;
