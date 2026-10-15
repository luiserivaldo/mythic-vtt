import { z } from 'zod';
import { ImageHash, SeatIcon } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

/**
 * UX-44 / UI-JOIN-01: the campaign icon and screenshot shown on the join screen. `null` clears.
 * UX-05 / UI-HOST-02: `autoScreenshot` is the sign-out capture; `screenshot` (the DM's upload)
 * takes precedence over it wherever a thumbnail is shown.
 */
export const campaignSetBranding = defineAction({
  type: 'campaign.setBranding',
  schema: z
    .strictObject({
      icon: SeatIcon.nullable().optional(),
      screenshot: ImageHash.nullable().optional(),
      autoScreenshot: ImageHash.nullable().optional(),
    })
    .refine(
      (p) => p.icon !== undefined || p.screenshot !== undefined || p.autoScreenshot !== undefined,
      { message: 'at least one field to update is required' },
    ),
  permission: (_state, actor) => isHost(actor),
  reduce: (draft, a) => {
    const { icon, screenshot, autoScreenshot } = a.payload;
    if (icon === null) delete draft.icon;
    else if (icon !== undefined) draft.icon = icon;
    if (screenshot === null) delete draft.screenshot;
    else if (screenshot !== undefined) draft.screenshot = screenshot;
    if (autoScreenshot === null) delete draft.autoScreenshot;
    else if (autoScreenshot !== undefined) draft.autoScreenshot = autoScreenshot;
  },
  modExposed: false,
});
