import { z } from 'zod';
import { AoEEntity, Id } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdminOn, isLayerLocked } from './entity-access.js';

export const aoePlace = defineAction({
  type: 'aoe.place',
  schema: z.strictObject({ sceneId: Id, entity: AoEEntity }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    if (
      !scene ||
      p.entity.id in scene.entities ||
      isLayerLocked(scene, p.entity.layer) ||
      new Set(p.entity.owners).size !== p.entity.owners.length ||
      !p.entity.owners.every((ownerId) => ownerId in state.seats)
    )
      return false;
    // D23: placement changes the shared map and is admin-only. Once placed, the normal
    // ownership and per-entity grants apply to update/remove.
    return isAdminOn(state, actor, p.entity.layer);
  },
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (scene) scene.entities[a.payload.entity.id] = a.payload.entity;
  },
  modExposed: false,
});
