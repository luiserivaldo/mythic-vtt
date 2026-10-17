import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import type { Campaign, Entity } from '../schema/index.js';
import { diffPatchesFor, patchesFor, visibleTo } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { isAdminOnlyPlaceable, validFogRegionEntity, validWallEntity } from './entity-access.js';
import { canPerform, reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';

// FOG-01 (D47 + MV-303): walls, doors, sight blocking and fog regions are admin data.

const WALL = testId(21);
const BOX = testId(22);
const FOG = testId(23);
const TOKEN = testId(24);
const PREFAB = testId(25);
const NEW = testId(26);
const shape = { kind: 'box' as const, color: '#888888', walkable: false };
const seg = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
];
const square = [
  { x: 0, z: 0 },
  { x: 2, z: 0 },
  { x: 2, z: 2 },
  { x: 0, z: 2 },
];
// Players hold every seat capability, own everything and have every entity grant: none of it
// may open walls, sight blocking or fog regions to them.
const grants = { owners: [IDS.owner], perms: { view: true, move: true, edit: true, delete: true } };
const wall = (): Entity => makeEntity(WALL, { layer: 'map', ...grants, wall: { points: seg } });
const box = (): Entity => makeEntity(BOX, { layer: 'props', ...grants, shape, blocksSight: true });
// No entity grants here: on the dm layer they would open it to a co-DM (D32), tested below.
const fog = (): Entity =>
  makeEntity(FOG, {
    layer: 'dm',
    owners: [IDS.owner],
    fogRegion: { points: square, hidden: true },
  });
const token = (): Entity =>
  makeEntity(TOKEN, {
    ...grants,
    token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
  });

