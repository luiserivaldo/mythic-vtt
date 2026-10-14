import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createLatencyProbe, MAX_LATENCY_MS } from './latency-probe.js';

describe('host latency challenges (UX-06)', () => {
  it('ignores unsolicited, wrong and replayed pongs', () => {
    let now = 100;
    const probe = createLatencyProbe(
      () => now,
      () => 'challenge',
    );
    expect(probe.complete('challenge')).toBeNull();
    expect(probe.start()).toBe('challenge');
    now = 142.4;
    expect(probe.complete('forged')).toBeNull();
    expect(probe.complete('challenge')).toBe(42);
    expect(probe.complete('challenge')).toBeNull();
  });
  it('bounds every measured sample independently of wall-clock time', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e9, noNaN: true }), (elapsed) => {
        let now = 0;
        const probe = createLatencyProbe(
          () => now,
          () => 'nonce',
        );
        probe.start();
        now = elapsed;
        const sample = probe.complete('nonce');
        expect(sample).not.toBeNull();
        expect(Number.isInteger(sample)).toBe(true);
        expect(sample).toBeGreaterThanOrEqual(0);
        expect(sample).toBeLessThanOrEqual(MAX_LATENCY_MS);
      }),
    );
  });
  it('refuses negative and non-finite clock deltas', () => {
    for (const elapsed of [-1, NaN, Infinity, -Infinity]) {
      let now = 0;
      const probe = createLatencyProbe(
        () => now,
        () => 'nonce',
      );
      probe.start();
      now = elapsed;
      expect(probe.complete('nonce')).toBeNull();
    }
  });
  it('replaces an old challenge so a late reply cannot time a new one', () => {
    let index = 0;
    const probe = createLatencyProbe(
      () => 0,
      () => String(++index),
    );
    const old = probe.start();
    const current = probe.start();
    expect(probe.complete(old)).toBeNull();
    expect(probe.complete(current)).toBe(0);
  });
});
