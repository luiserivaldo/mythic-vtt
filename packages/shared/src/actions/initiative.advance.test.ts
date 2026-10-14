import { expect, it } from 'vitest';
import { initiativeAdvance } from './initiative.advance.js';
import { ACTORS, IDS, makeCampaign, makeEntity } from './testing.js';
import { MAX_ROUND } from '../schema/initiative.js';

it('rejects malformed payloads, empty orders and a round overflow before reducing', () => {
  const payload = { sceneId: IDS.scene };
  expect(initiativeAdvance.schema.safeParse(payload).success).toBe(true);
  expect(initiativeAdvance.schema.safeParse({ ...payload, round: 2 }).success).toBe(false);
  expect(initiativeAdvance.schema.safeParse({}).success).toBe(false);
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (!scene) throw new Error('missing fixture scene');
  expect(initiativeAdvance.permission(state, ACTORS.host, payload)).toBe(false);
  scene.entities[IDS.entity] = makeEntity(IDS.entity, {
    token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
  });
  scene.initiative = { round: MAX_ROUND, order: [IDS.entity], activeEntityId: IDS.entity };
  expect(initiativeAdvance.permission(state, ACTORS.host, payload)).toBe(false);
  scene.initiative.activeEntityId = null;
  expect(initiativeAdvance.permission(state, ACTORS.host, payload)).toBe(true);
});
