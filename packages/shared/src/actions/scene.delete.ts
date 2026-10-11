import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

export const sceneDelete = defineAction({
  type: 'scene.delete',
  schema: z.strictObject({ sceneId: Id }),
  permission: (state, actor, p) =>
    isHost(actor) && p.sceneId in state.scenes && Object.keys(state.scenes).length > 1,
  reduce: (draft, action) => {
    Reflect.deleteProperty(draft.scenes, action.payload.sceneId);
    // UX-04: never choose a private fallback for the players.
    if (draft.activeSceneId === action.payload.sceneId) draft.activeSceneId = null;
  },
  modExposed: false,
});
