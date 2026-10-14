import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction } from './define.js';
import { canUseEntity, isLayerLocked } from './entity-access.js';

export const aoeRemove = defineAction({
  type: 'aoe.remove',
  schema: z.strictObject({ sceneId: Id, entityId: Id }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    return (
      scene !== undefined &&
      entity?.aoe !== undefined &&
      !isLayerLocked(scene, entity.layer) &&
      canUseEntity(state, actor, entity, 'delete')
    );
  },
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (scene?.entities[a.payload.entityId]?.aoe)
      Reflect.deleteProperty(scene.entities, a.payload.entityId);
  },
  modExposed: false,
});
