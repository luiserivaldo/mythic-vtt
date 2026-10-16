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
 * can still be replayed after a crash (HIST-02). No one may send it any more.
 *
 * A replayed entry follows the v10-to-v11 fold's rule as far as one scene's change can: a DM-only
 * scene is ignored (players never acted there); when this is the only playable scene its value
 * is applied to every seat; when other playable scenes exist the change may only LOWER a tool,
 * never raise it, because the fold kept the stricter value and the other scenes' values are no
 * longer known.
 *
 * Not handled: a `seat.create` replayed in the same recovery window gets the Player template's
 * tools, not folded ones. The old scene toggles are gone from state by then, so there is nothing
 * cheap and exact to fold from; the window is a 0.0.1 crash followed directly by an upgrade.
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
    const scene = draft.scenes[a.payload.sceneId];
    if (!scene || scene.dmOnly === true) return;
    const onlyPlayable = Object.values(draft.scenes).every(
      (other) => other.id === scene.id || other.dmOnly === true,
    );
    const next = (current: boolean, value: boolean | undefined): boolean =>
      value === undefined ? current : onlyPlayable ? value : current && value;
    const t = a.payload.toggles;
    for (const seat of Object.values(draft.seats)) {
      const tools = resolveSeatTools(seat);
      seat.tools = {
        measure: next(tools.measure, t.measure),
        draw: next(tools.draw, t.draw),
        pins: next(tools.pins, t.pins),
      };
    }
  },
  modExposed: false,
});
