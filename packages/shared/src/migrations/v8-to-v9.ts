import type { MigrationStep } from './runner.js';

// UX-44: seat.icon/temporary and campaign.icon/screenshot are optional, so v8 saves are preserved.
export const v8ToV9: MigrationStep = {
  from: 8,
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
    return { ...payload, state: { ...state, schemaVersion: 9 } };
  },
};
