import type { AnyAction } from './define.js';
import { sceneRename } from './scene.rename.js';

/** Append-only (AGENTS.md §6): add new actions at the end to keep merges painless. */
export const allActions: readonly AnyAction[] = [sceneRename];

const byType = new Map(allActions.map((a) => [a.type, a]));

export function getAction(type: string): AnyAction | undefined {
  return byType.get(type);
}
