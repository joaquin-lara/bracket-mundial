import { describe, it, expect } from 'vitest';
import {
  ACHIEVEMENTS,
  evaluate,
  type EvalContext,
  type MatchInfo,
  type PredInfo,
  type DuelInfo,
  type DuelRound,
} from './achievements';
import { PLATINUM_REQUIRED_IDS } from './achievementsList';

const PLAYERS = ['u1', 'u2', 'u3', 'u4'];

function match(id: number, over: Partial<MatchInfo> = {}): MatchInfo {
  return {
    id,
    stage: 'GROUP_STAGE',
    groupName: 'Group A',
    venue: 'Dallas',
    kickoff: `2026-06-${String((id % 27) + 1).padStart(2, '0')}T18:00:00Z`,
    status: 'FINISHED',
    homeScore: 1,
    awayScore: 0,
    homeCode: null, // null keeps the model out of the way for core tests
    awayCode: null,
    ...over,
  };
}

function pred(userId: string, matchId: number, ph: number, pa: number, points: number | null, over: Partial<PredInfo> = {}): PredInfo {
  return { userId, matchId, predHome: ph, predAway: pa, points, updatedAt: '2026-06-01T00:00:00Z', ...over };
}

function baseCtx(over: Partial<EvalContext> = {}): EvalContext {
  return {
    players: PLAYERS,
    matches: [],
    predictions: [],
    duels: [],
    standings: [],
    tournamentComplete: false,
    ...over,
  };
}

describe('achievement definitions', () => {
  it('has 77 unique ids', () => {
    expect(ACHIEVEMENTS).toHaveLength(77);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(77);
  });
  it('every achievement has a non-empty name, emoji and description', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.emoji.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
    }
  });

  it('Platinum requires the 72 non-placement badges (excludes itself + Final Standings)', () => {
    expect(PLATINUM_REQUIRED_IDS).toHaveLength(72);
    expect(PLATINUM_REQUIRED_IDS).not.toContain('platinum');
    expect(PLATINUM_REQUIRED_IDS).not.toContain('champion');
    expect(PLATINUM_REQUIRED_IDS).not.toContain('better_luck_next_time');
  });
});

describe('exact-score badges', () => {
  it('awards Nostradamus at 3 exacts and Smash and Grab / Park the Bus by scoreline', () => {
    const matches = [
      match(1, { homeScore: 1, awayScore: 0 }),
      match(2, { homeScore: 0, awayScore: 0 }),
      match(3, { homeScore: 2, awayScore: 1 }),
    ];
    const predictions = [
      pred('u1', 1, 1, 0, 3),
      pred('u1', 2, 0, 0, 3),
      pred('u1', 3, 2, 1, 3),
    ];
    const earned = evaluate(baseCtx({ matches, predictions })).get('u1')!;
    expect(earned.has('nostradamus')).toBe(true);
    expect(earned.has('smash_and_grab')).toBe(true);
    expect(earned.has('park_the_bus')).toBe(true);
    expect(earned.has('mirror_match')).toBe(true); // 0-0 is a draw
    expect(earned.has('nostradamus_prime')).toBe(false);
  });

  it('Goal Fest and Goleada need the right scoreline shape', () => {
    const matches = [match(1, { homeScore: 4, awayScore: 2 }), match(2, { homeScore: 5, awayScore: 0 })];
    const predictions = [pred('u1', 1, 4, 2, 3), pred('u1', 2, 5, 0, 3)];
    const earned = evaluate(baseCtx({ matches, predictions })).get('u1')!;
    expect(earned.has('goal_fest')).toBe(true); // 6 total goals
    expect(earned.has('goleada')).toBe(true); // 5-0 margin
  });
});

