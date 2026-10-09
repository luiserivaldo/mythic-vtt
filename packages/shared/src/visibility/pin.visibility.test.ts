import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import type { ActionEnvelope } from '../actions/envelope.js';
import { reduceAction } from '../actions/run.js';
import { ACTORS, IDS, makeCampaign, makeEntity } from '../actions/testing.js';
import { patchesFor } from './patches-for.js';
import { visibleTo } from './visible-to.js';

const SECRET = 'The lich keeps the real phylactery below the altar.';
const pin = { text: SECRET, reveal: { proximity: 4 } };
const player = { kind: 'seat', seatId: IDS.owner } as const;
const spectators = { kind: 'spectators' } as const;
const host = { kind: 'host' } as const;

function stateWithPin(layer: 'tokens' | 'dm' = 'tokens') {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene) scene.entities[IDS.entity] = makeEntity(IDS.entity, { layer, pin });
  return state;
}

describe('pin visibility (TRIG-01, PERM-03)', () => {
  it('includes a DM-layer pin only in the host snapshot', () => {
    const state = stateWithPin('dm');
    expect(visibleTo(host, state).scenes[IDS.scene]?.entities[IDS.entity]?.pin).toEqual(pin);
    for (const audience of [player, spectators]) {
      const view = visibleTo(audience, state);
      expect(view.scenes[IDS.scene]?.entities[IDS.entity]).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain(SECRET);
    }
  });

  it('turns a layer move into a secret-free removal for a seat and spectators', () => {
    const before = stateWithPin();
    const envelope: ActionEnvelope = {
      id: IDS.action,
      type: 'entity.setLayer',
      payload: { sceneId: IDS.scene, entityId: IDS.entity, layer: 'dm' },
      actor: ACTORS.host,
      campaignId: IDS.campaign,
      sceneId: IDS.scene,
      sessionId: IDS.session,
      seq: 1,
      ts: 1_000,
    };
    const result = reduceAction(before, envelope);

    for (const audience of [player, spectators]) {
      const patches = patchesFor(audience, before, result.state, result.patches);
      expect(patches).toEqual([
        { op: 'remove', path: ['scenes', IDS.scene, 'entities', IDS.entity] },
      ]);
      expect(JSON.stringify(patches)).not.toContain(SECRET);
      expect(applyPatches(visibleTo(audience, before), patches)).toEqual(
        visibleTo(audience, result.state),
      );
      expect(JSON.stringify(visibleTo(audience, result.state))).not.toContain(SECRET);
    }

    const hostPatches = patchesFor(host, before, result.state, result.patches);
    expect(applyPatches(visibleTo(host, before), hostPatches)).toEqual(
      visibleTo(host, result.state),
    );
    expect(visibleTo(host, result.state).scenes[IDS.scene]?.entities[IDS.entity]?.pin).toEqual(pin);
  });
});
