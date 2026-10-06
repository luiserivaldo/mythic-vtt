import { z } from 'zod';
import { Entity, Id } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdminOn, isLayerLocked } from './entity-access.js';

export const entityCreate = defineAction({
  type: 'entity.create',
  schema: z.strictObject({ sceneId: Id, entity: Entity }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    return (
      scene !== undefined &&
      isAdminOn(state, actor, p.entity.layer) &&
      !(p.entity.id in scene.entities) &&
      !isLayerLocked(scene, p.entity.layer) &&
      new Set(p.entity.owners).size === p.entity.owners.length &&
      p.entity.owners.every((ownerId) => ownerId in state.seats)
    );
  },
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (scene) scene.entities[a.payload.entity.id] = a.payload.entity;
  },
  modExposed: false,
});
