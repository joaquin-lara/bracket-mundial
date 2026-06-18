// Group-stage table computation. Pure: in matches, out standings tables.

import { fairPlayFor } from './fairPlay';
import { lookup } from './ml/teams';
import type { Match } from './types';

export interface GroupRow {
  team: string;
  code: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  /** FIFA fair-play points (0 = cleanest, negative = more cards). */
  fairPlay: number;
  /** FIFA World Ranking position (lower = better), or null if unknown. */
  rank: number | null;
}

export interface GroupTable {
  name: string; // "Group A"
  rows: GroupRow[];
}

function emptyRow(team: string, code: string | null): GroupRow {
  return {
    team,
    code,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    pts: 0,
    fairPlay: fairPlayFor(code),
    rank: lookup(code)?.globalRank ?? lookup(team)?.globalRank ?? null,
  };
}

function isCounted(m: Match): boolean {
  return m.status === 'FINISHED' && m.home_score != null && m.away_score != null;
}

/**
 * Builds the group tables from the fixtures. Teams come from the fixture list
 * itself, so tables exist (with zeros) before any game is played. Only
 * FINISHED matches count; live scores stay provisional.
 *
 * Ranking follows the FIFA sequence in full:
 *   1. Points
 *   2. Head-to-head among the teams level on points — points, then goal
 *      difference, then goals scored in the matches between only those teams.
 *      If three or more remain tied, the same criteria are re-applied to the
 *      matches between just the still-tied teams (recursion).
 *   3. Overall goal difference, then overall goals scored.
 *   4. Fair-play points.
 *   5. FIFA World Ranking.
 * A final alphabetical fallback keeps the order deterministic.
 */
export function computeGroupTables(matches: Match[]): GroupTable[] {
  const groups = new Map<string, Map<string, GroupRow>>();
  const groupMatches = new Map<string, Match[]>();

  for (const m of matches) {
    if (!m.group_name) continue;
    if (!groups.has(m.group_name)) {
      groups.set(m.group_name, new Map());
      groupMatches.set(m.group_name, []);
    }
    const rows = groups.get(m.group_name)!;
    groupMatches.get(m.group_name)!.push(m);

    for (const [team, code] of [
      [m.home_team, m.home_code],
      [m.away_team, m.away_code],
    ] as [string, string | null][]) {
      if (team === 'TBD') continue;
      if (!rows.has(team)) rows.set(team, emptyRow(team, code));
    }

    if (!isCounted(m)) continue;

    const home = rows.get(m.home_team);
    const away = rows.get(m.away_team);
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.gf += m.home_score!;
    home.ga += m.away_score!;
    away.gf += m.away_score!;
    away.ga += m.home_score!;

    if (m.home_score! > m.away_score!) {
      home.won++;
      home.pts += 3;
      away.lost++;
    } else if (m.home_score! < m.away_score!) {
      away.won++;
      away.pts += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.pts++;
      away.pts++;
    }
  }

  const tables: GroupTable[] = [];
  for (const [name, rowMap] of groups) {
    for (const r of rowMap.values()) r.gd = r.gf - r.ga;
    const played = groupMatches.get(name) ?? [];
    tables.push({ name, rows: rankRows([...rowMap.values()], played) });
  }

  tables.sort((a, b) => a.name.localeCompare(b.name));
  return tables;
}

// --- ranking ---------------------------------------------------------------

/** Top-level ranking: split on points, resolve each tied cluster. */
function rankRows(rows: GroupRow[], matches: Match[]): GroupRow[] {
  const byPoints = [...rows].sort((a, b) => b.pts - a.pts);
  return flattenClusters(byPoints, (a) => a.pts, (tied) => resolveHeadToHead(tied, matches));
}

/**
 * Step 2 head-to-head: re-rank a set of teams that are all level on points by
 * the results between only those teams. Teams still tied after this pass have
 * the criteria re-applied to just their sub-set; a sub-set that never splits
 * falls through to the overall-results step.
 */
function resolveHeadToHead(tied: GroupRow[], matches: Match[]): GroupRow[] {
  const mini = miniTable(tied, matches);
  const key = (r: GroupRow) => {
    const s = mini.get(r.team)!;
    return [s.pts, s.gd, s.gf] as const;
  };
  const sorted = [...tied].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return kb[0] - ka[0] || kb[1] - ka[1] || kb[2] - ka[2];
  });

  return flattenClusters(
    sorted,
    (r) => key(r).join(','),
    (subset) =>
      // No split: head-to-head exhausted, move on to overall results.
      // Proper subset: re-apply head-to-head among just these teams.
      subset.length === tied.length
        ? resolveOverall(subset)
        : resolveHeadToHead(subset, matches)
  );
}

/** Steps 3-5: overall goal difference, overall goals, fair play, FIFA rank. */
function resolveOverall(tied: GroupRow[]): GroupRow[] {
  return [...tied].sort(
    (a, b) =>
      b.gd - a.gd ||
      b.gf - a.gf ||
      b.fairPlay - a.fairPlay ||
      rankValue(a.rank) - rankValue(b.rank) ||
      a.team.localeCompare(b.team)
  );
}

/** Build the mini-table of results among `teams` only (finished matches). */
function miniTable(
  teams: GroupRow[],
  matches: Match[]
): Map<string, { pts: number; gd: number; gf: number }> {
  const names = new Set(teams.map((t) => t.team));
  const stats = new Map<string, { pts: number; gd: number; gf: number }>();
  for (const t of teams) stats.set(t.team, { pts: 0, gd: 0, gf: 0 });

  for (const m of matches) {
    if (!isCounted(m)) continue;
    if (!names.has(m.home_team) || !names.has(m.away_team)) continue;
    const home = stats.get(m.home_team)!;
    const away = stats.get(m.away_team)!;
    home.gf += m.home_score!;
    away.gf += m.away_score!;
    home.gd += m.home_score! - m.away_score!;
    away.gd += m.away_score! - m.home_score!;
    if (m.home_score! > m.away_score!) home.pts += 3;
    else if (m.home_score! < m.away_score!) away.pts += 3;
    else {
      home.pts++;
      away.pts++;
    }
  }
  return stats;
}

/**
 * Walk a list already sorted by `key`, handing each maximal run of equal-key
 * rows to `resolve`. Runs of length 1 pass through untouched.
 */
function flattenClusters<T>(
  sorted: GroupRow[],
  key: (r: GroupRow) => T,
  resolve: (tied: GroupRow[]) => GroupRow[]
): GroupRow[] {
  const out: GroupRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && key(sorted[j]) === key(sorted[i])) j++;
    const run = sorted.slice(i, j);
    out.push(...(run.length === 1 ? run : resolve(run)));
    i = j;
  }
  return out;
}

function rankValue(rank: number | null): number {
  return rank == null ? Number.POSITIVE_INFINITY : rank;
}
