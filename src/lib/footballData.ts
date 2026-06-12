// Fixture sources. Both return the same FixtureRow shape so the sync layer
// is swappable: football-data.org (primary) and openfootball (fallback).

import { finalScore, isFinished, type ApiScore } from './scoring';
import type { Goal } from './types';

export interface FixtureRow {
  id: number;
  home_team: string;
  away_team: string;
  home_code: string | null;
  away_code: string | null;
  kickoff: string; // ISO UTC
  stage: string;
  group_name: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  goals: Goal[];
}

// --- football-data.org v4 --------------------------------------------------

interface FdTeam {
  id: number | null;
  name: string | null;
  shortName?: string | null;
  tla?: string | null;
}

interface FdGoal {
  minute: number;
  injuryTime: number | null;
  type: string;
  team: { name: string | null } | null;
  scorer: { name: string | null } | null;
}

interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  stage: string;
  group: string | null;
  homeTeam: FdTeam | null;
  awayTeam: FdTeam | null;
  score: ApiScore | null;
  goals?: FdGoal[];
}

export async function fetchFootballDataMatchDetail(
  apiKey: string,
  matchId: number,
): Promise<FixtureRow> {
  const res = await fetch(`https://api.football-data.org/v4/matches/${matchId}`, {
    headers: { 'X-Auth-Token': apiKey },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`football-data.org match ${matchId} responded ${res.status}: ${body.slice(0, 200)}`);
  }
  const m = (await res.json()) as FdMatch;
  return mapFdMatch(m);
}

export async function fetchFootballDataFixtures(apiKey: string): Promise<FixtureRow[]> {
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': apiKey },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`football-data.org responded ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { matches?: FdMatch[] };
  if (!Array.isArray(data.matches)) {
    throw new Error('football-data.org response had no matches array');
  }
  return data.matches.map(mapFdMatch);
}

function mapFdMatch(m: FdMatch): FixtureRow {
  // finalScore returns null for unplayed matches (null fullTime), and the
  // running score for IN_PLAY ones, so live goals show up between syncs.
  const score = finalScore(m.score);
  const VALID_TYPES = new Set(['REGULAR', 'OWN_GOAL', 'PENALTY']);
  return {
    id: m.id,
    home_team: m.homeTeam?.name ?? 'TBD',
    away_team: m.awayTeam?.name ?? 'TBD',
    home_code: m.homeTeam?.tla ?? null,
    away_code: m.awayTeam?.tla ?? null,
    kickoff: new Date(m.utcDate).toISOString(),
    stage: m.stage ?? 'GROUP_STAGE',
    group_name: m.group ? prettyGroup(m.group) : null,
    status: m.status ?? 'SCHEDULED',
    home_score: score?.home ?? null,
    away_score: score?.away ?? null,
    goals: (m.goals ?? []).map((g) => ({
      minute: g.minute,
      scorer: g.scorer?.name ?? 'Unknown',
      team: g.team?.name === m.homeTeam?.name ? 'home' : 'away',
      type: (VALID_TYPES.has(g.type) ? g.type : 'REGULAR') as Goal['type'],
    })),
  };
}

function prettyGroup(group: string): string {
  // "GROUP_A" -> "Group A"
  const m = /^GROUP_([A-Z0-9]+)$/.exec(group);
  return m ? `Group ${m[1]}` : group;
}

// --- openfootball fallback (no API key needed) ------------------------------

const OPENFOOTBALL_URL =
  'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

interface OfMatch {
  round?: string;
  date?: string; // "2026-06-11"
  time?: string; // "13:00 UTC-6"
  team1?: string | { name?: string; code?: string };
  team2?: string | { name?: string; code?: string };
  group?: string;
  ground?: string;
  score?: { ft?: [number, number] };
  score1?: number | null;
  score2?: number | null;
}

export async function fetchOpenfootballFixtures(): Promise<FixtureRow[]> {
  const res = await fetch(OPENFOOTBALL_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`openfootball responded ${res.status}`);
  const data = (await res.json()) as { matches?: OfMatch[] };
  if (!Array.isArray(data.matches)) throw new Error('openfootball response had no matches array');
  return data.matches.map(mapOfMatch).filter((m): m is FixtureRow => m !== null);
}

function mapOfMatch(m: OfMatch): FixtureRow | null {
  if (!m.date) return null;
  const home = teamName(m.team1);
  const away = teamName(m.team2);
  const kickoff = parseOfKickoff(m.date, m.time);
  const ft = m.score?.ft ?? (m.score1 != null && m.score2 != null ? [m.score1, m.score2] : null);
  const finished = Array.isArray(ft);
  return {
    id: openfootballId(m.date, home, away),
    home_team: home,
    away_team: away,
    home_code: teamCode(m.team1),
    away_code: teamCode(m.team2),
    kickoff,
    stage: m.group ? 'GROUP_STAGE' : (m.round ?? 'UNKNOWN'),
    group_name: m.group ?? null,
    status: finished ? 'FINISHED' : new Date(kickoff).getTime() <= Date.now() ? 'TIMED' : 'SCHEDULED',
    home_score: finished ? ft![0] : null,
    away_score: finished ? ft![1] : null,
    goals: [],
  };
}

function teamName(t: OfMatch['team1']): string {
  if (typeof t === 'string') return t;
  return t?.name ?? 'TBD';
}

function teamCode(t: OfMatch['team1']): string | null {
  if (typeof t === 'object' && t?.code) return t.code;
  return null;
}

function parseOfKickoff(date: string, time?: string): string {
  // time looks like "13:00 UTC-6" or "15:00 UTC-4"; default 12:00 UTC if absent.
  const m = time ? /^(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})(?::?(\d{2}))?$/.exec(time.trim()) : null;
  const [y, mo, d] = date.split('-').map(Number);
  if (!m) return new Date(Date.UTC(y, mo - 1, d, 12, 0)).toISOString();
  const h = Number(m[1]);
  const min = Number(m[2]);
  const offH = Number(m[3]);
  const offM = (offH < 0 ? -1 : 1) * Number(m[4] ?? 0);
  const utcMs = Date.UTC(y, mo - 1, d, h, min) - (offH * 60 + offM) * 60_000;
  return new Date(utcMs).toISOString();
}

/**
 * Deterministic synthetic id in a reserved high range (9xxxxxxxx) so
 * openfootball rows never collide with real football-data ids, and
 * re-seeding is idempotent. Do not mix the two sources in one database.
 */
export function openfootballId(date: string, home: string, away: string): number {
  const key = `${date}|${home}|${away}`;
  let h = 2166136261; // FNV-1a 32-bit
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 900_000_000 + (h >>> 0) % 100_000_000;
}

// --- source switch ----------------------------------------------------------

export async function fetchFixtures(): Promise<FixtureRow[]> {
  const source = process.env.FIXTURES_SOURCE ?? 'football-data';
  if (source === 'openfootball') return fetchOpenfootballFixtures();
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new Error('FOOTBALL_DATA_API_KEY is not set');
  return fetchFootballDataFixtures(key);
}
