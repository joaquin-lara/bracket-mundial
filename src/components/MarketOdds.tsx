'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { pct } from '@/lib/ml/model';

interface MarketEntry {
  probByCode: Record<string, number>;
  probDraw: number;
  volume24hr: number;
}

type MarketMap = Record<string, MarketEntry>;

const MarketOddsContext = createContext<MarketMap>({});

const POLL_MS = 20_000;

/**
 * Polls our own /api/market-odds (cached server-side, see src/lib/polymarket.ts)
 * every 20s and hands the snapshot to any <MarketOddsRow> below it. One poll
 * per page regardless of how many fixtures render a row.
 */
export function MarketOddsProvider({ children }: { children: React.ReactNode }) {
  const [odds, setOdds] = useState<MarketMap>({});

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/market-odds');
        const json = await res.json();
        if (!cancelled) setOdds(json.odds ?? {});
      } catch {
        // Keep the last good snapshot on a transient fetch failure.
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return <MarketOddsContext.Provider value={odds}>{children}</MarketOddsContext.Provider>;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export interface MarketEntryView {
  probHome: number;
  probDraw: number;
  probAway: number;
  volume24hr: number;
}

/** This fixture's live Polymarket odds, oriented to (home, away), or null if untraded. */
export function useMarketEntry(home: string, away: string): MarketEntryView | null {
  const odds = useContext(MarketOddsContext);
  const entry = odds[pairKey(home, away)];
  if (!entry) return null;
  const probHome = entry.probByCode[home];
  const probAway = entry.probByCode[away];
  if (probHome == null || probAway == null) return null;
  return { probHome, probDraw: entry.probDraw, probAway, volume24hr: entry.volume24hr };
}

/** Polymarket's live win/draw/win for one fixture, or nothing if untraded. */
export function MarketOddsRow({ home, away }: { home: string; away: string }) {
  const entry = useMarketEntry(home, away);
  if (!entry) return null;
  const { probHome, probDraw, probAway } = entry;

  return (
    <div className="ml-market-row">
      <span className="ml-market-tag">Market</span>
      <div className="ml-bar ml-bar-sm">
        <span className="ml-bar-h" style={{ width: `${probHome * 100}%` }} />
        <span className="ml-bar-d" style={{ width: `${probDraw * 100}%` }} />
        <span className="ml-bar-a" style={{ width: `${probAway * 100}%` }} />
      </div>
      <div className="ml-fix-probs ml-market-probs">
        <span>{pct(probHome)}</span>
        <span className="ml-fix-draw">{pct(probDraw)}</span>
        <span>{pct(probAway)}</span>
      </div>
    </div>
  );
}
