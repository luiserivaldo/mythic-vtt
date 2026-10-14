import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

export const sceneActivate = defineAction({
  type: 'scene.activate',
  schema: z.strictObject({ sceneId: Id }),
  permission: (state, actor, p) =>
    p.sceneId in state.scenes && state.scenes[p.sceneId]?.dmOnly !== true && isHost(actor),
  reduce: (draft, a) => {
    draft.activeSceneId = a.payload.sceneId;
  },
  modExposed: false,
});
