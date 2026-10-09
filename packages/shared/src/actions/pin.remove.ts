import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdminOn, isLayerLocked } from './entity-access.js';

export const pinRemove = defineAction({
  type: 'pin.remove',
  schema: z.strictObject({ sceneId: Id, entityId: Id }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    return (
      scene !== undefined &&
      entity?.pin !== undefined &&
      !isLayerLocked(scene, entity.layer) &&
      isAdminOn(state, actor, entity.layer)
    );
  },
  reduce: (draft, a) => {
    const entity = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId];
    if (entity?.pin) Reflect.deleteProperty(entity, 'pin');
  },
  modExposed: false,
});
