import type { AnyAction } from './define.js';
import { gridUpdate } from './grid.update.js';
import { sceneActivate } from './scene.activate.js';
import { sceneCreate } from './scene.create.js';
import { sceneRename } from './scene.rename.js';
import { sceneUpdate } from './scene.update.js';
import { seatAssign } from './seat.assign.js';
import { seatCreate } from './seat.create.js';
import { seatRelease } from './seat.release.js';
import { seatUpdate } from './seat.update.js';
import { sessionJoin } from './session.join.js';

/** Append-only (AGENTS.md §6): add new actions at the end to keep merges painless. */
export const allActions: readonly AnyAction[] = [
  sceneRename,
  sceneCreate,
  sceneUpdate,
  sceneActivate,
  gridUpdate,
  seatCreate,
  seatUpdate,
  seatAssign,
  seatRelease,
  sessionJoin,
];

const byType = new Map(allActions.map((a) => [a.type, a]));

export function getAction(type: string): AnyAction | undefined {
  return byType.get(type);
}
