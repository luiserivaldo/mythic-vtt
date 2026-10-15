import { z } from 'zod';
import { ImageHash, SeatIcon } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

/** UX-44 / UI-JOIN-01: the campaign icon and screenshot shown on the join screen. `null` clears. */
export const campaignSetBranding = defineAction({
  type: 'campaign.setBranding',
  schema: z
    .strictObject({
      icon: SeatIcon.nullable().optional(),
      screenshot: ImageHash.nullable().optional(),
    })
    .refine((p) => p.icon !== undefined || p.screenshot !== undefined, {
      message: 'at least one field to update is required',
    }),
  permission: (_state, actor) => isHost(actor),
  reduce: (draft, a) => {
    const { icon, screenshot } = a.payload;
    if (icon === null) delete draft.icon;
    else if (icon !== undefined) draft.icon = icon;
    if (screenshot === null) delete draft.screenshot;
    else if (screenshot !== undefined) draft.screenshot = screenshot;
  },
  modExposed: false,
});
