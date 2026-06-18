// "As it stands" projection logic. Pure: in the group tables + fixtures, out
// the projected qualifiers, the best-third race, the projected Round-of-32
// bracket, and a per-team qualification outlook with a plain-language note on
// what each side still needs.
//
// Scope note: clinch/elimination is computed at the points level — every
// remaining group game is expanded into win/draw/loss and ties are resolved
// optimistically (for "can still") or pessimistically (for "already sure"),
// which is the standard magic-number approach. Exact goal-difference and
// head-to-head edge cases on the final matchday are therefore approximated.
// Third-place qualification depends on all twelve groups at once, so the notes
// speak to a team's group finish (1st / 2nd / 3rd) rather than simulating the
// cross-group best-thirds race result.

import type { GroupRow, GroupTable } from './groups';
import type { Match } from './types';

// --- Round of 32 layout (the 16 fixed pairings) ----------------------------

type Seed =
  | { kind: 'pos'; pos: 1 | 2; group: string }
  | { kind: 'third'; groups: string[] };

interface Pairing {
  match: number;
  home: Seed;
  away: Seed;
}

/** The 16 fixed Round-of-32 pairings, with the third-place candidate sets. */
export const R32_PAIRINGS: Pairing[] = [
  { match: 1, home: pos(1, 'E'), away: third('ABCDF') },
  { match: 2, home: pos(1, 'I'), away: third('CDFGH') },
  { match: 3, home: pos(2, 'A'), away: pos(2, 'B') },
  { match: 4, home: pos(1, 'F'), away: pos(2, 'C') },
  { match: 5, home: pos(2, 'K'), away: pos(2, 'L') },
  { match: 6, home: pos(1, 'H'), away: pos(2, 'J') },
  { match: 7, home: pos(1, 'D'), away: third('BEFIJ') },
  { match: 8, home: pos(1, 'G'), away: third('AEHIJ') },
  { match: 9, home: pos(1, 'C'), away: pos(2, 'F') },
  { match: 10, home: pos(2, 'E'), away: pos(2, 'I') },
  { match: 11, home: pos(1, 'A'), away: third('CEFHI') },
  { match: 12, home: pos(1, 'L'), away: third('EHIJK') },
  { match: 13, home: pos(1, 'J'), away: pos(2, 'H') },
  { match: 14, home: pos(2, 'D'), away: pos(2, 'G') },
  { match: 15, home: pos(1, 'B'), away: third('EFGIJ') },
  { match: 16, home: pos(1, 'K'), away: third('DEIJL') },
];

function pos(p: 1 | 2, group: string): Seed {
  return { kind: 'pos', pos: p, group };
}
function third(groups: string): Seed {
  return { kind: 'third', groups: groups.split('') };
}

export function seedLabel(s: Seed): string {
  return s.kind === 'pos' ? `${s.pos}${s.group}` : `3${s.groups.join('')}`;
}

// --- third-place race ------------------------------------------------------

export interface ThirdRow {
  group: string; // letter, e.g. "E"
  row: GroupRow;
  /** true once this third-placer is inside the top 8 that advance. */
  qualifies: boolean;
}

/** Group letter from a "Group X" name, or the name itself as a fallback. */
export function groupLetter(name: string): string {
  const m = /Group\s+([A-Z0-9]+)/i.exec(name);
  return m ? m[1].toUpperCase() : name;
}

/**
 * Rank the twelve third-placed teams. No head-to-head (different groups):
 * points, overall goal difference, overall goals, fair play, FIFA ranking.
 * The top 8 advance.
 */
export function rankThirds(tables: GroupTable[]): ThirdRow[] {
  const thirds = tables
    .filter((t) => t.rows.length >= 3)
    .map((t) => ({ group: groupLetter(t.name), row: t.rows[2] }));

  thirds.sort(
    (a, b) =>
      b.row.pts - a.row.pts ||
      b.row.gd - a.row.gd ||
      b.row.gf - a.row.gf ||
      b.row.fairPlay - a.row.fairPlay ||
      rankValue(a.row.rank) - rankValue(b.row.rank) ||
      a.group.localeCompare(b.group)
  );

  return thirds.map((t, i) => ({ ...t, qualifies: i < 8 }));
}

function rankValue(rank: number | null): number {
  return rank == null ? Number.POSITIVE_INFINITY : rank;
}

// --- projected Round-of-32 bracket -----------------------------------------

export interface ProjectedSeed {
  label: string; // "1E", "2C", "3ABCDF"
  team: GroupRow | null; // the projected occupant, if resolvable
}
export interface ProjectedMatch {
  match: number;
  home: ProjectedSeed;
  away: ProjectedSeed;
}

