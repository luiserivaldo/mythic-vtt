import { z } from 'zod';
import { AoEEntity, DEFAULT_LASTING_AOE_LIMIT, Id } from '../schema/index.js';
import { defineAction, seatOf } from './define.js';
import { isAdminOn, isLayerLocked } from './entity-access.js';
import { canUseTool } from './seat-tools.js';
import { viewEntity } from '../visibility/visible-to.js';

/** Q27 / MEAS-03: promote the actor's measuring template; never overwrite another object. */
export const aoePersist = defineAction({
  type: 'aoe.persist',
  schema: z.strictObject({ sceneId: Id, sourceId: Id, entityId: Id }),
  permission: (state, actor, p) => {
    const scene = state.scenes[p.sceneId];
    const source = scene?.entities[p.sourceId];
    if (
      !scene ||
      !source ||
      actor.identityId !== p.sourceId ||
      source.lastingAoE ||
      !AoEEntity.safeParse(source).success ||
      p.entityId === p.sourceId ||
      scene.entities[p.entityId] ||
      isLayerLocked(scene, source.layer)
    )
      return false;
    if (isAdminOn(state, actor, source.layer)) return true;
    const seat = seatOf(state, actor);
    if (
      !seat?.permissions.view ||
      source.layer !== 'effects' ||
      source.measuringAoE !== true ||
      !canUseTool(state, actor, p.sceneId, 'measure') ||
      viewEntity({ kind: 'seat', seatId: seat.id }, source, seat) === null
    )
      return false;
    const count = Object.values(scene.entities).filter(
      (entity) => entity.aoe && entity.lastingAoE?.creatorIdentityId === actor.identityId,
    ).length;
    return count < (scene.maxLastingAoEsPerPlayer ?? DEFAULT_LASTING_AOE_LIMIT);
  },
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    const source = scene?.entities[a.payload.sourceId];
    if (!scene || !source) return;
    const placed = {
      ...source,
      id: a.payload.entityId,
      owners: a.actor.kind === 'seat' && a.actor.seatId ? [a.actor.seatId] : [],
      lastingAoE: { creatorIdentityId: a.payload.sourceId },
    };
    delete placed.measuringAoE;
    scene.entities[a.payload.entityId] = placed;
    Reflect.deleteProperty(scene.entities, a.payload.sourceId);
  },
  modExposed: false,
});
