import { describe, expect, it } from 'vitest';
import { computeGroupTables } from './groups';
import type { Match } from './types';

let nextId = 1;

function match(
  group: string,
  home: string,
  away: string,
  hs: number | null,
  as_: number | null
): Match {
  return {
    id: nextId++,
    home_team: home,
    away_team: away,
    home_code: home.slice(0, 3).toUpperCase(),
    away_code: away.slice(0, 3).toUpperCase(),
    kickoff: '2026-06-15T18:00:00Z',
    stage: 'GROUP_STAGE',
    group_name: group,
    status: hs == null ? 'TIMED' : 'FINISHED',
    home_score: hs,
    away_score: as_,
    scored: hs != null,
    venue: null,
  };
}

describe('computeGroupTables', () => {
  it('builds zeroed tables before any game is played', () => {
    const tables = computeGroupTables([
      match('Group A', 'Mexico', 'South Africa', null, null),
      match('Group A', 'Canada', 'Morocco', null, null),
    ]);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(4);
    expect(tables[0].rows.every((r) => r.played === 0 && r.pts === 0)).toBe(true);
  });

  it('awards 3/1/0 points and computes goal stats', () => {
    const tables = computeGroupTables([
      match('Group A', 'Mexico', 'South Africa', 2, 0),
      match('Group A', 'Canada', 'Morocco', 1, 1),
    ]);
    const rows = tables[0].rows;
    const byTeam = Object.fromEntries(rows.map((r) => [r.team, r]));
    expect(byTeam['Mexico']).toMatchObject({ pts: 3, won: 1, gf: 2, ga: 0, gd: 2 });
    expect(byTeam['South Africa']).toMatchObject({ pts: 0, lost: 1, gd: -2 });
    expect(byTeam['Canada'].pts).toBe(1);
    expect(byTeam['Morocco'].pts).toBe(1);
    expect(rows[0].team).toBe('Mexico');
  });

  it('sorts by points, then goal difference, then goals scored', () => {
    const tables = computeGroupTables([
      // A beats D 3-0; B beats D 1-0; C beats D 4-2 (all on 3 pts, D on 0)
      match('Group B', 'AAA', 'DDD', 3, 0), // gd +3, gf 3
      match('Group B', 'BBB', 'DDD', 1, 0), // gd +1, gf 1
      match('Group B', 'CCC', 'DDD', 4, 2), // gd +2, gf 4
    ]);
    expect(tables[0].rows.map((r) => r.team)).toEqual(['AAA', 'CCC', 'BBB', 'DDD']);
  });

  it('breaks a full two-way tie with the head-to-head result', () => {
    const tables = computeGroupTables([
      // X and Y both finish 6 pts, +3 gd, 6 gf; Y won the mutual game.
      match('Group C', 'YYY', 'XXX', 1, 0), // Y wins h2h
      match('Group C', 'YYY', 'ZZZ', 4, 0),
      match('Group C', 'WWW', 'YYY', 3, 1),
      match('Group C', 'XXX', 'ZZZ', 3, 0),
      match('Group C', 'XXX', 'WWW', 3, 2),
    ]);
    const rows = tables[0].rows;
    const x = rows.findIndex((r) => r.team === 'XXX');
    const y = rows.findIndex((r) => r.team === 'YYY');
    const rx = rows[x];
    const ry = rows[y];
    // Confirm the tie is real, then Y must rank above X.
    expect([rx.pts, rx.gd, rx.gf]).toEqual([ry.pts, ry.gd, ry.gf]);
    expect(y).toBeLessThan(x);
  });

  it('ignores knockout matches and TBD placeholders', () => {
    const ko = match('', 'Mexico', 'Brazil', 1, 0);
    ko.group_name = null;
    ko.stage = 'LAST_32';
    const placeholder = match('Group D', 'TBD', 'Japan', null, null);
    const tables = computeGroupTables([ko, placeholder]);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows.map((r) => r.team)).toEqual(['Japan']);
  });
});
