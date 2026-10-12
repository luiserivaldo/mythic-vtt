import { z } from 'zod';
import { Id, ScenePlayerToggles } from '../schema/index.js';
import { defineAction, isCoDm, isHost } from './define.js';

export const sceneSetPlayerToggles = defineAction({
  type: 'scene.setPlayerToggles',
  schema: z.strictObject({
    sceneId: Id,
    toggles: ScenePlayerToggles.refine((t) => Object.keys(t).length > 0, {
      message: 'at least one toggle is required',
    }),
  }),
  // PERM-05: players can never grant themselves abilities.
  permission: (state, actor, p) =>
    p.sceneId in state.scenes && (isHost(actor) || isCoDm(state, actor)),
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (scene) scene.playerToggles = { ...scene.playerToggles, ...a.payload.toggles };
  },
  modExposed: false,
});
