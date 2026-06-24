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

  it('never overwrites a team football-data already has', () => {
    const fd = [row({ id: 100, home_team: 'Brazil', home_code: 'BRA' })];
    const of = [row({ id: 1, home_team: 'Germany' })];
    mergeKnockoutTeams(fd, of);
    expect(fd[0].home_team).toBe('Brazil');
    expect(fd[0].home_code).toBe('BRA');
  });

  it('ignores group-stage rows and day mismatches', () => {
    const fd = [row({ id: 100, kickoff: '2026-06-28T19:00:00.000Z' })];
    const ofGroup = row({ id: 1, group_name: 'Group A', stage: 'GROUP_STAGE', home_team: 'Germany' });
    const ofWrongDay = row({ id: 2, home_team: 'Germany', kickoff: '2026-06-29T19:00:00.000Z' });
    mergeKnockoutTeams(fd, [ofGroup, ofWrongDay]);
    expect(fd[0].home_team).toBe('TBD');
  });
});
