// Live "what the market thinks" odds for World Cup fixtures, sourced from
// Polymarket's public Gamma API. Each match is its own three-way event
// (home / draw / away), found by tag rather than by guessing a URL: their
// slugs encode 3-letter codes that don't reliably match ours (DR Congo is
// "cdr" there vs our "COD", and at least one slug -- Curaçao vs Côte
// d'Ivoire -- is stale and still reads "kor", South Korea's code, from an
// earlier qualification scenario). So team identity here is resolved from
// each outcome's name (the side of the market actually traded), not from
// the slug, via the same lookup() the rest of the app uses for football-data
// / openfootball name variants.
//
// Cached in-process for CACHE_MS: the predictor page is polled by every open
// browser tab, but this module talks to Polymarket at most once per window
// no matter how many tabs are open (see /api/market-odds).

import { lookup } from './ml/teams';

const GAMMA_EVENTS_URL =
  'https://gamma-api.polymarket.com/events?tag_slug=fifa-world-cup&closed=false&limit=100';

// Base match event, e.g. "fifwc-ecu-ger-2026-06-25" -- excludes the
// "-halftime-result", "-exact-score" and "-more-markets" siblings Polymarket
// lists alongside each match.
const MATCH_SLUG = /^fifwc-[a-z]{3}-[a-z]{3}-\d{4}-\d{2}-\d{2}$/;

export interface MarketOdds {
  /** Win probability for each side, keyed by our TLA code. */
  probByCode: Record<string, number>;
  probDraw: number;
  volume24hr: number;
  updatedAt: number;
}

interface GammaMarket {
  groupItemTitle?: string;
  question: string;
  outcomePrices: string; // JSON-encoded ["yesPrice", "noPrice"]
}

interface GammaEvent {
  slug: string;
  volume24hr?: number;
  markets: GammaMarket[];
}

/** Pair key independent of which side Polymarket calls "home". */
function pairKey(codeA: string, codeB: string): string {
  return [codeA, codeB].sort().join('|');
}

async function fetchFromPolymarket(): Promise<Map<string, MarketOdds>> {
  const res = await fetch(GAMMA_EVENTS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Polymarket Gamma API ${res.status}`);
  const events = (await res.json()) as GammaEvent[];

  const out = new Map<string, MarketOdds>();
  for (const ev of events) {
    if (!MATCH_SLUG.test(ev.slug)) continue;

    let probDraw: number | null = null;
    const probByCode: Record<string, number> = {};
    for (const m of ev.markets) {
      const yesPrice = Number(JSON.parse(m.outcomePrices)[0]);
      // The draw leg's groupItemTitle is "Draw (Home vs. Away)", which never
      // resolves to a team -- that's how it's told apart from the two sides.
      const team = m.groupItemTitle ? lookup(m.groupItemTitle) : null;
      if (team) probByCode[team.code] = yesPrice;
      else probDraw = yesPrice;
    }

    const codes = Object.keys(probByCode);
    if (codes.length !== 2 || probDraw == null) continue; // unresolved team name(s) or no draw leg
    out.set(pairKey(codes[0], codes[1]), {
      probByCode,
      probDraw,
      volume24hr: ev.volume24hr ?? 0,
      updatedAt: Date.now(),
    });
  }
  return out;
}

const CACHE_MS = 20_000;
let cache: { data: Map<string, MarketOdds>; fetchedAt: number } | null = null;
let pending: Promise<Map<string, MarketOdds>> | null = null;

/**
 * All currently-tradeable World Cup match odds, keyed by sorted team-code
 * pair ("ARG|BRA"). Refetches Polymarket at most once every CACHE_MS
 * regardless of caller volume; on failure (network hiccup, Polymarket
 * down) falls back to the last good snapshot rather than throwing.
 */
export async function getMarketOdds(): Promise<Map<string, MarketOdds>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.data;
  if (pending) return pending;

  pending = fetchFromPolymarket()
    .then((data) => {
      cache = { data, fetchedAt: Date.now() };
      return data;
    })
    .catch((err) => {
      if (cache) return cache.data; // serve stale rather than fail the page
      throw err;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Look up one fixture's market odds by our own team codes, in either order. */
export function marketOddsFor(
  odds: Map<string, MarketOdds>,
  homeCode: string,
  awayCode: string
): { probHome: number; probDraw: number; probAway: number; volume24hr: number } | null {
  const entry = odds.get(pairKey(homeCode, awayCode));
  if (!entry) return null;
  const probHome = entry.probByCode[homeCode];
  const probAway = entry.probByCode[awayCode];
  if (probHome == null || probAway == null) return null;
  return { probHome, probDraw: entry.probDraw, probAway, volume24hr: entry.volume24hr };
}
