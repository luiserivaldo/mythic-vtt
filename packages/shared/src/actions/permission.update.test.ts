import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { patchesFor, visibleTo } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { permissionUpdate } from './permission.update.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'permission.update';
const entityPayload = {
  target: 'entity' as const,
  sceneId: IDS.scene,
  entityId: IDS.entity,
  permissions: { view: false, edit: true },
};
const seatPayload = {
  target: 'seat' as const,
  seatId: IDS.other,
  permissions: { view: false, delete: true },
};
const envelope = (payload: unknown = entityPayload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});
const stateWithEntity = (layer: 'tokens' | 'dm' = 'tokens') => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene)
    scene.entities[IDS.entity] = makeEntity(IDS.entity, {
      layer,
      owners: [IDS.owner],
      name: 'SECRET',
    });
  return state;
};

describe(`${T} schema`, () => {
  it('accepts seat and entity updates', () => {
    expect(permissionUpdate.schema.safeParse(entityPayload).success).toBe(true);
    expect(permissionUpdate.schema.safeParse(seatPayload).success).toBe(true);
  });

  it('rejects empty, malformed, mismatched and extra fields', () => {
    expect(permissionUpdate.schema.safeParse({ ...seatPayload, permissions: {} }).success).toBe(
      false,
    );
    expect(
      permissionUpdate.schema.safeParse({ ...entityPayload, permissions: { move: 'yes' } }).success,
    ).toBe(false);
    expect(permissionUpdate.schema.safeParse({ ...seatPayload, sceneId: IDS.scene }).success).toBe(
      false,
    );
    expect(permissionUpdate.schema.safeParse({ ...entityPayload, extra: true }).success).toBe(
      false,
    );
  });
});

describe(`${T} permissions`, () => {
  it('allows only host and co-DM for seat and entity targets', () => {
    for (const payload of [seatPayload, entityPayload]) {
      expect(permissionMatrix(stateWithEntity(), T, payload)).toEqual({
        host: true,
        owner: false,
        otherSeat: false,
        coDm: true,
        spectator: false,
        mod: false,
      });
    }
  });

  it('rejects missing targets', () => {
    expect(permissionUpdate.permission(makeCampaign(), ACTORS.host, entityPayload)).toBe(false);
    expect(
      permissionUpdate.permission(stateWithEntity(), ACTORS.host, {
        ...seatPayload,
        seatId: IDS.entity,
      }),
    ).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('merges seat and entity permissions deterministically', () => {
    const entityResult = reduceAction(stateWithEntity(), envelope());
    expect(entityResult.state.scenes[IDS.scene]?.entities[IDS.entity]?.perms).toEqual({
      view: false,
      edit: true,
    });
    expect(entityResult).toEqual(reduceAction(stateWithEntity(), envelope()));

    const before = stateWithEntity();
    const seatResult = reduceAction(before, envelope(seatPayload));
    expect(seatResult.state.seats[IDS.other]?.permissions).toEqual({
      view: false,
      move: true,
      edit: false,
      delete: true,
    });
    expect(before.seats[IDS.other]?.permissions.view).toBe(true);
  });

  it('removes entities when an audience loses entity-level view permission', () => {
    const before = stateWithEntity();
    const result = reduceAction(before, envelope());
    const audience = { kind: 'seat' as const, seatId: IDS.other };
    const patches = patchesFor(audience, before, result.state, result.patches);
    expect(patches).toContainEqual({
      op: 'remove',
      path: ['scenes', IDS.scene, 'entities', IDS.entity],
    });
    expect(applyPatches(visibleTo(audience, before), patches)).toEqual(
      visibleTo(audience, result.state),
    );
  });

  it('recomputes visibility when a seat-level view permission changes', () => {
    const before = stateWithEntity();
    const result = reduceAction(before, envelope(seatPayload));
    const audience = { kind: 'seat' as const, seatId: IDS.other };
    const patches = patchesFor(audience, before, result.state, result.patches);
    expect(patches).toContainEqual({
      op: 'remove',
      path: ['scenes', IDS.scene, 'entities', IDS.entity],
    });
    expect(applyPatches(visibleTo(audience, before), patches)).toEqual(
      visibleTo(audience, result.state),
    );
  });

  it('does not leak permission changes on a DM-layer entity', () => {
    const before = stateWithEntity('dm');
    const result = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.other }, { kind: 'spectators' }] as const)
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
  });
});
