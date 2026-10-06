import { z } from 'zod';
import { Entity, Id } from '../schema/index.js';
import { defineAction } from './define.js';
import { canUseEntity, isLayerLocked } from './entity-access.js';

const EntityChanges = Entity.omit({ id: true, layer: true, owners: true, perms: true })
  .partial()
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: 'at least one field to update is required',
  });

export const entityUpdate = defineAction({
  type: 'entity.update',
  schema: z.strictObject({ sceneId: Id, entityId: Id, changes: EntityChanges }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    if (!scene || !entity || isLayerLocked(scene, entity.layer)) return false;

    const keys = Object.keys(p.changes);
    const needsMove = keys.includes('transform');
    const needsEdit = keys.some((key) => key !== 'transform');
    return (
      (!needsMove || canUseEntity(state, actor, entity, 'move')) &&
      (!needsEdit || canUseEntity(state, actor, entity, 'edit'))
    );
  },
  reduce: (draft, a) => {
    const entity = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId];
    if (entity) Object.assign(entity, a.payload.changes);
  },
  modExposed: false,
});
