import { Campaign, type Entity, type Grid } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { makeCampaign, tid } from '../testing.js';
import {
  intersectRayPlane,
  multiplyQuaternions,
  projectRayToAxis,
  quaternionFromAxisAngle,
  resolveGizmo3DTarget,
  rotateDraft,
  signedAngleAroundAxis,
  snapLinear,
  snapRotation,
} from './transform-gizmo-3d.js';

const S = tid(31);
const E = tid(32);
const P = tid(33);
const grid: Grid = {
  type: 'square', sizePx: 70, unitsPerCell: 5, unitLabel: 'ft', diagonal: 'chebyshev', snap: true,
};
const entity = (over: Partial<Entity> = {}): Entity => ({
  id: E,
  layer: 'props',
  name: 'Crate',
  owners: [],
  transform: {
    position: { x: 2, y: 1, z: 3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  shape: { kind: 'box', color: '#885522', walkable: true },
  ...over,
});

describe('3D axis and plane projection', () => {
  it('projects a pointer ray onto the vertical move axis', () => {
    expect(
      projectRayToAxis(
        { x: 3, y: 4, z: 5 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 5 },
        { x: 0, y: 1, z: 0 },
      ),
    ).toBeCloseTo(3);
    expect(
      projectRayToAxis(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ),
    ).toBeNull();
  });

  it('intersects the ground and rotation planes and rejects parallel rays', () => {
    expect(
      intersectRayPlane(
        { x: 1, y: 4, z: 2 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ),
    ).toEqual({ x: 1, y: 1, z: 2 });
    expect(
      intersectRayPlane(
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ),
    ).toBeNull();
  });
});

describe('3D snapping and rotation', () => {
  it('snaps translation to whole cells and rotation to 15 degrees', () => {
    expect(snapLinear(2.49, true)).toBe(2);
    expect(snapLinear(2.49, false)).toBe(2.49);
    expect((snapRotation((22 * Math.PI) / 180, true) * 180) / Math.PI).toBeCloseTo(15);
    expect((snapRotation((22 * Math.PI) / 180, false) * 180) / Math.PI).toBeCloseTo(22);
  });

  it('finds signed angles and composes normalised axis rotations', () => {
    expect(
      signedAngleAroundAxis({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }),
    ).toBeCloseTo(Math.PI / 2);
    const q = rotateDraft({ x: 0, y: 0, z: 0, w: 1 }, 'x', (22 * Math.PI) / 180, true);
    expect(q.x).toBeCloseTo(Math.sin(Math.PI / 24));
    expect(q.w).toBeCloseTo(Math.cos(Math.PI / 24));
    const combined = multiplyQuaternions(q, quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2));
    expect(Math.hypot(combined.x, combined.y, combined.z, combined.w)).toBeCloseTo(1);
  });
});

describe('resolveGizmo3DTarget', () => {
  const campaign = Campaign.parse({
    ...makeCampaign(),
    activeSceneId: S,
    seats: {
      [P]: {
        id: P, label: 'Player', role: 'player', identityId: null, binding: 'persistent',
        permissions: { view: true, move: true, edit: false, delete: false },
      },
    },
    scenes: {
      [S]: {
        id: S, name: 'Ruins', grid, environment: { background: '#000000' }, layers: {},
        entities: {
          [E]: entity(),
          [tid(34)]: entity({ id: tid(34), layer: 'tokens', shape: undefined, owners: [P], token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' } }),
          [tid(35)]: entity({ id: tid(35), shape: undefined, image: { asset: { kind: 'local', hash: 'a'.repeat(64) }, calibrated: false } }),
        },
      },
    },
  });

  it('permits host props and owner token elevation, but not unrelated entities', () => {
    expect(resolveGizmo3DTarget(campaign, [E], { kind: 'host' })?.kind).toBe('prop');
    expect(resolveGizmo3DTarget(campaign, [tid(34)], { kind: 'seat', seatId: P })?.kind).toBe('token');
    expect(resolveGizmo3DTarget(campaign, [E], { kind: 'seat', seatId: P })).toBeNull();
    expect(resolveGizmo3DTarget(campaign, [tid(35)], { kind: 'host' })).toBeNull();
  });
});
