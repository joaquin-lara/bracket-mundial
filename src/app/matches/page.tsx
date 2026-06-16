import type { Metadata } from 'next';
import MatchList from '@/components/MatchList';
import { ensureFreshScores } from '@/lib/autoSync';
import { createClient } from '@/lib/supabase/server';
import { isGuestEmail } from '@/lib/players';
import type { Match, Prediction, RevealedPick } from '@/lib/types';

export const metadata: Metadata = { title: 'Your bracket' };
export const dynamic = 'force-dynamic';

export default async function EnterBracketPage() {
  await ensureFreshScores();
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
  const revealedPicks: Record<number, RevealedPick[]> = {};

  if (matchList.length > 0) {
    // RLS filters automatically: own rows always; others' only after kickoff.
    const { data: preds } = await supabase
      .from('predictions')
      .select('id, match_id, pred_home, pred_away, points, user_id');

    const userIds = [...new Set((preds ?? []).map((p) => p.user_id as string))];
    const { data: profiles } = userIds.length
      ? await supabase.from('profiles').select('id, display_name').in('id', userIds)
      : { data: [] };
    const nameById = new Map(
      (profiles ?? []).map((p) => [p.id as string, p.display_name as string])
    );

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

  const guest = isGuestEmail(user.email);

  return (
    <main>
      <h1>{guest ? 'The bracket' : 'Your bracket'}</h1>
      {guest ? (
        <p className="page-intro">
          You&apos;re browsing as a <strong>guest</strong>. Every fixture is here to look through,
          and after kickoff you can see how each player&apos;s picks compared. To fill out your own
          bracket, sign out and sign in as a player.
        </p>
      ) : (
        <p className="page-intro">
          Every match in the tournament, ready for your picks. Type the <strong>final score</strong>{' '}
          you expect and hit <strong>Save</strong>; edit as often as you like until{' '}
          <strong>10 minutes before kickoff</strong>. Switch to <strong>Past</strong> to see how
          everyone&apos;s picks compared to the real results.
        </p>
      )}
      {matchList.length === 0 ? (
        <p className="empty">
          No fixtures yet. They appear after the first sync runs (see README step 5).
        </p>
      ) : (
        <MatchList
          matches={matchList}
          predictions={predictions}
          revealedPicks={revealedPicks}
          split
          readOnly={guest}
        />
      )}
    </main>
  );
}
