import { z } from 'zod';
import { isWithinBounds } from '../geometry/bounds.js';
import {
  EntityFields,
  Id,
  resolveSceneBounds,
  visionRuleViolation,
  type Entity,
} from '../schema/index.js';
import { viewEntity } from '../visibility/visible-to.js';
import { defineAction, seatOf } from './define.js';
import {
  ADMIN_ONLY_COMPONENTS,
  canUseEntity,
  canReadEntityLabel,
  isAdminOn,
  isLayerLocked,
} from './entity-access.js';

const EntityChanges = EntityFields.omit({
  id: true,
  layer: true,
  owners: true,
  perms: true,
  lastingAoE: true,
  measuringAoE: true,
})
  .partial()
  // FOG-01: `blocksSight: null` turns sight blocking off again (the stored flag is only `true`).
  .extend({ blocksSight: z.literal(true).nullable().optional() })
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

    // FOG-01: walls, doors, sight blocking and fog regions are admin data, whatever the player's
    // ownership or entity grants, and the result must still satisfy every vision rule.
    if (
      ADMIN_ONLY_COMPONENTS.some((key) => key in p.changes) &&
      !isAdminOn(state, actor, entity.layer)
    )
      return false;
    const { blocksSight, ...rest } = p.changes;
    const merged: Entity = Object.assign({}, entity, rest);
    if (blocksSight === null) delete merged.blocksSight;
    else if (blocksSight !== undefined) merged.blocksSight = blocksSight;
    if (visionRuleViolation(merged) !== undefined) return false;

    // TOK-06: entity.update must not bypass the marker action's hidden-label guard.
    if (p.changes.token?.statusMarkers !== undefined && !canReadEntityLabel(state, actor, entity))
      return false;

    // PERM-03: an editor who cannot read the label may not change who can (a widening would
    // reveal the hidden markers and real name on the next patch).
    if (
      p.changes.token &&
      p.changes.token.labelVisibility !== entity.token?.labelVisibility &&
      !canReadEntityLabel(state, actor, entity)
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
    if (!entity) return;
    const fields = entity.token?.quickFields;
    const previousMarkers = entity.token?.statusMarkers;
    const { blocksSight, ...changes } = a.payload.changes;
    Object.assign(entity, changes);
    if (blocksSight === null) delete entity.blocksSight;
    else if (blocksSight !== undefined) entity.blocksSight = blocksSight;
    if (entity.token && fields) entity.token.quickFields = fields;
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
