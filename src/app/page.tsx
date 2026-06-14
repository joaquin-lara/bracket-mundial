import Link from 'next/link';
import { flagUrl } from '@/lib/flags';
import GlobeBackdrop from '@/components/GlobeBackdrop';
import HomeIntro from '@/components/HomeIntro';
import PitchStripes from '@/components/PitchStripes';
import PresenceDot from '@/components/PresenceDot';
import TodayGames from '@/components/TodayGames';
import { PLAYER_META, PLAYERS } from '@/lib/players';
import { createClient } from '@/lib/supabase/server';
import type { Match } from '@/lib/types';

export const revalidate = 60; // cache for 1 minute

export default async function HomePage() {
  const supabase = createClient();

  const { data } = await supabase.from('standings').select('display_name, total');
  const totals = new Map<string, number>(
    (data ?? []).map((r) => [r.display_name as string, r.total as number])
  );

  const { data: profiles } = await supabase.from('profiles').select('id, display_name');
  const idByName = new Map(
    (profiles ?? []).map((p) => [p.display_name as string, p.id as string])
  );

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
              View/edit your bracket →
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
          {PLAYERS.map((name) => (
            <div className="contender-card" key={name}>
              <div className="contender-avatar" style={{ background: 'rgba(0,0,0,0.5)' }}>
                <img src={flagUrl(PLAYER_META[name].flagCode)!} alt={name} className="contender-flag" />
              </div>
              <div className="contender-name">
                {name}
                {idByName.has(name) && <PresenceDot userId={idByName.get(name)!} />}
              </div>
              <div className="contender-pts">
                {totals.has(name) ? `${totals.get(name)} pts` : 'unclaimed'}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
