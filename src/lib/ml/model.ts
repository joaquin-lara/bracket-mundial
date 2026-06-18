// The predictor itself. Pure functions: feed it two teams, get back calibrated
// win/draw/loss probabilities, expected goals and a scoreline distribution.
//
// Goal model: Dixon-Coles. Each team carries an attack and a defense rating
// (learned over 150 years of results in build:elo). A match's expected goals are
// one side's attack against the other's defense; those two Poisson means give a
// scoreline grid, which a low-score correction tilts toward draws (real football
// has more 0-0 / 1-1 than independent goals predict). This beat the old Elo +
// independent-Poisson model out of sample (see scripts/backtest.ts). The final
// W/D/L is a *blend* of three signals that make different errors, so the average
// is steadier in every era (scripts/rolling-validation.ts, squad-rolling.ts):
// Dixon-Coles (form/attack-defence) 60% + Elo (overall strength) 40%, then mixed
// 70/30 with a FIFA squad talent-pool model on teams that have a squad rating.
// The scoreline distribution and expected goals stay pure Dixon-Coles.

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
  scoreGrid: number[][]; // [homeGoals][awayGoals] probability, 0..5 each
}

const MAX_GOALS = 8;
// The live W/D/L is a blend of Dixon-Coles with the Elo + independent-Poisson
// model. The two make different errors, so the average is steadier out of sample
// -- it beats DC alone in every 2-year window (scripts/rolling-validation.ts).
const BLEND_ELO_WEIGHT = 0.4; // 40% Elo+Poisson, 60% Dixon-Coles

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

/** Win/draw/loss from the Elo + independent-Poisson model (no draw correction). */
function eloPoissonWDL(eloGap: number): { pHome: number; pDraw: number; pAway: number } {
  const { lambdaHome, lambdaAway } = expectedGoals(eloGap);
  const g = scoreGrid(lambdaHome, lambdaAway, MAX_GOALS);
  return { pHome: g.pHome, pDraw: g.pDraw, pAway: g.pAway };
}

/**
 * Win/draw/loss from the FIFA squad talent-pool model (mean overall of each
 * nation's best 23), or null when either side has no squad rating. Rolling-
 * window validated to add on top of the DC+Elo blend; mixed at MODEL.squad.weight.
 */
function squadWDL(home: TeamRating, away: TeamRating): { pHome: number; pDraw: number; pAway: number } | null {
  const sq = MODEL.squad;
  if (!sq || home.squad == null || away.squad == null) return null;
  const supremacy = (home.squad - away.squad) * sq.goalsPerStr;
  const half = MODEL.avgTotalGoals / 2;
  const g = scoreGrid(Math.max(0.15, half + supremacy / 2), Math.max(0.15, half - supremacy / 2), MAX_GOALS);
  return { pHome: g.pHome, pDraw: g.pDraw, pAway: g.pAway };
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

  // Compact 6x6 scoreline matrix (0..5 goals each side) for the heatmap UI.
  const scoreGridMatrix = Array.from({ length: 6 }, () => Array<number>(6).fill(0));
  for (const c of grid.cells) {
    if (c.home <= 5 && c.away <= 5) scoreGridMatrix[c.home][c.away] = c.prob;
  }

  const eloGap = home.elo - away.elo + (neutral ? 0 : MODEL.homeAdvantageElo);

  // Blend DC's W/D/L with the Elo+Poisson model's (robust win, see above). The
  // scoreline distribution / expected goals stay pure Dixon-Coles -- the blend
  // only steadies the headline win/draw/win split.
  const eloWDL = eloPoissonWDL(eloGap);
  const w = BLEND_ELO_WEIGHT;
  let probHome = (1 - w) * grid.pHome + w * eloWDL.pHome;
  let probDraw = (1 - w) * grid.pDraw + w * eloWDL.pDraw;
  let probAway = (1 - w) * grid.pAway + w * eloWDL.pAway;

  // Mix in the FIFA squad talent-pool model when both teams are rated (a third,
  // orthogonal signal: results + Elo strength + squad talent). Robust across
  // every rolling window; see scripts/squad-rolling.ts.
  const squad = squadWDL(home, away);
  if (squad && MODEL.squad) {
    const sw = MODEL.squad.weight;
    probHome = (1 - sw) * probHome + sw * squad.pHome;
    probDraw = (1 - sw) * probDraw + sw * squad.pDraw;
    probAway = (1 - sw) * probAway + sw * squad.pAway;
  }

  return {
    home,
    away,
    neutral,
    eloGap,
    expectedWinHome: expectedWin(eloGap),
    lambdaHome,
    lambdaAway,
    probHome,
    probDraw,
    probAway,
    mostLikelyScore: { home: top.home, away: top.away, prob: top.prob },
    topScores: sorted.slice(0, 6),
    scoreGrid: scoreGridMatrix,
  };
}

/** Round a probability to a clean percentage string. */
export function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}
