import { describe, expect, it } from 'vitest';
import type { AoEShape, WalkableSurface } from '@mythic/shared';
import {
  containsVolume,
  sectionPolygon,
  shellDimensions,
  surfaceRings,
  type Volume,
} from './aoe-geometry.js';

const identity = { x: 0, y: 0, z: 0, w: 1 };
const volume = (shape: AoEShape, y = 0): Volume => ({
  shape,
  position: { x: 0, y, z: 0 },
  rotation: identity,
});

describe('MEAS-06 volume geometry', () => {
  it('uses the same centred and local +Z dimensions as shared inclusion', () => {
    const shapes: AoEShape[] = [
      { kind: 'sphere', radius: 2, color: '#ffffff' },
      { kind: 'cylinder', radius: 2, height: 3, color: '#ffffff' },
      { kind: 'cone', radius: 2, length: 5, color: '#ffffff' },
      { kind: 'cube', size: 4, color: '#ffffff' },
      { kind: 'line', width: 2, height: 3, length: 5, color: '#ffffff' },
    ];
    expect(shapes.map(shellDimensions)).toEqual([
      { width: 4, height: 4, depth: 4, offsetZ: 0 },
      { width: 4, height: 3, depth: 4, offsetZ: 0 },
      { width: 4, height: 4, depth: 5, offsetZ: 2.5 },
      { width: 4, height: 4, depth: 4, offsetZ: 0 },
      { width: 2, height: 3, depth: 5, offsetZ: 2.5 },
    ]);
    for (const shape of shapes)
      expect(
        containsVolume(volume(shape), {
          x: 0,
          y: 0,
          z: shape.kind === 'cone' || shape.kind === 'line' ? 1 : 0,
        }),
      ).toBe(true);
    const cone = shapes[2];
    const line = shapes[4];
    if (!cone || !line) throw new Error('missing test shapes');
    expect(containsVolume(volume(cone), { x: 0, y: 0, z: -0.1 })).toBe(false);
    expect(containsVolume(volume(line), { x: 0, y: 0, z: -0.1 })).toBe(false);
    expect(sectionPolygon(volume(cone)).map((p) => p.z)).toEqual([0, 5, 5]);
  });

  it('places rings on ground and a walkable platform only where the volume intersects', () => {
    const platform: WalkableSurface = {
      kind: 'box',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1, z: 3 },
    };
    const rings = surfaceRings(
      volume({ kind: 'sphere', radius: 2, color: '#ffffff' }, 0.5),
      [platform],
      0.2,
    );
    expect(rings.some(([a]) => Math.abs(a.y - 0.025) < 0.001)).toBe(true);
    expect(rings.some(([a]) => Math.abs(a.y - 1.025) < 0.001)).toBe(true);
    expect(
      surfaceRings(volume({ kind: 'sphere', radius: 0.2, color: '#ffffff' }, 5), [platform]),
    ).toEqual([]);
  });

  it('rotates line containment with the entity quaternion', () => {
    const rotated: Volume = {
      ...volume({ kind: 'line', length: 4, width: 1, height: 1, color: '#ffffff' }),
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    };
    expect(containsVolume(rotated, { x: 2, y: 0, z: 0 })).toBe(true);
    expect(containsVolume(rotated, { x: 0, y: 0, z: 2 })).toBe(false);
  });
});
