import { describe, expect, it } from 'vitest';
import type { WalkableSurface } from '@mythic/shared';
import { DROP_LINE_MIN_HEIGHT, dropLineFor, dropLinesFor } from './drop-lines.js';
import { standeeDimensions } from './token-standee.js';
import type { RenderEntity, RenderScene } from './scene-model.js';

const box = (x: number, y: number, z: number, h = 2, s = 4): WalkableSurface => ({
  kind: 'box',
  position: { x, y, z },
  scale: { x: s, y: h, z: s },
});
const tok = (x: number, y: number, z: number, sizeCells = 1) => ({
  position: [x, y, z] as const,
  sizeCells,
});

describe('dropLineFor', () => {
  it('drops to the ground when nothing is below', () => {
    const l = dropLineFor(tok(1, 3, 1), []);
    expect(l?.surfaceY).toBe(0);
    expect(l?.length).toBe(3);
  });
  it('shows nothing at the surface or within tolerance', () => {
    expect(dropLineFor(tok(1, 0, 1), [])).toBeUndefined();
    expect(dropLineFor(tok(1, DROP_LINE_MIN_HEIGHT - 0.01, 1), [])).toBeUndefined();
    expect(dropLineFor(tok(0, 2, 0), [box(0, 0, 0)])).toBeUndefined();
  });
  it('lands on a platform below', () => {
    const l = dropLineFor(tok(0, 5, 0), [box(0, 0, 0)]);
    expect(l?.surfaceY).toBe(2);
    expect(l?.length).toBe(3);
  });
  it('ignores a platform elsewhere', () => {
    expect(dropLineFor(tok(10, 5, 0), [box(0, 0, 0)])?.surfaceY).toBe(0);
  });
  it('picks the highest of stacked platforms below the token', () => {
    const w = [box(0, 0, 0), box(0, 2, 0), box(0, 8, 0)];
    expect(dropLineFor(tok(0, 6, 0), w)?.surfaceY).toBe(4);
  });
  it('token inside a platform footprint at height drops to what is below it', () => {
    const l = dropLineFor(tok(0, 1, 0), [box(0, 0, 0)]);
    expect(l?.surfaceY).toBe(0);
    expect(l?.length).toBe(1);
  });
  it('scales the disc with the footprint', () => {
    const a = dropLineFor(tok(0, 2, 0, 1), []);
    const b = dropLineFor(tok(0, 2, 0, 3), []);
    expect(b?.discRadius).toBeCloseTo((a?.discRadius ?? 0) * 3);
    expect(a?.discRadius).toBeGreaterThan(standeeDimensions(1).baseRadius);
  });
});

describe('dropLinesFor', () => {
  it('uses only walkable shapes and only tokens', () => {
    const shape = (walkable: boolean, id: string): RenderEntity => ({
      id,
      layer: 'props-under',
      position: [0, 0, 0],
      sizeCells: 1,
      secret: false,
      shape: {
        kind: 'box',
        color: '#fff',
        walkable,
        width: 4,
        height: 2,
        depth: 4,
        yaw: 0,
        scale: { x: 4, y: 2, z: 4 },
      },
    });
    const token: RenderEntity = {
      id: 't',
      layer: 'tokens',
      position: [0, 5, 0],
      sizeCells: 1,
      secret: false,
      token: {
        image: undefined,
        name: 't',
        owners: [],
        entityLayer: 'tokens',
        perms: {},
        labelVisibility: 'all',
      },
    };
    const scene = (w: boolean): RenderScene => ({
      id: 's',
      background: '#000',
      entities: [shape(w, 'p'), token],
    });
    expect(dropLinesFor(scene(true)).map((d) => [d.id, d.line.surfaceY])).toEqual([['t', 2]]);
    expect(dropLinesFor(scene(false))[0]?.line.surfaceY).toBe(0);
    expect(dropLinesFor({ ...scene(true), entities: [shape(true, 'p')] })).toEqual([]);
  });
});