describe('Mic Drop', () => {
  it('fires only when no rival got the outcome', () => {
    const matches = [match(1, { homeScore: 2, awayScore: 1 })];
    const predictions = [
      pred('u1', 1, 2, 1, 3), // exact
      pred('u2', 1, 0, 1, 1), // miss
      pred('u3', 1, 0, 3, 1), // miss
      // u4 no pick at all
    ];
    expect(evaluate(baseCtx({ matches, predictions })).get('u1')!.has('mic_drop')).toBe(true);
  });
  it('does not fire if a rival got the outcome (2 pts)', () => {
    const matches = [match(1, { homeScore: 2, awayScore: 1 })];
    const predictions = [pred('u1', 1, 2, 1, 3), pred('u2', 1, 3, 0, 2)];
    expect(evaluate(baseCtx({ matches, predictions })).get('u1')!.has('mic_drop')).toBe(false);
  });
});

describe('streaks', () => {
  it('Hot Streak at 5 correct outcomes in a row, On Fire needs 10', () => {
    const matches = Array.from({ length: 6 }, (_, i) => match(i + 1));
    const predictions = matches.map((m, i) => pred('u1', m.id, 1, 0, i < 5 ? 2 : 1));
    const earned = evaluate(baseCtx({ matches, predictions })).get('u1')!;
    expect(earned.has('hot_streak')).toBe(true);
    expect(earned.has('on_fire')).toBe(false);
  });

  it('Frostbite at 5 misses in a row', () => {
    const matches = Array.from({ length: 5 }, (_, i) => match(i + 1));
    const predictions = matches.map((m) => pred('u1', m.id, 9, 9, 1));
    expect(evaluate(baseCtx({ matches, predictions })).get('u1')!.has('frostbite')).toBe(true);
  });

  it('Redemption: 5 misses then 5 correct', () => {
    const matches = Array.from({ length: 10 }, (_, i) => match(i + 1));
    const predictions = matches.map((m, i) => pred('u1', m.id, 1, 0, i < 5 ? 1 : 2));
    expect(evaluate(baseCtx({ matches, predictions })).get('u1')!.has('redemption')).toBe(true);
  });
});

describe('milestones', () => {
  it('points and appearance tiers', () => {
    // 25 matches, 2 pts each = 50 points
    const matches = Array.from({ length: 25 }, (_, i) => match(i + 1));
    const predictions = matches.map((m) => pred('u1', m.id, 1, 0, 2));
    const earned = evaluate(baseCtx({ matches, predictions })).get('u1')!;
    expect(earned.has('half_century')).toBe(true); // 50 pts
    expect(earned.has('squad_player')).toBe(true); // 25 picks
    expect(earned.has('marksman')).toBe(true); // 20+ correct outcomes
    expect(earned.has('centurion')).toBe(false);
  });
});

describe('Ambitious / High Roller', () => {
  it('Ambitious fires on a bold bet; High Roller needs the outcome too', () => {
    const matches = [match(1, { homeScore: 6, awayScore: 0 }), match(2, { homeScore: 0, awayScore: 0 })];
    const predictions = [pred('u1', 1, 6, 0, 3), pred('u1', 2, 7, 0, 1)];
    const earned = evaluate(baseCtx({ matches, predictions })).get('u1')!;
    expect(earned.has('ambitious')).toBe(true);
    expect(earned.has('high_roller')).toBe(true); // match 1: 6-0 bet, exact
  });
});

describe('Down to the Wire', () => {
  it('fires when locked within 2 minutes of the cutoff', () => {
    const kickoff = '2026-06-10T18:00:00Z';
    // lock = kickoff - 10min = 17:50; pick at 17:49 is within the final 2 min
    const matches = [match(1, { kickoff })];
    const predictions = [pred('u1', 1, 1, 0, 2, { updatedAt: '2026-06-10T17:49:00Z' })];
    expect(evaluate(baseCtx({ matches, predictions })).get('u1')!.has('down_to_the_wire')).toBe(true);
  });
  it('does not fire for an early pick', () => {
    const matches = [match(1, { kickoff: '2026-06-10T18:00:00Z' })];
    const predictions = [pred('u1', 1, 1, 0, 2, { updatedAt: '2026-06-09T12:00:00Z' })];
    expect(evaluate(baseCtx({ matches, predictions })).get('u1')!.has('down_to_the_wire')).toBe(false);
  });
});

