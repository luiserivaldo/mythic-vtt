import { z } from 'zod';
import { Id, TokenStatusMarkers } from '../schema/index.js';
import { defineAction } from './define.js';
import { canUseEntity, canReadEntityLabel, isLayerLocked } from './entity-access.js';

export const tokenSetStatusMarkers = defineAction({
  type: 'token.setStatusMarkers',
  schema: z.strictObject({ sceneId: Id, entityId: Id, markers: TokenStatusMarkers }),
  permission: (state, actor, payload) => {
    const scene = state.scenes[payload.sceneId];
    const entity = scene?.entities[payload.entityId];
    return !!(
      scene &&
      entity?.token &&
      !isLayerLocked(scene, entity.layer) &&
      canUseEntity(state, actor, entity, 'edit') &&
      canReadEntityLabel(state, actor, entity)
    );
  },
  reduce: (draft, action) => {
    const token = draft.scenes[action.payload.sceneId]?.entities[action.payload.entityId]?.token;
    if (token) token.statusMarkers = action.payload.markers;
  },
  modExposed: false,
});
