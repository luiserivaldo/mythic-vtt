import { viewEntity } from '../visibility/visible-to.js';
import { z } from 'zod';
import { Id, MAX_PREFABS, PrefabEntity } from '../schema/index.js';
import { defineAction, seatOf, isHost } from './define.js';
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
      (isHost(actor) ||
        (actor.seatId !== undefined &&
          viewEntity({ kind: 'seat', seatId: actor.seatId }, entity, seatOf(state, actor)) !==
            null)) &&
      !(p.prefabId in (state.prefabs ?? {})) &&
      Object.keys(state.prefabs ?? {}).length < MAX_PREFABS
    );
  },
  reduce: (draft, action) => {
    const p = action.payload;
    const entity = draft.scenes[p.sceneId]?.entities[p.entityId];
    if (!entity) return;
    // Source grants govern blueprint visibility, but do not carry over to placed copies.
    const blueprint = PrefabEntity.parse(
      Object.fromEntries(Object.entries(entity).filter(([key]) => key !== 'id')),
    );
    draft.prefabs ??= {};
    draft.prefabs[p.prefabId] = { id: p.prefabId, name: p.name, entity: blueprint };
  },
  modExposed: false,
});
