import { describe, expect, it } from 'vitest';
import { parseGammaEvents } from './polymarket';

// Minimal Gamma event shapes, mirroring the fields parseGammaEvents reads.
function ev(slug: string, markets: unknown[], volume24hr = 0) {
  return { slug, volume24hr, markets };
}
function mkt(groupItemTitle: string, yes: string, question?: string) {
  return { groupItemTitle, question, outcomePrices: JSON.stringify([yes, String(1 - Number(yes))]) };
}

describe('parseGammaEvents', () => {
  it('parses a group-stage 3-way match (home / draw / away)', () => {
    const map = parseGammaEvents([
      ev('fifwc-bra-ger-2026-06-20', [
        mkt('Brazil', '0.55'),
        mkt('Draw (Brazil vs. Germany)', '0.25'),
        mkt('Germany', '0.20'),
      ]),
    ] as never);
    const entry = map.get('BRA|GER');
    expect(entry).toBeTruthy();
    expect(entry!.probByCode.BRA).toBeCloseTo(0.55);
    expect(entry!.probByCode.GER).toBeCloseTo(0.2);
    expect(entry!.probDraw).toBeCloseTo(0.25);
  });

  it('parses a knockout 2-way match with no draw leg (draw = 0)', () => {
    const map = parseGammaEvents([
      ev('fifwc-can-mar-2026-07-04', [mkt('Canada', '0.42'), mkt('Morocco', '0.58')]),
    ] as never);
    const entry = map.get('CAN|MAR');
    expect(entry).toBeTruthy();
    expect(entry!.probByCode.CAN).toBeCloseTo(0.42);
    expect(entry!.probByCode.MAR).toBeCloseTo(0.58);
    expect(entry!.probDraw).toBe(0);
  });

  it('resolves awkward country spellings (Côte d’Ivoire, DR Congo, USA)', () => {
    const map = parseGammaEvents([
      ev('fifwc-civ-cod-2026-06-22', [
        mkt("Côte d'Ivoire", '0.50'),
        mkt('Draw', '0.25'),
        mkt('DR Congo', '0.25'),
      ]),
      ev('fifwc-usa-mex-2026-06-23', [mkt('USA', '0.5'), mkt('Mexico', '0.5')]),
    ] as never);
    expect(map.get('CIV|COD')).toBeTruthy();
    expect(map.get('MEX|USA')).toBeTruthy();
  });

  it('skips a match when a team name cannot be resolved (no half-odds)', () => {
    const map = parseGammaEvents([
      ev('fifwc-xxx-bra-2026-06-24', [mkt('Neverland', '0.5'), mkt('Brazil', '0.5')]),
    ] as never);
    expect(map.size).toBe(0);
  });

  it('tolerates array-encoded prices and ignores non-match slugs', () => {
    const map = parseGammaEvents([
      { slug: 'fifwc-arg-fra-2026-07-01', volume24hr: 10, markets: [
        { groupItemTitle: 'Argentina', outcomePrices: ['0.6', '0.4'] },
        { groupItemTitle: 'France', outcomePrices: ['0.4', '0.6'] },
      ] },
      // winner/prop events must be ignored
      { slug: 'fifwc-world-cup-winner-2026', markets: [{ groupItemTitle: 'Brazil', outcomePrices: '["0.2","0.8"]' }] },
    ] as never);
    expect(map.get('ARG|FRA')).toBeTruthy();
    expect(map.size).toBe(1);
  });

  it('falls back to the question text when groupItemTitle is missing', () => {
    const map = parseGammaEvents([
      { slug: 'fifwc-esp-por-2026-06-28', markets: [
        { question: 'Will Spain win?', outcomePrices: '["0.5","0.5"]' },
        { question: 'Will Portugal win?', outcomePrices: '["0.5","0.5"]' },
      ] },
    ] as never);
    expect(map.get('ESP|POR')).toBeTruthy();
  });
});
