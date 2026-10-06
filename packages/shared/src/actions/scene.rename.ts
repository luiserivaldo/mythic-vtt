import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isCoDm, isHost } from './define.js';

export const sceneRename = defineAction({
  type: 'scene.rename',
  schema: z.strictObject({ sceneId: Id, name: z.string().trim().min(1).max(120) }),
  // Rejecting an unknown scene here keeps the reducer total.
  permission: (state, actor, p) =>
    p.sceneId in state.scenes && (isHost(actor) || isCoDm(state, actor)),
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (scene) scene.name = a.payload.name;
  },
  modExposed: false,
});
