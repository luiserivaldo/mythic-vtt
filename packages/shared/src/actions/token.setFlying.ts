import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction } from './define.js';
import { canUseEntity, isLayerLocked } from './entity-access.js';

/**
 * TOK-03 / Q26: a flying token has its vertical position locked. `token.move` keeps its height
 * and the drag tool applies no gravity. Setting an explicit value (not a toggle) keeps the action
 * idempotent when a client resends it.
 */
export const tokenSetFlying = defineAction({
  type: 'token.setFlying',
  schema: z.strictObject({ sceneId: Id, entityId: Id, flying: z.boolean() }),
  // Same as elevation: whoever may move the token may lock or release its height.
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    return (
      scene !== undefined &&
      entity?.token !== undefined &&
      !isLayerLocked(scene, entity.layer) &&
      canUseEntity(state, actor, entity, 'move')
    );
  },
  reduce: (draft, a) => {
    const token = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId]?.token;
    if (!token) return;
    // Absent means "not flying": no stored `false`, so old saves and new ones compare equal.
    if (a.payload.flying) token.flying = true;
    else delete token.flying;
  },
  modExposed: false,
});
