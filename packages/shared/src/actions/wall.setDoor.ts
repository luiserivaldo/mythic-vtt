import { z } from 'zod';
import { DoorState, Id } from '../schema/index.js';
import { defineAction, seatOf } from './define.js';
import { isAdminOn, isLayerLocked } from './entity-access.js';
import { canUseTool } from './seat-tools.js';

/**
 * VIS-01 (FOG-01, MV-303 Q1): open, close, lock or unlock a door. The host and co-DMs (outside the
 * dm layer; doors always live on the map layer) may set any state on any door. A player needs the
 * per-seat `doors` tool, and even then may only switch an unlocked, non-secret door between open
 * and closed in the active scene: never lock or unlock, and never touch a secret door (a closed one
 * is sent to them as a plain wall). Range, line of sight and action cost are not rules yet.
 * A locked map layer blocks everyone, as it does for `entity.update`. This is the only door path a
 * player can use; `entity.update` of `wall` stays admin-only. Undo uses the ordinary inverse patch.
 */
export const wallSetDoor = defineAction({
  type: 'wall.setDoor',
  schema: z.strictObject({ sceneId: Id, entityId: Id, state: DoorState }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    const door = entity?.wall?.door;
    if (!scene || !entity || !door || door.state === p.state) return false;
    if (isLayerLocked(scene, entity.layer)) return false;
    if (isAdminOn(state, actor, entity.layer)) return true;
    return (
      p.sceneId === state.activeSceneId &&
      seatOf(state, actor)?.permissions.view === true &&
      canUseTool(state, actor, p.sceneId, 'doors') &&
      door.secret !== true &&
      door.state !== 'locked' &&
      p.state !== 'locked'
    );
  },
  reduce: (draft, a) => {
    const door = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId]?.wall?.door;
    if (door) door.state = a.payload.state;
  },
  modExposed: false,
});
