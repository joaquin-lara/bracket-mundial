import Link from 'next/link';
import Flag from '@/components/Flag';
import GlobeBackdrop from '@/components/GlobeBackdrop';
import { PLAYER_META, PLAYERS } from '@/lib/players';
import { createClient } from '@/lib/supabase/server';
import { stageLabel, type Match } from '@/lib/types';

export const revalidate = 60; // cache for 1 minute

export default async function HomePage() {
  const supabase = createClient();

  const { data } = await supabase.from('standings').select('display_name, total');
  const totals = new Map<string, number>(
    (data ?? []).map((r) => [r.display_name as string, r.total as number])
  );

  // Today's games feed the globe dots.
  const from = new Date(Date.now() - 8 * 3600_000).toISOString();
  const to = new Date(Date.now() + 24 * 3600_000).toISOString();
  const { data: todayMatches } = await supabase
    .from('matches')
    .select('*')
    .gte('kickoff', from)
    .lte('kickoff', to)
    .order('kickoff', { ascending: true });

  return (
    <div className="home-pitch">
      <section className="hero">
        <GlobeBackdrop matches={(todayMatches ?? []) as Match[]} />

        <div className="hero-content">
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
            <Link href="/matches" className="btn-gold">
              Edit your bracket →
            </Link>
            <Link href="/standings" className="btn-ghost">
              Player standings
            </Link>
          </div>
        </div>
      </section>

      {(todayMatches ?? []).length > 0 && (
        <section className="today-games">
          <div className="contenders-head">
            <span className="contenders-label">Today&apos;s Games</span>
            <div className="contenders-line" />
          </div>
          <div className="sched-card">
            {(todayMatches as Match[]).map((m) => {
              const finished = m.status === 'FINISHED';
              const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
              const time = new Date(m.kickoff).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
              return (
                <div className="sched-row" key={m.id}>
                  <span className="sched-time">{time}</span>
                  <span className="sched-team home">
                    <span className="sched-name">{m.home_team}</span>
                    <Flag code={m.home_code} name={m.home_team} />
                  </span>
                  <span className={`sched-mid${live ? ' live' : ''}`}>
                    {finished || live ? `${m.home_score ?? ''} – ${m.away_score ?? ''}` : 'vs'}
                  </span>
                  <span className="sched-team">
                    <Flag code={m.away_code} name={m.away_team} />
                    <span className="sched-name">{m.away_team}</span>
                  </span>
                  <span className="sched-stage">
                    {live ? <span className="badge-live">LIVE</span> : finished ? <>FT · {stageLabel(m.stage, m.group_name)}</> : stageLabel(m.stage, m.group_name)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
