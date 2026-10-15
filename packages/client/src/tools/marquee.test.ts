import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { idsInRect, marqueeRect, marqueeSelection } from './marquee.js';

describe('marquee', () => {
  it('spans two corners in any drag direction', () => {
    const rect = { left: 10, top: 20, right: 110, bottom: 220 };
    expect(marqueeRect({ x: 10, y: 20 }, { x: 110, y: 220 })).toEqual(rect);
    expect(marqueeRect({ x: 110, y: 220 }, { x: 10, y: 20 })).toEqual(rect);
    expect(marqueeRect({ x: 10, y: 220 }, { x: 110, y: 20 })).toEqual(rect);
  });

  it('is symmetric and never inverted', () => {
    const coord = fc.double({ min: -1e4, max: 1e4, noNaN: true });
    fc.assert(
      fc.property(coord, coord, coord, coord, (ax, ay, bx, by) => {
        const r = marqueeRect({ x: ax, y: ay }, { x: bx, y: by });
        expect(r).toEqual(marqueeRect({ x: bx, y: by }, { x: ax, y: ay }));
        expect(r.left).toBeLessThanOrEqual(r.right);
        expect(r.top).toBeLessThanOrEqual(r.bottom);
      }),
    );
  });

  it('keeps the points inside, edges included', () => {
    const rect = { left: 0, top: 0, right: 100, bottom: 50 };
    const points = [
      { id: 'a', x: 10, y: 10 },
      { id: 'edge', x: 100, y: 50 },
      { id: 'out', x: 101, y: 10 },
      { id: 'above', x: 50, y: -1 },
    ];
    expect(idsInRect(points, rect)).toEqual(['a', 'edge']);
  });

  it('replaces the selection, or adds to it with a modifier', () => {
    expect(marqueeSelection(['x'], ['a', 'b'], false)).toEqual(['a', 'b']);
    expect(marqueeSelection(['x', 'a'], ['a', 'b'], true)).toEqual(['x', 'a', 'b']);
    expect(marqueeSelection(['x'], [], false)).toEqual([]);
    expect(marqueeSelection(['x'], [], true)).toEqual(['x']);
  });
});
