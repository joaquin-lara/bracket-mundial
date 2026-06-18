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
  ALG: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Algeria
  ARG: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Argentina
  AUS: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Australia
  AUT: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Austria
  BEL: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Belgium
  BIH: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Bosnia and Herzegovina
  BRA: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Brazil
  CAN: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Canada
  CIV: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Ivory Coast
  COD: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // DR Congo
  COL: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Colombia
  CPV: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Cape Verde
  CRO: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Croatia
  CUR: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Curaçao
  CZE: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Czech Republic
  ECU: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Ecuador
  EGY: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Egypt
  ENG: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // England
  ESP: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Spain
  FRA: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // France
  GER: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Germany
  GHA: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Ghana
  HAI: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Haiti
  IRN: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Iran
  IRQ: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Iraq
  JOR: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Jordan
  JPN: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Japan
  KOR: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // South Korea
  KSA: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Saudi Arabia
  MAR: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Morocco
  MEX: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Mexico
  NED: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Netherlands
  NOR: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Norway
  NZL: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // New Zealand
  PAN: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Panama
  PAR: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Paraguay
  POR: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Portugal
  QAT: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Qatar
  RSA: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // South Africa
  SCO: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Scotland
  SEN: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Senegal
  SUI: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Switzerland
  SWE: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Sweden
  TUN: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Tunisia
  TUR: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Turkey
  URY: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Uruguay
  USA: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // United States
  UZB: { yellow: 0, secondYellow: 0, directRed: 0, yellowAndDirectRed: 0 }, // Uzbekistan
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
