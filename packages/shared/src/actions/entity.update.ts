import { z } from 'zod';
import { isWithinBounds } from '../geometry/bounds.js';
import { Entity, Id, resolveSceneBounds } from '../schema/index.js';
import { defineAction } from './define.js';
import { canUseEntity, canReadEntityLabel, isLayerLocked } from './entity-access.js';

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

    // D37: a move may not leave the canvas.
    if (
      p.changes.transform &&
      !isWithinBounds(resolveSceneBounds(scene), p.changes.transform.position)
    )
      return false;

    // TOK-06: entity.update must not bypass the marker action's hidden-label guard.
    if (p.changes.token?.statusMarkers !== undefined && !canReadEntityLabel(state, actor, entity))
      return false;

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
    if (!entity) return;
    const previousMarkers = entity.token?.statusMarkers;
    Object.assign(entity, a.payload.changes);
    // A resize uses the client's filtered token; omission cannot erase hidden markers.
    if (
      a.payload.changes.token &&
      a.payload.changes.token.statusMarkers === undefined &&
      previousMarkers !== undefined &&
      entity.token
    )
      entity.token.statusMarkers = previousMarkers;
  },
  modExposed: false,
});
