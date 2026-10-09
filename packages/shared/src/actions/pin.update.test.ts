import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { pinUpdate } from './pin.update.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'pin.update';
const original = { text: 'Original note', reveal: 'hover' as const };
const changes = { text: 'Revised note', reveal: { proximity: 2 } };
const payload = { sceneId: IDS.scene, entityId: IDS.entity, changes };
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});
const stateWithPin = () => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene) scene.entities[IDS.entity] = makeEntity(IDS.entity, { pin: original });
  return state;
};

describe(`${T} schema`, () => {
  it('accepts partial changes and rejects empty, malformed, protected or extra fields', () => {
    expect(pinUpdate.schema.safeParse(payload).success).toBe(true);
    expect(pinUpdate.schema.safeParse({ ...payload, changes: { text: 'Text only' } }).success).toBe(
      true,
    );
    expect(pinUpdate.schema.safeParse({ ...payload, changes: {} }).success).toBe(false);
    expect(pinUpdate.schema.safeParse({ ...payload, changes: { text: '' } }).success).toBe(false);
    expect(
      pinUpdate.schema.safeParse({ ...payload, changes: { reveal: { proximity: -1 } } }).success,
    ).toBe(false);
    expect(pinUpdate.schema.safeParse({ ...payload, changes: { layer: 'dm' } }).success).toBe(
      false,
    );
    expect(pinUpdate.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows host and co-DM but denies players, spectators and mods by default', () => {
    expect(permissionMatrix(stateWithPin(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('rejects missing pins, locked layers and co-DM writes on the DM layer', () => {
    expect(pinUpdate.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);
    const plain = stateWithPin();
    const plainEntity = plain.scenes[IDS.scene]?.entities[IDS.entity];
    if (plainEntity) Reflect.deleteProperty(plainEntity, 'pin');
    expect(pinUpdate.permission(plain, ACTORS.host, payload)).toBe(false);
    const locked = stateWithPin();
    const lockedScene = locked.scenes[IDS.scene];
    if (lockedScene) lockedScene.layers.tokens = { locked: true };
    expect(pinUpdate.permission(locked, ACTORS.host, payload)).toBe(false);
    const dm = stateWithPin();
    const dmEntity = dm.scenes[IDS.scene]?.entities[IDS.entity];
    if (dmEntity) dmEntity.layer = 'dm';
    expect(pinUpdate.permission(dm, ACTORS.host, payload)).toBe(true);
    expect(pinUpdate.permission(dm, ACTORS.coDm, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('updates deterministically without mutating the input', () => {
    const before = stateWithPin();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.pin).toEqual(changes);
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.pin).toEqual(original);
    expect(result).toEqual(reduceAction(stateWithPin(), envelope()));
  });

  it('does not leak a DM-layer pin update to a player or spectators', () => {
    const before = stateWithPin();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) entity.layer = 'dm';
    const result = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      const patches = patchesFor(audience, before, result.state, result.patches);
      expect(patches).toEqual([]);
      expect(JSON.stringify(patches)).not.toContain(changes.text);
    }
    expect(
      JSON.stringify(patchesFor({ kind: 'host' }, before, result.state, result.patches)),
    ).toContain(changes.text);
  });
});
