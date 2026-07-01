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

const GAMMA_EVENTS_URL = 'https://gamma-api.polymarket.com/events';
// Gamma caps a page at 100 events and the World Cup tag carries hundreds
// (winner, group-advancement, per-match and prop events), so we page through
// with offset until a short page. MAX_PAGES is a runaway guard, not a real cap.
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

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
  question?: string;
  // JSON-encoded ["yesPrice", "noPrice"]; Gamma has also served it as a plain
  // array, so we tolerate both.
  outcomePrices?: string | string[];
}

interface GammaEvent {
  slug: string;
  volume24hr?: number;
  markets?: GammaMarket[];
}

/** Pair key independent of which side Polymarket calls "home". */
function pairKey(codeA: string, codeB: string): string {
  return [codeA, codeB].sort().join('|');
}

/** The "Yes" price of a market, tolerant of string- or array-encoded prices. */
function yesPrice(raw: GammaMarket['outcomePrices']): number | null {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const n = Number(arr[0]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** The draw leg is titled like "Draw (Home vs. Away)" — never a team. */
function isDrawLeg(title: string): boolean {
  return /\b(draw|tie)\b/i.test(title);
}

/** A market's team label: the group title, else parsed from "Will X win?". */
function marketTeam(m: GammaMarket): string | null {
  const title = m.groupItemTitle?.trim();
  if (title) return title;
  const q = /^will\s+(.+?)\s+(?:win|advance|qualify)/i.exec(m.question?.trim() ?? '');
  return q ? q[1] : null;
}

/**
 * Fold Gamma events into our pair-keyed odds map. Pure and exported so the
 * parsing can be unit-tested without hitting the network. A match event has one
 * yes/no market per outcome: two teams plus, in the group stage, a draw. In the
 * knockouts there is no draw (the tie always produces a winner), so a two-way
 * market is valid and its draw probability is 0. An outcome whose team name we
 * can't resolve simply leaves that side missing, so the match is skipped rather
 * than shown with half its odds.
 */
export function parseGammaEvents(events: GammaEvent[]): Map<string, MarketOdds> {
  const out = new Map<string, MarketOdds>();
  for (const ev of events) {
    if (!MATCH_SLUG.test(ev.slug)) continue;

    let probDraw: number | null = null;
    const probByCode: Record<string, number> = {};
    for (const m of ev.markets ?? []) {
      const price = yesPrice(m.outcomePrices);
      if (price == null) continue;
      const label = marketTeam(m);
      if (!label) continue;
      if (isDrawLeg(label)) {
        probDraw = price;
        continue;
      }
      const team = lookup(label);
      if (team) probByCode[team.code] = price;
    }

    const codes = Object.keys(probByCode);
    if (codes.length !== 2) continue; // one or both team names unresolved
    out.set(pairKey(codes[0], codes[1]), {
      probByCode,
      probDraw: probDraw ?? 0, // knockouts have no draw leg
      volume24hr: ev.volume24hr ?? 0,
      updatedAt: Date.now(),
    });
  }
  return out;
}

async function fetchFromPolymarket(): Promise<Map<string, MarketOdds>> {
  const events: GammaEvent[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${GAMMA_EVENTS_URL}?tag_slug=fifa-world-cup&closed=false&limit=${PAGE_LIMIT}&offset=${
      page * PAGE_LIMIT
    }`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Polymarket Gamma API ${res.status}`);
    const batch = (await res.json()) as GammaEvent[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    events.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
  }
  return parseGammaEvents(events);
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
