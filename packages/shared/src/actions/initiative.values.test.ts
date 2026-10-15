import { describe, expect, it } from 'vitest';
import { patchesFor, reduceAction, visibleTo, type ActionEnvelope } from '../index.js';
import { ACTORS, IDS, makeCampaign, makeEntity } from './testing.js';

// UX-38 / PERM-03: initiative scores are keyed by combatant id, so they follow its visibility.
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
const initiative = {
  round: 1,
  order: [hiddenId, IDS.entity],
  activeEntityId: hiddenId,
  values: { [hiddenId]: 4321, [IDS.entity]: 12 },
};
const envelope: ActionEnvelope = {
  id: IDS.action,
  type: 'initiative.set',
  payload: { sceneId: IDS.scene, initiative },
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
};

describe('initiative scores', () => {
  it('strips a hidden combatant score from views and patches', () => {
    const before = fixture();
    const result = reduceAction(before, envelope);
    expect(result.state.scenes[IDS.scene]?.initiative).toEqual(initiative);
    const audience = { kind: 'spectators' } as const;
    expect(visibleTo(audience, result.state).scenes[IDS.scene]?.initiative).toEqual({
      round: 1,
      order: [IDS.entity],
      activeEntityId: null,
      values: { [IDS.entity]: 12 },
    });
    const wire = JSON.stringify(patchesFor(audience, before, result.state, result.patches));
    expect(wire).not.toMatch(new RegExp(`${hiddenId}|4321`));
    expect(
      visibleTo({ kind: 'seat', seatId: IDS.coDm }, result.state).scenes[IDS.scene]?.initiative,
    ).toEqual(initiative);
  });
  it('drops a deleted combatant score with its row', () => {
    const result = reduceAction(fixture(), envelope);
    const deleted = reduceAction(result.state, {
      ...envelope,
      type: 'entity.delete',
      payload: { sceneId: IDS.scene, entityId: hiddenId },
    });
    expect(deleted.state.scenes[IDS.scene]?.initiative).toEqual({
      round: 1,
      order: [IDS.entity],
      activeEntityId: null,
      values: { [IDS.entity]: 12 },
    });
  });
});
