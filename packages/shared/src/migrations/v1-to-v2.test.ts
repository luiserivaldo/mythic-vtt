import { expect, it } from 'vitest';
import { storeMigrate } from './registry.js';

it('preserves old campaign, scene, session and snapshot data without mutating inputs', () => {
  const original = { schemaVersion: 1, arbitrary: { preserved: true } };
  for (const kind of ['campaign', 'scene', 'session'] as const) {
    expect(storeMigrate(kind, 1, original)).toEqual({ ...original, schemaVersion: 2 });
  }
  const snapshot = { schemaVersion: 1, seq: 42, state: original };
  expect(storeMigrate('snapshot', 1, snapshot)).toEqual({
    ...snapshot,
    schemaVersion: 2,
    state: { ...original, schemaVersion: 2 },
  });
  expect(snapshot.state.schemaVersion).toBe(1);
});
