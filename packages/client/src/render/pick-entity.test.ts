import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { Entity, Scene } from '@mythic/shared';
import { tid } from '../testing.js';
import { entityIdForObject, hoveredTokenId } from './pick-entity.js';

const TOKEN = tid(1);
const PROP = tid(2);

const scene = Scene.parse({
  id: tid(9),
  name: 'Hover scene',
  grid: {
    type: 'square',
    sizePx: 70,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'alternating',
    snap: true,
  },
  environment: { background: '#102030' },
  layers: {},
  entities: {
    [TOKEN]: Entity.parse({
      id: TOKEN,
      layer: 'tokens',
      name: 'Goblin',
      owners: [],
      transform: {
        position: { x: 1, y: 0, z: 2 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    }),
    [PROP]: Entity.parse({
      id: PROP,
      layer: 'props',
      name: 'Wall',
      owners: [],
      transform: {
        position: { x: 3, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      shape: { kind: 'box', color: '#334455', walkable: false },
    }),
  },
});

function named(name: string): Object3D {
  const mesh = new Object3D();
  mesh.name = name;
  return mesh;
}

describe('entityIdForObject', () => {
  it('resolves a mesh named after an entity', () => {
    expect(entityIdForObject(named(TOKEN), scene)).toBe(TOKEN);
    expect(entityIdForObject(named(PROP), scene)).toBe(PROP);
  });

  it('walks up unnamed and unknown parents to the entity group', () => {
    const outer = named(TOKEN);
    const inner = new Object3D();
    const leaf = new Object3D();
    outer.add(inner);
    inner.add(leaf);
    expect(entityIdForObject(leaf, scene)).toBe(TOKEN);
  });

  it('ignores unnamed helpers and names the scene does not hold', () => {
    expect(entityIdForObject(new Object3D(), scene)).toBeUndefined();
    expect(entityIdForObject(named('grid'), scene)).toBeUndefined();
    expect(entityIdForObject(named('canvas-fill'), scene)).toBeUndefined();
    expect(entityIdForObject(named(tid(30)), scene)).toBeUndefined();
  });

  it('prefers the nearest named ancestor', () => {
    const outer = named(PROP);
    const inner = named(TOKEN);
    outer.add(inner);
    expect(entityIdForObject(inner, scene)).toBe(TOKEN);
  });
});

describe('hoveredTokenId (MEAS-05)', () => {
  it('takes the nearest token hit and ignores non-token hits in front of it', () => {
    const hits = [{ object: named(PROP) }, { object: named(TOKEN) }];
    expect(hoveredTokenId(hits, scene)).toBe(TOKEN);
  });

  it('returns null for no hits, non-token hits only, and unknown entity ids', () => {
    expect(hoveredTokenId([], scene)).toBeNull();
    expect(hoveredTokenId([{ object: named(PROP) }], scene)).toBeNull();
    expect(hoveredTokenId([{ object: named('grid') }], scene)).toBeNull();
    expect(hoveredTokenId([{ object: named(tid(31)) }], scene)).toBeNull();
  });

  it('resolves a hit on a standee child to its token', () => {
    const base = named(TOKEN);
    const quad = named(TOKEN);
    base.add(quad);
    expect(hoveredTokenId([{ object: quad }], scene)).toBe(TOKEN);
  });
});
