import MatchList from '@/components/MatchList';
import { createClient } from '@/lib/supabase/server';
import type { Match, Prediction } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SchedulePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: matches } = await supabase
    .from('matches')
    .select('*')
    .order('kickoff', { ascending: true });

  const matchList = (matches ?? []) as Match[];

  const predictions: Record<number, Prediction> = {};
  if (matchList.length > 0) {
    const { data: preds } = await supabase
      .from('predictions')
      .select('id, match_id, pred_home, pred_away, points')
      .eq('user_id', user.id);
    for (const p of preds ?? []) {
      predictions[p.match_id as number] = p as unknown as Prediction;
    }
  }

  return (
    <main>
      <h1>Full schedule</h1>
      <p className="subtitle">Every fixture in the tournament. Predict any match that hasn&apos;t locked yet.</p>
      {matchList.length === 0 ? (
        <p className="empty">
          No fixtures yet. They appear after the first sync runs (see README step 5).
        </p>
      ) : (
        <MatchList matches={matchList} predictions={predictions} />
      )}
    </main>
  );
}
