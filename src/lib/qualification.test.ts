import { describe, expect, it } from 'vitest';
import { computeGroupTables, type GroupRow, type GroupTable } from './groups';
import {
  groupOutlooks,
  projectBracket,
  rankThirds,
  R32_PAIRINGS,
  seedLabel,
} from './qualification';
import type { Match } from './types';

let nextId = 1;
function match(group: string, home: string, away: string, hs: number | null, as_: number | null): Match {
  return {
    id: nextId++,
    home_team: home,
    away_team: away,
    home_code: home.slice(0, 3).toUpperCase(),
    away_code: away.slice(0, 3).toUpperCase(),
    kickoff: '2026-06-20T18:00:00Z',
    stage: 'GROUP_STAGE',
    group_name: group,
    status: hs == null ? 'TIMED' : 'FINISHED',
    home_score: hs,
    away_score: as_,
    scored: hs != null,
    venue: null,
  };
}

function grow(code: string, pts: number, gd = 0, gf = 0): GroupRow {
  return {
    team: `${code}-team`,
    code,
    played: 3,
    won: 0,
    drawn: 0,
    lost: 0,
    gf,
    ga: gf - gd,
    gd,
    pts,
    fairPlay: 0,
    rank: null,
  };
}

/** Twelve synthetic tables; `thirdPts` keys the group letter to its 3rd's points. */
function tablesWith(thirdPts: Record<string, number>): GroupTable[] {
  return 'ABCDEFGHIJKL'.split('').map((L) => ({
    name: `Group ${L}`,
    rows: [grow(`${L}1`, 9), grow(`${L}2`, 6), grow(L, thirdPts[L] ?? 0), grow(`${L}4`, 0)],
  }));
}

describe('rankThirds', () => {
  it('advances the eight best third-placed teams', () => {
    const thirds = rankThirds(
      tablesWith({ A: 7, B: 6, C: 6, D: 5, E: 4, F: 4, G: 3, H: 3, I: 1, J: 1, K: 0, L: 0 })
    );
    expect(thirds).toHaveLength(12);
    const qualified = thirds.filter((t) => t.qualifies).map((t) => t.group);
    expect(qualified).toHaveLength(8);
    expect(qualified).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(thirds.slice(8).every((t) => !t.qualifies)).toBe(true);
  });

  it('breaks ties by goal difference then goals scored', () => {
    const tables = tablesWith({});
    // Two thirds level on points; B has the better goal difference.
    tables[0].rows[2] = grow('A', 4, 1, 3); // gd +1
    tables[1].rows[2] = grow('B', 4, 5, 7); // gd +5
    for (let i = 2; i < 12; i++) tables[i].rows[2] = grow(tables[i].name.slice(-1), 0);
    const order = rankThirds(tables).map((t) => t.group);
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('A'));
  });
});

describe('projectBracket', () => {
  it('fills group-position slots from the tables', () => {
    const matches = projectBracket(tablesWith({}));
    const m = matches.find((x) => x.home.label === '2A')!; // 2A vs 2B
    expect(m.away.label).toBe('2B');
    expect(m.home.team?.code).toBe('A2'); // runner-up of group A
    expect(m.away.team?.code).toBe('B2');
  });

  it('assigns each qualifying third to a slot within its candidate set, all distinct', () => {
    // Groups A-H supply the eight thirds.
    const qualify = { A: 5, B: 5, C: 5, D: 5, E: 5, F: 5, G: 5, H: 5 };
    const matches = projectBracket(tablesWith(qualify));

    const thirdSeeds = matches.flatMap((m) =>
      [m.home, m.away].filter((s) => s.label.startsWith('3'))
    );
    expect(thirdSeeds).toHaveLength(8);

    const used = new Set<string>();
    for (const s of thirdSeeds) {
      const candidates = s.label.slice(1).split('');
      const code = s.team?.code;
      expect(code).toBeTruthy();
      expect(candidates).toContain(code!); // group letter sits in the slot's set
      used.add(code!);
    }
    expect(used.size).toBe(8); // every qualifying group placed exactly once
  });

  it('keeps the sixteen fixed pairings, in official venue order', () => {
    expect(R32_PAIRINGS).toHaveLength(16);
    // First match is at SoFi (LA): 2A vs 2B.
    expect(R32_PAIRINGS[0].venue).toBe('SoFi Stadium');
    expect(seedLabel(R32_PAIRINGS[0].home)).toBe('2A');
    expect(seedLabel(R32_PAIRINGS[0].away)).toBe('2B');
    // 1E (e.g. Germany) is the Boston/Gillette match vs 3ABCDF.
    const gillette = R32_PAIRINGS.find((p) => seedLabel(p.home) === '1E')!;
    expect(gillette.venue).toBe('Gillette Stadium');
    expect(seedLabel(gillette.away)).toBe('3ABCDF');
  });
});

describe('groupOutlooks', () => {
  it('classifies a finished group: winner, qualifier, third, eliminated', () => {
    const matches = [
      match('Group A', 'AAA', 'BBB', 1, 0),
      match('Group A', 'AAA', 'CCC', 1, 0),
      match('Group A', 'AAA', 'DDD', 1, 0),
      match('Group A', 'BBB', 'CCC', 1, 0),
      match('Group A', 'BBB', 'DDD', 1, 0),
      match('Group A', 'CCC', 'DDD', 1, 0),
    ];
    const table = computeGroupTables(matches)[0]; // AAA 9, BBB 6, CCC 3, DDD 0
    const outlook = Object.fromEntries(groupOutlooks(table, matches).map((o) => [o.team, o.status]));
    expect(outlook['AAA']).toBe('won_group');
    expect(outlook['BBB']).toBe('through');
    expect(outlook['CCC']).toBe('third_race');
    expect(outlook['DDD']).toBe('eliminated');
  });

  it('spells out what a fence team needs on the final matchday', () => {
    // After two rounds: AAA 6, BBB 3, CCC 3, DDD 0. Last round: AAA-DDD, BBB-CCC.
    const matches = [
      match('Group B', 'AAA', 'BBB', 1, 0),
      match('Group B', 'AAA', 'CCC', 1, 0),
      match('Group B', 'BBB', 'DDD', 1, 0),
      match('Group B', 'CCC', 'DDD', 1, 0),
      match('Group B', 'AAA', 'DDD', null, null), // to play
      match('Group B', 'BBB', 'CCC', null, null), // to play
    ];
    const table = computeGroupTables(matches)[0];
    const outlook = Object.fromEntries(groupOutlooks(table, matches).map((o) => [o.team, o]));
    expect(outlook['AAA'].status).toBe('through');
    expect(outlook['BBB'].status).toBe('in_contention');
    expect(outlook['BBB'].note.toLowerCase()).toContain('win guarantees');
  });
});
