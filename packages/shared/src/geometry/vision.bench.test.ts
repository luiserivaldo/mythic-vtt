// FOG-02 benchmark (D47, G1): the host builds one vision polygon per source per action, so a
// dungeon of 300 wall segments seen from 6 origins must take 2 ms or less in total.
import { describe, expect, it } from 'vitest';
import type { Point2 } from './primitives.js';
import { visibilityPolygon, type Bounds2, type Segment } from './vision.js';

const BOUNDS: Bounds2 = { minX: 0, minZ: 0, maxX: 60, maxZ: 50 };

/** Deterministic LCG so the layout is the same on every run. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A 6 x 5 grid of 10-cell rooms with one-cell doors, plus square pillars, trimmed to `count`. */
function dungeon(count: number): Segment[] {
  const rand = lcg(296);
  const segments: Segment[] = [];
  const wall = (ax: number, az: number, bx: number, bz: number) =>
    segments.push({ a: { x: ax, z: az }, b: { x: bx, z: bz } });
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 5; j++) {
      const x = i * 10;
      const z = j * 10;
      const door = 3 + Math.floor(rand() * 5);
      // South and west walls with a door; the neighbours' walls close the rest.
      wall(x, z, x + door, z);
      wall(x + door + 1, z, x + 10, z);
      wall(x, z, x, z + door);
      wall(x, z + door + 1, x, z + 10);
    }
  }
  while (segments.length < count) {
    const x = 1 + rand() * 57;
    const z = 1 + rand() * 47;
    wall(x, z, x + 0.8, z);
    wall(x + 0.8, z, x + 0.8, z + 0.8);
    wall(x + 0.8, z + 0.8, x, z + 0.8);
    wall(x, z + 0.8, x, z);
  }
  return segments.slice(0, count);
}

const origins: Point2[] = [
  { x: 5.5, z: 5.5 },
  { x: 15.2, z: 24.7 },
  { x: 33.3, z: 12.1 },
  { x: 47.9, z: 38.6 },
  { x: 55.5, z: 45.5 },
  { x: 25.05, z: 40.4 },
];

/** Best and median of `runs` timings. Contention only ever adds time, so the bound uses the best. */
function timeMs(runs: number, fn: () => void): { best: number; median: number } {
  const times: number[] = [];
  for (let r = 0; r < runs; r++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return { best: times[0] as number, median: times[Math.floor(runs / 2)] as number };
}

describe('visibilityPolygon benchmark', () => {
  it('300 segments x 6 origins take 2 ms or less', { retry: 2 }, () => {
    const segments = dungeon(300);
    expect(segments).toHaveLength(300);
    const run = () => {
      for (const origin of origins) visibilityPolygon(origin, segments, BOUNDS);
    };
    for (let i = 0; i < 30; i++) run(); // warm up the JIT like a running host
    const { best, median } = timeMs(200, run);
    console.log(
      `FOG-02: 300 segments x 6 origins -> best ${best.toFixed(3)} ms, median ${median.toFixed(3)} ms (200 runs)`,
    );
    // The full suite runs files in parallel; the best run is the cost without that contention,
    // and a retry re-measures if every sample landed in a contended window.
    expect(best).toBeLessThanOrEqual(2);
  });

  it('stays well behaved at 2000 segments', () => {
    const rand = lcg(2000);
    const segments: Segment[] = [];
    for (let i = 0; i < 2000; i++) {
      const x = rand() * 60;
      const z = rand() * 50;
      const angle = rand() * Math.PI * 2;
      const length = 0.5 + rand() * 2.5;
      segments.push({
        a: { x, z },
        b: { x: x + Math.cos(angle) * length, z: z + Math.sin(angle) * length },
      });
    }
    const origin = { x: 30.3, z: 25.7 };
    visibilityPolygon(origin, segments, BOUNDS);
    const ms = timeMs(10, () => visibilityPolygon(origin, segments, BOUNDS)).median;
    const poly = visibilityPolygon(origin, segments, BOUNDS);
    console.log(
      `FOG-02: 2000 random segments x 1 origin -> ${ms.toFixed(3)} ms, ${String(poly.length)} vertices`,
    );
    expect(poly.length).toBeGreaterThanOrEqual(3);
    expect(poly.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z))).toBe(true);
    // Generous bound: catches an O(n^2) blow-up, not a precise budget.
    expect(ms).toBeLessThan(50);
  });
});
