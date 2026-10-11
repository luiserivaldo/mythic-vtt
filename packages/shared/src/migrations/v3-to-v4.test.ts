import { expect, it } from 'vitest';
import { makeCampaign, IDS } from '../actions/testing.js';
import { Campaign } from '../schema/index.js';
import { storeMigrate } from './registry.js';

it('migrates all older snapshots without inventing statistics or losing scene lifecycle data', () => {
  for (const version of [1, 2, 3]) {
    const state = { ...makeCampaign(), schemaVersion: version };
    const original = structuredClone(state);
    const result = storeMigrate('snapshot', version, {
      schemaVersion: version,
      seq: 14,
      state,
    }) as { schemaVersion: number; state: unknown; seq: number };
    expect(result.schemaVersion).toBe(4);
    expect(result.seq).toBe(14);
    const migrated = Campaign.parse(result.state);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.scenes[IDS.scene]?.entities).toEqual({});
    expect(migrated.seats).toEqual(state.seats);
    expect(state).toEqual(original);
  }
});
