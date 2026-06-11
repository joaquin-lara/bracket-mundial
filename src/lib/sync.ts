// Sync core, independent of Supabase so it can be integration-tested
// against a plain Postgres database. The route handler and the tests each
// supply a SyncDb implementation.

import { scorePrediction } from './scoring';
import type { FixtureRow } from './footballData';

export interface PredictionRow {
  id: string;
  pred_home: number;
  pred_away: number;
}

export interface FinishedMatch {
  id: number;
  home_score: number;
  away_score: number;
}

export interface SyncDb {
  upsertMatches(rows: FixtureRow[]): Promise<void>;
  /** Matches with status FINISHED, non-null scores, and scored = false. */
  getFinishedUnscored(): Promise<FinishedMatch[]>;
  getPredictionsForMatch(matchId: number): Promise<PredictionRow[]>;
  setPredictionPoints(updates: { id: string; points: number }[]): Promise<void>;
  markScored(matchId: number): Promise<void>;
}

export interface SyncResult {
  fixturesUpserted: number;
  matchesScored: number;
  predictionsScored: number;
}

/**
 * Idempotent by construction:
 *  - matches are upserted on their stable id, so re-runs update in place;
 *  - points are SET to an absolute value (never incremented), so even a
 *    crash between setPredictionPoints and markScored just rewrites the
 *    same values on the next run;
 *  - the `scored` flag stops a finished match from being processed again.
 */
export async function runSync(db: SyncDb, fetchFixtures: () => Promise<FixtureRow[]>): Promise<SyncResult> {
  const fixtures = await fetchFixtures();
  await db.upsertMatches(fixtures);

  const toScore = await db.getFinishedUnscored();
  let predictionsScored = 0;

  for (const match of toScore) {
    const predictions = await db.getPredictionsForMatch(match.id);
    const updates = predictions.map((p) => ({
      id: p.id,
      points: scorePrediction(p.pred_home, p.pred_away, match.home_score, match.away_score),
    }));
    if (updates.length > 0) {
      await db.setPredictionPoints(updates);
    }
    await db.markScored(match.id);
    predictionsScored += updates.length;
  }

  return {
    fixturesUpserted: fixtures.length,
    matchesScored: toScore.length,
    predictionsScored,
  };
}
