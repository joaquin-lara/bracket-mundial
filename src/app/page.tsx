import MatchList from '@/components/MatchList';
import { createClient } from '@/lib/supabase/server';
import type { Match, Prediction, RevealedPick } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware redirects; this is just a type guard

  const from = new Date(Date.now() - 12 * 3600_000).toISOString();
  const to = new Date(Date.now() + 36 * 3600_000).toISOString();

  const { data: matches } = await supabase
    .from('matches')
    .select('*')
    .gte('kickoff', from)
    .lte('kickoff', to)
    .order('kickoff', { ascending: true });

  const matchList = (matches ?? []) as Match[];
  const matchIds = matchList.map((m) => m.id);

  const predictions: Record<number, Prediction> = {};
  const revealedPicks: Record<number, RevealedPick[]> = {};

  if (matchIds.length > 0) {
    const { data: preds } = await supabase
      .from('predictions')
      .select('id, match_id, pred_home, pred_away, points, user_id')
      .in('match_id', matchIds);

    // RLS already filters: own rows always; others' rows only after kickoff.
    const userIds = [...new Set((preds ?? []).map((p) => p.user_id as string))];
    const { data: profiles } = userIds.length
      ? await supabase.from('profiles').select('id, display_name').in('id', userIds)
      : { data: [] };
    const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));

    const startedIds = new Set(
      matchList.filter((m) => new Date(m.kickoff).getTime() <= Date.now()).map((m) => m.id)
    );

    for (const p of preds ?? []) {
      if (p.user_id === user.id) {
        predictions[p.match_id as number] = p as unknown as Prediction;
      }
      if (startedIds.has(p.match_id as number)) {
        (revealedPicks[p.match_id as number] ??= []).push({
          match_id: p.match_id as number,
          display_name: nameById.get(p.user_id as string) ?? 'Unknown',
          pred_home: p.pred_home as number,
          pred_away: p.pred_away as number,
          points: p.points as number | null,
        });
      }
    }
  }

  return (
    <main>
      <h1>Today&apos;s matches</h1>
      <p className="subtitle">
        Enter the final score you expect. You can edit until 10 minutes before kickoff.
      </p>
      {matchList.length === 0 ? (
        <p className="empty">No matches in the next day and a half. Check the full schedule.</p>
      ) : (
        <MatchList matches={matchList} predictions={predictions} revealedPicks={revealedPicks} />
      )}
    </main>
  );
}
