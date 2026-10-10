import { z } from 'zod';
import { Id, SceneOverlay } from '../schema/index.js';
import { defineAction, isHost, isCoDm } from './define.js';

export const sceneSetOverlay = defineAction({
  type: 'scene.setOverlay',
  schema: z.strictObject({ sceneId: Id, overlay: SceneOverlay.nullable() }),
  permission: (state, actor, payload) =>
    !!state.scenes[payload.sceneId] && (isHost(actor) || isCoDm(state, actor)),
  reduce: (draft, action) => {
    const scene = draft.scenes[action.payload.sceneId];
    if (!scene) return;
    if (action.payload.overlay === null) delete scene.overlay;
    else scene.overlay = action.payload.overlay;
  },
  modExposed: false,
});
