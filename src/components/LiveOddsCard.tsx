'use client';

import Flag from './Flag';
import { useMarketEntry } from './MarketOdds';
import { pct } from '@/lib/ml/model';

export interface LiveOddsMatch {
  homeCode: string;
  awayCode: string;
  homeName: string;
  awayName: string;
  stage: string;
  live: boolean;
}

function fmtVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default function LiveOddsCard({ match }: { match: LiveOddsMatch }) {
  const entry = useMarketEntry(match.homeCode, match.awayCode);

  return (
    <div className="live-odds-card">
      <div className="live-odds-teams">
        <div className="live-odds-team">
          <Flag code={match.homeCode} name={match.homeName} />
          <span>{match.homeName}</span>
        </div>
        <span className="live-odds-vs">{match.live ? 'LIVE' : 'vs'}</span>
        <div className="live-odds-team right">
          <span>{match.awayName}</span>
          <Flag code={match.awayCode} name={match.awayName} />
        </div>
      </div>
      <div className="live-odds-stage">{match.stage}</div>

      {entry ? (
        <>
          <div className="odds-bar">
            <span className="odds-seg odds-seg-h" style={{ width: `${entry.probHome * 100}%` }} />
            <span className="odds-seg odds-seg-d" style={{ width: `${entry.probDraw * 100}%` }} />
            <span className="odds-seg odds-seg-a" style={{ width: `${entry.probAway * 100}%` }} />
          </div>

          <div className="odds-legend">
            <div className="odds-legend-item">
              <span className="odds-dot odds-dot-h" />
              <span className="odds-legend-name">{match.homeName}</span>
              <span className="odds-legend-pct">{pct(entry.probHome)}</span>
            </div>
            <div className="odds-legend-item">
              <span className="odds-dot odds-dot-d" />
              <span className="odds-legend-name">Draw</span>
              <span className="odds-legend-pct">{pct(entry.probDraw)}</span>
            </div>
            <div className="odds-legend-item">
              <span className="odds-dot odds-dot-a" />
              <span className="odds-legend-name">{match.awayName}</span>
              <span className="odds-legend-pct">{pct(entry.probAway)}</span>
            </div>
          </div>

          <p className="live-odds-foot">
            {fmtVolume(entry.volume24hr)} traded in the last 24h on Polymarket. Live, real-money
            bets — not a prediction, just what the market is paying right now. Updates every 20s.
          </p>
        </>
      ) : (
        <p className="live-odds-foot live-odds-empty">
          Polymarket hasn&apos;t listed a market for this match yet — check back closer to kickoff.
        </p>
      )}
    </div>
  );
}
