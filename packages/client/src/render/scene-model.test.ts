import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { Entity, Scene } from '@mythic/shared';
import { makeCampaign, tid } from '../testing.js';
import {
  activeRenderScene,
  gridToWorld,
  mapScene,
  orderedEntities,
  RENDER_LAYERS,
  renderLayer,
  safeYaw,
  type RenderEntity,
} from './scene-model.js';
import { tokenQuadRotation } from './PickableEntities.js';
import { standeeYaw } from './token-standee.js';

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
      yaw: 0,
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

  it('places tokens from every authored layer above props in the token slot', () => {
    for (const layer of ['map', 'props', 'tokens', 'dm'] as const) {
      const subject = Entity.parse({
        ...entity(7, layer),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      });
      expect(renderLayer(subject)).toBe('tokens');
    }
    expect(renderLayer(entity(8, 'map'))).toBe('map');
    expect(renderLayer(entity(9, 'props'))).toBe('props-under');
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

describe('token rotation (M1-34)', () => {
  const token = (rotation: { x: number; y: number; z: number; w: number }) =>
    Entity.parse({
      id: tid(40),
      layer: 'tokens',
      name: 'Trooper',
      owners: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation,
        scale: { x: 1, y: 1, z: 1 },
      },
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    });
  const yawOf = (rotation: { x: number; y: number; z: number; w: number }) =>
    mapScene({ ...scene, entities: { [tid(40)]: token(rotation) } }).entities[0]?.yaw;

  // Unit quaternions for a pure +Y rotation (same convention as the gizmo: quaternionFromYaw).
  const yawQuat = (yaw: number) => ({
    x: 0,
    y: Math.sin(yaw / 2),
    z: 0,
    w: Math.cos(yaw / 2),
  });

  it('maps the entity yaw for zero, full turns and negative angles', () => {
    expect(yawOf({ x: 0, y: 0, z: 0, w: 1 })).toBe(0);
    expect(yawOf(yawQuat(0.75))).toBeCloseTo(0.75);
    expect(yawOf(yawQuat(Math.PI))).toBeCloseTo(Math.PI);
    // A full turn is stored as the identity quaternion, so the yaw reads back as 0.
    expect(yawOf(yawQuat(2 * Math.PI))).toBeCloseTo(0);
    expect(yawOf(yawQuat(-1.1))).toBeCloseTo(-1.1);
  });

  it('never lets a non-finite stored rotation reach the renderer', () => {
    // Entity.parse (Zod number()) already rejects NaN/Infinity, so a non-finite rotation is
    // never stored; safeYaw is the renderer-side guard that maps any such value to 0.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const key of ['x', 'y', 'z', 'w'] as const) {
        const rotation: { x: number; y: number; z: number; w: number } = {
          x: 0,
          y: 0,
          z: 0,
          w: 1,
          [key]: value,
        };
        expect(safeYaw(rotation), `${key}=${String(value)}`).toBe(0);
      }
    }
    expect(safeYaw(yawQuat(0.5))).toBeCloseTo(0.5);
  });

  // The flat token quad uses three.js Euler order 'XYZ'. tokenQuadRotation must compose the
  // -PI/2 tilt with the entity yaw into exactly "flat quad, then a pure turn about world +Y".
  it('keeps the 2D quad in the floor plane and turned about world +Y by the entity yaw', () => {
    const y = new Vector3(0, 1, 0);
    for (const yaw of [0, 0.3, Math.PI / 2, Math.PI, -2.4, 5.9, -6.5]) {
      const [xRot, yRot, zRot] = tokenQuadRotation(yaw);
      const net = new Quaternion().setFromEuler(new Euler(xRot, yRot, zRot));
      const expected = new Quaternion()
        .setFromAxisAngle(y, yaw)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
      // Compositions are equal up to floating-point round-off (max ~5e-8 over a full sweep).
      expect(net.angleTo(expected)).toBeLessThan(1e-6);
      // The quad's normal (+Z before rotation) must point straight up at every angle, i.e.
      // the quad stays flat on the floor plane instead of tilting into it.
      const normal = new Vector3(0, 0, 1).applyQuaternion(net);
      expect(normal.y).toBeCloseTo(1, 9);
      // The artwork's right edge (+X before rotation) must point where the gizmo says the
      // token's forward is: (cos yaw, 0, -sin yaw), the convention of primitives.ts `rotate`.
      const right = new Vector3(1, 0, 0).applyQuaternion(net);
      expect(right.x).toBeCloseTo(Math.cos(yaw), 6);
      expect(right.y).toBeCloseTo(0, 6);
      expect(right.z).toBeCloseTo(-Math.sin(yaw), 6);
    }
  });

  it('adds the entity yaw on top of the standee billboard (CAM-04, no mirroring)', () => {
    expect(standeeYaw(0, 0)).toBe(0);
    expect(standeeYaw(Math.PI / 3, 0.5)).toBeCloseTo(Math.PI / 3 + 0.5);
    expect(standeeYaw(-1.2, 2.0)).toBeCloseTo(0.8);
  });
});
