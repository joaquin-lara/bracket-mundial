import type { Metadata } from 'next';
import PickHeatmap, { type HeatColumn, type HeatRow } from '@/components/PickHeatmap';
import RaceChart, { type RacePoint } from '@/components/RaceChart';
import RecapCard from '@/components/RecapCard';
import { ensureFreshScores } from '@/lib/autoSync';
import { buildRecap, type RecapInput, type RecapAchievement, type RecapDuel } from '@/lib/recap';
import { createClient } from '@/lib/supabase/server';
import { predict } from '@/lib/ml/model';
import { ACHIEVEMENTS_BY_ID } from '@/lib/achievementsList';
import { GUEST_NAME } from '@/lib/players';

export const metadata: Metadata = { title: 'Player Standings' };
export const dynamic = 'force-dynamic';

interface StandingRow {
  user_id: string;
  display_name: string;
  total: number;
  games_scored: number;
}

/** True if the side the model favored did NOT win (an upset). */
function underdogWon(
  homeCode: string | null,
  awayCode: string | null,
  hs: number | null,
  as_: number | null
): boolean {
  if (homeCode == null || awayCode == null || hs == null || as_ == null || hs === as_) return false;
  const r = predict({ home: homeCode, away: awayCode, neutral: true });
  if (!r) return false;
  const favIsHome = r.probHome >= r.probAway;
  const homeWon = hs > as_;
  return favIsHome ? !homeWon : homeWon;
}

export default async function StandingsPage() {
  await ensureFreshScores();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from('standings').select('*');
  // The shared guest account is view-only and never competes.
  const rows = ((data ?? []) as StandingRow[]).filter((r) => r.display_name !== GUEST_NAME);

  // Scored predictions (visible to everyone post-kickoff) + kickoff dates
  // feed the points race chart.
  const { data: scored } = await supabase
    .from('predictions')
    .select(
      'points, user_id, match_id, pred_home, pred_away, matches(kickoff, home_code, away_code, home_score, away_score)'
    )
    .not('points', 'is', null);
  const { data: profiles } = await supabase.from('profiles').select('id, display_name');
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));

  type ScoredMatch = {
    kickoff: string;
    home_code: string | null;
    away_code: string | null;
    home_score: number | null;
    away_score: number | null;
  };

  const raceEntries: RacePoint[] = (scored ?? [])
    .map((p) => {
      const match = p.matches as unknown as ScoredMatch | null;
      return {
        name: nameById.get(p.user_id as string) ?? 'Unknown',
        kickoff: match?.kickoff ?? '',
        points: (p.points as number) ?? 0,
      };
    })
    .filter((e) => e.kickoff !== '');

  // Match-day recap from the same scored rows.
  const recapInput: RecapInput[] = (scored ?? [])
    .map((p) => {
      const m = p.matches as unknown as ScoredMatch | null;
      if (!m?.kickoff) return null;
      return {
        name: nameById.get(p.user_id as string) ?? 'Unknown',
        kickoff: m.kickoff,
        points: (p.points as number) ?? 0,
        exact:
          m.home_score != null &&
          m.away_score != null &&
          (p.pred_home as number) === m.home_score &&
          (p.pred_away as number) === m.away_score,
        upset: underdogWon(m.home_code, m.away_code, m.home_score, m.away_score),
        homeCode: m.home_code,
        awayCode: m.away_code,
        homeScore: m.home_score,
        awayScore: m.away_score,
      };
    })
    .filter((e): e is RecapInput => e !== null);

  // Recap extras: badge unlocks (only once achievements are revealed) + duels.
  const { data: achState } = await supabase
    .from('achievements_state')
    .select('revealed_at')
    .eq('id', 1)
    .maybeSingle();

  let recapAchievements: RecapAchievement[] = [];
  if (achState?.revealed_at) {
    const { data: achRows } = await supabase
      .from('user_achievements')
      .select('user_id, achievement_id, earned_at, baseline')
      .eq('baseline', false);
    recapAchievements = (achRows ?? [])
      .map((a) => {
        const def = ACHIEVEMENTS_BY_ID[a.achievement_id as string];
        const player = nameById.get(a.user_id as string);
        if (!def || !player) return null;
        return { player, name: def.name, emoji: def.emoji, at: a.earned_at as string };
      })
      .filter((a): a is RecapAchievement => a !== null);
  }

  const { data: duelRows } = await supabase
    .from('duels')
    .select('challenger, opponent, winner, challenger_score, opponent_score, updated_at')
    .eq('status', 'finished');
  const recapDuels: RecapDuel[] = (duelRows ?? [])
    .map((d) => {
      const winner = nameById.get(d.winner as string);
      const loserId = d.winner === d.challenger ? d.opponent : d.challenger;
      const loser = nameById.get(loserId as string);
      if (!winner || !loser) return null;
      const winnerScore = (d.winner === d.challenger ? d.challenger_score : d.opponent_score) as number;
      const loserScore = (d.winner === d.challenger ? d.opponent_score : d.challenger_score) as number;
      return { winner, loser, winnerScore, loserScore, at: d.updated_at as string };
    })
    .filter((d): d is RecapDuel => d !== null);

  const recap = buildRecap(recapInput, { achievements: recapAchievements, duels: recapDuels });

  // Pick wall: one column per finished match, one row per player.
  const { data: finished } = await supabase
    .from('matches')
    .select('id, home_code, away_code, home_score, away_score, kickoff')
    .eq('status', 'FINISHED')
    .order('kickoff', { ascending: true });

  const heatColumns: HeatColumn[] = (finished ?? []).map((m) => {
    const day = new Date(m.kickoff as string).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    return {
      id: m.id as number,
      title: `${m.home_code ?? 'TBD'} ${m.home_score}–${m.away_score} ${m.away_code ?? 'TBD'} · ${day}`,
    };
  });

  const pointsByUserMatch = new Map<string, number>();
  for (const p of scored ?? []) {
    pointsByUserMatch.set(`${p.user_id}|${p.match_id}`, (p.points as number) ?? 0);
  }

  const heatRows: HeatRow[] = rows.map((r) => ({
    name: r.display_name,
    cells: (finished ?? []).map((m) => pointsByUserMatch.get(`${r.user_id}|${m.id}`) ?? null),
  }));

  return (
    <main>
      <h1>Player Standings</h1>
      <p className="subtitle">3 exact score · 2 right outcome · 1 wrong outcome · 0 no pick</p>
      {rows.length === 0 ? (
        <p className="empty">No players yet.</p>
      ) : (
        <table className="standings">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th className="num">Points</th>
              <th className="num">Scored games</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.user_id} className={r.user_id === user.id ? 'me' : ''}>
                <td>
                  <span className={`rank-chip rank-${i + 1}`}>{i + 1}</span>
                </td>
                <td>
                  {r.display_name}
                  {i === 0 ? ' 🏆' : i === rows.length - 1 && rows.length === 4 ? ' 💩' : ''}
                </td>
                <td className="num pts">{r.total}</td>
                <td className="num">{r.games_scored}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <RecapCard recap={recap} />

      <RaceChart entries={raceEntries} />

      <PickHeatmap columns={heatColumns} rows={heatRows} />
    </main>
  );
}
