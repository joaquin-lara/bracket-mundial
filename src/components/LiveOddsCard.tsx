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
        <span className="live-odds-team home">
          <span className="live-odds-name">{match.homeName}</span>
          <Flag code={match.homeCode} name={match.homeName} />
        </span>
        <span className={`live-odds-vs${match.live ? ' live' : ''}`}>
          {match.live ? 'LIVE' : 'vs'}
        </span>
        <span className="live-odds-team">
          <Flag code={match.awayCode} name={match.awayName} />
          <span className="live-odds-name">{match.awayName}</span>
        </span>
      </div>
      <div className="live-odds-stage">{match.stage}</div>

      {entry ? (
        <>
          <div className="odds-prob-head">
            <span className="odds-prob-item">
              {match.homeName} win
              <strong>{pct(entry.probHome)}</strong>
            </span>
            <span className="odds-prob-item odds-prob-center">
              Draw
              <strong>{pct(entry.probDraw)}</strong>
            </span>
            <span className="odds-prob-item odds-prob-right">
              {match.awayName} win
              <strong>{pct(entry.probAway)}</strong>
            </span>
          </div>
          <div className="odds-bar">
            <span className="odds-seg odds-seg-h" style={{ width: `${entry.probHome * 100}%` }} />
            <span className="odds-seg odds-seg-d" style={{ width: `${entry.probDraw * 100}%` }} />
            <span className="odds-seg odds-seg-a" style={{ width: `${entry.probAway * 100}%` }} />
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
