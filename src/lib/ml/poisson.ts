// Tiny Poisson toolkit for the goal model. A team's goals in a match are
// modelled as Poisson(lambda); the scoreline grid is the outer product of the
// two teams' independent goal distributions.

/** P(X = k) for X ~ Poisson(lambda). */
export function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // exp(k*ln(lambda) - lambda - ln(k!)) avoids large-factorial overflow.
  let logFact = 0;
  for (let i = 2; i <= k; i++) logFact += Math.log(i);
  return Math.exp(k * Math.log(lambda) - lambda - logFact);
}

/** Probability vector [P(0), P(1), ... P(maxGoals)] for one team. */
export function goalVector(lambda: number, maxGoals: number): number[] {
  const v: number[] = [];
  let total = 0;
  for (let k = 0; k <= maxGoals; k++) {
    const p = poissonPmf(lambda, k);
    v.push(p);
    total += p;
  }
  // Fold the tail (k > maxGoals) into the top bucket so the vector sums to 1.
  v[maxGoals] += 1 - total;
  return v;
}

export interface ScoreCell {
  home: number;
  away: number;
  prob: number;
}

/**
 * Full scoreline grid plus the marginal win/draw/loss probabilities, from two
 * independent Poisson goal distributions.
 */
export function scoreGrid(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals = 8
): { cells: ScoreCell[]; pHome: number; pDraw: number; pAway: number } {
  const h = goalVector(lambdaHome, maxGoals);
  const a = goalVector(lambdaAway, maxGoals);
  const cells: ScoreCell[] = [];
  let pHome = 0,
    pDraw = 0,
    pAway = 0;
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      const prob = h[i] * a[j];
      cells.push({ home: i, away: j, prob });
      if (i > j) pHome += prob;
      else if (i === j) pDraw += prob;
      else pAway += prob;
    }
  }
  return { cells, pHome, pDraw, pAway };
}
