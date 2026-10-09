import { z } from 'zod';
import { Id, PinComponent } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdminOn, isLayerLocked } from './entity-access.js';

export const pinCreate = defineAction({
  type: 'pin.create',
  schema: z.strictObject({ sceneId: Id, entityId: Id, pin: PinComponent }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const entity = scene?.entities[p.entityId];
    return (
      scene !== undefined &&
      entity !== undefined &&
      entity.pin === undefined &&
      !isLayerLocked(scene, entity.layer) &&
      isAdminOn(state, actor, entity.layer)
    );
  },
  reduce: (draft, a) => {
    const entity = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId];
    if (entity && entity.pin === undefined) entity.pin = a.payload.pin;
  },
  modExposed: false,
});
