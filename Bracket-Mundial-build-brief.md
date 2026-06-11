# Build brief: World Cup 2026 prediction bracket

**Before writing any files:** build this project inside my folder at `C:\Users\Joaquin Lara\Desktop\Bracket Mundial`. If you don't have access to that folder yet, ask me to connect it and wait for confirmation before creating anything. Do not write to a temporary or scratch location.

You are building a web app from scratch. This document is the complete spec. Build the entire codebase, then stop and give me clear setup steps for the parts that need my accounts (Supabase, football API key, Vercel). Do not assume first-run perfection: verify the three risky parts (database lock enforcement, real API payload shape, scoring idempotency) by testing, not by assuming.

## What the app is

A prediction game for me and my friends for the 2026 FIFA World Cup. Each day the day's matches appear. Players log in and enter the scoreline they think each match will end on. They can edit their prediction until 10 minutes before kickoff, then it locks. When a match finishes, points are awarded automatically based on how close the prediction was. Whoever has the most points at the end of the tournament wins.

## Scoring rules

For each match a player locked a prediction on, compare their predicted scoreline to the real final score:

- **3 points** — exact score (predicted home and away both equal the real result).
- **2 points** — correct outcome (same winner, or both are draws) but wrong scoreline.
- **1 point** — a prediction was locked but the outcome was wrong.
- **0 points** — no prediction was locked for that match.

Outcome is `sign(pred_home - pred_away) === sign(actual_home - actual_away)`.

Worked example, real result 2-1 (home win): predict 2-1 → 3; predict 3-0 → 2; predict 1-1 → 1; no prediction → 0.

(Decision already made: a locked-but-wrong guess earns 1 point, rewarding participation; only a no-show earns 0. Keep this.)

## Stack

- Next.js 14, App Router, TypeScript.
- Supabase for Postgres database and email/password Auth.
- `@supabase/ssr` for cookie-based auth in the App Router.
- Vercel for hosting and Vercel Cron for the scheduled sync job.
- football-data.org as the fixtures and results source (free tier, competition code `WC`).

## Data model

**profiles** — one row per user, auto-created on signup via a database trigger.
- `id` uuid, primary key, references `auth.users(id)`
- `display_name` text
- `created_at` timestamptz default now()

**matches** — fixtures, populated only by the sync job (never entered by hand). Use football-data.org's match id as the primary key so re-syncs are idempotent.
- `id` bigint, primary key (football-data match id)
- `home_team` text, `away_team` text
- `home_code` text, `away_code` text (3-letter country codes, for flags later; nullable)
- `kickoff` timestamptz (UTC)
- `stage` text, `group_name` text (nullable)
- `status` text (SCHEDULED / TIMED / IN_PLAY / PAUSED / FINISHED)
- `home_score` int, `away_score` int (null until played)
- `scored` boolean default false
- `updated_at` timestamptz default now()

**predictions** — one row per user per match.
- `id` uuid, primary key, default gen_random_uuid()
- `user_id` uuid, references auth.users(id)
- `match_id` bigint, references matches(id)
- `pred_home` int, `pred_away` int
- `points` int (null until the match is scored)
- `created_at`, `updated_at` timestamptz default now()
- unique constraint on (`user_id`, `match_id`)

**standings** — a SQL view: `user_id`, `display_name`, `SUM(points) AS total`, `COUNT(points) AS games_scored`, grouped by user, ordered by total descending. The leaderboard reads from this.

## Authentication

Email + password via Supabase Auth. Signup form collects email, password, and display_name. A Postgres trigger on `auth.users` inserts the matching `profiles` row automatically on signup (read display_name from user metadata). Middleware redirects logged-out users to `/login`.

## Locking (most important to get right)

A prediction can be created or edited only while `now() < kickoff - interval '10 minutes'`. Enforce in two layers:

1. **UI** — each match card shows a live countdown to the lock time and disables the score inputs once under 10 minutes remain.
2. **Database RLS policy** — the real guard. The insert and update policies on `predictions` carry a `WITH CHECK` that the referenced match's `kickoff > now() + interval '10 minutes'` (and `user_id = auth.uid()`). This must reject a late write even if someone calls the API directly, bypassing the UI.

**Verify this explicitly**: write a test that attempts to insert/update a prediction for a match kicking off in under 10 minutes and confirm the database rejects it.

## Row-level security summary

