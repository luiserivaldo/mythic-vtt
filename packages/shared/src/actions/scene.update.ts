import { z } from 'zod';
import {
  AssetRef,
  Id,
  SceneBounds,
  SceneFolder,
  SceneVision,
  LastingAoELimit,
} from '../schema/index.js';
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
      // ENV-07: an uploaded image used as the skybox; null clears it back to the colour/gradient.
      skybox: AssetRef.nullable().optional(),
      // D37: shrinking never moves entities; they stay and can be dragged back in.
      bounds: SceneBounds.optional(),
      maxLastingAoEsPerPlayer: LastingAoELimit.optional(),
      // UI-SCN-01: null takes the scene out of its folder.
      folder: SceneFolder.nullable().optional(),
      // FOG-01 (MV-303 Q2b): the dynamic-lighting switch; null removes it (off, as before v12).
      vision: SceneVision.nullable().optional(),
    })
    .refine(
      (p) =>
        p.name !== undefined ||
        p.background !== undefined ||
        p.zenith !== undefined ||
        p.skybox !== undefined ||
        p.bounds !== undefined ||
        p.maxLastingAoEsPerPlayer !== undefined ||
        p.folder !== undefined ||
        p.vision !== undefined,
      {
        message: 'at least one field to update is required',
      },
    ),
  permission: (state, actor, p) =>
    p.sceneId in state.scenes && (isHost(actor) || isCoDm(state, actor)),
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (!scene) return;
    if (a.payload.name !== undefined) scene.name = a.payload.name;
    if (a.payload.background !== undefined) scene.environment.background = a.payload.background;
    if (a.payload.bounds !== undefined) scene.bounds = a.payload.bounds;
    if (a.payload.maxLastingAoEsPerPlayer !== undefined)
      scene.maxLastingAoEsPerPlayer = a.payload.maxLastingAoEsPerPlayer;
    if (a.payload.zenith === null) delete scene.environment.zenith;
    else if (a.payload.zenith !== undefined) scene.environment.zenith = a.payload.zenith;
    if (a.payload.folder === null) delete scene.folder;
    else if (a.payload.folder !== undefined) scene.folder = a.payload.folder;
    if (a.payload.vision === null) delete scene.vision;
    else if (a.payload.vision !== undefined) scene.vision = a.payload.vision;
    if (a.payload.skybox === null) delete scene.environment.skybox;
    else if (a.payload.skybox !== undefined) scene.environment.skybox = a.payload.skybox;
  },
  modExposed: false,
});
