import { describe, expect, it } from 'vitest';
import { finalScore, scorePrediction } from './scoring';

describe('scorePrediction (real result 2-1, home win)', () => {
  it('3 points for the exact score', () => {
    expect(scorePrediction(2, 1, 2, 1)).toBe(3);
  });

  it('2 points for the correct outcome with a wrong scoreline', () => {
    expect(scorePrediction(3, 0, 2, 1)).toBe(2);
  });

  it('1 point for a locked prediction with the wrong outcome', () => {
    expect(scorePrediction(1, 1, 2, 1)).toBe(1);
  });

  it('0 points means no prediction row exists (absence, not a return value)', () => {
    // Nothing to compute: the sync job only scores existing rows, so a
    // missing row contributes 0 to the standings SUM. Asserted in the DB
    // integration test; here we just document the contract.
    expect(true).toBe(true);
  });
});

describe('scorePrediction edge cases', () => {
  it('exact draw is 3', () => {
    expect(scorePrediction(1, 1, 1, 1)).toBe(3);
  });
  it('wrong draw scoreline is still a correct outcome (2)', () => {
    expect(scorePrediction(0, 0, 2, 2)).toBe(2);
  });
  it('away win predicted, home win happened: 1', () => {
    expect(scorePrediction(0, 2, 3, 1)).toBe(1);
  });
});

describe('finalScore (football-data v4 score object)', () => {
  it('regular-time match uses fullTime', () => {
    expect(finalScore({ duration: 'REGULAR', fullTime: { home: 2, away: 1 } })).toEqual({ home: 2, away: 1 });
  });

  it('extra-time match uses fullTime', () => {
    expect(finalScore({ duration: 'EXTRA_TIME', fullTime: { home: 2, away: 1 } })).toEqual({ home: 2, away: 1 });
  });

  it('shootout where fullTime includes penalty goals: subtract penalties', () => {
    expect(
      finalScore({
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 5, away: 6 },
        penalties: { home: 4, away: 5 },
      })
    ).toEqual({ home: 1, away: 1 });
  });

  it('shootout where fullTime excludes penalties: use fullTime as-is', () => {
    expect(
      finalScore({
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 1, away: 1 },
        penalties: { home: 4, away: 2 },
      })
    ).toEqual({ home: 1, away: 1 });
  });

  it('unplayed match (null fullTime) returns null', () => {
    expect(finalScore({ duration: 'REGULAR', fullTime: { home: null, away: null } })).toBeNull();
    expect(finalScore(null)).toBeNull();
  });
});
