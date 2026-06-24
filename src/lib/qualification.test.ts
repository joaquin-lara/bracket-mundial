import { describe, expect, it } from 'vitest';
import { computeGroupTables, type GroupRow, type GroupTable } from './groups';
import {
  groupOutlooks,
  lockedSeeds,
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

  it('matches the official R32 schedule exactly, in UTC kickoff order', () => {
    // Ground truth: the official 2026 R32, ordered by UTC kickoff (the order the
    // fixtures sort into) — venue + both seeds per slot. Locks venue<->pairing
    // alignment so a team can never land at the wrong stadium.
    const OFFICIAL: [string, string, string][] = [
      ['SoFi Stadium', '2A', '2B'], // Los Angeles
      ['NRG Stadium', '1C', '2F'], // Houston
      ['Gillette Stadium', '1E', '3ABCDF'], // Boston
      ['Estadio BBVA', '1F', '2C'], // Monterrey
      ['AT&T Stadium', '2E', '2I'], // Dallas
      ['MetLife Stadium', '1I', '3CDFGH'], // New York/New Jersey
      ['Estadio Azteca', '1A', '3CEFHI'], // Mexico City
      ['Mercedes-Benz Stadium', '1L', '3EHIJK'], // Atlanta
      ['Lumen Field', '1G', '3AEHIJ'], // Seattle
      ["Levi's Stadium", '1D', '3BEFIJ'], // San Francisco Bay Area
      ['SoFi Stadium', '1H', '2J'], // Los Angeles
      ['BMO Field', '2K', '2L'], // Toronto
      ['BC Place', '1B', '3EFGIJ'], // Vancouver
      ['AT&T Stadium', '2D', '2G'], // Dallas
      ['Hard Rock Stadium', '1J', '2H'], // Miami
      ['Arrowhead Stadium', '1K', '3DEIJL'], // Kansas City
    ];
    expect(R32_PAIRINGS).toHaveLength(16);
    expect(
      R32_PAIRINGS.map((p) => [p.venue, seedLabel(p.home), seedLabel(p.away)])
    ).toEqual(OFFICIAL);
  });

  it('is ordered by kickoff (so it aligns with the kickoff-sorted fixtures)', () => {
    const times = R32_PAIRINGS.map((p) => Date.parse(p.kickoff));
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
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

});

describe('lockedSeeds', () => {
  it('locks 1st and 2nd once the group is fully decided', () => {
    // AAA 9, BBB 6, CCC 3, DDD 0 — all games played, every position settled.
    const matches = [
      match('Group A', 'AAA', 'BBB', 1, 0),
      match('Group A', 'AAA', 'CCC', 1, 0),
      match('Group A', 'AAA', 'DDD', 1, 0),
      match('Group A', 'BBB', 'CCC', 1, 0),
      match('Group A', 'BBB', 'DDD', 1, 0),
      match('Group A', 'CCC', 'DDD', 1, 0),
    ];
    const tables = computeGroupTables(matches);
    const locked = lockedSeeds(tables, matches);
    expect(locked['1A']?.team).toBe('AAA');
    expect(locked['2A']?.team).toBe('BBB');
    // Third place is never locked here (it depends on the cross-group race).
    expect(locked['3A']).toBeUndefined();
  });

  it('does not lock a position while 1st vs 2nd is still in play', () => {
    // After two rounds AAA and BBB are both on 6, CCC and DDD on 0. Final round:
    // AAA-BBB and CCC-DDD. Both AAA and BBB have clinched top two, but the head
    // game decides which is 1st — so neither can be placed in a single box yet.
    const matches = [
      match('Group B', 'AAA', 'CCC', 1, 0),
      match('Group B', 'AAA', 'DDD', 1, 0),
      match('Group B', 'BBB', 'CCC', 1, 0),
      match('Group B', 'BBB', 'DDD', 1, 0),
      match('Group B', 'AAA', 'BBB', null, null), // decides 1st vs 2nd
      match('Group B', 'CCC', 'DDD', null, null),
    ];
    const tables = computeGroupTables(matches);
    const locked = lockedSeeds(tables, matches);
    expect(locked['1B']).toBeUndefined();
    expect(locked['2B']).toBeUndefined();
  });

  it('locks 1st and 2nd while the group still has a game left to play', () => {
    // AAA and BBB are both done: AAA won all three (9), BBB won the two it could
    // (6). The only game left is CCC-DDD between the bottom two (max 3 each), so
    // it can't disturb the top two — AAA is locked 1st, BBB locked 2nd already.
    const matches = [
      match('Group C', 'AAA', 'BBB', 1, 0),
      match('Group C', 'AAA', 'CCC', 1, 0),
      match('Group C', 'AAA', 'DDD', 1, 0),
      match('Group C', 'BBB', 'CCC', 1, 0),
      match('Group C', 'BBB', 'DDD', 1, 0),
      match('Group C', 'CCC', 'DDD', null, null), // bottom two, can't reach the top
    ];
    const tables = computeGroupTables(matches);
    const locked = lockedSeeds(tables, matches);
    expect(locked['1C']?.team).toBe('AAA');
    expect(locked['2C']?.team).toBe('BBB');
  });
});

describe('groupOutlooks extra', () => {
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
