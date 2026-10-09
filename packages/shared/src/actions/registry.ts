import { prefabSave } from './prefab.save.js';
import { prefabRemove } from './prefab.remove.js';
import { prefabPlace } from './prefab.place.js';
import type { AnyAction } from './define.js';
import { aoePlace } from './aoe.place.js';
import { aoeRemove } from './aoe.remove.js';
import { aoeUpdate } from './aoe.update.js';
import { entityCreate } from './entity.create.js';
import { entityDelete } from './entity.delete.js';
import { entitySetLayer } from './entity.setLayer.js';
import { entitySetOwners } from './entity.setOwners.js';
import { entityUpdate } from './entity.update.js';
import { gridUpdate } from './grid.update.js';
import { layerLock } from './layer.lock.js';
import { permissionUpdate } from './permission.update.js';
import { sceneActivate } from './scene.activate.js';
import { sceneCreate } from './scene.create.js';
import { sceneRename } from './scene.rename.js';
import { sceneUpdate } from './scene.update.js';
import { seatAssign } from './seat.assign.js';
import { seatCreate } from './seat.create.js';
import { seatRelease } from './seat.release.js';
import { seatUpdate } from './seat.update.js';
import { sessionJoin } from './session.join.js';
import { tokenMove } from './token.move.js';
import { tokenSetElevation } from './token.setElevation.js';

/** Append-only: add new actions at the end to keep merges painless. */
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
  entityCreate,
  entityUpdate,
  entityDelete,
  entitySetLayer,
  entitySetOwners,
  layerLock,
  permissionUpdate,
  tokenMove,
  aoePlace,
  aoeUpdate,
  aoeRemove,
  tokenSetElevation,
  prefabSave,
  prefabRemove,
  prefabPlace,
];

const byType = new Map(allActions.map((a) => [a.type, a]));

export function getAction(type: string): AnyAction | undefined {
  return byType.get(type);
}