describe('duels', () => {
  function duel(id: string, challenger: string, opponent: string, winner: string, over: Partial<DuelInfo> = {}): DuelInfo {
    return {
      id,
      challenger,
      opponent,
      status: 'finished',
      winner,
      challengerScore: winner === challenger ? 3 : 1,
      opponentScore: winner === challenger ? 1 : 3,
      rounds: [],
      finishedAt: `2026-06-${id.padStart(2, '0')}T20:00:00Z`,
      ...over,
    };
  }

  it('First Blood and Shootout King by win count', () => {
    const duels = Array.from({ length: 5 }, (_, i) => duel(String(i + 1), 'u1', 'u2', 'u1'));
    const earned = evaluate(baseCtx({ duels })).get('u1')!;
    expect(earned.has('first_blood')).toBe(true);
    expect(earned.has('shootout_king')).toBe(true);
    expect(earned.has('unbeaten_run')).toBe(true); // 5 in a row
    expect(earned.has('nemesis')).toBe(true); // beat u2 thrice+
  });

  it('Clean Sheet when the opponent scores zero', () => {
    const duels = [duel('1', 'u1', 'u2', 'u1', { challengerScore: 3, opponentScore: 0 })];
    expect(evaluate(baseCtx({ duels })).get('u1')!.has('clean_sheet')).toBe(true);
  });

  it('Comeback King reconstructs a 2+ goal deficit from rounds', () => {
    const rounds: DuelRound[] = [
      { kick: 1, shooter: 'u1', shot: 'left', dive: 'left', goal: false }, // u1 misses
      { kick: 2, shooter: 'u2', shot: 'left', dive: 'right', goal: true }, // u2 scores (0-1)
      { kick: 3, shooter: 'u1', shot: 'left', dive: 'left', goal: false }, // u1 misses
      { kick: 4, shooter: 'u2', shot: 'left', dive: 'right', goal: true }, // u2 scores (0-2)
      { kick: 5, shooter: 'u1', shot: 'left', dive: 'right', goal: true }, // u1 (1-2)
      { kick: 6, shooter: 'u2', shot: 'left', dive: 'left', goal: false },
      { kick: 7, shooter: 'u1', shot: 'left', dive: 'right', goal: true }, // u1 (2-2)
      { kick: 8, shooter: 'u2', shot: 'left', dive: 'left', goal: false },
      { kick: 9, shooter: 'u1', shot: 'left', dive: 'right', goal: true }, // u1 (3-2) wins
    ];
    const duels: DuelInfo[] = [
      { id: '1', challenger: 'u1', opponent: 'u2', status: 'finished', winner: 'u1', challengerScore: 3, opponentScore: 2, rounds, finishedAt: '2026-06-10T20:00:00Z' },
    ];
    expect(evaluate(baseCtx({ duels })).get('u1')!.has('comeback_king')).toBe(true);
  });
});

describe('placement', () => {
  it('awards only when the tournament is complete', () => {
    const standings = [
      { userId: 'u1', total: 200 },
      { userId: 'u2', total: 150 },
      { userId: 'u3', total: 100 },
      { userId: 'u4', total: 50 },
    ];
    const open = evaluate(baseCtx({ standings, tournamentComplete: false }));
    expect(open.get('u1')!.has('champion')).toBe(false);

    const done = evaluate(baseCtx({ standings, tournamentComplete: true }));
    expect(done.get('u1')!.has('champion')).toBe(true);
    expect(done.get('u2')!.has('runner_up')).toBe(true);
    expect(done.get('u3')!.has('podium_finish')).toBe(true);
    expect(done.get('u4')!.has('better_luck_next_time')).toBe(true);
  });
});
