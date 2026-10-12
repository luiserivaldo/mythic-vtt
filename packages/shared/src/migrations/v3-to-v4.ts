import type { MigrationStep } from './runner.js';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function withInteraction(payload: Record<string, unknown>): Record<string, unknown> {
  const seats = payload['seats'];
  if (!record(seats)) return payload;
  return {
    ...payload,
    seats: Object.fromEntries(
      Object.entries(seats).map(([id, seat]) => [
        id,
        record(seat) ? { ...seat, interactionEnabled: seat['interactionEnabled'] ?? true } : seat,
      ]),
    ),
  };
}

/** UX-02: old seats remain interactive, including seats in persisted snapshots. */
export const v3ToV4: MigrationStep = {
  from: 3,
  migrate(payload, kind) {
    if (!record(payload)) return payload;
    if (kind === 'campaign') return withInteraction(payload);
    if (kind === 'snapshot' && record(payload['state']))
      return { ...payload, state: { ...withInteraction(payload['state']), schemaVersion: 4 } };
    return payload;
  },
};
