import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LayerId, Scene } from '@mythic/shared';
import { visibleEntities } from '../render/layer-visibility.js';
import type { RenderEntity, RenderScene } from '../render/scene-model.js';
import {
  idsInRect,
  isMarqueeBackdrop,
  marqueeGathers,
  marqueeRect,
  marqueeSelection,
} from './marquee.js';

type Kind = 'token' | 'prop' | 'aoe' | 'map' | 'none';

/** A drawn entity of `kind`; only the fields the pick rules read are filled in. */
function drawn(id: string, kind: Kind, layer: LayerId): { render: RenderEntity; layer: LayerId } {
  const render = {
    id,
    layer: 'tokens',
    position: [0, 0, 0],
    sizeCells: 1,
    secret: false,
    ...(kind === 'token' ? { token: {} } : {}),
    ...(kind === 'prop' ? { shape: {} } : {}),
    ...(kind === 'aoe' ? { aoe: {} } : {}),
    ...(kind === 'map' ? { mapImage: { asset: {}, scale: 4 } } : {}),
  } as unknown as RenderEntity;
  return { render, layer };
}

/** Ids the marquee may gather on a board seen with `focus` as the active layer (MV-258/272). */
function gathered(items: ReturnType<typeof drawn>[], focus: LayerId | null): string[] {
  const rendered = { entities: items.map((i) => i.render) } as unknown as RenderScene;
  const scene = {
    entities: Object.fromEntries(items.map((i) => [i.render.id, { layer: i.layer }])),
  } as unknown as Scene;
  return visibleEntities(rendered, scene, new Set(), focus)
    .filter((e) => marqueeGathers(e, focus))
    .map((e) => e.id);
}

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

  describe('what the marquee gathers (MV-272)', () => {
    const board = [
      drawn('token', 'token', 'tokens'),
      drawn('prop', 'prop', 'tokens'),
      drawn('aoe', 'aoe', 'tokens'),
      drawn('effect', 'aoe', 'effects'),
      drawn('map', 'map', 'map'),
    ];

    it('takes tokens, props and AoEs on the active layer, never the map', () => {
      expect(gathered(board, 'tokens')).toEqual(['token', 'prop', 'aoe']);
    });

    it('skips AoEs off the active layer and takes them on it', () => {
      expect(gathered(board, 'effects')).toEqual(['effect']);
    });

    it('takes map images only while the Map layer is active', () => {
      expect(gathered(board, 'map')).toEqual(['map']);
      for (const focus of ['tokens', 'props', 'effects', 'dm', null] as const)
        expect(gathered(board, focus)).not.toContain('map');
    });

    it('never gathers an entity with nothing to select or one marked dimmed', () => {
      expect(marqueeGathers(drawn('bare', 'none', 'tokens').render, 'tokens')).toBe(false);
      const token = drawn('token', 'token', 'tokens').render;
      expect(marqueeGathers({ ...token, dimmed: true }, 'tokens')).toBe(false);
      const map = drawn('map', 'map', 'map').render;
      expect(marqueeGathers({ ...map, dimmed: true }, 'map')).toBe(false);
    });

    it('a press on a map image starts a marquee unless the Map layer is active', () => {
      const image = {
        asset: { source: 'local' as const, hash: 'a'.repeat(64), kind: 'image' as const },
        calibrated: true,
      };
      const map = { layer: 'map' as const, image };
      expect(isMarqueeBackdrop(map, 'tokens')).toBe(true);
      expect(isMarqueeBackdrop(map, null)).toBe(true);
      expect(isMarqueeBackdrop(map, 'map')).toBe(false);
      // Only images: a token or prop kept on the map layer stays a click target.
      expect(isMarqueeBackdrop({ layer: 'map' }, 'tokens')).toBe(false);
      expect(isMarqueeBackdrop({ layer: 'tokens', image }, 'tokens')).toBe(false);
    });
  });
});