function table(): Campaign {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (!scene) throw new Error('scene');
  for (const entity of [wall(), box(), fog(), token()]) scene.entities[entity.id] = entity;
  for (const id of [IDS.owner, IDS.other]) {
    const seat = state.seats[id];
    if (seat) {
      seat.permissions = { view: true, move: true, edit: true, delete: true };
      seat.tools = { measure: true, draw: true, pins: true, doors: true };
    }
  }
  state.prefabs = { [PREFAB]: { id: PREFAB, name: 'Wall', entity: { ...wall(), owners: [] } } };
  return state;
}
const s = IDS.scene;
const moveTo = {
  position: { x: 3, y: 0, z: 3 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};
const ADMINS_ONLY = {
  host: true,
  coDm: true,
  owner: false,
  otherSeat: false,
  spectator: false,
  mod: false,
};
const HOST_ONLY = { ...ADMINS_ONLY, coDm: false };
const NOBODY = { ...HOST_ONLY, host: false };

describe('helpers', () => {
  it('names walls and fog regions as admin-only placeables', () => {
    expect(isAdminOnlyPlaceable(wall())).toBe(true);
    expect(isAdminOnlyPlaceable(fog())).toBe(true);
    expect(isAdminOnlyPlaceable(box())).toBe(false);
    expect(validWallEntity(wall())).toBe(true);
    expect(validWallEntity({ ...wall(), layer: 'props' })).toBe(false);
    expect(validWallEntity(box())).toBe(false);
    expect(validFogRegionEntity(fog())).toBe(true);
    expect(validFogRegionEntity({ ...fog(), layer: 'map' })).toBe(false);
  });
});

describe('creating', () => {
  it('walls and sight blockers: host and co-DM; fog regions: host (dm layer, D32)', () => {
    const create = (entity: Entity) => ({ sceneId: s, entity: { ...entity, id: NEW } });
    expect(permissionMatrix(makeCampaign(), 'entity.create', create(wall()))).toEqual(ADMINS_ONLY);
    expect(permissionMatrix(makeCampaign(), 'entity.create', create(box()))).toEqual(ADMINS_ONLY);
    expect(permissionMatrix(makeCampaign(), 'entity.create', create(fog()))).toEqual(HOST_ONLY);
  });

  it('rejects invalid vision entities from everyone, the host included', () => {
    const create = (entity: unknown) => ({ sceneId: s, entity });
    for (const bad of [
      { ...wall(), id: NEW, layer: 'props' },
      { ...wall(), id: NEW, shape },
      { ...wall(), id: NEW, perms: { view: false } },
      { ...box(), id: NEW, layer: 'dm' },
      { ...token(), id: NEW, blocksSight: true },
      { ...fog(), id: NEW, layer: 'map' },
    ])
      expect(canPerform(makeCampaign(), ACTORS.host, 'entity.create', create(bad))).toBe(false);
  });

  it('prefab.place cannot smuggle a wall in for a player, nor a hidden wall for anyone', () => {
    const place = { sceneId: s, prefabId: PREFAB, entityId: NEW, to: { x: 1, y: 0, z: 1 } };
    expect(permissionMatrix(table(), 'prefab.place', place)).toEqual(ADMINS_ONLY);
    const hidden = table();
    const prefab = hidden.prefabs?.[PREFAB];
    if (prefab) prefab.entity.perms = { view: false };
    expect(canPerform(hidden, ACTORS.host, 'prefab.place', place)).toBe(false);
  });
});

describe('moving, editing and deleting', () => {
  const update = (id: string, changes: object) => ({ sceneId: s, entityId: id, changes });

  it('a player may not move, edit or delete a wall, whatever its grants', () => {
    expect(permissionMatrix(table(), 'entity.update', update(WALL, { transform: moveTo }))).toEqual(
      ADMINS_ONLY,
    );
    expect(
      permissionMatrix(table(), 'entity.update', update(WALL, { wall: { points: square } })),
    ).toEqual(ADMINS_ONLY);
    expect(
      permissionMatrix(
        table(),
        'entity.update',
        update(WALL, { wall: { points: seg, door: { state: 'open' } } }),
      ),
    ).toEqual(ADMINS_ONLY);
    expect(permissionMatrix(table(), 'entity.update', update(WALL, { name: 'x' }))).toEqual(
      ADMINS_ONLY,
    );
    expect(permissionMatrix(table(), 'entity.delete', { sceneId: s, entityId: WALL })).toEqual(
      ADMINS_ONLY,
    );
    expect(
      permissionMatrix(table(), 'entity.setLayer', { sceneId: s, entityId: WALL, layer: 'props' }),
    ).toEqual(NOBODY);
  });

  it('a player may not set or clear blocksSight; admins can, and null clears it', () => {
    expect(permissionMatrix(table(), 'entity.update', update(BOX, { blocksSight: null }))).toEqual(
      ADMINS_ONLY,
    );
    const plain = table();
    const scene = plain.scenes[s];
    if (scene) scene.entities[BOX] = makeEntity(BOX, { layer: 'props', ...grants, shape });
    expect(permissionMatrix(plain, 'entity.update', update(BOX, { blocksSight: true }))).toEqual(
      ADMINS_ONLY,
    );
    // Not even on the owner's own token.
    expect(
      permissionMatrix(table(), 'entity.update', update(TOKEN, { blocksSight: true })),
    ).toEqual(NOBODY);
    const envelope: ActionEnvelope = {
      id: IDS.action,
      type: 'entity.update',
      payload: update(BOX, { blocksSight: null }),
      actor: ACTORS.host,
      campaignId: IDS.campaign,
      sessionId: IDS.session,
      seq: 1,
      ts: 1,
    };
    const before = table();
    const { state, inversePatches } = reduceAction(before, envelope);
    expect(state.scenes[s]?.entities[BOX]).not.toHaveProperty('blocksSight');
    expect(applyPatches(state, inversePatches)).toEqual(before);
  });

  it('a sight-blocking prop still moves like any prop, but never onto the dm layer', () => {
    expect(permissionMatrix(table(), 'entity.update', update(BOX, { transform: moveTo }))).toEqual({
      ...ADMINS_ONLY,
      owner: true,
      otherSeat: true,
    });
    expect(
      permissionMatrix(table(), 'entity.setLayer', { sceneId: s, entityId: BOX, layer: 'dm' }),
    ).toEqual(NOBODY);
    expect(
      canPerform(table(), ACTORS.host, 'entity.setLayer', {
        sceneId: s,
        entityId: BOX,
        layer: 'map',
      }),
    ).toBe(true);
  });

  it('an admin edit must keep every vision rule (no components added to a wall)', () => {
    expect(canPerform(table(), ACTORS.host, 'entity.update', update(WALL, { shape }))).toBe(false);
    expect(
      canPerform(table(), ACTORS.host, 'entity.update', update(TOKEN, { wall: { points: seg } })),
    ).toBe(false);
    expect(
      canPerform(
        table(),
        ACTORS.host,
        'entity.update',
        update(WALL, { wall: { points: seg, door: { state: 'locked', secret: true } } }),
      ),
    ).toBe(true);
  });

  it('an occluder cannot be hidden with perms.view', () => {
    for (const id of [WALL, BOX])
      expect(
        canPerform(table(), ACTORS.host, 'permission.update', {
          target: 'entity',
          sceneId: s,
          entityId: id,
          permissions: { view: false },
        }),
      ).toBe(false);
    expect(
      canPerform(table(), ACTORS.host, 'permission.update', {
        target: 'entity',
        sceneId: s,
        entityId: WALL,
        permissions: { move: false },
      }),
    ).toBe(true);
  });

  it('fog regions are the host’s: edit, reveal, move and delete; never off the dm layer', () => {
    const reveal = update(FOG, { fogRegion: { points: square, hidden: false } });
    expect(permissionMatrix(table(), 'entity.update', reveal)).toEqual(HOST_ONLY);
    expect(permissionMatrix(table(), 'entity.update', update(FOG, { transform: moveTo }))).toEqual(
      HOST_ONLY,
    );
    expect(permissionMatrix(table(), 'entity.delete', { sceneId: s, entityId: FOG })).toEqual(
      HOST_ONLY,
    );
    expect(
      permissionMatrix(table(), 'entity.setLayer', { sceneId: s, entityId: FOG, layer: 'map' }),
    ).toEqual(NOBODY);
    // Entity grants follow D32 like any DM-layer entity: they let a co-DM move it, never a
    // player; the region itself stays host-only to change, and never leaves the dm layer.
    const granted = table();
    const grantedFog = granted.scenes[s]?.entities[FOG];
    if (grantedFog) grantedFog.perms = grants.perms;
    expect(permissionMatrix(granted, 'entity.update', update(FOG, { transform: moveTo }))).toEqual(
      ADMINS_ONLY,
    );
    expect(permissionMatrix(granted, 'entity.update', reveal)).toEqual(HOST_ONLY);
    expect(
      permissionMatrix(granted, 'entity.setLayer', { sceneId: s, entityId: FOG, layer: 'map' }),
    ).toEqual(NOBODY);
  });

  it('a fog region and its edits never reach a player or spectator', () => {
    const before = table();
    const after = reduceAction(before, {
      id: IDS.action,
      type: 'entity.update',
      payload: update(FOG, { fogRegion: { points: square, hidden: false } }),
      actor: ACTORS.host,
      campaignId: IDS.campaign,
      sessionId: IDS.session,
      seq: 1,
      ts: 1,
    });
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      expect(JSON.stringify(visibleTo(audience, before))).not.toContain('fogRegion');
      expect(JSON.stringify(visibleTo(audience, before))).not.toContain(FOG);
      expect(patchesFor(audience, before, after.state, after.patches)).toEqual([]);
      expect(diffPatchesFor(audience, before, after.state)).toEqual([]);
    }
    expect(
      visibleTo({ kind: 'seat', seatId: IDS.coDm }, before).scenes[s]?.entities[FOG],
    ).toBeDefined();
  });
});

