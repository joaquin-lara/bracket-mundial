import Link from 'next/link';
import { flagUrl } from '@/lib/flags';
import GlobeBackdrop from '@/components/GlobeBackdrop';
import HomeIntro from '@/components/HomeIntro';
import PitchStripes from '@/components/PitchStripes';
import PresenceDot from '@/components/PresenceDot';
import TodayGames from '@/components/TodayGames';
import { GUEST_NAME, PLAYER_META, PLAYERS, isAdminEmail } from '@/lib/players';
import { ensureFreshScores } from '@/lib/autoSync';
import { signOut } from '@/app/actions';
import { createClient } from '@/lib/supabase/server';
import type { Match } from '@/lib/types';

export const revalidate = 60; // cache for 1 minute

export default async function HomePage() {
  await ensureFreshScores();
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from('standings').select('display_name, total');
  const totals = new Map<string, number>(
    (data ?? []).map((r) => [r.display_name as string, r.total as number])
  );

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, flag_code, color, status, founder_slot')
    .eq('status', 'approved');
  const approved = profiles ?? [];

  // Founders are matched by their stable slot (so a renamed founder still maps
  // to their roster card); everyone else is matched by their profile row.
  const bySlot = new Map(
    approved.filter((p) => p.founder_slot).map((p) => [p.founder_slot as string, p])
  );

  type Contender = { name: string; flagCode: string | null; color: string | null; userId?: string };
  const contenders: Contender[] = PLAYERS.map((slot) => {
    const prof = bySlot.get(slot);
    return {
      name: (prof?.display_name as string) ?? slot,
      flagCode: (prof?.flag_code as string | null) ?? PLAYER_META[slot].flagCode,
      color: (prof?.color as string | null) ?? PLAYER_META[slot].color,
      userId: prof?.id as string | undefined,
    };
  });
  for (const p of approved) {
    if (p.founder_slot || p.display_name === GUEST_NAME) continue;
    contenders.push({
      name: p.display_name as string,
      flagCode: (p.flag_code as string | null) ?? null,
      color: (p.color as string | null) ?? null,
      userId: p.id as string,
    });
  }

  // Admins see a banner when sign-ups are waiting.
  let pendingCount = 0;
  if (isAdminEmail(user?.email)) {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    pendingCount = count ?? 0;
  }

  // Fetch 2 days around now; client filters to local today.
  const from = new Date(Date.now() - 48 * 3600_000).toISOString();
  const to = new Date(Date.now() + 48 * 3600_000).toISOString();
  const { data: todayMatches } = await supabase
    .from('matches')
    .select('*')
    .gte('kickoff', from)
    .lte('kickoff', to)
    .order('kickoff', { ascending: true });

  return (
    <div className="home-pitch">
      <HomeIntro />
      <PitchStripes />
      {pendingCount > 0 && (
        <Link href="/admin" className="admin-banner">
          <span className="admin-banner-dot" />
          {pendingCount} sign-up{pendingCount === 1 ? '' : 's'} waiting for approval - review →
        </Link>
      )}
      <section className="hero">
        <GlobeBackdrop matches={(todayMatches ?? []) as Match[]} />

        <div className="hero-content">
          <div className="pill">
            <span className="pill-dot" />
            <span>World Cup 2026 · USA · Canada · Mexico</span>
          </div>

          <h1 className="hero-title">
            Stonks World
            <br />
            Cup Bracket.
          </h1>

          <p className="hero-tag">Predict the scores. Most points after the Final wins.</p>

          <div className="cta-row">
            <Link href="/matches" className="btn-gold">
              View your bracket →
            </Link>
            <Link href="/standings" className="btn-ghost">
              Player standings
            </Link>
          </div>
        </div>
      </section>

      <TodayGames matches={(todayMatches ?? []) as Match[]} />

      <section className="contenders">
        <div className="contenders-head">
          <span className="contenders-label">The Contenders</span>
          <div className="contenders-line" />
        </div>

        <div className="contender-grid">
          {contenders.map((c) => (
            <div className="contender-card" key={c.name}>
              <div className="contender-avatar" style={{ background: 'rgba(0, 0, 0, 0.6)' }}>
                {c.flagCode && flagUrl(c.flagCode) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={flagUrl(c.flagCode)!} alt={c.name} className="contender-flag" />
                ) : (
                  <span className="contender-initial">{c.name.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="contender-name">
                {c.name}
                {c.userId && <PresenceDot userId={c.userId} />}
              </div>
              <div className="contender-pts">
                {totals.has(c.name) ? `${totals.get(c.name)} pts` : 'unclaimed'}
              </div>
            </div>
          ))}
        </div>
      </section>

      {user && (
        <div className="signout-footer">
          <form action={signOut}>
            <button type="submit" className="btn-ghost">Sign out</button>
          </form>
        </div>
      )}
    </div>
  );
}
