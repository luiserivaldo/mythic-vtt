import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction } from './define.js';
import { canUseEntity, isLayerLocked } from './entity-access.js';

/** TOK-03 / D25: elevation is `transform.position.y` in cells; far beyond any real map. */
export const ELEVATION_MIN_CELLS = -1000;
export const ELEVATION_MAX_CELLS = 1000;

export const tokenSetElevation = defineAction({
  type: 'token.setElevation',
  schema: z.strictObject({
    sceneId: Id,
    entityId: Id,
    /** Cells (continuous, D25); clients snap to whole grid units by default. */
    elevation: z.number().min(ELEVATION_MIN_CELLS).max(ELEVATION_MAX_CELLS),
  }),
  // D23/D19: whoever may move the token may change its height.
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
    const entity = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId];
    if (entity?.token) entity.transform.position.y = a.payload.elevation;
  },
  modExposed: false,
});
