import type { SupabaseClient } from '@supabase/supabase-js';
import type { FixtureRow } from './footballData';
import type { SyncDb } from './sync';

/** SyncDb implementation backed by a service-role Supabase client. */
export function makeSupabaseSyncDb(admin: SupabaseClient): SyncDb {
  return {
    async upsertMatches(rows: FixtureRow[]) {
      if (rows.length === 0) return;
      // `scored` is intentionally absent from the payload so re-syncs
      // never reset the idempotency flag.
      const { error } = await admin
        .from('matches')
        .upsert(
          rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
          { onConflict: 'id' }
        );
      if (error) throw new Error(`upsertMatches: ${error.message}`);
    },

    async getFinishedUnscored() {
      const { data, error } = await admin
        .from('matches')
        .select('id, home_score, away_score')
        .eq('status', 'FINISHED')
        .eq('scored', false)
        .not('home_score', 'is', null)
        .not('away_score', 'is', null);
      if (error) throw new Error(`getFinishedUnscored: ${error.message}`);
      return data ?? [];
    },

    async getPredictionsForMatch(matchId: number) {
      const { data, error } = await admin
        .from('predictions')
        .select('id, pred_home, pred_away')
        .eq('match_id', matchId);
      if (error) throw new Error(`getPredictionsForMatch: ${error.message}`);
      return data ?? [];
    },

    async setPredictionPoints(updates) {
      for (const u of updates) {
        const { error } = await admin
          .from('predictions')
          .update({ points: u.points })
          .eq('id', u.id);
        if (error) throw new Error(`setPredictionPoints: ${error.message}`);
      }
    },

    async markScored(matchId: number) {
      const { error } = await admin
        .from('matches')
        .update({ scored: true })
        .eq('id', matchId);
      if (error) throw new Error(`markScored: ${error.message}`);
    },
  };
}