/**
 * Fill the 16 Round-of-32 pairings with the current projected qualifiers.
 * Group winners and runners-up come straight from the tables; the eight best
 * thirds are assigned to the variable slots by matching each qualifying
 * third's group to a slot whose candidate set contains it.
 */
export function projectBracket(tables: GroupTable[]): ProjectedMatch[] {
  const byLetter = new Map<string, GroupRow[]>();
  for (const t of tables) byLetter.set(groupLetter(t.name), t.rows);

  const thirds = rankThirds(tables).filter((t) => t.qualifies);
  const qualifyingGroups = thirds.map((t) => t.group);
  const thirdByGroup = new Map(thirds.map((t) => [t.group, t.row]));

  // Match each third-slot (in pairing order) to one qualifying group.
  const thirdSlots = R32_PAIRINGS.flatMap((p) =>
    [p.home, p.away].filter((s): s is Extract<Seed, { kind: 'third' }> => s.kind === 'third')
  );
  const slotGroup = assignThirds(thirdSlots, qualifyingGroups);

  let slotIdx = 0;
  const resolve = (s: Seed): ProjectedSeed => {
    const label = seedLabel(s);
    if (s.kind === 'pos') {
      const rows = byLetter.get(s.group);
      return { label, team: rows?.[s.pos - 1] ?? null };
    }
    const group = slotGroup[slotIdx++];
    return { label, team: group ? thirdByGroup.get(group) ?? null : null };
  };

  return R32_PAIRINGS.map((p) => ({
    match: p.match,
    home: resolve(p.home),
    away: resolve(p.away),
  }));
}

/**
 * Bipartite matching: assign each third-slot a distinct qualifying group from
 * its candidate set. Returns an array parallel to `slots` of group letters
 * (or null where no assignment was possible). Kuhn's augmenting-path algorithm.
 */
function assignThirds(
  slots: Extract<Seed, { kind: 'third' }>[],
  qualifyingGroups: string[]
): (string | null)[] {
  const groupQualifies = new Set(qualifyingGroups);
  const slotToGroup: (string | null)[] = slots.map(() => null);
  const groupToSlot = new Map<string, number>();

  const tryAssign = (slot: number, seen: Set<string>): boolean => {
    for (const g of slots[slot].groups) {
      if (!groupQualifies.has(g) || seen.has(g)) continue;
      seen.add(g);
      const taken = groupToSlot.get(g);
      if (taken === undefined || tryAssign(taken, seen)) {
        slotToGroup[slot] = g;
        groupToSlot.set(g, slot);
        return true;
      }
    }
    return false;
  };

  for (let s = 0; s < slots.length; s++) tryAssign(s, new Set());
  return slotToGroup;
}

// --- per-team qualification outlook ----------------------------------------

export type QualStatus =
  | 'won_group' // clinched 1st
  | 'through' // clinched a top-2 spot
  | 'in_contention' // can still finish top 2
  | 'third_race' // can't reach top 2, but can finish 3rd (best-thirds race)
  | 'eliminated'; // can't finish in the top 3

export interface TeamOutlook {
  team: string;
  code: string | null;
  status: QualStatus;
  note: string;
}

interface Eval {
  canWin: boolean; // can finish 1st
  clinchedWin: boolean;
  canTop2: boolean;
  clinchedTop2: boolean;
  canTop3: boolean;
}

/** Outlook for every team in a group, given the full fixture list. */
export function groupOutlooks(table: GroupTable, allMatches: Match[]): TeamOutlook[] {
  const teams = table.rows.map((r) => r.team);
  const base = new Map(table.rows.map((r) => [r.team, r.pts]));

  const remaining = allMatches.filter(
    (m) =>
      m.group_name === table.name &&
      m.status !== 'FINISHED' &&
      base.has(m.home_team) &&
      base.has(m.away_team)
  );

  // Expand remaining games into every win/draw/loss combination, recording the
  // final points each team would hold and each side's own result per combo.
  const combos: { pts: Map<string, number>; own: Map<string, 'W' | 'D' | 'L'> }[] = [];
  const build = (i: number, pts: Map<string, number>, own: Map<string, 'W' | 'D' | 'L'>) => {
    if (i === remaining.length) {
      combos.push({ pts: new Map(pts), own: new Map(own) });
      return;
    }
    const m = remaining[i];
    for (const r of ['H', 'D', 'A'] as const) {
      const next = new Map(pts);
      const ownNext = new Map(own);
      if (r === 'H') {
        next.set(m.home_team, next.get(m.home_team)! + 3);
        ownNext.set(m.home_team, 'W');
        ownNext.set(m.away_team, 'L');
      } else if (r === 'A') {
        next.set(m.away_team, next.get(m.away_team)! + 3);
        ownNext.set(m.home_team, 'L');
        ownNext.set(m.away_team, 'W');
      } else {
        next.set(m.home_team, next.get(m.home_team)! + 1);
        next.set(m.away_team, next.get(m.away_team)! + 1);
        ownNext.set(m.home_team, 'D');
        ownNext.set(m.away_team, 'D');
      }
      build(i + 1, next, ownNext);
    }
  };
  build(0, base, new Map());

  return teams.map((team) => {
    const code = table.rows.find((r) => r.team === team)!.code;
    const ev = evaluate(team, teams, combos);
    const status = statusOf(ev);
    const note = noteFor(team, ev, status, remaining, combos);
    return { team, code, status, note };
  });
}

