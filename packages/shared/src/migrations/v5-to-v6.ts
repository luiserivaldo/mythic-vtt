import type { MigrationStep } from './runner.js';

// Optional archived defaults to false, so old seats and historical records are preserved exactly.
export const v5ToV6: MigrationStep = {
  from: 5,
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
    return { ...payload, state: { ...state, schemaVersion: 6 } };
  },
};
