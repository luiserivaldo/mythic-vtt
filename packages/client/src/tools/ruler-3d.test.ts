import { describe, expect, it } from 'vitest';
import type { Entity, Scene } from '@mythic/shared';
import { prepareRulerPoint3d, rulerGuideCorner } from './ruler-3d.js';

const box: Entity = {
  id: 'B'.repeat(26),
  layer: 'props',
  name: 'Platform',
  owners: [],
  transform: {
    position: { x: 5, y: 2, z: 5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 4, y: 3, z: 4 },
  },
  shape: { kind: 'box', color: '#888888', walkable: true },
};

const token: Entity = {
  id: 'T'.repeat(26),
  layer: 'tokens',
  name: 'Scout',
  owners: [],
  transform: {
    position: { x: 8.5, y: 10, z: 8.5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
};

const scene: Scene = {
  id: 'S'.repeat(26),
  name: 'Tower',
  grid: {
    type: 'square',
    sizePx: 70,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'euclidean',
    snap: false,
  },
  bounds: { width: 20, height: 20 },
  environment: { background: '#000000' },
  layers: {},
  entities: { [box.id]: box, [token.id]: token },
};

describe('3D ruler picks (MEAS-02)', () => {
  it('uses the token base position instead of the standee hit point', () => {
    expect(prepareRulerPoint3d({ x: 8.5, y: 10.8, z: 8.5 }, scene, token.id)).toEqual(
      token.transform.position,
    );
  });

  it('resolves a primitive ray hit through the shared walkable surface geometry', () => {
    expect(prepareRulerPoint3d({ x: 5, y: 5, z: 5 }, scene, box.id)).toEqual({
      x: 5,
      y: 5,
      z: 5,
    });
  });

  it('measures a non-walkable primitive surface too', () => {
    const nonWalkable: Scene = {
      ...scene,
      entities: {
        [box.id]: {
          ...box,
          shape: { kind: 'box', color: '#888888', walkable: false },
        },
      },
    };
    expect(prepareRulerPoint3d({ x: 5, y: 5, z: 5 }, nonWalkable, box.id).y).toBe(5);
  });

  it('keeps the guide horizontal at the first point before its vertical leg', () => {
    expect(rulerGuideCorner({ x: 1, y: 0, z: 2 }, { x: 4, y: 10, z: 7 })).toEqual({
      x: 4,
      y: 0,
      z: 7,
    });
  });
});
