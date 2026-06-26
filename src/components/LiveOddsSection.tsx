'use client';

import LiveOddsCard from './LiveOddsCard';
import { MarketOddsProvider } from './MarketOdds';
import { lookup } from '@/lib/ml/teams';
import { stageLabel, type Match } from '@/lib/types';

/**
 * Client-side (not server) "today" filter, same as TodayGames: kickoff dates
 * are compared in the viewer's local timezone, which the server doesn't know.
 */
export default function LiveOddsSection({ matches }: { matches: Match[] }) {
  const localToday = new Date().toLocaleDateString('en-CA');
  const todays = matches.filter(
    (m) =>
      new Date(m.kickoff).toLocaleDateString('en-CA') === localToday &&
      // Once a match is over, drop it from Live Odds — the market is settled and
      // no longer reflects a live, tradeable probability.
      m.status !== 'FINISHED'
  );

  const rateable = todays
    .map((m) => {
      const home = lookup(m.home_code);
      const away = lookup(m.away_code);
      return home && away ? { m, homeCode: home.code, awayCode: away.code } : null;
    })
    .filter((x): x is { m: Match; homeCode: string; awayCode: string } => x !== null);

  if (rateable.length === 0) return null;

  return (
    <section className="live-odds">
      <div className="contenders-head">
        <span className="contenders-label live-odds-label">
          <span className="pill-dot live-odds-dot" />
          Live Odds · Polymarket
        </span>
        <div className="contenders-line" />
      </div>

      <MarketOddsProvider>
        <div className="live-odds-grid">
          {rateable.map(({ m, homeCode, awayCode }) => (
            <LiveOddsCard
              key={m.id}
              match={{
                homeCode,
                awayCode,
                homeName: m.home_team,
                awayName: m.away_team,
                stage: stageLabel(m.stage, m.group_name),
                live: m.status === 'IN_PLAY' || m.status === 'PAUSED',
              }}
            />
          ))}
        </div>
      </MarketOddsProvider>
    </section>
  );
}
