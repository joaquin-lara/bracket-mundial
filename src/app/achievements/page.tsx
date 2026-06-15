import type { Metadata } from 'next';
import AchievementsBoard, { type BoardEarner, type BoardPlayer } from '@/components/AchievementsBoard';
import { ensureFreshScores } from '@/lib/autoSync';
import { ensureAchievements } from '@/lib/achievementsSync';
import { createClient } from '@/lib/supabase/server';
import { GUEST_NAME, PLAYERS, isAchievementsPreviewUser } from '@/lib/players';

export const metadata: Metadata = { title: 'Achievements' };
export const dynamic = 'force-dynamic';

interface EarnRow {
  user_id: string;
  achievement_id: string;
  earned_at: string;
  match_id: number | null;
}

export default async function AchievementsPage() {
  await ensureFreshScores();
  await ensureAchievements();

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: state } = await supabase
    .from('achievements_state')
    .select('revealed_at')
    .eq('id', 1)
    .maybeSingle();
  const revealed = !!state?.revealed_at || isAchievementsPreviewUser(user.email);

  if (!revealed) {
    return (
      <main>
        <h1>Achievements</h1>
        <p className="subtitle">A secret for now.</p>
        <div className="page-intro">
          There&apos;s a hidden layer of badges waiting in the bracket. The whole thing stays
          locked until the first one is earned — then it reveals itself to everyone at once. Keep
          predicting. 👀
        </div>
      </main>
    );
  }

  const [{ data: rows }, { data: profiles }, { data: matchRows }] = await Promise.all([
    supabase.from('user_achievements').select('user_id, achievement_id, earned_at, match_id'),
    supabase.from('profiles').select('id, display_name'),
    supabase.from('matches').select('id, home_code, away_code, home_score, away_score, kickoff'),
  ]);

  const nameById = new Map<string, string>(
    (profiles ?? [])
      .filter((p) => p.display_name !== GUEST_NAME)
      .map((p) => [p.id as string, p.display_name as string])
  );

  // matchId -> "ESP 2–1 ARG · Jun 14"
  const matchLabel = new Map<number, string>();
  for (const m of matchRows ?? []) {
    const date = new Date(m.kickoff as string).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    const score = m.home_score != null && m.away_score != null ? `${m.home_score}–${m.away_score}` : 'vs';
    matchLabel.set(
      m.id as number,
      `${m.home_code ?? 'TBD'} ${score} ${m.away_code ?? 'TBD'} · ${date}`
    );
  }

  // achievement id -> earners (competitors only)
  const earners: Record<string, BoardEarner[]> = {};
  for (const r of (rows ?? []) as EarnRow[]) {
    const name = nameById.get(r.user_id);
    if (!name) continue;
    const fromMatch = r.match_id != null ? matchLabel.get(r.match_id) : undefined;
    const detail =
      fromMatch ??
      new Date(r.earned_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    if (!earners[r.achievement_id]) earners[r.achievement_id] = [];
    earners[r.achievement_id].push({ userId: r.user_id, name, detail });
  }

  // Players in the fixed roster order, only those with a profile.
  const idByName = new Map<string, string>();
  for (const [id, name] of nameById) idByName.set(name, id);
  const players: BoardPlayer[] = PLAYERS.filter((n) => idByName.has(n)).map((n) => ({
    userId: idByName.get(n)!,
    name: n,
  }));

  return (
    <main>
      <h1>Achievements</h1>
      <p className="subtitle">Switch players, sort, and filter. Tap a player to see their progress.</p>
      <AchievementsBoard earners={earners} players={players} meId={user.id} />
    </main>
  );
}
