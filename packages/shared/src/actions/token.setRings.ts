import { z } from 'zod';
import { Id, TokenRing } from '../schema/index.js';
import { defineAction } from './define.js';
import { canUseEntity, isLayerLocked } from './entity-access.js';

export const tokenSetRings = defineAction({
  type: 'token.setRings',
  schema: z.strictObject({ sceneId: Id, entityId: Id, rings: z.array(TokenRing).max(8) }),
  permission: (state, actor, payload) => {
    const scene = state.scenes[payload.sceneId];
    const entity = scene?.entities[payload.entityId];
    return !!(
      scene &&
      entity?.token &&
      !isLayerLocked(scene, entity.layer) &&
      canUseEntity(state, actor, entity, 'edit')
    );
  },
  reduce: (draft, action) => {
    const token = draft.scenes[action.payload.sceneId]?.entities[action.payload.entityId]?.token;
    if (token) token.rings = action.payload.rings;
  },
  modExposed: false,
});
