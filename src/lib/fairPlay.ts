// Fair-play points — the FIFA group tiebreaker that comes after overall
// goals but before FIFA ranking. We can't source disciplinary data from the
// fixtures API, so the card counts are entered by hand below and this module
// turns them into the deduction total FIFA actually uses.
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

const WEIGHTS = {
  yellow: 1,
  secondYellow: 3,
  directRed: 4,
  yellowAndDirectRed: 5,
} as const;

/**
 * Hand-entered card counts per team, keyed by 3-letter code (the same code the
 * fixtures table joins on). Fill these in as the group stage unfolds; any team
 * left out is treated as a clean sheet (0 deductions). Only the relative order
 * matters, so you can update incrementally.
 *
 * Example: GER had 3 yellows and one second-yellow sending-off ->
 *   GER: { yellow: 3, secondYellow: 1 }
 */
export const DISCIPLINE: Record<string, Discipline> = {
  // CODE: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 },
};

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

/** Fair-play points for a team code, from the hand-entered table. */
export function fairPlayFor(code: string | null | undefined): number {
  if (!code) return 0;
  return fairPlayPoints(DISCIPLINE[code.toUpperCase()]);
}
