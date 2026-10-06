import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isCoDm, isHost } from './define.js';

export const sceneActivate = defineAction({
  type: 'scene.activate',
  schema: z.strictObject({ sceneId: Id }),
  permission: (state, actor, p) =>
    p.sceneId in state.scenes && (isHost(actor) || isCoDm(state, actor)),
  reduce: (draft, a) => {
    draft.activeSceneId = a.payload.sceneId;
  },
  modExposed: false,
});
