// Group-stage table computation. Pure: in matches, out standings tables.

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
}

export interface GroupTable {
  name: string; // "Group A"
  rows: GroupRow[];
}

function emptyRow(team: string, code: string | null): GroupRow {
  return { team, code, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
}

/**
 * Builds the 12 group tables from the fixtures. Teams come from the fixture
 * list itself, so tables exist (with zeros) before any game is played. Only
 * FINISHED matches count, live scores stay provisional.
 *
 * Sort order follows FIFA: points, goal difference, goals scored, then the
 * head-to-head result for two-way ties. Deeper ties (three-way, or criteria
 * beyond head-to-head like fair play points) fall back to alphabetical.
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

    if (m.status !== 'FINISHED' || m.home_score == null || m.away_score == null) continue;

    const home = rows.get(m.home_team);
    const away = rows.get(m.away_team);
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.gf += m.home_score;
    home.ga += m.away_score;
    away.gf += m.away_score;
    away.ga += m.home_score;

    if (m.home_score > m.away_score) {
      home.won++;
      home.pts += 3;
      away.lost++;
    } else if (m.home_score < m.away_score) {
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
    const rows = [...rowMap.values()].sort(
      (a, b) =>
        b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team)
    );

    // Two-way head-to-head: if exactly two adjacent teams are fully tied on
    // pts/gd/gf, the winner of their mutual game ranks first.
    const played = groupMatches.get(name) ?? [];
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      const tied = a.pts === b.pts && a.gd === b.gd && a.gf === b.gf;
      const threeWay =
        (i > 0 && sameRank(rows[i - 1], a)) || (i + 2 < rows.length && sameRank(b, rows[i + 2]));
      if (!tied || threeWay) continue;
      const h2h = played.find(
        (m) =>
          m.status === 'FINISHED' &&
          m.home_score != null &&
          m.away_score != null &&
          ((m.home_team === a.team && m.away_team === b.team) ||
            (m.home_team === b.team && m.away_team === a.team))
      );
      if (!h2h) continue;
      const winner =
        h2h.home_score! > h2h.away_score!
          ? h2h.home_team
          : h2h.away_score! > h2h.home_score!
            ? h2h.away_team
            : null;
      if (winner === b.team) {
        rows[i] = b;
        rows[i + 1] = a;
      }
    }

    tables.push({ name, rows });
  }

  tables.sort((a, b) => a.name.localeCompare(b.name));
  return tables;
}

function sameRank(a: GroupRow, b: GroupRow): boolean {
  return a.pts === b.pts && a.gd === b.gd && a.gf === b.gf;
}
