import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { patchesFor, visibleTo } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { entitySetLayer } from './entity.setLayer.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'entity.setLayer';
const payload = { sceneId: IDS.scene, entityId: IDS.entity, layer: 'dm' as const };
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor: ACTORS.owner,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});
const stateWithEntity = () => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene) {
    scene.entities[IDS.entity] = makeEntity(IDS.entity, {
      owners: [IDS.owner],
      name: 'Visible token',
    });
  }
  return state;
};

describe(`${T} schema and permissions`, () => {
  it('accepts a valid payload and rejects missing, unknown or extra fields', () => {
    expect(entitySetLayer.schema.safeParse(payload).success).toBe(true);
    expect(
      entitySetLayer.schema.safeParse({ sceneId: IDS.scene, entityId: IDS.entity }).success,
    ).toBe(false);
    expect(entitySetLayer.schema.safeParse({ ...payload, layer: 'secret' }).success).toBe(false);
    expect(entitySetLayer.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });

  it('lets admins and an owner with move permission change layers', () => {
    expect(permissionMatrix(stateWithEntity(), T, payload)).toEqual({
      host: true,
      owner: true,
      otherSeat: false,
      coDm: false, // D32: only the host may move entities onto the DM layer
      spectator: false,
      mod: false,
    });
    expect(permissionMatrix(stateWithEntity(), T, { ...payload, layer: 'props' }).coDm).toBe(true);
  });

  it('supports an explicit move grant and rejects no-ops or locked layers', () => {
    const state = stateWithEntity();
    const entity = state.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) entity.perms = { move: true };
    expect(entitySetLayer.permission(state, ACTORS.otherSeat, payload)).toBe(true);
    expect(entitySetLayer.permission(state, ACTORS.host, { ...payload, layer: 'tokens' })).toBe(
      false,
    );
    const scene = state.scenes[IDS.scene];
    if (scene) scene.layers.dm = { locked: true };
    expect(entitySetLayer.permission(state, ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('changes the layer deterministically without mutating the input', () => {
    const before = stateWithEntity();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.layer).toBe('dm');
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.layer).toBe('tokens');
    expect(result).toEqual(reduceAction(stateWithEntity(), envelope()));
  });

  it('translates a move onto the DM layer into a removal for players and spectators', () => {
    const before = stateWithEntity();
    const result = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      const view = visibleTo(audience, before);
      const patches = patchesFor(audience, before, result.state, result.patches);
      expect(patches).toEqual([
        { op: 'remove', path: ['scenes', IDS.scene, 'entities', IDS.entity] },
      ]);
      expect(JSON.stringify(patches)).not.toContain('Visible token');
      expect(applyPatches(view, patches)).toEqual(visibleTo(audience, result.state));
    }
  });

  it('adds only the current entity view when the host reveals a DM-layer entity', () => {
    const before = stateWithEntity();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) {
      entity.layer = 'dm';
      entity.name = 'Revealed now';
    }
    const result = reduceAction(before, {
      ...envelope({ ...payload, layer: 'tokens' }),
      actor: ACTORS.host,
    });
    const patches = patchesFor(
      { kind: 'seat', seatId: IDS.other },
      before,
      result.state,
      result.patches,
    );
    expect(patches).toEqual([
      {
        op: 'add',
        path: ['scenes', IDS.scene, 'entities', IDS.entity],
        value: result.state.scenes[IDS.scene]?.entities[IDS.entity],
      },
    ]);
  });
});
