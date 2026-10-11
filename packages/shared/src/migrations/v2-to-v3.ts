import { blankScene } from '../schema/blank-scene.js';
import type { MigrationStep } from './runner.js';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const v2ToV3: MigrationStep = {
  from: 2,
  migrate(payload, kind) {
    if (!record(payload)) return payload;
    if (kind === 'scene') return { ...payload, dmOnly: payload['dmOnly'] ?? false };
    if (kind !== 'snapshot' || !record(payload['state'])) return payload;
    const state = payload['state'];
    const scenes = state['scenes'];
    if (!record(scenes) || typeof state['id'] !== 'string')
      return { ...payload, state: { ...state, schemaVersion: 3 } };
    const migrated = Object.fromEntries(
      Object.entries(scenes).map(([id, scene]) => [
        id,
        record(scene) ? { ...scene, dmOnly: scene['dmOnly'] ?? false } : scene,
      ]),
    );
    if (Object.keys(migrated).length === 0) {
      const scene = blankScene(state['id']);
      return {
        ...payload,
        state: {
          ...state,
          schemaVersion: 3,
          scenes: { [scene.id]: scene },
          activeSceneId: scene.id,
        },
      };
    }
    return { ...payload, state: { ...state, schemaVersion: 3, scenes: migrated } };
  },
};
