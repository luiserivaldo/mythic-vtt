import { describe, expect, it } from 'vitest';
import { patchesFor, visibleTo } from '../visibility/index.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';
import { tokenSetRings } from './token.setRings.js';
import type { ActionEnvelope } from './envelope.js';

const payload = {
  sceneId: IDS.scene,
  entityId: IDS.entity,
  rings: [{ radius: 10, color: '#55aaff' }],
};
const state = () => {
  const campaign = makeCampaign();
  const owner = campaign.seats[IDS.owner];
  if (owner) owner.permissions = { ...owner.permissions, edit: true };
  const scene = campaign.scenes[IDS.scene];
  if (scene)
    scene.entities[IDS.entity] = makeEntity(IDS.entity, {
      owners: [IDS.owner],
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    });
  return campaign;
};
const envelope: ActionEnvelope = {
  id: IDS.action,
  type: 'token.setRings',
  payload,
  actor: ACTORS.owner,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
};

describe('token.setRings', () => {
  it('validates bounded, positive scene-unit radii and strict colours', () => {
    expect(tokenSetRings.schema.safeParse(payload).success).toBe(true);
    for (const rings of [
      [{ radius: 0, color: '#55aaff' }],
      [{ radius: Infinity, color: '#55aaff' }],
      [{ radius: 10, color: 'red' }],
      [{ radius: 10, color: '#55aaff', secret: 'extra' }],
      Array.from({ length: 9 }, () => payload.rings[0]),
    ])
      expect(tokenSetRings.schema.safeParse({ ...payload, rings }).success).toBe(false);
    expect(tokenSetRings.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
    expect(
      tokenSetRings.schema.safeParse({ sceneId: IDS.scene, entityId: IDS.entity }).success,
    ).toBe(false);
  });
  it('enforces token edit rights and locked layers', () => {
    const campaign = state();
    expect(permissionMatrix(campaign, envelope.type, payload)).toEqual({
      host: true,
      owner: true,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
    const owner = campaign.seats[IDS.owner];
    if (owner) owner.permissions.edit = false;
    expect(tokenSetRings.permission(campaign, ACTORS.owner, payload)).toBe(false);
    const scene = campaign.scenes[IDS.scene];
    if (scene) scene.layers.tokens = { locked: true };
    expect(tokenSetRings.permission(campaign, ACTORS.host, payload)).toBe(false);
    expect(tokenSetRings.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);
  });
  it('replaces and removes rings deterministically without changing the source state', () => {
    const before = state();
    const result = reduceAction(before, envelope);
    expect(result).toEqual(reduceAction(before, envelope));
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.token?.rings).toEqual(
      payload.rings,
    );
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.token?.rings).toBeUndefined();
    expect(
      reduceAction(result.state, { ...envelope, payload: { ...payload, rings: [] } }).state.scenes[
        IDS.scene
      ]?.entities[IDS.entity]?.token?.rings,
    ).toEqual([]);
  });
  it('hides DM-layer rings but preserves public rings when the token name is private', () => {
    const before = state();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) entity.layer = 'dm';
    const result = reduceAction(before, { ...envelope, actor: ACTORS.host });
    expect(patchesFor({ kind: 'spectators' }, before, result.state, result.patches)).toEqual([]);
    const publicState = state();
    const token = publicState.scenes[IDS.scene]?.entities[IDS.entity]?.token;
    if (token) {
      token.labelVisibility = 'dm';
      token.rings = payload.rings;
    }
    const view = visibleTo({ kind: 'spectators' }, publicState).scenes[IDS.scene]?.entities[
      IDS.entity
    ];
    expect(view?.name).toBe('');
    expect(view?.token?.rings).toEqual(payload.rings);
  });
});
