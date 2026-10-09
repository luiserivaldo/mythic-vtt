import { z } from 'zod';
import { Id, PinComponent } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdminOn, isLayerLocked } from './entity-access.js';

const PinChanges = PinComponent.partial()
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: 'at least one field to update is required',
  });

export const pinUpdate = defineAction({
  type: 'pin.update',
  schema: z.strictObject({ sceneId: Id, entityId: Id, changes: PinChanges }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    return (
      scene !== undefined &&
      entity?.pin !== undefined &&
      !isLayerLocked(scene, entity.layer) &&
      isAdminOn(state, actor, entity.layer)
    );
  },
  reduce: (draft, a) => {
    const pin = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId]?.pin;
    if (pin) Object.assign(pin, a.payload.changes);
  },
  modExposed: false,
});
