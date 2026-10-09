import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { AoEShape } from '../schema/index.js';
import { tokensInAoE } from '../geometry/index.js';
import { aoePlace } from './aoe.place.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, testId } from './testing.js';

const T = 'aoe.place';
const aoeId = testId(12);
const entity = {
  ...makeEntity(aoeId, { layer: 'effects', name: 'Fireball' }),
  aoe: { kind: 'sphere' as const, radius: 4, color: '#ff4400' },
};
const payload = { sceneId: IDS.scene, entity };
const host = { ...ACTORS.host, identityId: aoeId } as const;
const coDm = { ...ACTORS.coDm, identityId: aoeId } as const;
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor: host,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});

describe(`${T} schema`, () => {
  it('accepts all five shapes and rejects missing, malformed or extra data', () => {
    const shapes = [
      { kind: 'sphere', radius: 2, color: 'red' },
      { kind: 'cylinder', radius: 2, height: 3, color: 'red' },
      { kind: 'cone', radius: 2, length: 3, color: 'red' },
      { kind: 'cube', size: 2, color: 'red' },
      { kind: 'line', length: 3, width: 1, height: 1, color: 'red' },
    ];
    for (const aoe of shapes)
      expect(aoePlace.schema.safeParse({ ...payload, entity: { ...entity, aoe } }).success).toBe(
        true,
      );
    expect(aoePlace.schema.safeParse({ sceneId: IDS.scene }).success).toBe(false);
    expect(
      aoePlace.schema.safeParse({ ...payload, entity: { ...entity, aoe: { kind: 'sphere' } } })
        .success,
    ).toBe(false);
    expect(aoePlace.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
    expect(
      aoePlace.schema.safeParse({ ...payload, entity: { ...entity, token: {} } }).success,
    ).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows host and co-DM identities but denies non-admin and mismatched identities', () => {
    const state = makeCampaign();
    expect(aoePlace.permission(state, host, payload)).toBe(true);
    expect(aoePlace.permission(state, coDm, payload)).toBe(true);
    expect(aoePlace.permission(state, { ...ACTORS.owner, identityId: aoeId }, payload)).toBe(false);
    expect(aoePlace.permission(state, { ...ACTORS.spectator, identityId: aoeId }, payload)).toBe(
      false,
    );
    expect(aoePlace.permission(state, ACTORS.host, payload)).toBe(false);
    expect(
      aoePlace.permission(state, { ...ACTORS.host, identityId: IDS.otherIdentity }, payload),
    ).toBe(false);
  });

  it('does not let a seat-level edit grant bypass admin-only placement', () => {
    const state = makeCampaign();
    const seat = state.seats[IDS.owner];
    if (seat) seat.permissions.edit = true;
    const owned = { ...payload, entity: { ...entity, owners: [IDS.owner] } };
    expect(aoePlace.permission(state, { ...ACTORS.owner, identityId: aoeId }, owned)).toBe(false);
  });

  it('keeps DM-layer placement host-only', () => {
    const hidden = { ...payload, entity: { ...entity, layer: 'dm' as const } };
    expect(aoePlace.permission(makeCampaign(), host, hidden)).toBe(true);
    expect(aoePlace.permission(makeCampaign(), coDm, hidden)).toBe(false);
  });

  it('allows replacing the same identity AoE but rejects a collision, unknown owners and locks', () => {
    const replacement = makeCampaign();
    const scene = replacement.scenes[IDS.scene];
    if (scene) scene.entities[aoeId] = { ...entity, name: 'Previous AoE' };
    expect(aoePlace.permission(replacement, host, payload)).toBe(true);
    const collision = makeCampaign();
    const collisionScene = collision.scenes[IDS.scene];
    if (collisionScene) collisionScene.entities[aoeId] = makeEntity(aoeId);
    expect(aoePlace.permission(collision, host, payload)).toBe(false);
    expect(
      aoePlace.permission(makeCampaign(), host, {
        ...payload,
        entity: { ...entity, owners: [testId(24)] },
      }),
    ).toBe(false);
    const locked = makeCampaign();
    const lockedScene = locked.scenes[IDS.scene];
    if (lockedScene) lockedScene.layers.effects = { locked: true };
    expect(aoePlace.permission(locked, host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('replaces only the placing identity AoE without mutating the input', () => {
    const before = makeCampaign();
    const otherId = IDS.otherIdentity;
    const otherAoE = {
      ...makeEntity(otherId, { layer: 'effects', name: 'Other user AoE' }),
      aoe: { kind: 'sphere' as const, radius: 2, color: '#0088ff' },
    };
    const scene = before.scenes[IDS.scene];
    if (scene) {
      scene.entities[aoeId] = { ...entity, name: 'Previous AoE' };
      scene.entities[otherId] = otherAoE;
    }
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[aoeId]).toEqual(entity);
    expect(result.state.scenes[IDS.scene]?.entities[otherId]).toEqual(otherAoE);
    expect(before.scenes[IDS.scene]?.entities[aoeId]?.name).toBe('Previous AoE');
  });

  it('sends an effects-layer AoE to players and spectators', () => {
    const before = makeCampaign();
    const result = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const)
      expect(JSON.stringify(patchesFor(audience, before, result.state, result.patches))).toContain(
        'Fireball',
      );
  });

  it('does not send an AoE placed on the DM layer to players or spectators', () => {
    const hidden = { ...payload, entity: { ...entity, layer: 'dm' as const, name: 'SECRET' } };
    const before = makeCampaign();
    const result = reduceAction(before, envelope(hidden));
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const)
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
  });
});

describe(`${T} geometry mapping (MEAS-03, D37)`, () => {
  it('feeds the stored shape straight into tokensInAoE, even beyond scene bounds', () => {
    const placed = {
      ...entity,
      transform: { ...entity.transform, position: { x: 500, y: 0, z: -500 } },
    };
    const result = reduceAction(makeCampaign(), envelope({ ...payload, entity: placed }));
    const stored = result.state.scenes[IDS.scene]?.entities[aoeId];
    const shape = AoEShape.parse(stored?.aoe);
    const aoe = {
      position: placed.transform.position,
      rotation: placed.transform.rotation,
      ...shape,
    };
    const near = { id: 'near', position: { x: 502, y: 0, z: -500 }, sizeCells: 1, heightCells: 1 };
    const far = { id: 'far', position: { x: 520, y: 0, z: -500 }, sizeCells: 1, heightCells: 1 };
    expect(tokensInAoE(aoe, [near, far]).map((t) => t.id)).toEqual(['near']);
  });

  it('requires a finite origin', () => {
    const bad = {
      ...entity,
      transform: { ...entity.transform, position: { x: Infinity, y: 0, z: 0 } },
    };
    expect(aoePlace.schema.safeParse({ ...payload, entity: bad }).success).toBe(false);
  });
});
