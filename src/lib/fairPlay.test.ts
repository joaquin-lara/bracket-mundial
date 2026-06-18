import { describe, expect, it } from 'vitest';
import { fairPlayPoints } from './fairPlay';

describe('fairPlayPoints', () => {
  it('is zero for a clean record', () => {
    expect(fairPlayPoints(undefined)).toBe(0);
    expect(fairPlayPoints({})).toBe(0);
  });

  it('applies the FIFA deduction weights (-1/-3/-4/-5)', () => {
    expect(fairPlayPoints({ yellow: 3 })).toBe(-3);
    expect(fairPlayPoints({ secondYellow: 1 })).toBe(-3);
    expect(fairPlayPoints({ directRed: 1 })).toBe(-4);
    expect(fairPlayPoints({ yellowAndDirectRed: 1 })).toBe(-5);
  });

  it('sums every card type', () => {
    expect(
      fairPlayPoints({ yellow: 2, secondYellow: 1, directRed: 1, yellowAndDirectRed: 1 })
    ).toBe(-(2 + 3 + 4 + 5));
  });
});
