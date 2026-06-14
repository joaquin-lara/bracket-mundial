// The predictor itself. Pure functions: feed it two teams, get back calibrated
// win/draw/loss probabilities, expected goals and a scoreline distribution.
//
// Goal model: Dixon-Coles. Each team carries an attack and a defense rating
// (learned over 150 years of results in build:elo). A match's expected goals are
// one side's attack against the other's defense; those two Poisson means give a
// scoreline grid, which a low-score correction tilts toward draws (real football
// has more 0-0 / 1-1 than independent goals predict). This beat the old Elo +
// independent-Poisson model out of sample (see scripts/backtest.ts). Elo is kept
// only as the human-readable overall-strength number shown on screen.

import { MODEL, lookup, type TeamRating } from './teams';
import { scoreGrid, type ScoreCell } from './poisson';

export interface PredictInput {
  /** Team identifier (TLA code or name) playing at "home" in the data sense. */
  home: string;
  away: string;
  /** Neutral venue (true for almost every World Cup match). Default true. */
  neutral?: boolean;
}

export interface PredictResult {
  home: TeamRating;
  away: TeamRating;
  neutral: boolean;
  eloGap: number; // home Elo - away Elo (+ home advantage if not neutral)
  expectedWinHome: number; // logistic expectation on the Elo gap (0..1)
  lambdaHome: number; // expected goals, home (Dixon-Coles)
  lambdaAway: number; // expected goals, away (Dixon-Coles)
  probHome: number;
  probDraw: number;
  probAway: number;
  mostLikelyScore: { home: number; away: number; prob: number };
  topScores: ScoreCell[]; // top scorelines by probability, descending
}

const MAX_GOALS = 8;

/** Logistic expected score for the home side given the Elo gap. */
export function expectedWin(eloGap: number): number {
  return 1 / (1 + Math.pow(10, -eloGap / 400));
}

/**
 * Elo-gap goal means (legacy helper). The live predictor now uses Dixon-Coles
 * attack/defense (see `dcGoals`); this remains for the Elo-based comparison and
 * is kept under test.
 */
export function expectedGoals(eloGap: number): { lambdaHome: number; lambdaAway: number } {
  const supremacy = eloGap * MODEL.goalsPerElo;
  const half = MODEL.avgTotalGoals / 2;
  return {
    lambdaHome: Math.max(0.15, half + supremacy / 2),
    lambdaAway: Math.max(0.15, half - supremacy / 2),
  };
}

/** Dixon-Coles goal means: a team's attack against the opponent's defense. */
export function dcGoals(
  home: TeamRating,
  away: TeamRating,
  neutral: boolean
): { lambdaHome: number; lambdaAway: number } {
  const { base, home: homeAdv } = MODEL.dc;
  return {
    lambdaHome: Math.exp(base + (neutral ? 0 : homeAdv) + home.dcAtt - away.dcDef),
    lambdaAway: Math.exp(base + away.dcAtt - home.dcDef),
  };
}

/**
 * Dixon-Coles low-score correction over a Poisson scoreline grid. The four
 * lowest cells are tilted by tau (rho < 0 inflates draws), then the grid is
 * renormalised. Returns the corrected cells and the marginal W/D/L totals.
 */
function dixonColes(
  lambdaHome: number,
  lambdaAway: number,
  rho: number
): { cells: ScoreCell[]; pHome: number; pDraw: number; pAway: number } {
  const grid = scoreGrid(lambdaHome, lambdaAway, MAX_GOALS);
  const cells: ScoreCell[] = [];
  let pHome = 0,
    pDraw = 0,
    pAway = 0,
    total = 0;
  for (const c of grid.cells) {
    let tau = 1;
    if (c.home === 0 && c.away === 0) tau = 1 - lambdaHome * lambdaAway * rho;
    else if (c.home === 0 && c.away === 1) tau = 1 + lambdaHome * rho;
    else if (c.home === 1 && c.away === 0) tau = 1 + lambdaAway * rho;
    else if (c.home === 1 && c.away === 1) tau = 1 - rho;
    const prob = Math.max(0, c.prob * tau);
    cells.push({ home: c.home, away: c.away, prob });
    total += prob;
  }
  // Renormalise (the tau tilt changes the total slightly) and tally W/D/A.
  for (const c of cells) {
    c.prob /= total;
    if (c.home > c.away) pHome += c.prob;
    else if (c.home === c.away) pDraw += c.prob;
    else pAway += c.prob;
  }
  return { cells, pHome, pDraw, pAway };
}

export function predict(input: PredictInput): PredictResult | null {
  const home = lookup(input.home);
  const away = lookup(input.away);
  if (!home || !away) return null;

  const neutral = input.neutral ?? true;
  const { lambdaHome, lambdaAway } = dcGoals(home, away, neutral);

  const grid = dixonColes(lambdaHome, lambdaAway, MODEL.dc.rho);
  const sorted = [...grid.cells].sort((a, b) => b.prob - a.prob);
  const top = sorted[0];

  // Elo gap retained for the on-screen strength readout, not the goal model.
  const eloGap = home.elo - away.elo + (neutral ? 0 : MODEL.homeAdvantageElo);

  return {
    home,
    away,
    neutral,
    eloGap,
    expectedWinHome: expectedWin(eloGap),
    lambdaHome,
    lambdaAway,
    probHome: grid.pHome,
    probDraw: grid.pDraw,
    probAway: grid.pAway,
    mostLikelyScore: { home: top.home, away: top.away, prob: top.prob },
    topScores: sorted.slice(0, 6),
  };
}

/** Round a probability to a clean percentage string. */
export function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}
