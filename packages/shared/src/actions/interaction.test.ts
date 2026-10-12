import { describe, expect, it } from 'vitest';
import { checkIntent, reduceAction } from './run.js';
import { seatUpdate } from './seat.update.js';
import { ACTORS, IDS, makeCampaign, makeEntity } from './testing.js';
import { visibleTo } from '../visibility/index.js';

function campaign() {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (!scene) throw new Error('missing scene');
  scene.entities[IDS.entity] = makeEntity(IDS.entity, {
    owners: [IDS.owner],
    token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
  });
  return state;
}
const move = { sceneId: IDS.scene, entityId: IDS.entity, to: { x: 1, y: 0, z: 1 } };

describe('seat interaction gate', () => {
  it('defaults old seats to enabled and leaves their view unchanged when disabled', () => {
    const state = campaign();
    expect(checkIntent(state, ACTORS.owner, 'token.move', move).ok).toBe(true);
    const before = visibleTo({ kind: 'seat', seatId: IDS.owner }, state);
    const next = reduceAction(state, {
      id: IDS.action,
      type: 'seat.update',
      payload: { seatId: IDS.owner, interactionEnabled: false },
      actor: ACTORS.host,
      campaignId: IDS.campaign,
      sessionId: IDS.session,
      seq: 1,
      ts: 1000,
    }).state;
    expect(checkIntent(next, ACTORS.owner, 'token.move', move)).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(visibleTo({ kind: 'seat', seatId: IDS.owner }, next).scenes).toEqual(before.scenes);
    expect(checkIntent(next, ACTORS.host, 'token.move', move).ok).toBe(true);
  });
  it('blocks privileged co-DM actions and cannot be re-enabled by the disabled seat', () => {
    const state = campaign();
    const seat = state.seats[IDS.coDm];
    if (!seat) throw new Error('missing seat');
    expect(
      checkIntent(state, ACTORS.coDm, 'scene.rename', { sceneId: IDS.scene, name: 'New' }).ok,
    ).toBe(true);
    seat.interactionEnabled = false;
    expect(
      checkIntent(state, ACTORS.coDm, 'scene.rename', { sceneId: IDS.scene, name: 'New' }).ok,
    ).toBe(false);
    expect(
      checkIntent(state, ACTORS.coDm, 'seat.update', { seatId: IDS.coDm, interactionEnabled: true })
        .ok,
    ).toBe(false);
  });
  it('accepts boolean-only updates, rejects non-boolean values and restores access', () => {
    expect(
      seatUpdate.schema.safeParse({ seatId: IDS.owner, interactionEnabled: false }).success,
    ).toBe(true);
    expect(
      seatUpdate.schema.safeParse({ seatId: IDS.owner, interactionEnabled: 'false' }).success,
    ).toBe(false);
    const state = campaign();
    const envelope = {
      id: IDS.action,
      type: 'seat.update',
      payload: { seatId: IDS.owner, interactionEnabled: false },
      actor: ACTORS.host,
      campaignId: IDS.campaign,
      sessionId: IDS.session,
      seq: 1,
      ts: 1000,
    };
    expect(reduceAction(state, envelope)).toEqual(reduceAction(state, envelope));
    const disabled = reduceAction(state, envelope).state;
    const enabled = reduceAction(disabled, {
      ...envelope,
      payload: { seatId: IDS.owner, interactionEnabled: true },
    }).state;
    expect(checkIntent(enabled, ACTORS.owner, 'token.move', move).ok).toBe(true);
  });
});
