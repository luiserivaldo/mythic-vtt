import type { MigrationStep } from './runner.js';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const withLimit = (scene: Record<string, unknown>) => ({
  ...scene,
  maxLastingAoEsPerPlayer: scene['maxLastingAoEsPerPlayer'] ?? 1,
});

/** MEAS-03: old templates stay measuring AoEs; no IDs, ownership or components are inferred. */
export const v5ToV6: MigrationStep = {
  from: 5,
  migrate(payload, kind) {
    if (!record(payload)) return payload;
    if (kind === 'scene') return withLimit(payload);
    if (kind === 'snapshot' && record(payload['state'])) {
      const state = payload['state'];
      const scenes = state['scenes'];
      return {
        ...payload,
        state: {
          ...state,
          schemaVersion: 6,
          ...(record(scenes)
            ? {
                scenes: Object.fromEntries(
                  Object.entries(scenes).map(([id, scene]) => [
                    id,
                    record(scene) ? withLimit(scene) : scene,
                  ]),
                ),
              }
            : {}),
        },
      };
    }
    return payload;
  },
};
