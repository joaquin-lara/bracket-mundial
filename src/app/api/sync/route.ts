import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { fetchFixtures, type FixtureRow } from '@/lib/footballData';
import { runSync, type SyncDb } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // bypasses RLS; server only
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const db: SyncDb = {
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

  try {
    const result = await runSync(db, fetchFixtures);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