describe('scene.update vision (MV-303 Q2b)', () => {
  const envelope = (payload: unknown): ActionEnvelope => ({
    id: IDS.action,
    type: 'scene.update',
    payload,
    actor: ACTORS.host,
    campaignId: IDS.campaign,
    sessionId: IDS.session,
    seq: 1,
    ts: 1,
  });

  it('is admin-only, sets and clears the switch, and undoes through inverse patches', () => {
    const on = { sceneId: s, vision: { dynamicLighting: true } };
    expect(permissionMatrix(makeCampaign(), 'scene.update', on)).toEqual(ADMINS_ONLY);
    const before = makeCampaign();
    const result = reduceAction(before, envelope(on));
    expect(result.state.scenes[s]?.vision).toEqual({ dynamicLighting: true });
    expect(applyPatches(result.state, result.inversePatches)).toEqual(before);
    expect(reduceAction(before, envelope(on))).toEqual(result);
    const off = reduceAction(result.state, envelope({ sceneId: s, vision: null }));
    expect(off.state.scenes[s]).not.toHaveProperty('vision');
    // Players receive the switch: their client draws the same fog (D47 (4)).
    const audience = { kind: 'seat', seatId: IDS.owner } as const;
    expect(patchesFor(audience, before, result.state, result.patches)).toEqual(
      diffPatchesFor(audience, before, result.state),
    );
    expect(visibleTo(audience, result.state).scenes[s]?.vision).toEqual({ dynamicLighting: true });
  });

  it('rejects the superseded D47 shape and junk', () => {
    for (const vision of [
      { fog: true },
      { dynamicLighting: 'yes' },
      { dynamicLighting: true, outside: 'dim' },
    ])
      expect(canPerform(makeCampaign(), ACTORS.host, 'scene.update', { sceneId: s, vision })).toBe(
        false,
      );
  });
});
