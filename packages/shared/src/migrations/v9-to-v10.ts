import type { MigrationStep } from './runner.js';

// UX-38: Initiative.values and Initiative.ascending are optional, so v9 saves are preserved.
export const v9ToV10: MigrationStep = {
  from: 9,
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
    return { ...payload, state: { ...state, schemaVersion: 10 } };
  },
};
