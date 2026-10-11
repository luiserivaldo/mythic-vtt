import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  Campaign,
  checkIntent,
  patchesFor,
  reduceAction,
  visibleTo,
  type ActionEnvelope,
} from '../index.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';
import { prefabSave } from './prefab.save.js';
import { prefabPlace } from './prefab.place.js';
import { prefabRemove } from './prefab.remove.js';
const prefabId = testId(12),
  copyId = testId(13),
  targetId = testId(14);
const save = { sceneId: IDS.scene, entityId: IDS.entity, prefabId, name: 'Stone pillar' };
const action: ActionEnvelope = {
  id: IDS.action,
  type: 'prefab.save',
  payload: save,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
};
function fixture() {
  const state = makeCampaign(),
    scene = state.scenes[IDS.scene];
  if (!scene) throw new Error('scene');
  scene.entities[IDS.entity] = makeEntity(IDS.entity, {
    name: 'Configured pillar',
    layer: 'props',
    owners: [IDS.owner],
    perms: { edit: true },
    shape: { kind: 'cylinder', color: '#8090ff', walkable: true },
    transform: {
      position: { x: 2, y: 3, z: 4 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 2, y: 4, z: 2 },
    },
  });
  state.scenes[targetId] = { ...scene, id: targetId, entities: {} };
  return state;
}
const matrix = {
  host: true,
  coDm: true,
  owner: false,
  otherSeat: false,
  spectator: false,
  mod: false,
};
describe('campaign prefabs', () => {
  it('validates each strict payload and permission matrix', () => {
    const state = fixture(),
      saved = reduceAction(state, action).state,
      place = { sceneId: targetId, prefabId, entityId: copyId, to: { x: 5, y: 0, z: 5 } };
    for (const [definition, payload, campaign] of [
      [prefabSave, save, state],
      [prefabPlace, place, saved],
      [prefabRemove, { prefabId }, saved],
    ] as const) {
      expect(definition.schema.safeParse(payload).success).toBe(true);
      expect(definition.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
      expect(definition.schema.safeParse({}).success).toBe(false);
      expect(permissionMatrix(campaign, definition.type, payload)).toEqual(matrix);
    }
    expect(checkIntent(state, ACTORS.host, action.type, { ...save, name: ' ' }).ok).toBe(false);
    expect(checkIntent(saved, ACTORS.host, action.type, save).ok).toBe(false);
    expect(checkIntent(state, ACTORS.host, action.type, { ...save, entityId: IDS.other }).ok).toBe(
      false,
    );
  });
  it('copies configuration independently across scenes and clears instance rights', () => {
    const before = fixture(),
      saved = reduceAction(before, action);
    expect(saved).toEqual(reduceAction(before, action));
    expect(before.prefabs).toBeUndefined();
    const place = {
      ...action,
      type: 'prefab.place',
      payload: { sceneId: targetId, prefabId, entityId: copyId, to: { x: 5, y: 6, z: 7 } },
    };
    const placed = reduceAction(saved.state, place);
    expect(placed).toEqual(reduceAction(saved.state, place));
    const copy = placed.state.scenes[targetId]?.entities[copyId];
    expect(copy).toMatchObject({
      name: 'Configured pillar',
      owners: [],
      shape: { kind: 'cylinder', walkable: true },
      transform: { position: { x: 5, y: 6, z: 7 }, scale: { x: 2, y: 4, z: 2 } },
    });
    expect(copy?.perms).toBeUndefined();
    expect(saved.state.scenes[targetId]?.entities[copyId]).toBeUndefined();
    expect(saved.state.prefabs?.[prefabId]?.entity.transform.position).toEqual({
      x: 2,
      y: 3,
      z: 4,
    });
    expect(Campaign.parse(JSON.parse(JSON.stringify(placed.state)))).toEqual(placed.state);
    const removed = reduceAction(placed.state, {
      ...action,
      type: 'prefab.remove',
      payload: { prefabId },
    }).state;
    expect(removed.prefabs?.[prefabId]).toBeUndefined();
    expect(removed.scenes[targetId]?.entities[copyId]).toEqual(copy);
  });
  it('enforces destination bounds, locks, collisions and co-DM layer limits', () => {
    const saved = reduceAction(fixture(), action).state;
    const payload = { sceneId: targetId, prefabId, entityId: copyId, to: { x: 5, y: 0, z: 5 } };
    expect(
      checkIntent(saved, ACTORS.host, 'prefab.place', { ...payload, to: { x: -1, y: 0, z: 0 } }).ok,
    ).toBe(false);
    const locked = Campaign.parse(saved);
    const target = locked.scenes[targetId];
    if (!target) throw new Error('scene');
    target.layers.props = { locked: true };
    expect(checkIntent(locked, ACTORS.host, 'prefab.place', payload).ok).toBe(false);
    const source = fixture();
    const entity = source.scenes[IDS.scene]?.entities[IDS.entity];
    if (!entity) throw new Error('entity');
    entity.layer = 'dm';
    expect(checkIntent(source, ACTORS.coDm, 'prefab.save', save).ok).toBe(false);
    const secret = reduceAction(source, action).state;
    expect(checkIntent(secret, ACTORS.coDm, 'prefab.place', payload).ok).toBe(false);
    expect(
      checkIntent(saved, ACTORS.host, 'prefab.place', {
        ...payload,
        sceneId: IDS.scene,
        entityId: IDS.entity,
      }).ok,
    ).toBe(false);
  });
  it('never sends blueprints, names or ids to players or spectators in snapshots or patches', () => {
    const before = fixture(),
      after = reduceAction(before, action);
    for (const audience of [
      { kind: 'spectators' },
      { kind: 'seat', seatId: IDS.owner },
      { kind: 'seat', seatId: IDS.other },
    ] as const) {
      expect(visibleTo(audience, after.state).prefabs).toBeUndefined();
      expect(
        JSON.stringify(patchesFor(audience, before, after.state, after.patches)),
      ).not.toContain(prefabId);
    }
    expect(visibleTo({ kind: 'seat', seatId: IDS.coDm }, after.state).prefabs).toEqual(
      after.state.prefabs,
    );
  });
  it('respects co-DM ownership/view overrides and rejects guessed unreadable prefab IDs', () => {
    const before = fixture(),
      source = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (!source) throw new Error('entity');
    source.owners = [];
    source.perms = { view: false };
    expect(checkIntent(before, ACTORS.coDm, 'prefab.save', save).ok).toBe(false);
    const after = reduceAction(before, action);
    expect(
      visibleTo({ kind: 'seat', seatId: IDS.coDm }, after.state).prefabs?.[prefabId],
    ).toBeUndefined();
    expect(
      JSON.stringify(
        patchesFor({ kind: 'seat', seatId: IDS.coDm }, before, after.state, after.patches),
      ),
    ).not.toContain('Configured pillar');
    expect(
      checkIntent(after.state, ACTORS.coDm, 'prefab.place', {
        sceneId: targetId,
        prefabId,
        entityId: copyId,
        to: { x: 5, y: 0, z: 5 },
      }).ok,
    ).toBe(false);
    expect(checkIntent(after.state, ACTORS.coDm, 'prefab.remove', { prefabId }).ok).toBe(false);
    const owned = fixture(),
      entity = owned.scenes[IDS.scene]?.entities[IDS.entity];
    if (!entity) throw new Error('entity');
    entity.owners = [IDS.coDm];
    entity.perms = { view: false };
    const saved = reduceAction(owned, action).state;
    expect(visibleTo({ kind: 'seat', seatId: IDS.coDm }, saved).prefabs?.[prefabId]).toBeDefined();
    const legacy = Campaign.parse(saved),
      blueprint = legacy.prefabs?.[prefabId];
    if (!blueprint) throw new Error('prefab');
    delete blueprint.entity.owners;
    expect(visibleTo({ kind: 'host' }, legacy).prefabs?.[prefabId]).toBeDefined();
    expect(
      visibleTo({ kind: 'seat', seatId: IDS.coDm }, legacy).prefabs?.[prefabId],
    ).toBeUndefined();
  });
  it('places numeric positions exactly while leaving the blueprint unchanged', () => {
    const saved = reduceAction(fixture(), action).state;
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (x, z, y) => {
          const envelope = {
            ...action,
            type: 'prefab.place',
            payload: { sceneId: targetId, prefabId, entityId: copyId, to: { x, y, z } },
          };
          expect(checkIntent(saved, ACTORS.host, envelope.type, envelope.payload).ok).toBe(true);
          expect(
            reduceAction(saved, envelope).state.scenes[targetId]?.entities[copyId]?.transform
              .position,
          ).toEqual({ x, y, z });
          expect(saved.prefabs?.[prefabId]?.entity.transform.position).toEqual({
            x: 2,
            y: 3,
            z: 4,
          });
        },
      ),
    );
  });
});
