import { z } from 'zod';
import { Id, resolveSeatTools } from '../schema/index.js';
import { defineAction } from './define.js';

/** The 0.0.1 payload shape, kept only so old session logs still parse. */
const LegacyToggles = z.strictObject({
  draw: z.boolean().optional(),
  measure: z.boolean().optional(),
  pins: z.boolean().optional(),
});

/**
 * RETIRED by UX-46 (MV-251, save v11): scene-wide player toggles no longer exist; each seat has
 * its own tools (`seat.update { tools }`). The type stays registered only so a 0.0.1 session log
 * can still be replayed after a crash (HIST-02). No one may send it any more, and a replayed entry
 * applies the change to every seat, the way the v10-to-v11 migration folds scene toggles into
 * seats.
 */
export const sceneSetPlayerToggles = defineAction({
  type: 'scene.setPlayerToggles',
  schema: z.strictObject({
    sceneId: Id,
    toggles: LegacyToggles.refine((t) => Object.keys(t).length > 0, {
      message: 'at least one toggle is required',
    }),
  }),
  permission: () => false,
  reduce: (draft, a) => {
    if (!(a.payload.sceneId in draft.scenes)) return;
    for (const seat of Object.values(draft.seats)) {
      const tools = resolveSeatTools(seat);
      const t = a.payload.toggles;
      seat.tools = {
        measure: t.measure ?? tools.measure,
        draw: t.draw ?? tools.draw,
        pins: t.pins ?? tools.pins,
      };
    }
  },
  modExposed: false,
});
