import { describe, expect, it } from 'vitest';
import { Entity, Scene } from '@mythic/shared';
import { makeCampaign, tid } from '../testing.js';
import {
  activeRenderScene,
  gridToWorld,
  mapScene,
  orderedEntities,
  RENDER_LAYERS,
  renderLayer,
  type RenderEntity,
} from './scene-model.js';

const entity = (id: number, layer: Entity['layer'], x = 0, y = 0, z = 0) =>
  Entity.parse({
    id: tid(id),
    layer,
    name: 'Fixture',
    owners: [],
    transform: {
      position: { x, y, z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });

const scene = Scene.parse({
  id: tid(8),
  name: 'Scene',
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
  entities: {
    [tid(3)]: entity(3, 'effects'),
    [tid(4)]: entity(4, 'tokens', 2, 4, -3),
    [tid(5)]: entity(5, 'props'),
    [tid(6)]: entity(6, 'map'),
  },
});

describe('render layer ordering', () => {
  it('keeps the documented order including reserved slots', () => {
    expect(RENDER_LAYERS).toEqual(['map', 'props-under', 'tokens', 'props-over', 'effects', 'ui']);
    const entries = [...RENDER_LAYERS].reverse().map((layer, index): RenderEntity => ({
      id: String(index),
      layer,
      position: [0, 0, 0],
      sizeCells: 1,
      secret: false,
    }));
    expect(orderedEntities(entries).map((item) => item.layer)).toEqual(RENDER_LAYERS);
    expect(entries[0]?.layer).toBe('ui');
  });

  it('places received DM tokens in the token slot', () => {
    const hidden = Entity.parse({
      ...entity(7, 'dm'),
      token: {
        sizeCells: 2,
        heightCells: 1,
        labelVisibility: 'dm',
      },
    });
    expect(renderLayer(hidden)).toBe('tokens');
  });
});

describe('store to scene mapping', () => {
  it('uses the active Scene and its received entities only', () => {
    const campaign = makeCampaign();
    campaign.scenes[scene.id] = scene;
    expect(activeRenderScene(campaign)).toBeNull();
    campaign.activeSceneId = scene.id;
    const mapped = activeRenderScene(campaign);
    expect(mapped).toEqual(mapScene(scene));
    expect(mapped?.background).toBe('#102030');
    expect(mapped?.entities.map((item) => item.layer)).toEqual([
      'map',
      'props-under',
      'tokens',
      'effects',
    ]);
    expect(mapped?.entities.find((item) => item.id === tid(4))?.position).toEqual([2, 4, -3]);
    campaign.activeSceneId = tid(9);
    expect(activeRenderScene(campaign)).toBeNull();
  });
});

describe('grid coordinates', () => {
  it('maps grid X/Y and elevation to world X/Z/Y across signed values', () => {
    for (const x of [-100, -0.5, 0, 0.25, 100]) {
      for (const y of [-50, 0, 50]) {
        for (const elevation of [-2, 0, 9]) {
          expect(gridToWorld(x, y, elevation)).toEqual([x, elevation, y]);
        }
      }
    }
    expect(gridToWorld(1, 2)).toEqual([1, 0, 2]);
  });
});

describe('primitive shapes (ENV-02)', () => {
  const shaped = (kind: 'box' | 'plane' | 'wedge', scale: { x: number; y: number; z: number }) =>
    Entity.parse({
      id: tid(20),
      layer: 'props',
      name: 'Platform',
      owners: [],
      transform: {
        position: { x: 3, y: 1, z: 4 },
        rotation: { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) },
        scale,
      },
      shape: { kind, color: '#aa5522', walkable: true },
    });
  const map = (entity: Entity) =>
    mapScene({ ...scene, entities: { [entity.id]: entity } }).entities[0];

  it('maps shape data, size, yaw and base position', () => {
    const rendered = map(shaped('box', { x: 2, y: 3, z: 4 }));
    expect(rendered?.position).toEqual([3, 1, 4]);
    expect(rendered?.shape).toMatchObject({
      kind: 'box',
      color: '#aa5522',
      walkable: true,
      width: 2,
      height: 3,
      depth: 4,
    });
    expect(rendered?.shape?.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('gives planes a fixed thickness and omits shape for non-shapes', () => {
    expect(map(shaped('plane', { x: 5, y: 9, z: 5 }))?.shape?.height).toBeLessThan(0.1);
    expect(map(entity(30, 'props'))?.shape).toBeUndefined();
  });
});
