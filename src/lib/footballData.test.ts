import { describe, expect, it } from 'vitest';
import { mergeKnockoutTeams, type FixtureRow } from './footballData';

function row(p: Partial<FixtureRow>): FixtureRow {
  return {
    id: 1,
    home_team: 'TBD',
    away_team: 'TBD',
    home_code: null,
    away_code: null,
    kickoff: '2026-06-28T19:00:00.000Z',
    stage: 'LAST_32',
    group_name: null,
    status: 'SCHEDULED',
    home_score: null,
    away_score: null,
    venue: null,
    ...p,
  };
}

const T1 = '2026-06-29T17:00:00.000Z'; // e.g. Boston
const T2 = '2026-06-29T21:30:00.000Z'; // e.g. Monterrey (same day, later)

describe('mergeKnockoutTeams', () => {
  it('fills a TBD knockout slot from a confirmed openfootball team', () => {
    const fd = [row({ id: 100 })];
    const of = [row({ id: 1, home_team: 'Germany', away_team: '3A/B/C/D/F' })];
    mergeKnockoutTeams(fd, of);
    expect(fd[0].home_team).toBe('Germany');
    expect(fd[0].home_code).toBe('GER');
    // The away side is still a placeholder in openfootball, so it stays TBD.
    expect(fd[0].away_team).toBe('TBD');
    expect(fd[0].away_code).toBeNull();
  });

  it('pairs by kickoff time, not list order (the misplacement regression)', () => {
    // Two same-day knockout fixtures; openfootball lists them in reverse order.
    const fd = [row({ id: 74, kickoff: T1 }), row({ id: 75, kickoff: T2 })];
    const of = [
      row({ id: 2, kickoff: T2, home_team: 'Netherlands' }),
      row({ id: 1, kickoff: T1, home_team: 'Germany' }),
    ];
    mergeKnockoutTeams(fd, of);
    const m74 = fd.find((m) => m.id === 74)!;
    const m75 = fd.find((m) => m.id === 75)!;
    expect(m74.home_team).toBe('Germany'); // T1 fixture gets the T1 team
    expect(m74.home_code).toBe('GER');
    expect(m75.home_team).toBe('Netherlands'); // T2 fixture gets the T2 team
    expect(m75.home_code).toBe('NED');
  });

  it('never overwrites a team football-data already has', () => {
    const fd = [row({ id: 100, home_team: 'Brazil', home_code: 'BRA' })];
    const of = [row({ id: 1, home_team: 'Germany' })];
    mergeKnockoutTeams(fd, of);
    expect(fd[0].home_team).toBe('Brazil');
    expect(fd[0].home_code).toBe('BRA');
  });

  it('ignores group-stage rows and leaves TBD when no kickoff matches', () => {
    const fd = [row({ id: 100, kickoff: T1 })];
    const ofGroup = row({ id: 1, kickoff: T1, group_name: 'Group A', stage: 'GROUP_STAGE', home_team: 'Germany' });
    const ofOtherTime = row({ id: 2, kickoff: T2, home_team: 'Germany' });
    mergeKnockoutTeams(fd, [ofGroup, ofOtherTime]);
    expect(fd[0].home_team).toBe('TBD');
  });
});
