import { describe, expect, it } from 'vitest';
import { fetchAll } from './achievementsSync';

/** A fake paged query backed by an in-memory array. */
function pager<T>(all: T[]) {
  return (from: number, to: number) =>
    Promise.resolve({ data: all.slice(from, to + 1), error: null as unknown });
}

describe('fetchAll', () => {
  it('returns every row when the result fits in one page', async () => {
    const data = Array.from({ length: 10 }, (_, i) => i);
    expect(await fetchAll(pager(data))).toEqual(data);
  });

  it('pages past the per-request cap', async () => {
    const data = Array.from({ length: 2500 }, (_, i) => i);
    const res = await fetchAll(pager(data));
    expect(res).toHaveLength(2500);
    expect(res[0]).toBe(0);
    expect(res[2499]).toBe(2499);
  });

  it('terminates when the total is an exact multiple of the page size', async () => {
    const data = Array.from({ length: 2000 }, (_, i) => i);
    expect(await fetchAll(pager(data))).toHaveLength(2000);
  });

  it('propagates query errors instead of silently truncating', async () => {
    const failing = () => Promise.resolve({ data: null, error: new Error('boom') });
    await expect(fetchAll(failing)).rejects.toThrow('boom');
  });
});
