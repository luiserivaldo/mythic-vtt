import { expect, it } from 'vitest';
import { makeCampaign } from '../actions/testing.js';
import { storeMigrate } from './registry.js';
import { Campaign } from '../schema/index.js';

it('migrates zero-scene snapshots to one deterministic blank active scene without losing data', () => {
  const state = { ...makeCampaign(), schemaVersion: 2, scenes: {}, activeSceneId: null };
  const original = structuredClone(state);
  const migrated = storeMigrate('snapshot', 2, { seq: 42, state });
  expect(migrated).toEqual(storeMigrate('snapshot', 2, { seq: 42, state }));
  expect(state).toEqual(original);
  const result = migrated as { seq: number; state: unknown };
  const campaign = Campaign.parse(result.state);
  expect(result.seq).toBe(42);
  expect(Object.keys(campaign.scenes)).toHaveLength(1);
  expect(campaign.scenes[campaign.activeSceneId ?? '']).toMatchObject({
    name: 'Blank scene',
    dmOnly: false,
  });
  expect(campaign.seats).toEqual(state.seats);
});
it('preserves existing scenes and adds the public default without mutating old saves', () => {
  const before = { ...makeCampaign(), schemaVersion: 2 };
  const migrated = storeMigrate('snapshot', 2, { state: before }) as { state: unknown };
  const after = Campaign.parse(migrated.state);
  expect(after.activeSceneId).toBe(before.activeSceneId);
  expect(Object.values(after.scenes)[0]?.dmOnly).toBe(false);
  expect(Object.values(before.scenes)[0]).not.toHaveProperty('dmOnly');
});
