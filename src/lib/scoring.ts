// Pure scoring logic + result-parsing helpers. No I/O here.

/**
 * Points for one locked prediction vs the real final score.
 *   3 = exact score
 *   2 = correct outcome (same winner, or both draws), wrong scoreline
 *   1 = locked a prediction but wrong outcome
 * (0 points = no prediction row at all; handled by absence of a row.)
 */
export function scorePrediction(
  predHome: number,
  predAway: number,
  actualHome: number,
  actualAway: number
): 1 | 2 | 3 {
  if (predHome === actualHome && predAway === actualAway) return 3;
  if (Math.sign(predHome - predAway) === Math.sign(actualHome - actualAway)) return 2;
  return 1;
}

// --- football-data.org v4 score parsing -----------------------------------

export interface ApiScorePair {
  home: number | null;
  away: number | null;
}

export interface ApiScore {
  winner?: string | null;
  duration?: string | null; // REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT
  fullTime?: ApiScorePair | null;
  regularTime?: ApiScorePair | null;
  extraTime?: ApiScorePair | null;
  penalties?: ApiScorePair | null;
}

/**
 * The score predictions are judged against: the score at the end of play,
 * including extra time but EXCLUDING a penalty shootout. A match decided
 * on penalties counts as a draw for prediction purposes.
 *
 * football-data.org's v4 `fullTime` has historically included shootout
 * goals for PENALTY_SHOOTOUT matches, so we subtract `penalties` and
 * sanity-check the result (a shootout can only follow a draw). If the
 * subtraction does not yield a draw, fullTime already excluded penalties
 * and we use it as-is.
 */
export function finalScore(score: ApiScore | null | undefined): { home: number; away: number } | null {
  if (!score) return null;
  const ft = score.fullTime;
  if (!ft || ft.home == null || ft.away == null) return null;

  if (score.duration === 'PENALTY_SHOOTOUT') {
    const pen = score.penalties;
    if (pen && pen.home != null && pen.away != null) {
      const home = ft.home - pen.home;
      const away = ft.away - pen.away;
      if (home === away && home >= 0) return { home, away };
    }
    const reg = score.regularTime;
    const ext = score.extraTime;
    if (reg && reg.home != null && reg.away != null) {
      return {
        home: reg.home + (ext?.home ?? 0),
        away: reg.away + (ext?.away ?? 0),
      };
    }
  }

  return { home: ft.home, away: ft.away };
}

export function isFinished(status: string | null | undefined): boolean {
  return status === 'FINISHED';
}
