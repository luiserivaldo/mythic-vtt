import { z } from 'zod';
import { isWithinBounds } from '../geometry/bounds.js';
import { Id, resolveSceneBounds, Vec3 } from '../schema/index.js';
import { defineAction } from './define.js';
import { canUseEntity, isLayerLocked } from './entity-access.js';

export const tokenMove = defineAction({
  type: 'token.move',
  schema: z.strictObject({ sceneId: Id, entityId: Id, to: Vec3 }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    return (
      scene !== undefined &&
      entity?.token !== undefined &&
      // D37: a move may not leave the canvas.
      isWithinBounds(resolveSceneBounds(scene), p.to) &&
      !isLayerLocked(scene, entity.layer) &&
      canUseEntity(state, actor, entity, 'move')
    );
  },
  reduce: (draft, a) => {
    const entity = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId];
    if (entity?.token) entity.transform.position = a.payload.to;
  },
  modExposed: false,
});
