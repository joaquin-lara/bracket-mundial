/**
 * Integration tests against a REAL Postgres database. They verify the two
 * riskiest behaviors with the actual supabase/schema.sql, not a mock:
 *
 *   1. RLS lock: the database itself rejects predictions written less than
 *      10 minutes before kickoff, even via direct SQL (UI bypassed).
 *   2. Sync idempotency: running the sync twice never doubles points.
 *
 * Requires TEST_DATABASE_URL pointing at a throwaway Postgres, e.g.:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/bracket_test npm run test:db
 */
import { readFileSync } from 'fs';
import path from 'path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FixtureRow } from '../src/lib/footballData';
import { runSync, type SyncDb } from '../src/lib/sync';

const url = process.env.TEST_DATABASE_URL;

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

let pool: Pool;

beforeAll(async () => {
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  pool = new Pool({ connectionString: url });

  const setup = readFileSync(path.join(__dirname, 'setup-test-db.sql'), 'utf8');
  const schema = readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  await pool.query(setup);
  await pool.query(schema);

  // Two users; the signup trigger must auto-create their profiles.
  await pool.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'ana@example.com', '{"display_name":"Ana"}'),
       ($2, 'beto@example.com', '{"display_name":"Beto"}')
     on conflict (id) do nothing`,
    [U1, U2]
  );

  // Fixtures: 101 locks soon (kickoff in 5 min), 102 is open (in 2 h),
  // 103 already kicked off, 104 is finished and awaiting scoring.
  await pool.query(`
    insert into public.matches (id, home_team, away_team, kickoff, status) values
      (101, 'Mexico', 'South Africa', now() + interval '5 minutes', 'TIMED'),
      (102, 'Canada', 'Morocco',      now() + interval '2 hours',   'TIMED'),
      (103, 'USA',    'Japan',        now() - interval '30 minutes','IN_PLAY'),
      (104, 'Spain',  'Argentina',    now() - interval '3 hours',   'FINISHED')
    on conflict (id) do nothing
  `);
  await pool.query(`update public.matches set home_score = 2, away_score = 1 where id = 104`);
});

afterAll(async () => {
  await pool?.end();
});

/** Run fn as an authenticated user (RLS + column grants apply). */
async function asUser<T>(uid: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: uid }),
    ]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

describe('signup trigger', () => {
  it('auto-created profiles with display_name from metadata', async () => {
    const { rows } = await pool.query(
      `select display_name from public.profiles where id in ($1, $2) order by display_name`,
      [U1, U2]
    );
    expect(rows.map((r) => r.display_name)).toEqual(['Ana', 'Beto']);
  });
});

describe('RLS: 10-minute lock', () => {
  it('REJECTS an insert for a match kicking off in under 10 minutes', async () => {
    await expect(
      asUser(U1, (c) =>
        c.query(
          `insert into public.predictions (user_id, match_id, pred_home, pred_away)
           values ($1, 101, 1, 0)`,
          [U1]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });

  it('REJECTS an insert for a match already kicked off', async () => {
    await expect(
      asUser(U1, (c) =>
        c.query(
          `insert into public.predictions (user_id, match_id, pred_home, pred_away)
           values ($1, 103, 1, 0)`,
          [U1]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });

  it('accepts an insert while the lock is open (kickoff in 2 h)', async () => {
    await asUser(U1, (c) =>
      c.query(
        `insert into public.predictions (user_id, match_id, pred_home, pred_away)
         values ($1, 102, 3, 1) on conflict (user_id, match_id) do nothing`,
        [U1]
      )
    );
    const { rows } = await pool.query(
      `select pred_home, pred_away from public.predictions where user_id = $1 and match_id = 102`,
      [U1]
    );
    expect(rows[0]).toEqual({ pred_home: 3, pred_away: 1 });
  });

  it('allows edits while open, then REJECTS the edit once the match locks', async () => {
    // Edit while open: fine.
    await asUser(U1, (c) =>
      c.query(`update public.predictions set pred_home = 2, pred_away = 0 where match_id = 102 and user_id = $1`, [U1])
    );

    // Move kickoff to 5 minutes from now (as the sync job would on a
    // schedule change), then try to edit again.
    await pool.query(`update public.matches set kickoff = now() + interval '5 minutes' where id = 102`);
    await expect(
      asUser(U1, (c) =>
        c.query(`update public.predictions set pred_home = 9, pred_away = 9 where match_id = 102 and user_id = $1`, [U1])
      )
    ).rejects.toThrow(/row-level security/);

    // Restore for later tests.
    await pool.query(`update public.matches set kickoff = now() + interval '2 hours' where id = 102`);
    const { rows } = await pool.query(
      `select pred_home, pred_away from public.predictions where user_id = $1 and match_id = 102`,
      [U1]
    );
    expect(rows[0]).toEqual({ pred_home: 2, pred_away: 0 }); // the locked write never landed
  });

  it('REJECTS inserting a prediction for another user', async () => {
    await expect(
      asUser(U2, (c) =>
        c.query(
          `insert into public.predictions (user_id, match_id, pred_home, pred_away)
           values ($1, 102, 0, 0)`,
          [U1] // U2 pretending to be U1
        )
      )
    ).rejects.toThrow(/row-level security/);
  });

  it('REJECTS a client writing the points column (column grant)', async () => {
    await expect(
      asUser(U2, (c) =>
        c.query(
          `insert into public.predictions (user_id, match_id, pred_home, pred_away, points)
           values ($1, 102, 1, 1, 3)`,
          [U2]
        )
      )
    ).rejects.toThrow(/permission denied/);
  });
});

describe('RLS: pick visibility', () => {
  it("hides another user's picks before kickoff, reveals them after", async () => {
    // U2 predicts match 102 (kickoff in 2 h).
    await asUser(U2, (c) =>
      c.query(
        `insert into public.predictions (user_id, match_id, pred_home, pred_away)
         values ($1, 102, 1, 1) on conflict (user_id, match_id) do nothing`,
        [U2]
      )
    );

    // Before kickoff: U1 sees only their own row for match 102.
    const before = await asUser(U1, (c) =>
      c.query(`select user_id from public.predictions where match_id = 102`)
    );
    expect(before.rows.map((r) => r.user_id)).toEqual([U1]);

    // After kickoff: U1 sees both.
    await pool.query(`update public.matches set kickoff = now() - interval '1 minute' where id = 102`);
    const after = await asUser(U1, (c) =>
      c.query(`select user_id from public.predictions where match_id = 102 order by user_id`)
    );
    expect(after.rows.map((r) => r.user_id)).toEqual([U1, U2]);

    await pool.query(`update public.matches set kickoff = now() + interval '2 hours' where id = 102`);
  });
});

// ---------------------------------------------------------------------------

function pgSyncDb(): SyncDb {
  return {
    async upsertMatches(rows: FixtureRow[]) {
      for (const r of rows) {
        await pool.query(
          `insert into public.matches
             (id, home_team, away_team, home_code, away_code, kickoff, stage, group_name, status, home_score, away_score, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
           on conflict (id) do update set
             home_team = excluded.home_team, away_team = excluded.away_team,
             home_code = excluded.home_code, away_code = excluded.away_code,
             kickoff = excluded.kickoff, stage = excluded.stage,
             group_name = excluded.group_name, status = excluded.status,
             home_score = excluded.home_score, away_score = excluded.away_score,
             updated_at = now()`,
          [r.id, r.home_team, r.away_team, r.home_code, r.away_code, r.kickoff, r.stage, r.group_name, r.status, r.home_score, r.away_score]
        );
      }
    },
    async getFinishedUnscored() {
      const { rows } = await pool.query(
        `select id, home_score, away_score from public.matches
         where status = 'FINISHED' and scored = false
           and home_score is not null and away_score is not null`
      );
      return rows;
    },
    async getPredictionsForMatch(matchId: number) {
      const { rows } = await pool.query(
        `select id, pred_home, pred_away from public.predictions where match_id = $1`,
        [matchId]
      );
      return rows;
    },
    async setPredictionPoints(updates) {
      for (const u of updates) {
        await pool.query(`update public.predictions set points = $1 where id = $2`, [u.points, u.id]);
      }
    },
    async markScored(matchId: number) {
      await pool.query(`update public.matches set scored = true where id = $1`, [matchId]);
    },
  };
}

describe('sync scoring + idempotency', () => {
  it('scores 3/2/1 correctly and never doubles on a second run', async () => {
    // Locked predictions on finished match 104 (real result 2-1), written by
    // the service role (bypasses RLS) exactly like production.
    await pool.query(
      `insert into public.predictions (user_id, match_id, pred_home, pred_away) values
         ($1, 104, 2, 1),  -- Ana: exact -> 3
         ($2, 104, 3, 0)   -- Beto: right outcome -> 2
       on conflict (user_id, match_id) do nothing`,
      [U1, U2]
    );

    const db = pgSyncDb();
    const fixtures: FixtureRow[] = []; // fetch step not under test here

    const first = await runSync(db, async () => fixtures);
    expect(first.matchesScored).toBe(1);
    expect(first.predictionsScored).toBe(2);

    const points = async () => {
      const { rows } = await pool.query(
        `select user_id, points from public.predictions where match_id = 104 order by user_id`
      );
      return rows;
    };

    expect(await points()).toEqual([
      { user_id: U1, points: 3 },
      { user_id: U2, points: 2 },
    ]);

    // Second run: nothing to score, points unchanged.
    const second = await runSync(db, async () => fixtures);
    expect(second.matchesScored).toBe(0);
    expect(second.predictionsScored).toBe(0);
    expect(await points()).toEqual([
      { user_id: U1, points: 3 },
      { user_id: U2, points: 2 },
    ]);

    // Re-upserting the same finished fixture must NOT reset the scored flag.
    await db.upsertMatches([
      {
        id: 104,
        home_team: 'Spain',
        away_team: 'Argentina',
        home_code: 'ESP',
        away_code: 'ARG',
        kickoff: new Date(Date.now() - 3 * 3600_000).toISOString(),
        stage: 'GROUP_STAGE',
        group_name: 'Group X',
        status: 'FINISHED',
        home_score: 2,
        away_score: 1,
        venue: null,
      },
    ]);
    const third = await runSync(db, async () => fixtures);
    expect(third.matchesScored).toBe(0);
    expect(await points()).toEqual([
      { user_id: U1, points: 3 },
      { user_id: U2, points: 2 },
    ]);
  });

  it('standings view: 1-point case and 0-point (no row) case land correctly', async () => {
    // Match 105: real result 0-2. Ana predicts wrong outcome (1 pt);
    // Beto makes no prediction (0 pts, no row).
    await pool.query(`
      insert into public.matches (id, home_team, away_team, kickoff, status, home_score, away_score)
      values (105, 'Brazil', 'Germany', now() - interval '2 hours', 'FINISHED', 0, 2)
      on conflict (id) do nothing
    `);
    await pool.query(
      `insert into public.predictions (user_id, match_id, pred_home, pred_away)
       values ($1, 105, 2, 0) on conflict (user_id, match_id) do nothing`,
      [U1]
    );

    await runSync(pgSyncDb(), async () => []);

    const standings = await asUser(U1, (c) =>
      c.query(`select display_name, total, games_scored from public.standings order by total desc`)
    );
    // Ana: 3 (exact) + 1 (wrong outcome) = 4 over 2 scored games.
    // Beto: 2 (outcome) over 1 scored game; no row for 105 -> contributes 0.
    expect(standings.rows).toEqual([
      { display_name: 'Ana', total: 4, games_scored: 2 },
      { display_name: 'Beto', total: 2, games_scored: 1 },
    ]);
  });
});
