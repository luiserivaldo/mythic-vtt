import type { MigrationStep } from './runner.js';

/** Optional token components: keep all existing data, including snapshot campaign versions. */
export const v1ToV2: MigrationStep = {
  from: 1,
  migrate: (payload, kind) => {
    if (kind !== 'snapshot' || typeof payload !== 'object' || payload === null) return payload;
    const record = payload as Record<string, unknown>;
    const state = record['state'];
    if (typeof state !== 'object' || state === null) return payload;
    return { ...record, state: { ...state, schemaVersion: 2 } };
  },
};