- `profiles`: anyone authenticated can read; a user can update only their own row.
- `matches`: authenticated users can read; no client writes at all (only the sync job, using the service-role key, writes).
- `predictions`:
  - select: a user always sees their own predictions. They can see other users' predictions for a match only after that match's kickoff has passed (prevents copying). Before kickoff, others' picks are hidden.
  - insert/update: own rows only, and only while the 10-minute lock is open (the policy above).
  - the sync job writes `points` using the service-role key, which bypasses RLS.

(Decision already made: picks are hidden from other players until kickoff, then revealed. Keep this.)

## Sync job (the automation)

A route handler at `/api/sync`:

1. Reject any request that doesn't carry the correct `CRON_SECRET` in its Authorization header (Vercel Cron sends it). This stops anyone else triggering it.
2. Fetch `GET https://api.football-data.org/v4/competitions/WC/matches` with header `X-Auth-Token: FOOTBALL_DATA_API_KEY`.
3. Upsert every match into `matches` (so new fixtures appear and kickoff times stay current). Map football-data fields to the schema; inspect a real response to confirm exact field names and how stages/groups are labeled before finalizing the parser.
4. For each match now `FINISHED` with `scored = false`: compute points for every prediction on that match per the scoring rules, write `predictions.points`, then set `matches.scored = true`.

**Idempotency is central**: the `scored` flag must guarantee a match is never scored twice across repeated cron runs. Test this by running the sync twice and confirming points don't double.

Schedule it in `vercel.json` every 30 minutes.

Put the scoring math in a pure, unit-testable function in `src/lib/scoring.ts` and write a few unit tests for it (the four cases above).

## Environment variables

Ship a `.env.local.example` listing all five:
- `NEXT_PUBLIC_SUPABASE_URL` (browser-safe)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser-safe)
- `SUPABASE_SERVICE_ROLE_KEY` (server only — powerful, never expose to client)
- `FOOTBALL_DATA_API_KEY` (server only)
- `CRON_SECRET` (server only — any random string I invent)

## Pages

- `/login`, `/signup`
- `/` — today's matches with the prediction form and per-match lock countdown; auth-gated.
- `/matches` — full tournament schedule (optional but nice).
- `/standings` — leaderboard from the standings view.

## Suggested file structure

```
package.json, tsconfig.json, next.config.js, vercel.json
.env.local.example, .gitignore, README.md
supabase/schema.sql          (tables, RLS policies, standings view, signup trigger)
middleware.ts
src/lib/supabase/client.ts   (browser client)
src/lib/supabase/server.ts   (server client)
src/lib/scoring.ts           (pure scoring function + the FINISHED/score parsing helpers)
src/lib/footballData.ts      (API fetch + response parsing)
src/lib/scoring.test.ts      (unit tests for the four scoring cases)
src/app/layout.tsx, src/app/globals.css
src/app/page.tsx             (daily matches + prediction form)
src/app/login/page.tsx, src/app/signup/page.tsx
src/app/standings/page.tsx
src/app/api/sync/route.ts
src/app/actions.ts           (server actions to submit predictions)
```

## Fallback for fixtures data

The plan assumes football-data.org's free tier includes the 2026 World Cup under competition code `WC`. If, once my API key is in hand, the free tier does NOT include 2026, fall back to the free openfootball dataset (`https://github.com/openfootball/worldcup.json`, no key needed) and add a small seed script that loads fixtures from it. Build the sync layer so the data source is swappable without rewriting the rest.

## Build and run order

1. `npm install`.
2. I create the Supabase project and run `supabase/schema.sql` in its SQL editor. (You write the SQL; I run it.)
3. I fill `.env.local` with my five keys.
4. `npm run dev`, open `localhost:3000`, sign up, test a prediction.
5. Manually hit `/api/sync` with the secret to confirm fixtures load and a finished match scores correctly.
6. Push to GitHub, import to Vercel, paste env vars, deploy. Cron runs automatically.

## What you need from me (and when)

Build everything that doesn't need my accounts first. Then stop and ask me for: Supabase project URL, anon key, and service-role key; a football-data.org API key (free signup); and a `CRON_SECRET` I invent. Walk me through creating the Supabase project and running the schema. I use VSCode and test on localhost, and the project should live in `C:\Users\Joaquin Lara\Desktop\Bracket Mundial`.

## Verification checklist before you call it done

- The database rejects a prediction written less than 10 minutes before kickoff.
- Scoring unit tests pass for all four cases (3 / 2 / 1 / 0).
- Running the sync twice does not double any points.
- A logged-out user is redirected to /login.
- Another player's picks are not visible before kickoff.
- `npm run build` and `tsc --noEmit` both pass.
```
