import type { MigrationStep } from './runner.js';

// Optional scene.initiative is absent on older scenes, so v7 saves are preserved exactly.
export const v7ToV8: MigrationStep = {
  from: 7,
  migrate(payload, kind) {
    if (
      kind !== 'snapshot' ||
      typeof payload !== 'object' ||
      payload === null ||
      !('state' in payload)
    )
      return payload;
    const state = payload.state;
    if (typeof state !== 'object' || state === null) return payload;
    return { ...payload, state: { ...state, schemaVersion: 8 } };
  },
};
