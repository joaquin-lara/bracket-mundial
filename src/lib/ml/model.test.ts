import { describe, it, expect } from 'vitest';
import { predict, expectedWin, expectedGoals, dcGoals, pct } from './model';
import { scoreGrid } from './poisson';
import { lookup, TEAMS } from './teams';

describe('team lookup', () => {
  it('has all 48 qualified teams', () => {
    expect(TEAMS).toHaveLength(48);
  });

  it('resolves by TLA code and by name, however spelled', () => {
    expect(lookup('ARG')?.name).toBe('Argentina');
    expect(lookup('Argentina')?.code).toBe('ARG');
    expect(lookup('USA')?.code).toBe('USA');
    expect(lookup('United States')?.code).toBe('USA');
    expect(lookup('Korea Republic')?.code).toBe('KOR');
    expect(lookup('Czechia')?.code).toBe('CZE');
  });

  it('returns null for non-qualified teams', () => {
    expect(lookup('Italy')).toBeNull();
    expect(lookup('XYZ')).toBeNull();
    expect(lookup('')).toBeNull();
  });
});

describe('elo helpers', () => {
  it('expectedWin is 0.5 at level pegging and monotonic', () => {
    expect(expectedWin(0)).toBeCloseTo(0.5, 6);
    expect(expectedWin(200)).toBeGreaterThan(0.5);
    expect(expectedWin(-200)).toBeLessThan(0.5);
  });

  it('a positive gap means the favourite scores more', () => {
    const { lambdaHome, lambdaAway } = expectedGoals(300);
    expect(lambdaHome).toBeGreaterThan(lambdaAway);
    expect(lambdaAway).toBeGreaterThanOrEqual(0.15);
  });
});

describe('predict', () => {
  it('returns null when a team is unknown', () => {
    expect(predict({ home: 'ARG', away: 'Italy' })).toBeNull();
  });

  it('produces probabilities that sum to ~1', () => {
    const r = predict({ home: 'ESP', away: 'BRA' })!;
    expect(r).not.toBeNull();
    expect(r.probHome + r.probDraw + r.probAway).toBeCloseTo(1, 3);
  });

  it('rates the much stronger side as the clear favourite', () => {
    const r = predict({ home: 'ARG', away: 'HAI' })!;
    expect(r.probHome).toBeGreaterThan(r.probAway);
    expect(r.probHome).toBeGreaterThan(0.7);
  });

  it('is symmetric: swapping sides swaps the win probabilities', () => {
    const a = predict({ home: 'FRA', away: 'JPN', neutral: true })!;
    const b = predict({ home: 'JPN', away: 'FRA', neutral: true })!;
    expect(a.probHome).toBeCloseTo(b.probAway, 6);
    expect(a.probAway).toBeCloseTo(b.probHome, 6);
    expect(a.probDraw).toBeCloseTo(b.probDraw, 6);
  });

  it('home advantage helps the home side when not neutral', () => {
    const neutral = predict({ home: 'MEX', away: 'CAN', neutral: true })!;
    const home = predict({ home: 'MEX', away: 'CAN', neutral: false })!;
    expect(home.probHome).toBeGreaterThan(neutral.probHome);
  });

  it('returns six scorelines, most likely first', () => {
    const r = predict({ home: 'ESP', away: 'BRA' })!;
    expect(r.topScores).toHaveLength(6);
    expect(r.topScores[0].prob).toBeGreaterThanOrEqual(r.topScores[1].prob);
    expect(r.mostLikelyScore.prob).toBeCloseTo(r.topScores[0].prob, 6);
  });
});

describe('dixon-coles goal model', () => {
  it('pits attack against the opposite defense; favourite scores more', () => {
    const arg = lookup('ARG')!;
    const hai = lookup('HAI')!;
    const { lambdaHome, lambdaAway } = dcGoals(arg, hai, true);
    expect(lambdaHome).toBeGreaterThan(lambdaAway);
    expect(lambdaAway).toBeGreaterThan(0);
  });

  it('home advantage lifts the home goal mean on a non-neutral ground', () => {
    const mex = lookup('MEX')!;
    const can = lookup('CAN')!;
    expect(dcGoals(mex, can, false).lambdaHome).toBeGreaterThan(
      dcGoals(mex, can, true).lambdaHome
    );
  });

  it('inflates draws vs an independent Poisson at the same goal means', () => {
    const r = predict({ home: 'ESP', away: 'FRA', neutral: true })!;
    const independent = scoreGrid(r.lambdaHome, r.lambdaAway).pDraw;
    expect(r.probDraw).toBeGreaterThan(independent);
  });
});

describe('pct', () => {
  it('formats a probability', () => {
    expect(pct(0.5)).toBe('50.0%');
  });
});
