import { expect, it } from 'vitest';
import { makeCampaign, IDS, makeEntity } from '../actions/testing.js';
import { storeMigrate } from './registry.js';

it('defaults scene caps and nested snapshots without changing old AoEs, IDs or ownership', () => {
  const state = { ...makeCampaign(), schemaVersion: 5 };
  const scene = state.scenes[IDS.scene];
  if (!scene) throw new Error('missing scene');
  scene.entities[IDS.entity] = makeEntity(IDS.entity, {
    owners: [IDS.owner],
    aoe: { kind: 'cube', size: 2, color: '#ff8800' },
  });
  const old = structuredClone(state);
  const next = storeMigrate('scene', 5, scene);
  expect(next).toEqual({ ...scene, maxLastingAoEsPerPlayer: 1 });
  expect(storeMigrate('snapshot', 5, { schemaVersion: 5, seq: 23, state })).toEqual({
    schemaVersion: 6,
    seq: 23,
    state: {
      ...state,
      schemaVersion: 6,
      scenes: { [IDS.scene]: { ...scene, maxLastingAoEsPerPlayer: 1 } },
    },
  });
  expect(state).toEqual(old);
  expect(storeMigrate('scene', 5, { ...scene, maxLastingAoEsPerPlayer: 0 })).toMatchObject({
    maxLastingAoEsPerPlayer: 0,
  });
});
