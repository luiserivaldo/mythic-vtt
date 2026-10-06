import { z } from 'zod';
import { AoEEntity, Id } from '../schema/index.js';
import { defineAction, seatOf } from './define.js';
import { isAdmin, isLayerLocked } from './entity-access.js';

export const aoePlace = defineAction({
  type: 'aoe.place',
  schema: z.strictObject({ sceneId: Id, entity: AoEEntity }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    if (
      !scene ||
      p.entity.id in scene.entities ||
      isLayerLocked(scene, p.entity.layer) ||
      new Set(p.entity.owners).size !== p.entity.owners.length ||
      !p.entity.owners.every((ownerId) => ownerId in state.seats)
    )
      return false;
    if (isAdmin(state, actor)) return true;

    const seat = seatOf(state, actor);
    // D23: placing shared map content is denied by default; a host-granted seat edit
    // capability permits a player to place only their own non-DM AoE.
    return (
      seat !== undefined &&
      seat.permissions.edit &&
      p.entity.layer !== 'dm' &&
      p.entity.owners.length === 1 &&
      p.entity.owners[0] === seat.id
    );
  },
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (scene) scene.entities[a.payload.entity.id] = a.payload.entity;
  },
  modExposed: false,
});
