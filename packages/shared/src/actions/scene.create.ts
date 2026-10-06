import { z } from 'zod';
import { Id, SceneBounds } from '../schema/index.js';
import { defineAction, isCoDm, isHost } from './define.js';

// GRID-02: default 5 ft per square. Ids come from the payload (not generated here) so the
// reducer stays deterministic and the client can reference the new scene immediately.
export const sceneCreate = defineAction({
  type: 'scene.create',
  schema: z.strictObject({
    sceneId: Id,
    name: z.string().trim().min(1).max(120),
    background: z.string().min(1).max(64).optional(),
    bounds: SceneBounds.optional(),
  }),
  permission: (state, actor, p) =>
    !(p.sceneId in state.scenes) && (isHost(actor) || isCoDm(state, actor)),
  reduce: (draft, a) => {
    draft.scenes[a.payload.sceneId] = {
      id: a.payload.sceneId,
      name: a.payload.name,
      grid: {
        type: 'square',
        sizePx: 70,
        unitsPerCell: 5,
        unitLabel: 'ft',
        diagonal: 'alternating',
        snap: true,
      },
      ...(a.payload.bounds ? { bounds: a.payload.bounds } : {}),
      environment: { background: a.payload.background ?? '#000000' },
      layers: {},
      entities: {},
    };
    // First scene of a campaign becomes the active one so the table is never empty.
    if (draft.activeSceneId === null) draft.activeSceneId = a.payload.sceneId;
  },
  modExposed: false,
});
