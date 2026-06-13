// Monte Carlo tournament simulation. Plays the whole World Cup thousands of
// times using the same goal model the match predictor uses, then reports how
// often each team advances and lifts the trophy.
//
// Group stage is exact to the 2026 format (12 groups of 4; top two plus the
// eight best third-placed teams advance, 32 in all). The knockout pairing is
// Elo-seeded rather than the official slot map, so title odds are a strength-
// driven approximation, not a bracket-accurate projection. Already-played
// results are honoured; only outstanding matches are sampled.

import { expectedGoals } from './model';
import { lookup, byCode, type TeamRating } from './teams';

export interface SimGroup {
  name: string;
  teams: string[]; // TLA codes, 4 per group
}

export interface SimFixture {
  group: string;
  home: string; // code
  away: string; // code
  played: boolean;
  homeScore?: number | null;
  awayScore?: number | null;
}

export interface TeamOutcome {
  code: string;
  name: string;
  elo: number;
  advance: number; // P(reach knockouts)
  winGroup: number;
  runnerUp: number;
  bestThird: number;
  quarter: number;
  semi: number;
  final: number;
  title: number;
}

export interface SimResult {
  iterations: number;
  teams: TeamOutcome[]; // sorted by title desc
}

// --- random helpers ---------------------------------------------------------

/** Knuth's Poisson sampler (fine for the small means we deal with). */
function samplePoisson(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function sampleGoals(home: string, away: string): [number, number] {
  const h = byCode(home);
  const a = byCode(away);
  if (!h || !a) return [0, 0];
  const gap = h.elo - a.elo; // neutral venue
  const { lambdaHome, lambdaAway } = expectedGoals(gap);
  return [samplePoisson(lambdaHome), samplePoisson(lambdaAway)];
}

/** Knockout: effective home win prob with draws decided on penalties (coin flip). */
function knockoutWin(home: string, away: string): string {
  const h = byCode(home);
  const a = byCode(away);
  if (!h || !a) return Math.random() < 0.5 ? home : away;
  const gap = h.elo - a.elo;
  const { lambdaHome, lambdaAway } = expectedGoals(gap);
  // One sampled scoreline; ties go to a 50/50 shootout.
  const hs = samplePoisson(lambdaHome);
  const as = samplePoisson(lambdaAway);
  if (hs > as) return home;
  if (as > hs) return away;
  return Math.random() < 0.5 ? home : away;
}

// --- group bookkeeping ------------------------------------------------------

interface Standing {
  code: string;
  pts: number;
  gf: number;
  ga: number;
}

function rank(a: Standing, b: Standing): number {
  if (b.pts !== a.pts) return b.pts - a.pts;
  const agd = a.gf - a.ga,
    bgd = b.gf - b.ga;
  if (bgd !== agd) return bgd - agd;
  if (b.gf !== a.gf) return b.gf - a.gf;
  return byCode(b.code)!.elo - byCode(a.code)!.elo; // stable, strength-based tiebreak
}

/**
 * Run the tournament `iterations` times. `groups` defines the 12 groups by
 * code; `fixtures` are the group-stage games (with any finished results filled
 * in). Returns per-team advancement and title probabilities.
 */
export function simulate(
  groups: SimGroup[],
  fixtures: SimFixture[],
  iterations = 4000
): SimResult {
  const allCodes = groups.flatMap((g) => g.teams);
  const tally: Record<string, Omit<TeamOutcome, 'name' | 'elo'>> = {};
  for (const c of allCodes) {
    tally[c] = {
      code: c,
      advance: 0, winGroup: 0, runnerUp: 0, bestThird: 0,
      quarter: 0, semi: 0, final: 0, title: 0,
    };
  }

  const fixturesByGroup = new Map<string, SimFixture[]>();
  for (const f of fixtures) {
    if (!fixturesByGroup.has(f.group)) fixturesByGroup.set(f.group, []);
    fixturesByGroup.get(f.group)!.push(f);
  }

  for (let it = 0; it < iterations; it++) {
    const winners: string[] = [];
    const runners: string[] = [];
    const thirds: Standing[] = [];

    for (const g of groups) {
      const s: Record<string, Standing> = {};
      for (const c of g.teams) s[c] = { code: c, pts: 0, gf: 0, ga: 0 };
      const gf = fixturesByGroup.get(g.name) ?? [];
      for (const f of gf) {
        let hs: number, as: number;
        if (f.played && f.homeScore != null && f.awayScore != null) {
          hs = f.homeScore;
          as = f.awayScore;
        } else {
          [hs, as] = sampleGoals(f.home, f.away);
        }
        if (!s[f.home] || !s[f.away]) continue;
        s[f.home].gf += hs; s[f.home].ga += as;
        s[f.away].gf += as; s[f.away].ga += hs;
        if (hs > as) s[f.home].pts += 3;
        else if (as > hs) s[f.away].pts += 3;
        else { s[f.home].pts += 1; s[f.away].pts += 1; }
      }
      const table = Object.values(s).sort(rank);
      winners.push(table[0].code);
      runners.push(table[1].code);
      thirds.push(table[2]);
      tally[table[0].code].winGroup++;
      tally[table[1].code].runnerUp++;
    }

    // Eight best third-placed teams advance.
    const bestThirds = [...thirds].sort(rank).slice(0, 8);
    for (const t of bestThirds) tally[t.code].bestThird++;

    const advancers = [...winners, ...runners, ...bestThirds.map((t) => t.code)];
    for (const c of advancers) tally[c].advance++;

    // Knockout: Elo-seeded single elimination (approximate pairing).
    let bracket = [...advancers].sort((a, b) => byCode(b)!.elo - byCode(a)!.elo);
    // Pad to a power of two if needed (32 advancers -> already 2^5).
    const round = (size: number) => size; // labels handled below
    let stage = bracket.length; // 32
    while (bracket.length > 1) {
      const next: string[] = [];
      const n = bracket.length;
      for (let i = 0; i < n / 2; i++) {
        const home = bracket[i];
        const away = bracket[n - 1 - i]; // serpentine seeding: best vs worst
        next.push(knockoutWin(home, away));
      }
      bracket = next;
      stage = bracket.length;
      if (stage === 8) for (const c of bracket) tally[c].quarter++;
      else if (stage === 4) for (const c of bracket) tally[c].semi++;
      else if (stage === 2) for (const c of bracket) tally[c].final++;
      else if (stage === 1) tally[bracket[0]].title++;
    }
    void round;
  }

  const teams: TeamOutcome[] = allCodes.map((c) => {
    const t = tally[c];
    const rt = byCode(c) as TeamRating;
    const d = iterations;
    return {
      code: c,
      name: rt.name,
      elo: rt.elo,
      advance: t.advance / d,
      winGroup: t.winGroup / d,
      runnerUp: t.runnerUp / d,
      bestThird: t.bestThird / d,
      quarter: t.quarter / d,
      semi: t.semi / d,
      final: t.final / d,
      title: t.title / d,
    };
  });
  teams.sort((a, b) => b.title - a.title);
  return { iterations, teams };
}

/** Helper: are all 48 codes present in the rating table? */
export function unknownCodes(codes: string[]): string[] {
  return codes.filter((c) => !lookup(c));
}
