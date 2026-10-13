import type { MigrationStep } from './runner.js';

/** UX-07: old tokens have no quick fields; never invent character statistics. */
export const v4ToV5: MigrationStep = {
  from: 4,
  migrate: (payload, kind) => {
    if (kind !== 'snapshot' || typeof payload !== 'object' || payload === null) return payload;
    const record = payload as Record<string, unknown>;
    const state = record['state'];
    if (typeof state !== 'object' || state === null) return payload;
    return { ...record, state: { ...state, schemaVersion: 5 } };
  },
};
