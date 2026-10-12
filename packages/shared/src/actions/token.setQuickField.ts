import { z } from 'zod';
import { Id, QuickField, QuickFieldId } from '../schema/index.js';
import { viewEntity } from '../visibility/visible-to.js';
import { defineAction, seatOf } from './define.js';
import { canUseEntity, isAdminOn, isLayerLocked } from './entity-access.js';

export const tokenSetQuickField = defineAction({
  type: 'token.setQuickField',
  schema: z.strictObject({
    sceneId: Id,
    entityId: Id,
    fieldId: QuickFieldId,
    field: QuickField.nullable(),
  }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    if (
      !scene ||
      !entity?.token ||
      isLayerLocked(scene, entity.layer) ||
      !canUseEntity(state, actor, entity, 'edit')
    )
      return false;
    const existing = entity.token.quickFields?.[p.fieldId];
    if (p.field && !existing && Object.keys(entity.token.quickFields ?? {}).length >= 32)
      return false;
    if (isAdminOn(state, actor, entity.layer)) return true;
    const seat = seatOf(state, actor);
    if (!seat || !existing || !p.field) return false;
    // Editors may change a shared value, but only admins may create/remove fields or change sharing.
    return (
      viewEntity({ kind: 'seat', seatId: seat.id }, entity, seat)?.token?.quickFields?.[
        p.fieldId
      ] !== undefined &&
      p.field.visibility === existing.visibility &&
      p.field.color === existing.color
    );
  },
  reduce: (draft, a) => {
    const token = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId]?.token;
    if (!token) return;
    if (a.payload.field === null) delete token.quickFields?.[a.payload.fieldId];
    else {
      token.quickFields ??= {};
      token.quickFields[a.payload.fieldId] = a.payload.field;
    }
  },
  modExposed: false,
});