/** How many other teams sit above `team` on points: strict, and tie-inclusive. */
function rivalsAbove(team: string, teams: string[], pts: Map<string, number>) {
  let strict = 0;
  let orEqual = 0;
  const mine = pts.get(team)!;
  for (const t of teams) {
    if (t === team) continue;
    if (pts.get(t)! > mine) {
      strict++;
      orEqual++;
    } else if (pts.get(t)! === mine) {
      orEqual++;
    }
  }
  return { strict, orEqual };
}

function evaluate(
  team: string,
  teams: string[],
  combos: { pts: Map<string, number> }[]
): Eval {
  let canWin = false;
  let clinchedWin = true;
  let canTop2 = false;
  let clinchedTop2 = true;
  let canTop3 = false;
  for (const c of combos) {
    const { strict, orEqual } = rivalsAbove(team, teams, c.pts);
    if (strict === 0) canWin = true;
    if (orEqual !== 0) clinchedWin = false;
    if (strict <= 1) canTop2 = true;
    if (orEqual > 1) clinchedTop2 = false;
    if (strict <= 2) canTop3 = true;
  }
  if (combos.length === 0) {
    canWin = clinchedWin;
    canTop2 = clinchedTop2;
  }
  return { canWin, clinchedWin, canTop2, clinchedTop2, canTop3 };
}

function statusOf(ev: Eval): QualStatus {
  if (ev.clinchedTop2) return ev.clinchedWin ? 'won_group' : 'through';
  if (!ev.canTop3) return 'eliminated';
  if (!ev.canTop2) return 'third_race';
  return 'in_contention';
}

function noteFor(
  team: string,
  ev: Eval,
  status: QualStatus,
  remaining: Match[],
  combos: { pts: Map<string, number>; own: Map<string, 'W' | 'D' | 'L'> }[]
): string {
  if (status === 'won_group') return 'Group winners. Qualified for the Round of 32.';
  if (status === 'through') return 'Qualified for the Round of 32.';
  if (status === 'eliminated') return 'Eliminated. Out of the tournament.';

  const ownGames = remaining.filter((m) => m.home_team === team || m.away_team === team);

  // Final-matchday case (one game left): spell out what each result brings.
  if (ownGames.length === 1) {
    const teams = [...combos[0].pts.keys()];
    const win = evalSubset(team, teams, combos, 'W');
    const draw = evalSubset(team, teams, combos, 'D');
    const loss = evalSubset(team, teams, combos, 'L');

    if (status === 'third_race') {
      const lead =
        win.canTop3 && !loss.canTop3
          ? 'Must win to stay alive in the best third-place race.'
          : 'Can still advance, but only as one of the eight best third-place teams.';
      return lead;
    }

    // in_contention
    const parts: string[] = [];
    if (draw.clinchedTop2) parts.push('A draw is enough to finish in the top two and qualify.');
    else if (win.clinchedTop2) parts.push('A win guarantees qualification.');
    else if (win.canTop2) parts.push('A win might be enough, but other results need to go their way.');

    if (!loss.canTop3) parts.push('A loss means elimination.');
    else if (!loss.canTop2) parts.push('A loss rules out a top-two finish. They would need a best third-place spot to go through.');
    return parts.join(' ') || 'Still in contention. Results to play for.';
  }

  // Earlier rounds (more than one game left): keep it short.
  if (status === 'third_race') return 'Out of top-two contention. Can only advance as a best third-place team.';
  return ev.canWin ? 'In contention. Can still win the group.' : 'Still in contention for a top-two finish.';
}

/** Re-evaluate restricted to the combos where `team` got a given own result. */
function evalSubset(
  team: string,
  teams: string[],
  combos: { pts: Map<string, number>; own: Map<string, 'W' | 'D' | 'L'> }[],
  own: 'W' | 'D' | 'L'
): Eval {
  const subset = combos.filter((c) => c.own.get(team) === own);
  return evaluate(team, teams, subset);
}
