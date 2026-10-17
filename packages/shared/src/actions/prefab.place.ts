import type { Actor } from './envelope.js';
import { canReadPrefab } from './prefab-access.js';
import { z } from 'zod';
import { EntityFields, Id, Vec3, type Prefab } from '../schema/index.js';
import { defineAction } from './define.js';
import { entityCreate } from './entity.create.js';

function copy(prefab: Prefab, id: string, to: z.infer<typeof Vec3>, actor: Actor) {
  // FOG-01: the vision rules are checked by entity.create's permission, not thrown here.
  return EntityFields.parse({
    ...Object.fromEntries(
      Object.entries(prefab.entity).filter(
        ([key]) => !['owners', 'perms', 'lastingAoE', 'measuringAoE'].includes(key),
      ),
    ),
    id,
    owners: [],
    ...(prefab.entity.aoe
      ? { lastingAoE: { ...(actor.identityId ? { creatorIdentityId: actor.identityId } : {}) } }
      : {}),
    // MV-177: a hidden source places hidden copies; other instance grants are not inherited.
    ...(prefab.entity.perms?.view === false ? { perms: { view: false } } : {}),
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
        entity: copy(prefab, p.entityId, p.to, actor),
      })
    );
  },
  reduce: (draft, action) => {
    const p = action.payload,
      scene = draft.scenes[p.sceneId],
      prefab = draft.prefabs?.[p.prefabId];
    if (scene && prefab) scene.entities[p.entityId] = copy(prefab, p.entityId, p.to, action.actor);
  },
  modExposed: false,
});
