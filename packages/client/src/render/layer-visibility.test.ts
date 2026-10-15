import { describe, expect, it } from 'vitest';
import { Entity, Scene, type LayerId } from '@mythic/shared';
import { tid } from '../testing.js';
import { mapScene } from './scene-model.js';
import { visibleEntities } from './layer-visibility.js';

function entity(n: number, layer: LayerId) {
  return Entity.parse({
    id: tid(n),
    layer,
    name: `E${String(n)}`,
    owners: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
  });
}

const scene = Scene.parse({
  id: tid(9),
  name: 'Layers',
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
    [tid(1)]: entity(1, 'dm'),
    [tid(2)]: entity(2, 'tokens'),
    [tid(3)]: entity(3, 'props'),
  },
});

describe('visibleEntities', () => {
  const rendered = mapScene(scene);
  const ids = (hidden: LayerId[]) =>
    visibleEntities(rendered, scene, new Set(hidden)).map((e) => e.id);

  it('keeps everything when no layer is hidden', () => {
    expect(ids([])).toHaveLength(3);
  });
  it('drops entities on any hidden layer, not just DM only', () => {
    expect(ids(['dm']).sort()).toEqual([tid(2), tid(3)].sort());
    expect(ids(['tokens', 'props'])).toEqual([tid(1)]);
  });
});
