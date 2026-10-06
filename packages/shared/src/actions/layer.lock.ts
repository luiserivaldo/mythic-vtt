import { z } from 'zod';
import { Id, LayerId } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdmin } from './entity-access.js';

export const layerLock = defineAction({
  type: 'layer.lock',
  schema: z.strictObject({ sceneId: Id, layer: LayerId, locked: z.boolean() }),
  permission: (state, actor, p) => p.sceneId in state.scenes && isAdmin(state, actor),
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (scene) scene.layers[a.payload.layer] = { locked: a.payload.locked };
  },
  modExposed: false,
});
