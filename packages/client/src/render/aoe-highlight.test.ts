import { Entity, Scene, type AoE } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { tid } from '../testing.js';
import { deriveAoEHighlights } from './aoe-highlight.js';

const transform = (x: number, y: number, z: number) => ({
  position: { x, y, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
});

const token = (id: number, name: string, x: number, y: number, z: number, layer = 'tokens') =>
  Entity.parse({
    id: tid(id),
    layer,
    name,
    owners: [],
    transform: transform(x, y, z),
    token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
  });

const sceneWith = (aoe: AoE) => {
  const affected = token(1, 'Inside', 2, 0, 2);
  const edge = token(2, 'Edge', 3, 0, 2);
  const outside = token(3, 'Outside', 3.01, 0, 2);
  const elevated = token(4, 'Elevated', 2, 3, 2);
  const hidden = token(5, 'Secret', 2, 0, 2, 'dm');
  const volume = Entity.parse({
    id: tid(10),
    layer: 'effects',
    name: 'Sphere',
    owners: [],
    transform: transform(aoe.position.x, aoe.position.y, aoe.position.z),
    aoe: { kind: 'sphere', radius: 1, color: '#ff7744' },
  });
  return Scene.parse({
    id: tid(20),
    name: 'Highlights',
    bounds: { width: 4, height: 4 },
    grid: {
      type: 'square',
      sizePx: 70,
      unitsPerCell: 5,
      unitLabel: 'ft',
      diagonal: 'chebyshev',
      snap: true,
    },
    environment: { background: '#102030' },
    layers: {},
    entities: Object.fromEntries(
      [affected, edge, outside, elevated, hidden, volume].map((entity) => [entity.id, entity]),
    ),
  });
};

describe('AoE affected highlight derivation', () => {
  it('uses centre inclusion for inside and exact-edge tokens, respects elevation, and excludes hidden entities', () => {
    const scene = sceneWith({ kind: 'sphere', position: { x: 2, y: 0, z: 2 }, radius: 1 });
    const result = deriveAoEHighlights(scene, { hiddenLayers: new Set(['dm']) });

    expect(result.tokenNames).toEqual(['Edge', 'Inside']);
    expect(result.tokenIds).not.toContain(tid(3));
    expect(result.tokenIds).not.toContain(tid(4));
    expect(result.tokenIds).not.toContain(tid(5));
    expect(result.cells.every((cell) => cell.x >= 0 && cell.z >= 0)).toBe(true);
  });

  it('updates from an elevated local override and omits redacted names while retaining the token highlight', () => {
    const scene = sceneWith({ kind: 'sphere', position: { x: 2, y: 0, z: 2 }, radius: 1 });
    const redacted = scene.entities[tid(4)];
    if (!redacted) throw new Error('missing elevated fixture');
    redacted.name = '';
    const result = deriveAoEHighlights(scene, {
      hiddenLayers: new Set(['dm']),
      override: {
        entityId: tid(10),
        aoe: { kind: 'sphere', position: { x: 2, y: 3, z: 2 }, radius: 0.1 },
      },
    });

    expect(result.tokenIds).toEqual([tid(4)]);
    expect(result.tokenNames).toEqual([]);
  });
});
