import Link from 'next/link';
import { PLAYER_META, PLAYERS } from '@/lib/players';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = createClient();
  const { data } = await supabase.from('standings').select('display_name, total');
  const totals = new Map<string, number>(
    (data ?? []).map((r) => [r.display_name as string, r.total as number])
  );

  return (
    <div>
      <section className="hero">
        <div className="pill">
          <span className="pill-dot" />
          <span>World Cup 2026 · USA · Canada · Mexico</span>
        </div>

        <h1 className="hero-title">
          Stonks
          <br />
          Bracket.
        </h1>

        <p className="hero-tag">El que sale último es el más pendejo.</p>

        <div className="cta-row">
          <Link href="/today" className="btn-gold">
            Fill out my bracket →
          </Link>
          <Link href="/standings" className="btn-ghost">
            View live standings
          </Link>
        </div>
      </section>

      <section className="contenders">
        <div className="contenders-head">
          <span className="contenders-label">The Contenders</span>
          <div className="contenders-line" />
        </div>

        <div className="contender-grid">
          {PLAYERS.map((name) => (
            <div className="contender-card" key={name}>
              <div className="contender-avatar" style={{ background: PLAYER_META[name].color }}>
                {PLAYER_META[name].initial}
              </div>
              <div className="contender-name">{name}</div>
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
