import { describe, expect, it } from 'vitest';
import { legResolvable, legWon, type LegLike } from './gamblers';
import type { MatchStats } from './types';

function leg(overrides: Partial<LegLike>): LegLike {
  return {
    match_id: 1,
    market: 'winner',
    side: null,
    comparator: null,
    line: null,
    pick: null,
    pick_home_score: null,
    pick_away_score: null,
    ...overrides,
  };
}

const stats: MatchStats = {
  home: {
    shotsOnGoal: 5, shotsOffGoal: 3, totalShots: 10, blockedShots: 2,
    shotsInsideBox: 6, shotsOutsideBox: 4, fouls: 8, cornerKicks: 6,
    offsides: 1, possession: 60, yellowCards: 2, redCards: 0, goalkeeperSaves: 3,
  },
  away: {
    shotsOnGoal: 2, shotsOffGoal: 4, totalShots: 8, blockedShots: 1,
    shotsInsideBox: 3, shotsOutsideBox: 5, fouls: 11, cornerKicks: 3,
    offsides: 2, possession: 40, yellowCards: 4, redCards: 1, goalkeeperSaves: 1,
  },
};

describe('legResolvable', () => {
  it('winner/exact_score resolve as soon as scores exist, even without stats', () => {
    const result = { home_score: 2, away_score: 1, stats: null };
    expect(legResolvable(leg({ market: 'winner', pick: 'home' }), result)).toBe(true);
    expect(legResolvable(leg({ market: 'exact_score', pick_home_score: 2, pick_away_score: 1 }), result)).toBe(true);
  });

  it('stat markets stay unresolvable until match_stats is populated', () => {
    const result = { home_score: 2, away_score: 1, stats: null };
    expect(legResolvable(leg({ market: 'corners', side: 'home', comparator: 'over', line: 4.5 }), result)).toBe(false);
  });

  it('stat markets resolve once match_stats is present', () => {
    const result = { home_score: 2, away_score: 1, stats };
    expect(legResolvable(leg({ market: 'corners', side: 'home', comparator: 'over', line: 4.5 }), result)).toBe(true);
  });

  it('is unresolvable with no result at all', () => {
    expect(legResolvable(leg({ market: 'winner', pick: 'home' }), undefined)).toBe(false);
  });
});

describe('legWon', () => {
  const result = { home_score: 2, away_score: 1, stats };

  it('winner: matches resultLabel', () => {
    expect(legWon(leg({ market: 'winner', pick: 'home' }), result)).toBe(true);
    expect(legWon(leg({ market: 'winner', pick: 'away' }), result)).toBe(false);
    expect(legWon(leg({ market: 'winner', pick: 'draw' }), result)).toBe(false);
  });

  it('exact_score: both numbers must match', () => {
    expect(legWon(leg({ market: 'exact_score', pick_home_score: 2, pick_away_score: 1 }), result)).toBe(true);
    expect(legWon(leg({ market: 'exact_score', pick_home_score: 2, pick_away_score: 2 }), result)).toBe(false);
  });

  it('stat market, side=home: reads the home value', () => {
    expect(legWon(leg({ market: 'corners', side: 'home', comparator: 'over', line: 4.5 }), result)).toBe(true);
    expect(legWon(leg({ market: 'corners', side: 'home', comparator: 'under', line: 4.5 }), result)).toBe(false);
  });

  it('stat market, side=total: sums both teams', () => {
    // total corners = 6 + 3 = 9
    expect(legWon(leg({ market: 'corners', side: 'total', comparator: 'over', line: 8.5 }), result)).toBe(true);
    expect(legWon(leg({ market: 'corners', side: 'total', comparator: 'under', line: 8.5 }), result)).toBe(false);
  });

  it('possession reads the raw percentage per side', () => {
    expect(legWon(leg({ market: 'possession', side: 'home', comparator: 'over', line: 55.5 }), result)).toBe(true);
    expect(legWon(leg({ market: 'possession', side: 'away', comparator: 'over', line: 55.5 }), result)).toBe(false);
  });

  it('red_cards: under works when the value is 0', () => {
    expect(legWon(leg({ market: 'red_cards', side: 'home', comparator: 'under', line: 0.5 }), result)).toBe(true);
    expect(legWon(leg({ market: 'red_cards', side: 'away', comparator: 'under', line: 0.5 }), result)).toBe(false);
  });
});
