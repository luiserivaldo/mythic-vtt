import { describe, expect, it } from 'vitest';
import { patchesFor, visibleTo } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { pinCreate } from './pin.create.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'pin.create';
const pin = { text: 'The west stair is trapped.', reveal: 'click' as const };
const payload = { sceneId: IDS.scene, entityId: IDS.entity, pin };
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
const stateWithEntity = () => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene) scene.entities[IDS.entity] = makeEntity(IDS.entity);
  return state;
};

describe(`${T} schema`, () => {
  it('accepts each reveal rule and rejects malformed, empty, oversized or extra data', () => {
    expect(pinCreate.schema.safeParse(payload).success).toBe(true);
    expect(
      pinCreate.schema.safeParse({ ...payload, pin: { ...pin, reveal: 'hover' } }).success,
    ).toBe(true);
    expect(
      pinCreate.schema.safeParse({ ...payload, pin: { ...pin, reveal: { proximity: 3 } } }).success,
    ).toBe(true);
    expect(pinCreate.schema.safeParse({ ...payload, pin: { ...pin, text: '' } }).success).toBe(
      false,
    );
    expect(
      pinCreate.schema.safeParse({ ...payload, pin: { ...pin, text: 'x'.repeat(4_097) } }).success,
    ).toBe(false);
    expect(
      pinCreate.schema.safeParse({ ...payload, pin: { ...pin, reveal: { proximity: -1 } } })
        .success,
    ).toBe(false);
    expect(pinCreate.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
    expect(pinCreate.schema.safeParse({ ...payload, pin: { ...pin, extra: true } }).success).toBe(
      false,
    );
  });
});

describe(`${T} permissions`, () => {
  it('allows host and co-DM but denies players, spectators and mods by default', () => {
    expect(permissionMatrix(stateWithEntity(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('rejects missing entities, existing pins, locked layers and co-DM writes on the DM layer', () => {
    expect(pinCreate.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);
    const existing = stateWithEntity();
    const existingEntity = existing.scenes[IDS.scene]?.entities[IDS.entity];
    if (existingEntity) existingEntity.pin = pin;
    expect(pinCreate.permission(existing, ACTORS.host, payload)).toBe(false);
    const locked = stateWithEntity();
    const lockedScene = locked.scenes[IDS.scene];
    if (lockedScene) lockedScene.layers.tokens = { locked: true };
    expect(pinCreate.permission(locked, ACTORS.host, payload)).toBe(false);
    const dm = stateWithEntity();
    const dmEntity = dm.scenes[IDS.scene]?.entities[IDS.entity];
    if (dmEntity) dmEntity.layer = 'dm';
    expect(pinCreate.permission(dm, ACTORS.host, payload)).toBe(true);
    expect(pinCreate.permission(dm, ACTORS.coDm, payload)).toBe(false);
  });

  it('does not let entity ownership or edit grants bypass pin administration', () => {
    const state = stateWithEntity();
    const entity = state.scenes[IDS.scene]?.entities[IDS.entity];
    const owner = state.seats[IDS.owner];
    if (entity) {
      entity.owners = [IDS.owner];
      entity.perms = { edit: true };
    }
    if (owner) owner.permissions.edit = true;
    expect(pinCreate.permission(state, ACTORS.owner, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('adds the component deterministically without mutating the input', () => {
    const before = stateWithEntity();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.pin).toEqual(pin);
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.pin).toBeUndefined();
    expect(result).toEqual(reduceAction(stateWithEntity(), envelope()));
  });

  it('never sends a pin when its entity is hidden from the audience', () => {
    const before = stateWithEntity();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) entity.perms = { view: false };
    const result = reduceAction(before, envelope());
    const hiddenAudiences = [{ kind: 'seat', seatId: IDS.other }, { kind: 'spectators' }] as const;
    for (const audience of hiddenAudiences) {
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
      expect(JSON.stringify(visibleTo(audience, result.state))).not.toContain(pin.text);
    }
    expect(
      JSON.stringify(patchesFor({ kind: 'host' }, before, result.state, result.patches)),
    ).toContain(pin.text);
  });
});
