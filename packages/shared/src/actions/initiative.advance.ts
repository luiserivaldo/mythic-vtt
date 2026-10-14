import { z } from 'zod';
import { Id, nextInitiative } from '../schema/index.js';
import { defineAction, isHost, isCoDm } from './define.js';

export const initiativeAdvance = defineAction({
  type: 'initiative.advance',
  schema: z.strictObject({ sceneId: Id }),
  permission: (state, actor, payload) => {
    const scene = state.scenes[payload.sceneId];
    return !!(
      scene?.initiative &&
      (isHost(actor) || isCoDm(state, actor)) &&
      scene.initiative.order.every((id) => scene.entities[id]?.token !== undefined) &&
      nextInitiative(scene.initiative)
    );
  },
  reduce: (draft, action) => {
    const scene = draft.scenes[action.payload.sceneId];
    const next = scene?.initiative ? nextInitiative(scene.initiative) : undefined;
    if (scene && next) scene.initiative = next;
  },
  modExposed: false,
});
