import { z } from 'zod';
import { Id, Initiative } from '../schema/index.js';
import { defineAction, isHost, isCoDm } from './define.js';

export const initiativeSet = defineAction({
  type: 'initiative.set',
  schema: z.strictObject({ sceneId: Id, initiative: Initiative }),
  permission: (state, actor, payload) => {
    const scene = state.scenes[payload.sceneId];
    return !!(
      scene &&
      (isHost(actor) || isCoDm(state, actor)) &&
      payload.initiative.order.every((id) => scene.entities[id]?.token !== undefined)
    );
  },
  reduce: (draft, action) => {
    const scene = draft.scenes[action.payload.sceneId];
    if (scene) scene.initiative = action.payload.initiative;
  },
  modExposed: false,
});
