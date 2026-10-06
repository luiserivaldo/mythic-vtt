import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdmin, isAdminOn } from './entity-access.js';

export const entitySetOwners = defineAction({
  type: 'entity.setOwners',
  schema: z.strictObject({ sceneId: Id, entityId: Id, owners: z.array(Id) }),
  permission: (state, actor, p) => {
    const entity = state.scenes[p.sceneId]?.entities[p.entityId];
    return (
      entity !== undefined &&
      isAdmin(state, actor) &&
      isAdminOn(state, actor, entity.layer) &&
      new Set(p.owners).size === p.owners.length &&
      p.owners.every((ownerId) => ownerId in state.seats)
    );
  },
  reduce: (draft, a) => {
    const entity = draft.scenes[a.payload.sceneId]?.entities[a.payload.entityId];
    if (entity) entity.owners = a.payload.owners;
  },
  modExposed: false,
});
