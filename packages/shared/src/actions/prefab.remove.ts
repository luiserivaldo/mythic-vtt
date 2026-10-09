import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdminOn } from './entity-access.js';

export const prefabRemove = defineAction({
  type: 'prefab.remove',
  schema: z.strictObject({ prefabId: Id }),
  permission: (state, actor, p) => {
    const prefab = state.prefabs?.[p.prefabId];
    return !!prefab && isAdminOn(state, actor, prefab.entity.layer);
  },
  reduce: (draft, action) => {
    if (draft.prefabs) Reflect.deleteProperty(draft.prefabs, action.payload.prefabId);
  },
  modExposed: false,
});
