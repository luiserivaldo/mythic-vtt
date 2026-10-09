import { z } from 'zod';
import { Id, MAX_PREFABS, PrefabEntity } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdminOn } from './entity-access.js';

export const prefabSave = defineAction({
  type: 'prefab.save',
  schema: z.strictObject({
    sceneId: Id,
    entityId: Id,
    prefabId: Id,
    name: z.string().trim().min(1).max(120),
  }),
  permission: (state, actor, p) => {
    const entity = state.scenes[p.sceneId]?.entities[p.entityId];
    return (
      !!entity &&
      isAdminOn(state, actor, entity.layer) &&
      !(p.prefabId in (state.prefabs ?? {})) &&
      Object.keys(state.prefabs ?? {}).length < MAX_PREFABS
    );
  },
  reduce: (draft, action) => {
    const p = action.payload;
    const entity = draft.scenes[p.sceneId]?.entities[p.entityId];
    if (!entity) return;
    // Parsing creates an independent deep copy; owners and overrides are instance-specific.
    const blueprint = PrefabEntity.parse(
      Object.fromEntries(
        Object.entries(entity).filter(([key]) => !['id', 'owners', 'perms'].includes(key)),
      ),
    );
    draft.prefabs ??= {};
    draft.prefabs[p.prefabId] = { id: p.prefabId, name: p.name, entity: blueprint };
  },
  modExposed: false,
});
