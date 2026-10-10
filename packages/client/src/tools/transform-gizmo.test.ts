import { Campaign, yawFromQuaternion, type Entity, type Grid } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import type { IntentResult } from '../net/intents.js';
import { makeCampaign, tid } from '../testing.js';
import { commitTransform, type Submit } from './gizmo-commit.js';
import { gizmoStore } from './gizmo-store.js';
import {
  applyMove,
  applyRotate,
  applyScale,
  buildTransform,
  draftFromEntity,
  entityExtents,
  entityScale,
  formatTyped,
  handleLayout,
  hitHandle,
  normalizeYaw,
  parseTypedValues,
  pointerAngle,
  quaternionFromYaw,
  resolveGizmoTarget,
  sameTransform,
  snapFootprint,
} from './transform-gizmo.js';

const grid = (over: Partial<Grid> = {}): Grid => ({
  type: 'square',
  sizePx: 70,
  unitsPerCell: 5,
  unitLabel: 'ft',
  diagonal: 'chebyshev',
  snap: true,
  ...over,
});
const deg = (d: number) => (d * Math.PI) / 180;

const S = tid(2);
const E = tid(3);
const entity = (over: Partial<Entity> = {}): Entity => ({
  id: E,
  layer: 'tokens',
  name: 'Goblin',
  owners: [],
  transform: {
    position: { x: 2.5, y: 1, z: 3.5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  ...over,
});

describe('move', () => {
  const base = { start: { x: 2.5, z: 3.5 }, pointerStart: { x: 2.5, z: 3.5 } };
  it('snaps odd footprints to cell centres and even ones to corners', () => {
    const pointer = { x: 4.9, z: 3.6 };
    expect(applyMove({ ...base, pointer, grid: grid(), footprint: 1 })).toEqual({ x: 4.5, z: 3.5 });
    expect(applyMove({ ...base, pointer, grid: grid(), footprint: 2 })).toEqual({ x: 5, z: 4 });
  });
  it('is free when the grid does not snap, and for unsupported grids', () => {
    const pointer = { x: 4.9, z: 3.6 };
    const free = applyMove({ ...base, pointer, grid: grid({ snap: false }), footprint: 1 });
    expect(free.x).toBeCloseTo(4.9);
    expect(free.z).toBeCloseTo(3.6);
    expect(
      applyMove({ ...base, pointer, grid: grid({ type: 'hex' }), footprint: 1 }).x,
    ).toBeCloseTo(4.9);
  });
  it('derives the footprint from the entity extents', () => {
    expect(snapFootprint({ width: 0.5, depth: 0.5 })).toBe(1);
    expect(snapFootprint({ width: 2, depth: 1 })).toBe(2);
  });
});

describe('rotate', () => {
  const center = { x: 0, z: 0 };
  it('measures angles in the yaw sense', () => {
    expect(pointerAngle(center, { x: 1, z: 0 })).toBeCloseTo(0);
    expect(pointerAngle(center, { x: 0, z: -1 })).toBeCloseTo(Math.PI / 2);
  });
  it('snaps to 15 degrees on a snapping grid', () => {
    const pointer = { x: Math.cos(deg(-40)), z: Math.sin(deg(40)) }; // pointer angle -37 deg
    const yaw = applyRotate({
      center,
      pointerStart: { x: 1, z: 0 },
      pointer,
      startYaw: 0,
      grid: grid(),
    });
    expect((yaw * 180) / Math.PI).toBeCloseTo(-45);
  });
  it('is free otherwise and keeps the start yaw at the centre', () => {
    const pointer = { x: Math.cos(deg(-40)), z: Math.sin(deg(40)) };
    const free = applyRotate({
      center,
      pointerStart: { x: 1, z: 0 },
      pointer,
      startYaw: 0,
      grid: grid({ snap: false }),
    });
    expect((free * 180) / Math.PI).toBeCloseTo(-40);
    expect(
      applyRotate({
        center,
        pointerStart: { x: 1, z: 0 },
        pointer: center,
        startYaw: 1,
        grid: grid(),
      }),
    ).toBe(1);
  });
  it('round-trips yaw through the quaternion the renderer reads', () => {
    for (const d of [-170, -45, 0, 15, 90, 180]) {
      expect(yawFromQuaternion(quaternionFromYaw(deg(d)))).toBeCloseTo(normalizeYaw(deg(d)));
    }
  });
  it('normalises into (-PI, PI]', () => {
    expect(normalizeYaw(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeYaw(-Math.PI)).toBeCloseTo(Math.PI);
  });
});

describe('scale', () => {
  const center = { x: 0, z: 0 };
  const args = { center, pointerStart: { x: 2, z: 0 }, startScale: 1 };
  it('snaps to whole grid units, never below one, when the grid snaps', () => {
    expect(applyScale({ ...args, pointer: { x: 5.4, z: 0 }, grid: grid() })).toBe(3);
    expect(applyScale({ ...args, pointer: { x: 0.2, z: 0 }, grid: grid() })).toBe(1);
  });
  it('is continuous and clamped otherwise', () => {
    expect(
      applyScale({ ...args, pointer: { x: 3, z: 0 }, grid: grid({ snap: false }) }),
    ).toBeCloseTo(1.5);
    expect(applyScale({ ...args, pointer: { x: 0, z: 0 }, grid: grid({ snap: false }) })).toBe(0.1);
  });
});

describe('handles', () => {
  const layout = handleLayout({ x: 0, z: 0 }, 0, 0.5, 1 / 48);
  it('hits the nearest handle within the radius and prefers outer handles over move', () => {
    expect(hitHandle(layout.move, layout, 0.2)).toBe('move');
    expect(hitHandle(layout.rotate, layout, 0.2)).toBe('rotate');
    expect(hitHandle(layout.scale, layout, 0.2)).toBe('scale');
    expect(hitHandle({ x: -3, z: -3 }, layout, 0.2)).toBeNull();
    const overlapped = { move: { x: 0, z: 0 }, rotate: { x: 0, z: 0 }, scale: { x: 9, z: 9 } };
    expect(hitHandle({ x: 0, z: 0 }, overlapped, 0.2)).toBe('rotate');
  });
  it('places the rotate handle along the yaw direction', () => {
    const l = handleLayout({ x: 1, z: 1 }, Math.PI / 2, 0.5, 0);
    expect(l.rotate.x).toBeCloseTo(1);
    expect(l.rotate.z).toBeCloseTo(0.5);
  });
});

describe('typed values', () => {
  const ok = { x: '10', z: '-5', rotation: '90', scale: '2' };
  it('converts scene units to cells and degrees to radians', () => {
    const r = parseTypedValues(ok, 5);
    expect(r).toEqual({ ok: true, draft: { x: 2, z: -1, yaw: Math.PI / 2, scale: 2 } });
  });
  it('accepts comma decimals and normalises angles', () => {
    const r = parseTypedValues({ ...ok, x: '2,5', rotation: '270' }, 5);
    expect(r.ok && r.draft.x).toBeCloseTo(0.5);
    expect(r.ok && r.draft.yaw).toBeCloseTo(-Math.PI / 2);
  });
  it.each(['', 'abc', '1e', 'NaN', 'Infinity', '1 2'])('rejects %j', (bad) => {
    const r = parseTypedValues({ ...ok, x: bad, rotation: bad, scale: bad }, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['rotation', 'scale', 'x']);
  });
  it('rejects non-positive and out-of-range scale and huge coordinates', () => {
    for (const scale of ['0', '-1', '1000'])
      expect(parseTypedValues({ ...ok, scale }, 5).ok).toBe(false);
    expect(parseTypedValues({ ...ok, z: '1e12' }, 5).ok).toBe(false);
  });
  it('formats what it parses', () => {
    const e = entity();
    const typed = formatTyped(draftFromEntity(e), 5);
    expect(typed).toEqual({ x: '12.5', z: '17.5', rotation: '0', scale: '1' });
    const back = parseTypedValues(typed, 5);
    expect(back.ok && buildTransform(e.transform, back.draft)).toEqual(e.transform);
  });
});

describe('buildTransform', () => {
  it('keeps elevation, untouched rotation and scales all axes together', () => {
    const e = entity({ transform: { ...entity().transform, scale: { x: 1, y: 2, z: 3 } } });
    const t = buildTransform(e.transform, { x: 4, z: 5, yaw: 0, scale: 2 });
    expect(t.position).toEqual({ x: 4, y: 1, z: 5 });
    expect(t.rotation).toBe(e.transform.rotation);
    expect(t.scale).toEqual({ x: 2, y: 4, z: 6 });
    expect(sameTransform(buildTransform(e.transform, draftFromEntity(e)), e.transform)).toBe(true);
  });
});

describe('token scale source (TOK-09)', () => {
  it('uses token.sizeCells for drafts and footprints, never transform scale', () => {
    const token = entity({
      token: { sizeCells: 3, heightCells: 3, labelVisibility: 'all' },
      transform: { ...entity().transform, scale: { x: 9, y: 8, z: 7 } },
    });
    expect(entityScale(token)).toBe(3);
    expect(draftFromEntity(token).scale).toBe(3);
    expect(entityExtents(token)).toEqual({ width: 3, depth: 3 });
  });
});

describe('resolveGizmoTarget (PERM-01/02, D23)', () => {
  const campaign = (): Campaign => {
    const c = makeCampaign();
    const P = tid(4);
    return Campaign.parse({
      ...c,
      seats: {
        [P]: {
          id: P,
          label: 'Ann',
          role: 'player',
          identityId: null,
          binding: 'persistent',
          permissions: { view: true, move: true, edit: false, delete: false },
        },
      },
      activeSceneId: S,
      scenes: {
        [S]: {
          id: S,
          name: 'Crypt',
          grid: grid(),
          environment: { background: '#000' },
          layers: {},
          entities: {
            [E]: entity(),
            [tid(5)]: entity({ id: tid(5), owners: [P] }),
            [tid(6)]: entity({ id: tid(6), layer: 'props' }),
          },
        },
      },
    });
  };
  const player = { kind: 'seat', seatId: tid(4) } as const;
  it('host may transform any single selected entity', () => {
    expect(resolveGizmoTarget(campaign(), [E], { kind: 'host' })?.entity.id).toBe(E);
  });
  it('a player only gets handles for entities they own', () => {
    expect(resolveGizmoTarget(campaign(), [E], player)).toBeNull();
    expect(resolveGizmoTarget(campaign(), [tid(5)], player)?.entity.id).toBe(tid(5));
    expect(resolveGizmoTarget(campaign(), [tid(6)], player)).toBeNull();
  });
  it('shows nothing for observers, multi-selection, empty selection or unknown ids', () => {
    expect(resolveGizmoTarget(campaign(), [E], null)).toBeNull();
    expect(resolveGizmoTarget(campaign(), [E, tid(5)], { kind: 'host' })).toBeNull();
    expect(resolveGizmoTarget(campaign(), [], { kind: 'host' })).toBeNull();
    expect(resolveGizmoTarget(campaign(), [tid(9)], { kind: 'host' })).toBeNull();
    expect(resolveGizmoTarget(null, [E], { kind: 'host' })).toBeNull();
  });
});

describe('commitTransform (D34)', () => {
  const draft = { x: 4.5, z: 3.5, yaw: 0, scale: 1 };
  const begin = (e: Entity) => {
    gizmoStore.getState().clear();
    gizmoStore.getState().begin({
      sceneId: S,
      entityId: E,
      draft,
      base: e.transform,
      baseTokenSize: e.token?.sizeCells,
    });
  };
  const run = (e: Entity, submit: Submit) =>
    commitTransform({ submit, store: gizmoStore, sceneId: S, entity: e, draft });

  it('sends exactly one entity.update with only the transform and settles', async () => {
    const e = entity();
    begin(e);
    const calls: unknown[][] = [];
    const ok = await run(e, (...a) => {
      calls.push(a);
      return Promise.resolve<IntentResult>({ ok: true, seq: 1 });
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      'entity.update',
      { sceneId: S, entityId: E, changes: { transform: buildTransform(e.transform, draft) } },
      S,
    ]);
    expect(gizmoStore.getState().preview?.settling).toBe(true);
    expect(gizmoStore.getState().busy).toBe(false);
  });
  it('updates a token size without changing its transform scale', async () => {
    const e = entity({ token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' } });
    const resized = { ...draftFromEntity(e), scale: 2 };
    gizmoStore.getState().clear();
    gizmoStore.getState().begin({
      sceneId: S,
      entityId: E,
      draft: resized,
      base: e.transform,
      baseTokenSize: e.token?.sizeCells,
    });
    const calls: unknown[][] = [];
    const ok = await commitTransform({
      submit: (...args) => {
        calls.push(args);
        return Promise.resolve<IntentResult>({ ok: true, seq: 1 });
      },
      store: gizmoStore,
      sceneId: S,
      entity: e,
      draft: resized,
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([
      [
        'entity.update',
        {
          sceneId: S,
          entityId: E,
          changes: { token: { ...e.token, sizeCells: 2 } },
        },
        S,
      ],
    ]);
    expect(e.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
  });
  it('reverts the preview and reports the reason on reject', async () => {
    const e = entity();
    begin(e);
    const ok = await run(e, () => Promise.resolve({ ok: false, reason: 'timeout' }));
    expect(ok).toBe(false);
    expect(gizmoStore.getState().preview).toBeNull();
    expect(gizmoStore.getState().error).toMatch(/did not accept/);
  });
  it('sends nothing when the transform is unchanged', async () => {
    const e = entity();
    begin(e);
    let sent = 0;
    await commitTransform({
      submit: () => {
        sent++;
        return Promise.resolve<IntentResult>({ ok: true, seq: 1 });
      },
      store: gizmoStore,
      sceneId: S,
      entity: e,
      draft: draftFromEntity(e),
    });
    expect(sent).toBe(0);
    expect(gizmoStore.getState().preview).toBeNull();
  });
  it('ignores a second commit while one is in flight', async () => {
    const e = entity();
    begin(e);
    let release: (r: IntentResult) => void = () => undefined;
    const pending = run(e, () => new Promise<IntentResult>((r) => (release = r)));
    expect(await run(e, () => Promise.reject(new Error('should not send')))).toBe(false);
    release({ ok: true, seq: 1 });
    expect(await pending).toBe(true);
  });
});

describe('battlemap gizmo bounds (M1-42)', () => {
  const map = entity({
    layer: 'map',
    image: { asset: { source: 'local', kind: 'image', hash: 'a'.repeat(64) }, calibrated: true },
    transform: { ...entity().transform, scale: { x: 4, y: 4, z: 4 } },
  });
  it('matches rectangular texture dimensions rather than a square placeholder', () => {
    expect(entityExtents(map, 2)).toEqual({ width: 8, depth: 4 });
    expect(entityExtents(map, 0.5)).toEqual({ width: 2, depth: 4 });
  });
  it('falls back safely before texture load or for invalid aspect', () => {
    for (const aspect of [undefined, 0, -1, NaN, Infinity])
      expect(entityExtents(map, aspect)).toEqual({ width: 4, depth: 4 });
  });
  it('allows only authorized viewers to transform a selected map', () => {
    const campaign = Campaign.parse({
      ...makeCampaign(),
      activeSceneId: S,
      scenes: {
        [S]: {
          id: S,
          name: 'Map',
          grid: grid(),
          environment: { background: '#000' },
          layers: {},
          entities: { [map.id]: map },
        },
      },
    });
    expect(resolveGizmoTarget(campaign, [map.id], { kind: 'host' })?.entity).toEqual(map);
    expect(resolveGizmoTarget(campaign, [map.id], null)).toBeNull();
  });
});

describe('3D gizmo uses same aspect source as 2D (M1-47)', () => {
  const map = entity({
    layer: 'map',
    image: { asset: { source: 'local', kind: 'image', hash: 'a'.repeat(64) }, calibrated: true },
    transform: { ...entity().transform, scale: { x: 4, y: 4, z: 4 } },
  });
  it('gives the same footprint for 2:1 aspect as the 2D gizmo', () => {
    const aspect = 2;
    const extents2D = entityExtents(map, aspect);
    const footprint2D = snapFootprint(extents2D);
    // The 3D gizmo now uses the same entityExtents function with the same aspect
    const extents3D = entityExtents(map, aspect);
    const footprint3D = snapFootprint(extents3D);
    expect(footprint2D).toBe(footprint3D);
    expect(extents2D).toEqual(extents3D);
  });
  it('falls back to square for invalid aspect in both gizmos', () => {
    for (const aspect of [undefined, 0, -1, NaN, Infinity]) {
      const extents2D = entityExtents(map, aspect);
      const extents3D = entityExtents(map, aspect);
      expect(extents2D).toEqual(extents3D);
      expect(snapFootprint(extents2D)).toBe(snapFootprint(extents3D));
    }
  });
});
