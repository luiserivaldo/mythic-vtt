import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isCoDm, isHost } from './define.js';

export const sceneUpdate = defineAction({
  type: 'scene.update',
  schema: z
    .strictObject({
      sceneId: Id,
      name: z.string().trim().min(1).max(120).optional(),
      background: z.string().min(1).max(64).optional(),
      // ENV-07: null clears the gradient back to a plain colour.
      zenith: z.string().min(1).max(64).nullable().optional(),
    })
    .refine((p) => p.name !== undefined || p.background !== undefined || p.zenith !== undefined, {
      message: 'at least one field to update is required',
    }),
  permission: (state, actor, p) =>
    p.sceneId in state.scenes && (isHost(actor) || isCoDm(state, actor)),
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (!scene) return;
    if (a.payload.name !== undefined) scene.name = a.payload.name;
    if (a.payload.background !== undefined) scene.environment.background = a.payload.background;
    if (a.payload.zenith === null) delete scene.environment.zenith;
    else if (a.payload.zenith !== undefined) scene.environment.zenith = a.payload.zenith;
  },
  modExposed: false,
});
