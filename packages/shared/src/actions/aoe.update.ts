import { z } from 'zod';
import { AoEShape, Id, Transform } from '../schema/index.js';
import { defineAction } from './define.js';
import { canUseEntity, isLayerLocked } from './entity-access.js';

const AoEChanges = z
  .strictObject({
    name: z.string().optional(),
    transform: Transform.optional(),
    aoe: AoEShape.optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, {
    message: 'at least one field to update is required',
  });

export const aoeUpdate = defineAction({
  type: 'aoe.update',
  schema: z.strictObject({ sceneId: Id, entityId: Id, changes: AoEChanges }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    if (!scene || !entity?.aoe || isLayerLocked(scene, entity.layer)) return false;

    const needsMove = p.changes.transform !== undefined;
    const needsEdit = p.changes.name !== undefined || p.changes.aoe !== undefined;
    return (
      (!needsMove || canUseEntity(state, actor, entity, 'move')) &&
      (!needsEdit || canUseEntity(state, actor, entity, 'edit'))
    );
  },
  reduce: (draft, a) => {
    const entity = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId];
    if (entity?.aoe) Object.assign(entity, a.payload.changes);
  },
  modExposed: false,
});
