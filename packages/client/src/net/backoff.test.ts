import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff.js';

const opts = { baseMs: 100, maxMs: 1000, factor: 2, jitter: 0 };

describe('backoffDelay', () => {
  it('grows exponentially and caps', () => {
    expect([0, 1, 2, 3, 4, 10].map((a) => backoffDelay(a, opts, () => 0.5))).toEqual([
      100, 200, 400, 800, 1000, 1000,
    ]);
  });
  it('applies jitter within [cap*(1-jitter), cap]', () => {
    const j = { ...opts, jitter: 0.5 };
    expect(backoffDelay(2, j, () => 0)).toBe(200);
    expect(backoffDelay(2, j, () => 1)).toBe(400);
  });
  it('never exceeds the cap for any random value', () => {
    for (let a = 0; a < 20; a++) {
      for (const r of [0, 0.3, 0.999]) {
        const d = backoffDelay(a, { ...opts, jitter: 1 }, () => r);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1000);
      }
    }
  });
});
