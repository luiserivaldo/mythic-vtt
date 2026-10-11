import { z } from 'zod';
import { isWithinBounds } from '../geometry/bounds.js';
import { Entity, Id, resolveSceneBounds } from '../schema/index.js';
import { viewEntity } from '../visibility/visible-to.js';
import { defineAction, seatOf } from './define.js';
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

    // D37: a move may not leave the canvas.
    if (
      p.changes.transform &&
      !isWithinBounds(resolveSceneBounds(scene), p.changes.transform.position)
    )
      return false;

    // UX-07: general token editors may echo visible fields but must use the dedicated action
    // to change them. Omitted private fields are preserved when replacing the token component.
    for (const [id, field] of Object.entries(p.changes.token?.quickFields ?? {})) {
      const audience =
        actor.kind === 'host'
          ? { kind: 'host' as const }
          : { kind: 'seat' as const, seatId: actor.seatId ?? '' };
      const existing = viewEntity(audience, entity, seatOf(state, actor))?.token?.quickFields?.[id];
      if (
        !existing ||
        field.value !== existing.value ||
        field.visibility !== existing.visibility ||
        field.color !== existing.color
      )
        return false;
    }
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
    if (entity) {
      const fields = entity.token?.quickFields;
      Object.assign(entity, a.payload.changes);
      if (entity.token && fields) entity.token.quickFields = fields;
    }
  },
  modExposed: false,
});
