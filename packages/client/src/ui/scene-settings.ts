import { resolveSceneBounds, type Scene, type SceneBounds } from '@mythic/shared';
import type { IntentSpec } from './intent-specs.js';

export interface SceneSettingsDraft {
  name: string;
  folder: string;
  bounds: SceneBounds;
  cellPx: number;
}

/**
 * UI-SCN-01: the intents that move a scene to the draft, sending only what changed: one
 * `scene.update` (name, folder, canvas size) and a `grid.update` for the cell size. An empty
 * folder takes the scene out of its folder. Nothing changed gives no intents.
 */
export function sceneSettingsIntents(scene: Scene, draft: SceneSettingsDraft): IntentSpec[] {
  const update: Record<string, unknown> = {};
  const name = draft.name.trim();
  if (name !== scene.name) update.name = name;
  const folder = draft.folder.trim();
  if (folder !== (scene.folder ?? '')) update.folder = folder === '' ? null : folder;
  const current = resolveSceneBounds(scene);
  if (draft.bounds.width !== current.width || draft.bounds.height !== current.height)
    update.bounds = draft.bounds;
  const out: IntentSpec[] = [];
  if (Object.keys(update).length > 0)
    out.push({
      type: 'scene.update',
      payload: { sceneId: scene.id, ...update },
      sceneId: scene.id,
    });
  if (draft.cellPx !== scene.grid.sizePx)
    out.push({
      type: 'grid.update',
      payload: { sceneId: scene.id, sizePx: draft.cellPx },
      sceneId: scene.id,
    });
  return out;
}
