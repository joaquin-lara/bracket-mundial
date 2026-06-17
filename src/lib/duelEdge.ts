// Private "tells" model for the penalty shootout (Joaquin only). A goal is scored
// iff shot direction != dive direction (matching pennies): as keeper you want to
// MATCH the shooter, as shooter you want to DIFFER from the keeper. From the duels
// you've played against an opponent (the only ones RLS lets you read), we model
// their shot tendencies and dive tendencies, lightly smoothed toward random and
// nudged by what they just did this game (repeat/switch), then recommend the best
// counter for the current kick.

export type Pick = 'left' | 'center' | 'right';
export const DIRS: Pick[] = ['left', 'center', 'right'];

interface Round { kick: number; shooter: string; shot: Pick; dive: Pick; goal: boolean }
interface DuelLike { id: string; challenger: string; opponent: string; rounds: Round[] }

export interface Reco {
  role: 'shoot' | 'keep';
  /** Opponent's predicted pick distribution (their shot if you keep, their dive if you shoot). */
  predict: Record<Pick, number>;
  recommend: Pick; // what YOU should pick
  successChance: number; // estimated goal (shoot) or save (keep) probability
  baseline: number; // success chance if you guessed randomly
  n: number; // observations of the opponent in the relevant role
  confidence: 'low' | 'med' | 'high';
}

const zero = (): Record<Pick, number> => ({ left: 0, center: 0, right: 0 });

/** Laplace-smoothed frequencies so a tiny sample doesn't read as a certainty. */
function smooth(counts: Record<Pick, number>): Record<Pick, number> {
  const total = DIRS.reduce((s, d) => s + counts[d], 0);
  const denom = total + 3;
  const p = zero();
  for (const d of DIRS) p[d] = (counts[d] + 1) / denom;
  return p;
}

function argmax(p: Record<Pick, number>): Pick {
  return DIRS.reduce((best, d) => (p[d] > p[best] ? d : best), DIRS[0]);
}
function argmin(p: Record<Pick, number>): Pick {
  return DIRS.reduce((best, d) => (p[d] < p[best] ? d : best), DIRS[0]);
}

/** Most recent opponent pick of a kind within one duel (for repeat/switch). */
function lastInDuel(d: DuelLike | undefined, kind: 'shot' | 'dive', me: string, oppId: string): Pick | null {
  if (!d) return null;
  const rounds = [...(d.rounds ?? [])].sort((a, b) => b.kick - a.kick);
  for (const r of rounds) {
    if (kind === 'shot' && r.shooter === oppId) return r.shot;
    if (kind === 'dive' && r.shooter === me) return r.dive;
  }
  return null;
}

export function computeReco(
  duels: DuelLike[],
  me: string,
  oppId: string,
  role: 'shoot' | 'keep',
  currentDuelId: string | null
): Reco {
  const relevant = duels.filter(
    (d) => (d.challenger === me && d.opponent === oppId) || (d.challenger === oppId && d.opponent === me)
  );

  const shotCounts = zero(); // opponent shooting
  const diveCounts = zero(); // opponent keeping (their dive)
  const shotTrans: Record<Pick, Record<Pick, number>> = { left: zero(), center: zero(), right: zero() };
  const diveTrans: Record<Pick, Record<Pick, number>> = { left: zero(), center: zero(), right: zero() };

  for (const d of relevant) {
    const rounds = [...(d.rounds ?? [])].sort((a, b) => a.kick - b.kick);
    let prevShot: Pick | null = null;
    let prevDive: Pick | null = null;
    for (const r of rounds) {
      if (r.shooter === oppId) {
        shotCounts[r.shot]++;
        if (prevShot) shotTrans[prevShot][r.shot]++;
        prevShot = r.shot;
      } else if (r.shooter === me) {
        diveCounts[r.dive]++;
        if (prevDive) diveTrans[prevDive][r.dive]++;
        prevDive = r.dive;
      }
    }
  }

  // Blend base frequency with the transition row for their last pick this game,
  // weighting the transition by how much of it we've actually seen.
  const blend = (base: Record<Pick, number>, transRow: Record<Pick, number> | null): Record<Pick, number> => {
    const b = smooth(base);
    if (!transRow) return b;
    const tTotal = DIRS.reduce((s, d) => s + transRow[d], 0);
    if (tTotal === 0) return b;
    const t = smooth(transRow);
    const w = tTotal / (tTotal + 4);
    const p = zero();
    let sum = 0;
    for (const d of DIRS) { p[d] = (1 - w) * b[d] + w * t[d]; sum += p[d]; }
    for (const d of DIRS) p[d] /= sum;
    return p;
  };

  const cur = relevant.find((d) => d.id === currentDuelId);
  let predict: Record<Pick, number>;
  let n: number;
  if (role === 'keep') {
    const last = lastInDuel(cur, 'shot', me, oppId);
    predict = blend(shotCounts, last ? shotTrans[last] : null);
    n = DIRS.reduce((s, d) => s + shotCounts[d], 0);
  } else {
    const last = lastInDuel(cur, 'dive', me, oppId);
    predict = blend(diveCounts, last ? diveTrans[last] : null);
    n = DIRS.reduce((s, d) => s + diveCounts[d], 0);
  }

  let recommend: Pick;
  let successChance: number;
  let baseline: number;
  if (role === 'keep') {
    recommend = argmax(predict); // dive where they most likely shoot
    successChance = predict[recommend]; // P(save) = P(shot lands there)
    baseline = 1 / 3;
  } else {
    recommend = argmin(predict); // shoot where they least likely dive
    successChance = 1 - predict[recommend]; // P(goal) = P(dive isn't there)
    baseline = 2 / 3;
  }

  const confidence = n >= 15 ? 'high' : n >= 6 ? 'med' : 'low';
  return { role, predict, recommend, successChance, baseline, n, confidence };
}
