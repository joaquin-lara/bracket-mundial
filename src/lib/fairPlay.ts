// Fair-play points — the FIFA group tiebreaker that comes after overall goals
// but before FIFA ranking. We can't source disciplinary data from the fixtures
// API, so card counts are entered by hand in the app (the `discipline` table)
// and this module turns them into the deduction total FIFA actually uses.
//
// FIFA's per-player-per-match deduction table (a team's fair-play score is the
// sum of every card its players pick up across the group stage):
//   yellow card .......................... -1
//   indirect red (second yellow) ......... -3
//   direct red card ...................... -4
//   yellow + direct red (same player) .... -5
//
// The tiebreaker ranks the team with the HIGHER (closer to zero) total above
// the team with the more negative total — i.e. fewer/softer cards is better.

export interface Discipline {
  /** Single yellow cards (not the first of a two-yellow sending-off). */
  yellow?: number;
  /** Sending-offs for a second yellow in the same match. */
  secondYellow?: number;
  /** Straight (direct) red cards. */
  directRed?: number;
  /** A yellow followed by a direct red for the same player in one match. */
  yellowAndDirectRed?: number;
}

/** One row of the `discipline` table (snake_case, as stored in Supabase). */
export interface DisciplineRow {
  team_code: string;
  yellow: number;
  second_yellow: number;
  direct_red: number;
  yellow_direct_red: number;
}

const WEIGHTS = {
  yellow: 1,
  secondYellow: 3,
  directRed: 4,
  yellowAndDirectRed: 5,
} as const;

/** FIFA fair-play points for one team: 0 (cleanest) down to negative. */
export function fairPlayPoints(d: Discipline | undefined): number {
  if (!d) return 0;
  const deductions =
    (d.yellow ?? 0) * WEIGHTS.yellow +
    (d.secondYellow ?? 0) * WEIGHTS.secondYellow +
    (d.directRed ?? 0) * WEIGHTS.directRed +
    (d.yellowAndDirectRed ?? 0) * WEIGHTS.yellowAndDirectRed;
  return deductions === 0 ? 0 : -deductions;
}

/** Build a code -> fair-play-points map from the stored discipline rows. */
export function fairPlayByCode(rows: DisciplineRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const r of rows) {
    map[r.team_code.toUpperCase()] = fairPlayPoints({
      yellow: r.yellow,
      secondYellow: r.second_yellow,
      directRed: r.direct_red,
      yellowAndDirectRed: r.yellow_direct_red,
    });
  }
  return map;
}
