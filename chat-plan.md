# Player-to-Player Chat — Implementation Plan

Reuses Curva's `ChatBubble.tsx` interaction (floating circle, click-to-open, drag-to-reposition, corner snap, position saved in localStorage) but swaps the AI backend for Supabase Realtime player-to-player messaging.

## Decisions locked in
- **Structure:** Group room ("El Vestuario") + private 1-to-1 DMs.
- **Persistence:** Messages stored in Supabase, auto-deleted after 24 hours.
- **Receipts (WhatsApp style):** one gray check = sent, two gray checks = delivered, two blue checks + "Read" = read. Plus an unread count badge on the bubble.
- **Access:** Logged-in players only. The shared guest account (`guest@bracketmundial.app`) is blocked at both the UI and the database (RLS).

## What already exists in Bracket Mundial (reused, not rebuilt)
- Supabase auth + SSR client (`src/lib/supabase/client.ts`, `server.ts`).
- Supabase Realtime pattern: `ChallengeWatcher.tsx` already subscribes to `postgres_changes` on the `duels` table and runs a presence channel. Chat copies this pattern.
- Presence: `presenceStore.ts` + `PresenceDot.tsx` already know who is online. Chat reuses this for online dots and to infer "delivered".
- Guest gating: `isGuestEmail()` in `src/lib/players.ts`, already used across the app.
- Mount point: `src/app/layout.tsx` already conditionally mounts watchers with `user.id`. Chat mounts the same way.

---

## Phase 1 — Database (`supabase/chat.sql`, new idempotent file)

Mirrors the conventions in `schema.sql` / `duels.sql` (RLS on, column-level grants, `security definer` RPCs, add table to `supabase_realtime`).

**Tables**
- `chat_conversations`
  - `id uuid pk`
  - `kind text` — `'group'` or `'dm'`
  - `user_a uuid`, `user_b uuid` — both null for the group row; for DMs store the two participant ids with `user_a < user_b` so each pair is unique.
  - `unique` index on `(kind, user_a, user_b)` to dedupe.
  - One fixed group row is seeded on first run.
- `chat_messages`
  - `id uuid pk`, `conversation_id uuid fk`, `sender_id uuid fk`, `body text`
  - `created_at timestamptz default now()`
  - `expires_at timestamptz default now() + interval '24 hours'`
- `chat_reads`
  - `(conversation_id, user_id)` pk, `last_read_at timestamptz`
  - One watermark row per user per conversation. A message is "read" by a user when their `last_read_at >= message.created_at`. Unread count = messages newer than the watermark. This one table powers both read receipts and the unread badge.

**Helper function**
- `is_guest(uid uuid)` returning boolean (looks up `auth.users.email` = `guest@bracketmundial.app`), mirroring `is_admin_email()`. Used in every chat RLS policy to block the guest account.

**RLS policies**
- Read messages: only if `auth.uid()` is a participant of the conversation (group = everyone non-guest; DM = `user_a` or `user_b`) and `not is_guest(auth.uid())`.
- Insert message: sender must be `auth.uid()`, must be a participant, must not be guest, and `expires_at` is server-defaulted (not client-set).
- `chat_reads`: a user can upsert only their own watermark row.
- DM conversation creation goes through an RPC `chat_open_dm(other uuid)` (`security definer`) that finds-or-creates the pair row and returns its id, so clients never insert conversations directly.

**Grants**: `select` on the three tables to `authenticated`; `insert(conversation_id, sender_id, body)` on `chat_messages`; `insert/update(last_read_at)` on `chat_reads`. Revoke everything else.

**Realtime**: `alter publication supabase_realtime add table public.chat_messages, public.chat_reads;` (postgres_changes respects RLS, so each client only receives rows it is allowed to see).

**24-hour cleanup** (two layers):
1. Every query filters `where created_at > now() - interval '24 hours'` (instant correctness even if cleanup lags).
2. A `pg_cron` job (`select cron.schedule('chat-cleanup', '*/15 * * * *', $$delete from chat_messages where expires_at < now()$$);`) hard-deletes expired rows so the table stays small.

---

