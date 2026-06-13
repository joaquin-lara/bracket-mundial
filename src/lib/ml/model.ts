// The predictor itself. Pure functions: feed it two teams, get back calibrated
// win/draw/loss probabilities, expected goals and a scoreline distribution.
//
// Pipeline, in three steps:
//   1. Elo gap  -> a single number capturing the strength difference.
//   2. Gap      -> expected goals for each side (Poisson means), using the two
//                  constants fitted from 150 years of results in build:elo.
//   3. Poisson  -> win/draw/loss probabilities and the most likely scorelines.

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
  lambdaHome: number; // expected goals, home
  lambdaAway: number; // expected goals, away
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
 * Turn two ratings into Poisson goal means. Average match goals split evenly,
 * then tilted by the strength gap: each Elo point is worth `goalsPerElo` goals
 * of supremacy (both numbers measured from the dataset).
 */
export function expectedGoals(eloGap: number): { lambdaHome: number; lambdaAway: number } {
  const supremacy = eloGap * MODEL.goalsPerElo;
  const half = MODEL.avgTotalGoals / 2;
  return {
    lambdaHome: Math.max(0.15, half + supremacy / 2),
    lambdaAway: Math.max(0.15, half - supremacy / 2),
  };
}

export function predict(input: PredictInput): PredictResult | null {
  const home = lookup(input.home);
  const away = lookup(input.away);
  if (!home || !away) return null;

  const neutral = input.neutral ?? true;
  const eloGap = home.elo - away.elo + (neutral ? 0 : MODEL.homeAdvantageElo);
  const { lambdaHome, lambdaAway } = expectedGoals(eloGap);

  const grid = scoreGrid(lambdaHome, lambdaAway, MAX_GOALS);
  const sorted = [...grid.cells].sort((a, b) => b.prob - a.prob);
  const top = sorted[0];

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
