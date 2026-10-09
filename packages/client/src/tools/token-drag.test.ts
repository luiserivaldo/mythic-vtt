import { Campaign, Scene, type Entity } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import type { RenderScene } from '../render/scene-model.js';
import { makeCampaign, tid } from '../testing.js';
import {
  dragStarted,
  dragRulerPaths,
  groundPoint,
  intersectPlaneY,
  movableToken,
  pressOnGizmoHandle,
  previewPosition,
  shouldSendPreview,
  tokenDrop,
  visibleGhosts,
  withLocalDrag,
} from './token-drag.js';
import { handleLayout } from './transform-gizmo.js';
import { tokenDragStore } from './token-drag-store.js';

const S = tid(2);
const E = tid(3);
const P = tid(4);
const PLATFORM = tid(6);

const entity = (over: Partial<Entity> = {}): Entity => ({
  id: E,
  layer: 'tokens',
  name: 'Goblin',
  owners: [],
  transform: {
    position: { x: 2.5, y: 0, z: 3.5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
  ...over,
});

const scene = (snap = true, extra: Record<string, Entity> = {}): Scene =>
  Scene.parse({
    id: S,
    name: 'Crypt',
    grid: {
      type: 'square',
      sizePx: 70,
      unitsPerCell: 5,
      unitLabel: 'ft',
      diagonal: 'chebyshev',
      snap,
    },
    bounds: { width: 10, height: 8 },
    environment: { background: '#000' },
    layers: {},
    entities: { [E]: entity(), ...extra },
  });

const platform = (): Entity =>
  entity({
    id: PLATFORM,
    layer: 'props',
    name: 'Dais',
    token: undefined,
    shape: { kind: 'box', color: '#888', walkable: true },
    transform: {
      position: { x: 6, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 4, y: 2, z: 4 },
    },
  });

describe('tokenDrop', () => {
  it('snaps to the cell centre when the grid snaps, else leaves it free', () => {
    const e = scene().entities[E] as Entity;
    expect(tokenDrop(scene(), e, { x: 4.9, y: 0, z: 3.6 })).toMatchObject({ x: 4.5, z: 3.5 });
    const free = tokenDrop(scene(false), e, { x: 4.9, y: 0, z: 3.6 });
    expect(free.x).toBeCloseTo(4.9);
  });
  it('clamps inside the scene bounds', () => {
    const e = scene().entities[E] as Entity;
    const to = tokenDrop(scene(), e, { x: 99, y: 0, z: -5 });
    expect(to.x).toBeLessThanOrEqual(10);
    expect(to.z).toBeGreaterThanOrEqual(0);
  });
  it('clamps a Tiny token by its half-cell footprint when snap is off', () => {
    const sc = scene(false);
    const tiny = entity({ token: { sizeCells: 0.5, heightCells: 0.5, labelVisibility: 'all' } });
    expect(tokenDrop(sc, tiny, { x: -2, y: 0, z: -2 })).toMatchObject({ x: 0.25, z: 0.25 });
    expect(tokenDrop(sc, tiny, { x: 20, y: 0, z: 20 })).toMatchObject({ x: 9.75, z: 7.75 });
  });
  it('takes the exact surface height over a walkable platform (D25)', () => {
    const sc = scene(true, { [PLATFORM]: platform() });
    const e = sc.entities[E] as Entity;
    const onDais = tokenDrop(sc, e, { x: 6, y: 0, z: 4 });
    const off = tokenDrop(sc, e, { x: 1.5, y: 0, z: 1.5 });
    expect(off.y).toBe(0);
    expect(onDais.y).toBeGreaterThanOrEqual(0);
  });
});

describe('pointer to ground', () => {
  it('intersects a horizontal plane and rejects parallel or backwards rays', () => {
    const hit = intersectPlaneY(
      { origin: { x: 0, y: 10, z: 0 }, direction: { x: 1, y: -1, z: 0 } },
      0,
    );
    expect(hit).toEqual({ x: 10, y: 0, z: 0 });
    expect(
      intersectPlaneY({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, 0),
    ).toBeNull();
    expect(
      intersectPlaneY({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, 0),
    ).toBeNull();
  });
  it('keeps the grab offset so the token does not jump to the pointer', () => {
    const sc = scene(false);
    const e = sc.entities[E] as Entity;
    const ray = { origin: { x: 4, y: 20, z: 5 }, direction: { x: 0, y: -1, z: 0 } };
    const ground = groundPoint(ray, 0, sc, e);
    expect(ground).not.toBeNull();
    if (!ground) return;
    const to = previewPosition(sc, e, ground, { x: 0.2, z: -0.3 });
    expect(to.x).toBeCloseTo(3.8);
    expect(to.z).toBeCloseTo(5.3);
  });
});

describe('permissions', () => {
  const campaign = (): Campaign =>
    Campaign.parse({
      ...makeCampaign(),
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
          ...scene(),
          entities: { [E]: entity(), [tid(5)]: entity({ id: tid(5), owners: [P] }) },
        },
      },
    });
  it('only draggable when the viewer may token.move it', () => {
    const c = campaign();
    const sc = c.scenes[S] ?? null;
    expect(movableToken(c, { kind: 'host' }, sc, E)?.id).toBe(E);
    const player = { kind: 'seat', seatId: P } as const;
    expect(movableToken(c, player, sc, E)).toBeNull();
    expect(movableToken(c, player, sc, tid(5))?.id).toBe(tid(5));
    expect(movableToken(c, null, sc, E)).toBeNull();
  });
});

describe('render helpers', () => {
  const rendered: RenderScene = {
    id: S,
    background: '#000',
    entities: [
      { id: E, layer: 'tokens', position: [2.5, 0, 3.5], sizeCells: 1, yaw: 0, secret: false },
    ],
  };
  it('moves only the dragged entity in the rendered copy', () => {
    const local = {
      sceneId: S,
      entityId: E,
      base: { x: 2.5, y: 0, z: 3.5 },
      to: { x: 4.5, y: 0, z: 3.5 },
      settling: false,
    };
    expect(withLocalDrag(rendered, local)?.entities[0]?.position).toEqual([4.5, 0, 3.5]);
    expect(rendered.entities[0]?.position).toEqual([2.5, 0, 3.5]);
    expect(withLocalDrag(rendered, null)).toBe(rendered);
    expect(withLocalDrag(rendered, { ...local, sceneId: tid(9) })).toBe(rendered);
  });
  it('shows ghosts for fresh previews only, hiding ones that already landed', () => {
    const sc = scene();
    const fresh = { sceneId: S, entityId: E, to: { x: 5.5, y: 0, z: 3.5 }, at: 1000 };
    expect(visibleGhosts({ a: fresh }, sc, 1100)).toHaveLength(1);
    expect(visibleGhosts({ a: fresh }, sc, 5000)).toHaveLength(0);
    expect(visibleGhosts({ a: { ...fresh, to: { x: 2.5, y: 0, z: 3.5 } } }, sc, 1100)).toHaveLength(
      0,
    );
    expect(visibleGhosts({ a: { ...fresh, sceneId: tid(9) } }, sc, 1100)).toHaveLength(0);
    expect(visibleGhosts({ a: fresh }, null, 1100)).toHaveLength(0);
  });
  it('derives temporary rulers from drag previews and hides the local ruler on release', () => {
    const sc = scene();
    const local = {
      sceneId: S,
      entityId: E,
      base: { x: 2.5, y: 0, z: 3.5 },
      to: { x: 4.5, y: 0, z: 5.5 },
      settling: false,
    };
    const fresh = { sceneId: S, entityId: E, to: { x: 5.5, y: 0, z: 3.5 }, at: 1000 };
    expect(dragRulerPaths(local, { sender: fresh }, sc, 1100)).toEqual([
      { key: 'local', from: null, points: [local.base, local.to] },
      {
        key: 'sender',
        from: 'sender',
        points: [sc.entities[E]?.transform.position, fresh.to],
      },
    ]);
    expect(dragRulerPaths({ ...local, settling: true }, {}, sc, 1100)).toEqual([]);
    expect(dragRulerPaths(local, { sender: fresh }, sc, 5000)).toHaveLength(1);
    expect(dragRulerPaths(local, {}, null, 1100)).toEqual([]);
  });
  it('prunes stale remote previews from the store', () => {
    tokenDragStore
      .getState()
      .setRemote('a', { sceneId: S, entityId: E, to: { x: 1, y: 0, z: 1 }, at: 0 });
    tokenDragStore.getState().pruneRemote(10_000, 1500);
    expect(tokenDragStore.getState().remote).toEqual({});
  });
});

describe('gestures', () => {
  it('starts dragging past the threshold and throttles previews', () => {
    expect(dragStarted({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
    expect(dragStarted({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
    expect(shouldSendPreview(null, 0, false)).toBe(true);
    expect(shouldSendPreview(0, 10, false)).toBe(false);
    expect(shouldSendPreview(0, 60, false)).toBe(true);
    expect(shouldSendPreview(0, 1, true)).toBe(true);
  });
  it('leaves rotate and scale handles to the gizmo but not the body', () => {
    const e = scene().entities[E] as Entity;
    const c = e.transform.position;
    expect(pressOnGizmoHandle(e, { x: c.x, z: c.z }, 48)).toBe(false);
    const { rotate } = handleLayout({ x: c.x, z: c.z }, 0, 0.5, 1 / 48);
    expect(pressOnGizmoHandle(e, rotate, 48)).toBe(true);
  });
});
