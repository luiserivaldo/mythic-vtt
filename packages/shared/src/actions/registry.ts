import type { AnyAction } from './define.js';
import { gridUpdate } from './grid.update.js';
import { sceneActivate } from './scene.activate.js';
import { sceneCreate } from './scene.create.js';
import { sceneRename } from './scene.rename.js';
import { sceneUpdate } from './scene.update.js';

/** Append-only (AGENTS.md §6): add new actions at the end to keep merges painless. */
export const allActions: readonly AnyAction[] = [
  sceneRename,
  sceneCreate,
  sceneUpdate,
  sceneActivate,
  gridUpdate,
];

const byType = new Map(allActions.map((a) => [a.type, a]));

export function getAction(type: string): AnyAction | undefined {
  return byType.get(type);
}
