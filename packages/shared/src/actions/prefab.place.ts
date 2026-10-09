import { canReadPrefab } from './prefab-access.js';
import { z } from 'zod';
import { Entity, Id, Vec3, type Prefab } from '../schema/index.js';
import { defineAction } from './define.js';
import { entityCreate } from './entity.create.js';

function copy(prefab: Prefab, id: string, to: z.infer<typeof Vec3>) {
  return Entity.parse({
    ...Object.fromEntries(
      Object.entries(prefab.entity).filter(([key]) => !['owners', 'perms'].includes(key)),
    ),
    id,
    owners: [],
    transform: { ...prefab.entity.transform, position: to },
  });
}
export const prefabPlace = defineAction({
  type: 'prefab.place',
  schema: z.strictObject({ sceneId: Id, prefabId: Id, entityId: Id, to: Vec3.strict() }),
  permission: (state, actor, p) => {
    const prefab = state.prefabs?.[p.prefabId];
    return (
      !!prefab &&
      canReadPrefab(state, actor, prefab) &&
      entityCreate.permission(state, actor, {
        sceneId: p.sceneId,
        entity: copy(prefab, p.entityId, p.to),
      })
    );
  },
  reduce: (draft, action) => {
    const p = action.payload,
      scene = draft.scenes[p.sceneId],
      prefab = draft.prefabs?.[p.prefabId];
    if (scene && prefab) scene.entities[p.entityId] = copy(prefab, p.entityId, p.to);
  },
  modExposed: false,
});
