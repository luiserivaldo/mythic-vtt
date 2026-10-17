import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, seatOf } from './define.js';
import { isAdminOn, isLayerLocked } from './entity-access.js';
import { canUseTool } from './seat-tools.js';

/**
 * VIS-01 (FOG-01, D47 + MV-303): open or close a door. The host and co-DMs (outside the dm layer;
 * doors always live on the map layer) may toggle any door. A player needs the per-seat `doors`
 * tool, and even then only a non-secret door in the active scene (one they can see). Range, line
 * of sight and action cost are not rules yet. A locked map layer blocks everyone, as it does for
 * `entity.update`. This is the only door path a player can use; `entity.update` of `wall` stays
 * admin-only. Undo uses the ordinary inverse patch.
 *
 * PERM-03: a player's rejection is the same `forbidden` for a secret door, a plain wall, a non-wall
 * entity and an unknown id, so the reply never reveals that a secret door exists.
 */
export const wallSetDoor = defineAction({
  type: 'wall.setDoor',
  schema: z.strictObject({ sceneId: Id, entityId: Id, open: z.boolean() }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    const door = entity?.wall?.door;
    if (!scene || !entity || !door || door.open === p.open) return false;
    if (isLayerLocked(scene, entity.layer)) return false;
    if (isAdminOn(state, actor, entity.layer)) return true;
    return (
      door.secret !== true &&
      entity.layer !== 'dm' &&
      p.sceneId === state.activeSceneId &&
      seatOf(state, actor)?.permissions.view === true &&
      canUseTool(state, actor, p.sceneId, 'doors')
    );
  },
  reduce: (draft, a) => {
    const door = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId]?.wall?.door;
    if (door) door.open = a.payload.open;
  },
  modExposed: false,
});
