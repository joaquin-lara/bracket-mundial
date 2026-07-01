import { describe, expect, it } from 'vitest';
import { R32_BRACKET_FIFA, R32_PAIRINGS } from './qualification';
import { bracketVenueRank, KNOCKOUT_BRACKET_VENUES } from './venues';
import type { Match } from './types';

// Reproduces the reordering KnockoutSection applies before rendering, so we can
// assert the bracket connectors line each match up with the two boxes that feed
// it (slot i is fed by slots 2i / 2i+1 of the previous round).

function m(partial: Partial<Match>): Match {
  return {
    id: 0,
    home_team: 'TBD',
    away_team: 'TBD',
    home_code: null,
    away_code: null,
    kickoff: '2026-06-28T00:00:00Z',
    stage: 'LAST_32',
    group_name: null,
    status: 'FINISHED',
    home_score: 1,
    away_score: 0,
    scored: true,
    venue: null,
    ...partial,
  };
}

// The DB returns fixtures in kickoff order. R32 kickoff order == R32_PAIRINGS
// order; give each fixture a distinct winner code so we can trace it forward.
const r32Kickoff: Match[] = R32_PAIRINGS.map((p, i) =>
  m({ id: 100 + i, venue: p.venue, home_code: `W${p.fifa}`, away_code: 'X', home_score: 1, away_score: 0 }),
);
const winnerOf = (fifa: number) => `W${fifa}`;

// Round of 16 in kickoff order, with the real venues and the correct FIFA
// pairings (winners of the two feeder R32 matches).
const R16 = [
  { fifa: 90, venue: 'NRG Stadium', feeders: [73, 75] },
  { fifa: 89, venue: 'Lincoln Financial Field', feeders: [74, 77] },
  { fifa: 91, venue: 'MetLife Stadium', feeders: [76, 78] },
  { fifa: 92, venue: 'Estadio Azteca', feeders: [79, 80] },
  { fifa: 93, venue: 'AT&T Stadium', feeders: [83, 84] },
  { fifa: 94, venue: 'Lumen Field', feeders: [81, 82] },
  { fifa: 95, venue: 'Mercedes-Benz Stadium', feeders: [86, 88] },
  { fifa: 96, venue: 'BC Place', feeders: [85, 87] },
];
const r16Kickoff: Match[] = R16.map((r, i) =>
  m({
    id: 200 + i,
    stage: 'LAST_16',
    venue: r.venue,
    home_code: winnerOf(r.feeders[0]),
    away_code: winnerOf(r.feeders[1]),
  }),
);

function orderR32(matches: Match[]): Match[] {
  return R32_BRACKET_FIFA.map((fifa) => matches[R32_PAIRINGS.findIndex((p) => p.fifa === fifa)]);
}
function orderByVenue(stage: string, matches: Match[]): Match[] {
  return matches
    .slice()
    .sort((a, b) => bracketVenueRank(stage, a.venue) - bracketVenueRank(stage, b.venue));
}

describe('knockout bracket ordering', () => {
  it('feeds each Round-of-16 box from the two R32 slots directly above it', () => {
    const r32 = orderR32(r32Kickoff);
    const r16 = orderByVenue('LAST_16', r16Kickoff);

    r16.forEach((match, i) => {
      const topFeeder = r32[2 * i];
      const bottomFeeder = r32[2 * i + 1];
      // The R16 match's two teams must be the winners of its two adjacent R32 boxes.
      expect(match.home_code).toBe(topFeeder.home_code);
      expect(match.away_code).toBe(bottomFeeder.home_code);
    });
  });

  it('places Canada v Morocco between RSA·CAN and NED·MAR, not BRA·JPN', () => {
    // Demo scenario from the reported bug.
    const r32 = orderR32(
      R32_PAIRINGS.map((p, i) => {
        const teams: Record<number, [string, string]> = {
          73: ['RSA', 'CAN'],
          74: ['GER', 'PAR'],
          75: ['NED', 'MAR'],
          76: ['BRA', 'JPN'],
          77: ['FRA', 'SWE'],
          78: ['CIV', 'NOR'],
        };
        const [h, a] = teams[p.fifa] ?? [`H${p.fifa}`, `A${p.fifa}`];
        // winner is whoever we mark with the higher score; encode winner in home_code
        const winner = { 73: 'CAN', 74: 'PAR', 75: 'MAR', 76: 'BRA', 77: 'FRA', 78: 'NOR' }[p.fifa] ?? h;
        return m({ id: 300 + i, venue: p.venue, home_team: h, away_team: a, home_code: winner, away_code: a });
      }),
    );
    const canMar = m({ id: 400, stage: 'LAST_16', venue: 'NRG Stadium', home_code: 'CAN', away_code: 'MAR' });
    const parFra = m({ id: 401, stage: 'LAST_16', venue: 'Lincoln Financial Field', home_code: 'PAR', away_code: 'FRA' });
    const r16 = orderByVenue('LAST_16', [canMar, parFra]);

    // CAN·MAR should be the SECOND R16 box (slot 1), fed by R32 slots 2 and 3.
    const canMarIdx = r16.findIndex((x) => x.id === 400);
    expect(canMarIdx).toBe(1);
    expect(r32[2].home_code).toBe('CAN'); // RSA·CAN winner
    expect(r32[3].home_code).toBe('MAR'); // NED·MAR winner
  });

  it('exposes bracket venue orders for R16, QF and SF', () => {
    expect(KNOCKOUT_BRACKET_VENUES.LAST_16).toHaveLength(8);
    expect(KNOCKOUT_BRACKET_VENUES.QUARTER_FINALS).toHaveLength(4);
    expect(KNOCKOUT_BRACKET_VENUES.SEMI_FINALS).toHaveLength(2);
  });
});
