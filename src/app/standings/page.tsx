import type { Metadata } from 'next';
import PickHeatmap, { type HeatColumn, type HeatRow } from '@/components/PickHeatmap';
import RaceChart, { type RacePoint } from '@/components/RaceChart';
import RecapCard from '@/components/RecapCard';
import { ensureFreshScores } from '@/lib/autoSync';
import { buildRecap, type RecapInput } from '@/lib/recap';
import { createClient } from '@/lib/supabase/server';
import { ensureAchievements } from '@/lib/achievementsSync';
import { ACHIEVEMENTS_BY_ID, TIER_ORDER } from '@/lib/achievementsList';
import { GUEST_NAME, isAchievementsPreviewUser } from '@/lib/players';

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
  await ensureAchievements();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from('standings').select('*');
  // The shared guest account is view-only and never competes.
  const rows = ((data ?? []) as StandingRow[]).filter((r) => r.display_name !== GUEST_NAME);

  // Earned badges (only once the achievements feature has revealed itself).
  const { data: achState } = await supabase
    .from('achievements_state')
    .select('revealed_at')
    .eq('id', 1)
    .maybeSingle();
  const achRevealed = !!achState?.revealed_at || isAchievementsPreviewUser(user.email);
  const badgesByUser = new Map<string, { emojis: string[]; count: number }>();
  if (achRevealed) {
    const { data: achRows } = await supabase
      .from('user_achievements')
      .select('user_id, achievement_id');
    const grouped = new Map<string, string[]>();
    for (const r of achRows ?? []) {
      const list = grouped.get(r.user_id as string) ?? [];
      list.push(r.achievement_id as string);
      grouped.set(r.user_id as string, list);
    }
    for (const [uid, ids] of grouped) {
      const defs = ids.map((id) => ACHIEVEMENTS_BY_ID[id]).filter(Boolean);
      const emojis = defs
        .slice()
        .sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier])
        .slice(0, 4)
        .map((a) => a.emoji);
      badgesByUser.set(uid, { emojis, count: defs.length });
    }
  }

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
        homeCode: m.home_code,
        awayCode: m.away_code,
        homeScore: m.home_score,
        awayScore: m.away_score,
      };
    })
    .filter((e): e is RecapInput => e !== null);
  const recap = buildRecap(recapInput);

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
                  {achRevealed && badgesByUser.get(r.user_id)?.count ? (
                    <span className="ach-badges" title={`${badgesByUser.get(r.user_id)!.count} achievements`}>
                      {badgesByUser.get(r.user_id)!.emojis.join(' ')}
                      {badgesByUser.get(r.user_id)!.count > 4 ? ` +${badgesByUser.get(r.user_id)!.count - 4}` : ''}
                    </span>
                  ) : null}
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
