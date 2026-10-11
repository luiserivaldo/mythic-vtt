import type { MigrationStep } from './runner.js';

/** ACT-01: chat is optional; old campaigns keep all data without fabricated messages. */
export const v3ToV4: MigrationStep = {
  from: 3,
  migrate(payload, kind) {
    if (
      kind !== 'snapshot' ||
      typeof payload !== 'object' ||
      payload === null ||
      !('state' in payload)
    )
      return payload;
    const state = payload.state;
    if (typeof state !== 'object' || state === null || Array.isArray(state)) return payload;
    return { ...payload, state: { ...state, schemaVersion: 4 } };
  },
};
