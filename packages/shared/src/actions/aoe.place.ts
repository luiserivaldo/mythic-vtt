import { z } from 'zod';
import { AoEEntity, Id } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdminOn, isLayerLocked } from './entity-access.js';
import { seatOf } from './define.js';
import { canUseTool } from './seat-tools.js';
import { isWithinBounds } from '../geometry/bounds.js';
import { resolveSceneBounds } from '../schema/index.js';

export const aoePlace = defineAction({
  type: 'aoe.place',
  schema: z.strictObject({
    sceneId: Id,
    entity: AoEEntity.omit({ lastingAoE: true, measuringAoE: true }),
  }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const existing = scene?.entities[p.entity.id];
    if (
      !scene ||
      actor.identityId !== p.entity.id ||
      (existing !== undefined && !AoEEntity.safeParse(existing).success) ||
      existing?.lastingAoE !== undefined ||
      isLayerLocked(scene, p.entity.layer) ||
      new Set(p.entity.owners).size !== p.entity.owners.length ||
      !p.entity.owners.every((ownerId) => ownerId in state.seats)
    )
      return false;
    if (existing?.layer === 'dm' && !isAdminOn(state, actor, 'dm')) return false;
    if (isAdminOn(state, actor, p.entity.layer)) return true;
    // Q27 / MEAS-03: a player can measure one identity-bound template on effects.
    // Props remain admin-only (D23); persistent copies use aoe.persist and its cap.
    const seat = seatOf(state, actor);
    return !!(
      seat &&
      seat.permissions.view &&
      (!existing || existing.measuringAoE === true) &&
      p.entity.layer === 'effects' &&
      p.entity.perms === undefined &&
      p.entity.owners.every((id) => id === seat.id) &&
      isWithinBounds(resolveSceneBounds(scene), p.entity.transform.position) &&
      canUseTool(state, actor, p.sceneId, 'measure')
    );
  },
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (scene)
      scene.entities[a.payload.entity.id] = {
        ...a.payload.entity,
        measuringAoE: true,
        ...(!isAdminOn(draft, a.actor, a.payload.entity.layer) && a.actor.seatId
          ? { owners: [a.actor.seatId] }
          : {}),
      };
  },
  modExposed: false,
});
