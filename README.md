# Bracket Mundial

World Cup 2026 prediction game. Players predict each match's final score, predictions lock 10 minutes before kickoff, and points are awarded automatically when matches finish.

## Scoring

| Points | Meaning |
|---|---|
| 3 | Exact score |
| 2 | Correct outcome (winner or draw), wrong scoreline |
| 1 | Prediction locked, wrong outcome |
| 0 | No prediction |

A match decided on penalties counts as a draw (the score at the end of extra time is what's judged).

## Stack

Next.js 14 (App Router, TypeScript), Supabase (Postgres + email/password auth), Vercel (hosting + cron), football-data.org (fixtures and results).

## Setup

### 1. Install

```bash
npm install
```

### 2. Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier).
2. In the project: **SQL Editor → New query**, paste the entire contents of `supabase/schema.sql`, run it.
3. **Authentication → Sign In / Providers → Email**: turn OFF "Confirm email" (simplest for a friend group; leave it on if you want confirmation emails).
4. **Project Settings → API**: copy the Project URL, the `anon` key, and the `service_role` key.

### 3. football-data.org

Register free at [football-data.org/client/register](https://www.football-data.org/client/register). The API key arrives by email.

### 4. Environment

```bash
copy .env.local.example .env.local
```

Fill in all five values. `CRON_SECRET` is any random string you invent.

### 5. Run locally

```bash
npm run dev
```

Open http://localhost:3000, sign up, then load fixtures by hitting the sync endpoint:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/sync
```

You should get `{"ok":true,"fixturesUpserted":...}`. If you instead get a football-data.org error mentioning your subscription, the free tier doesn't include WC 2026; see "Fixtures fallback" below.

### 6. Deploy

1. Push this repo to GitHub.
2. [vercel.com](https://vercel.com) → Add New Project → import the repo.
3. Paste all five env vars in the project settings.
4. Deploy. `vercel.json` schedules `/api/sync` every 30 minutes; Vercel Cron automatically sends your `CRON_SECRET` as the Authorization header.

## Fixtures fallback (openfootball)

If football-data.org's free tier does not cover WC 2026:

1. Set `FIXTURES_SOURCE=openfootball` in `.env.local` and in Vercel env vars.
2. Seed once: `npm run seed:openfootball`

The cron then syncs fixtures and scores from the openfootball dataset instead (no key needed). Don't mix sources in one database: openfootball rows use synthetic ids in the 9xxxxxxxx range.

## Tests

```bash
npm test          # scoring unit tests (pure function)
npm run typecheck
npm run test:db   # integration tests against a real Postgres (see below)
```

`test:db` verifies the riskiest behavior at the database level with the real `supabase/schema.sql`: the 10-minute lock rejects late writes even via direct SQL, picks stay hidden until kickoff, clients can't write the points column, and running the sync twice never doubles points. It needs a throwaway local Postgres:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/bracket_test npm run test:db
```

`tests/setup-test-db.sql` is applied automatically to stub Supabase's `auth` schema. Never run it against your Supabase project.

## How the pieces fit

- `supabase/schema.sql` — tables, the signup trigger that auto-creates profiles, the standings view, and the RLS policies. The 10-minute lock lives HERE, in the insert/update policies on `predictions`, so it holds even against direct API calls. Column-level grants stop clients from ever writing `points` or match results.
- `src/lib/scoring.ts` — pure scoring function plus football-data score parsing (handles extra time and penalty shootouts).
- `src/lib/sync.ts` — sync core, database-agnostic so the integration tests run it against plain Postgres. Idempotent: points are set, never incremented, and the `scored` flag stops re-scoring.
- `src/app/api/sync/route.ts` — cron endpoint. Rejects requests without `Authorization: Bearer CRON_SECRET`. Upserts fixtures, scores finished matches with the service-role key.
- `src/lib/footballData.ts` — both fixture sources behind one interface (`FIXTURES_SOURCE` switches).
- `middleware.ts` — redirects logged-out users to `/login`; `/api/sync` is excluded.
