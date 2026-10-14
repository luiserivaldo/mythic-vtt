import { describe, expect, it } from 'vitest';
import { createStoreMigrate, MIGRATION_STEPS } from './registry.js';
import { makeCampaign, IDS } from '../actions/testing.js';
import { v4ToV5 } from './v4-to-v5.js';
const storeMigrate = createStoreMigrate(
  MIGRATION_STEPS.filter((step) => step.from < 5),
  5,
);
import { Campaign } from '../schema/index.js';

describe('v4 to v5 quick-fields migration', () => {
  it('leaves tokens without quick fields instead of inventing statistics', () => {
    const state = { ...makeCampaign(), schemaVersion: 4 };
    const old = structuredClone(state);
    const next = Campaign.parse(storeMigrate('campaign', 4, state));
    expect(next.schemaVersion).toBe(5);
    expect(next.scenes[IDS.scene]?.entities).toEqual({});
    expect(next.seats).toEqual(state.seats);
    expect(state).toEqual(old);
  });
  it('bumps the schema version of persisted snapshots and keeps the sequence number', () => {
    const state = { ...makeCampaign(), schemaVersion: 4 };
    expect(storeMigrate('snapshot', 4, { schemaVersion: 4, state, seq: 42 })).toMatchObject({
      schemaVersion: 5,
      seq: 42,
      state: { schemaVersion: 5, seats: state.seats },
    });
  });
  it('leaves scene payloads unchanged', () => {
    const scene = { name: 'Old scene' };
    expect(createStoreMigrate([v4ToV5], 5)('scene', 4, scene)).toBe(scene);
  });
  it('migrates every older snapshot version through the whole chain', () => {
    for (const version of [1, 2, 3, 4]) {
      const state = { ...makeCampaign(), schemaVersion: version };
      const result = storeMigrate('snapshot', version, {
        schemaVersion: version,
        seq: 14,
        state,
      }) as {
        schemaVersion: number;
        state: unknown;
        seq: number;
      };
      expect(result.schemaVersion).toBe(5);
      expect(result.seq).toBe(14);
      expect(Campaign.parse(result.state).schemaVersion).toBe(5);
    }
  });
});