## Phase 2 — Frontend logic (`src/lib/chat.ts`)
Small pure helpers, no UI:
- `groupConversationId` constant + `dmPairKey(a, b)` ordering helper.
- Types: `ChatMessage`, `Conversation`, `TickState`.
- `tickFor(message, reads, participants)` returns `'sent' | 'delivered' | 'read'`:
  - `sent` = row exists in DB.
  - `delivered` = at least one recipient is currently online via the presence store (best-effort web equivalent of WhatsApp's delivered).
  - `read` = all other participants' `last_read_at >= message.created_at`.

Optional `src/lib/chatStore.ts` (copy of `presenceStore.ts` shape) holding the global unread count for the badge, so any component can subscribe.

---

## Phase 3 — The bubble component (`src/components/ChatBubble.tsx`)
Start from Curva's `ChatBubble.tsx` and keep verbatim:
- All drag / corner-snap / pointer logic, `localStorage` corner persistence (rename key to `bm-chat-corner`), click-vs-drag detection, open/close animation, panel docking to the same corner.

Replace:
- Branding: drop Speedy / `soft_tire.png`; use the app's green theme (`#0b5f3a`) and a chat/⚽ icon. Reuse the same CSS variables the rest of the app uses.
- The AI `send()` (POST `/api/chat`) is removed. `send()` now `insert`s into `chat_messages` for the active conversation.

Add a two-view panel:
1. **List view (default):** the group room at top, then each other player as a DM row with their `PresenceDot` (online/dueling) and unread count. Tapping a row opens its thread (calling `chat_open_dm` for DMs).
2. **Thread view:** header with a back arrow + conversation name; the message list (own messages right-aligned, others left, same bubble styling as Curva); the composer (input + send) reused as-is.

Per-message footer in a thread shows the WhatsApp ticks via `tickFor(...)`: gray single, gray double, blue double, with a small "Read" label on the latest read message.

Realtime + reads (copying `ChallengeWatcher`):
- Subscribe to `postgres_changes` on `chat_messages` (and `chat_reads` for live tick updates), plus a 7s poll fallback and a `visibilitychange` refresh, exactly like the duels watcher.
- When a thread is open and focused, upsert the user's `chat_reads.last_read_at = now()` so the sender's ticks turn blue.
- Maintain the global unread count (messages newer than each watermark, across all conversations) and expose it for the badge.

Badge: a small count chip on the closed bubble (and, since the bubble lives in the layout, it is visible site-wide) whenever unread > 0.

---

## Phase 4 — Mount + gate (`src/app/layout.tsx`)
One line next to the existing watchers:
```tsx
{user && !isGuestEmail(user.email) && <ChatBubble me={user.id} />}
```
This guarantees guests never even load the component; RLS is the second line of defense.

---

## Phase 5 — Styling
Add chat styles to `globals.css` (the app uses global CSS, e.g. the `.chal-*` and `.pres-*` classes), or keep Curva's inline-style approach. Match the green theme and existing panel/line/text variables so the bubble feels native.

---

## Phase 6 — Verification
- Two browser profiles signed in as different players: send group + DM messages, confirm realtime delivery both directions.
- Confirm tick transitions: gray on send, gray-double when recipient online, blue + "Read" after recipient opens the thread.
- Confirm unread badge increments when the panel is closed and clears on open.
- Confirm a message older than 24h disappears (manually backdate a row, run the cleanup query).
- Confirm the guest account sees no bubble and that direct API reads/inserts are rejected by RLS.
- Confirm drag/corner-snap and saved position still work on desktop and touch.

---

## New / changed files summary
| File | Action |
|------|--------|
| `supabase/chat.sql` | new — tables, RLS, `is_guest()`, `chat_open_dm()`, realtime, pg_cron cleanup |
| `src/lib/chat.ts` | new — types + tick/unread helpers |
| `src/lib/chatStore.ts` | new (optional) — global unread store |
| `src/components/ChatBubble.tsx` | new — adapted from Curva, list + thread views, receipts |
| `src/app/layout.tsx` | edit — mount the bubble for non-guest users |
| `src/app/globals.css` | edit — chat styles |

No changes to Curva. No new dependencies (Supabase Realtime is already in use).

## Open question before building
WhatsApp shows group ticks as blue only when **everyone** has read. With a growing roster that can mean ticks rarely go blue in the group room. Two options: (a) blue when all other participants have read (true WhatsApp), or (b) in the group room show a simpler "seen by N" instead of blue ticks. Worth picking before Phase 3.
