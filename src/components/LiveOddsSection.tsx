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
  const now = Date.now();
  // A match can't still be running this long after kickoff (90' + half-time +
  // stoppage, plus extra time and penalties for knockouts ≈ 3h). Past that it
  // has ended, so drop it from Live Odds even if its stored status never
  // flipped to FINISHED — the market is settled, not a live price.
  const MATCH_OVER_MS = 3 * 60 * 60 * 1000;
  const todays = matches.filter((m) => {
    if (new Date(m.kickoff).toLocaleDateString('en-CA') !== localToday) return false;
    if (m.status === 'FINISHED') return false;
    if (now - new Date(m.kickoff).getTime() > MATCH_OVER_MS) return false;
    return true;
  });

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
