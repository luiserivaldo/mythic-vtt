import { z } from 'zod';
import { Id, LayerId, visionRuleViolation } from '../schema/index.js';
import { defineAction, isCoDm } from './define.js';
import { canUseEntity, isLayerLocked } from './entity-access.js';

export const entitySetLayer = defineAction({
  type: 'entity.setLayer',
  schema: z.strictObject({ sceneId: Id, entityId: Id, layer: LayerId }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    return (
      scene !== undefined &&
      entity !== undefined &&
      entity.layer !== p.layer &&
      !isLayerLocked(scene, entity.layer) &&
      !isLayerLocked(scene, p.layer) &&
      // D32: only the host may move entities onto the DM layer among admins.
      !(p.layer === 'dm' && isCoDm(state, actor)) &&
      // FOG-01: walls and fog regions stay on the map layer, and a sight
      // blocker cannot move onto the dm layer (occluders are data every player receives, D47 (4)).
      visionRuleViolation({ ...entity, layer: p.layer }) === undefined &&
      canUseEntity(state, actor, entity, 'move')
    );
  },
  reduce: (draft, a) => {
    const entity = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId];
    if (entity) entity.layer = a.payload.layer;
  },
  modExposed: false,
});
