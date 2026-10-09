import { describe, expect, it } from 'vitest';
import { patchesFor, reduceAction, visibleTo, type ActionEnvelope } from '../index.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';
import { initiativeSet } from './initiative.set.js';

const hiddenId = 'Z'.repeat(26);
function fixture() {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (!scene) throw new Error('missing scene');
  for (const [id, layer] of [
    [IDS.entity, 'tokens'],
    [hiddenId, 'dm'],
  ] as const)
    scene.entities[id] = makeEntity(id, {
      layer,
      name: layer === 'dm' ? 'Secret combatant' : 'Hero',
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    });
  return state;
}
const initiative = { round: 1, order: [IDS.entity, hiddenId], activeEntityId: IDS.entity };
const payload = { sceneId: IDS.scene, initiative };
const envelope: ActionEnvelope = {
  id: IDS.action,
  type: 'initiative.set',
  payload,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
};

describe('initiative actions and visibility', () => {
  it('accepts a strict scene payload and only DM/co-DM control with real token members', () => {
    const state = fixture();
    expect(initiativeSet.schema.safeParse(payload).success).toBe(true);
    expect(initiativeSet.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
    expect(initiativeSet.schema.safeParse({ sceneId: IDS.scene }).success).toBe(false);
    expect(permissionMatrix(state, envelope.type, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
    expect(
      initiativeSet.permission(state, ACTORS.host, {
        ...payload,
        initiative: { ...initiative, order: [IDS.other], activeEntityId: null },
      }),
    ).toBe(false);
  });
  it('sets, advances, wraps and clears a deleted active member deterministically', () => {
    const before = fixture();
    const result = reduceAction(before, envelope);
    expect(result).toEqual(reduceAction(before, envelope));
    expect(before.scenes[IDS.scene]?.initiative).toBeUndefined();
    const advance = { ...envelope, type: 'initiative.advance', payload: { sceneId: IDS.scene } };
    expect(permissionMatrix(result.state, advance.type, advance.payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
    const second = reduceAction(result.state, advance);
    expect(second.state.scenes[IDS.scene]?.initiative?.activeEntityId).toBe(hiddenId);
    const wrapped = reduceAction(second.state, advance);
    expect(wrapped.state.scenes[IDS.scene]?.initiative).toMatchObject({
      round: 2,
      activeEntityId: IDS.entity,
    });
    const deleted = reduceAction(wrapped.state, {
      ...envelope,
      type: 'entity.delete',
      payload: { sceneId: IDS.scene, entityId: IDS.entity },
    });
    expect(deleted.state.scenes[IDS.scene]?.initiative).toEqual({
      round: 2,
      order: [hiddenId],
      activeEntityId: null,
    });
    expect(permissionMatrix(before, advance.type, advance.payload).host).toBe(false);
  });
  it('never sends DM combatant IDs/names in a snapshot or advance patch', () => {
    const before = fixture();
    const result = reduceAction(before, envelope);
    const audience = { kind: 'spectators' } as const;
    const view = visibleTo(audience, result.state);
    expect(view.scenes[IDS.scene]?.initiative).toEqual({
      round: 1,
      order: [IDS.entity],
      activeEntityId: IDS.entity,
    });
    const next = reduceAction(result.state, {
      ...envelope,
      type: 'initiative.advance',
      payload: { sceneId: IDS.scene },
    });
    expect(
      visibleTo(audience, next.state).scenes[IDS.scene]?.initiative?.activeEntityId,
    ).toBeNull();
    expect(JSON.stringify(patchesFor(audience, before, result.state, result.patches))).not.toMatch(
      new RegExp(`${hiddenId}|Secret combatant`),
    );
    expect(
      JSON.stringify(patchesFor(audience, result.state, next.state, next.patches)),
    ).not.toMatch(new RegExp(`${hiddenId}|Secret combatant`));
    expect(
      visibleTo({ kind: 'seat', seatId: IDS.coDm }, next.state).scenes[IDS.scene]?.initiative
        ?.order,
    ).toEqual(initiative.order);
    const privateLayer = reduceAction(result.state, {
      ...envelope,
      type: 'entity.setLayer',
      payload: { sceneId: IDS.scene, entityId: IDS.entity, layer: 'dm' },
    });
    expect(visibleTo(audience, privateLayer.state).scenes[IDS.scene]?.initiative?.order).toEqual(
      [],
    );
    expect(
      JSON.stringify(patchesFor(audience, result.state, privateLayer.state, privateLayer.patches)),
    ).not.toContain(hiddenId);
  });
});
