import type { Metadata } from 'next';
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
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from('standings').select('*');
  const rows = (data ?? []) as StandingRow[];

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
                  {i === 0 ? ' 🏆' : ''}
                </td>
                <td className="num pts">{r.total}</td>
                <td className="num">{r.games_scored}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
