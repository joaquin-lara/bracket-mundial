import type { Metadata } from 'next';
import PickHeatmap, { type HeatColumn, type HeatRow } from '@/components/PickHeatmap';
import RaceChart, { type RacePoint } from '@/components/RaceChart';
import { ensureFreshScores } from '@/lib/autoSync';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Player Standings' };
export const dynamic = 'force-dynamic';

interface StandingRow {
  user_id: string;
  display_name: string;
  total: number;
  games_scored: number;
}

export default async function StandingsPage() {
  await ensureFreshScores();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from('standings').select('*');
  const rows = (data ?? []) as StandingRow[];

  // Scored predictions (visible to everyone post-kickoff) + kickoff dates
  // feed the points race chart.
  const { data: scored } = await supabase
    .from('predictions')
    .select('points, user_id, match_id, matches(kickoff)')
    .not('points', 'is', null);
  const { data: profiles } = await supabase.from('profiles').select('id, display_name');
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));

  const raceEntries: RacePoint[] = (scored ?? [])
    .map((p) => {
      const match = p.matches as unknown as { kickoff: string } | null;
      return {
        name: nameById.get(p.user_id as string) ?? 'Unknown',
        kickoff: match?.kickoff ?? '',
        points: (p.points as number) ?? 0,
      };
    })
    .filter((e) => e.kickoff !== '');

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

      <RaceChart entries={raceEntries} />

      <PickHeatmap columns={heatColumns} rows={heatRows} />
    </main>
  );
}
