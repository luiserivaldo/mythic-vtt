import { expect, it } from 'vitest';
import { storeMigrate } from './registry.js';

it('upgrades v1 and v2 snapshots without inventing statistics or losing unknown data', () => {
  for (const version of [1, 2]) {
    const state = { schemaVersion: version, scenes: {}, preserved: { text: 'legacy' } };
    const snapshot = { schemaVersion: version, state, seq: 14 };
    expect(storeMigrate('snapshot', version, snapshot)).toEqual({
      schemaVersion: 3,
      state: { ...state, schemaVersion: 3 },
      seq: 14,
    });
    expect(snapshot.state.schemaVersion).toBe(version);
    expect(storeMigrate('campaign', version, state)).toEqual({ ...state, schemaVersion: 3 });
  }
});
