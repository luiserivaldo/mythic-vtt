import { z } from 'zod';
import { GridColor, Id } from '../schema/index.js';
import { defineAction, isCoDm, isHost } from './define.js';

const FIELDS = [
  'sizePx',
  'unitsPerCell',
  'unitLabel',
  'diagonal',
  'snap',
  'color',
  'opacity',
] as const;

// GRID-01..03. Colour and opacity are optional Grid fields (see schema/scene.ts).
export const gridUpdate = defineAction({
  type: 'grid.update',
  schema: z
    .strictObject({
      sceneId: Id,
      sizePx: z.number().positive().max(4096).optional(),
      unitsPerCell: z.number().positive().max(1_000_000).optional(),
      unitLabel: z.string().trim().min(1).max(16).optional(),
      diagonal: z.enum(['chebyshev', 'alternating', 'euclidean', 'manhattan']).optional(),
      snap: z.boolean().optional(),
      color: GridColor.optional(),
      opacity: z.number().min(0).max(1).optional(),
    })
    .refine((p) => FIELDS.some((f) => p[f] !== undefined), {
      message: 'at least one grid field is required',
    }),
  permission: (state, actor, p) =>
    p.sceneId in state.scenes && (isHost(actor) || isCoDm(state, actor)),
  reduce: (draft, a) => {
    const scene = draft.scenes[a.payload.sceneId];
    if (!scene) return;
    const p = a.payload;
    if (p.sizePx !== undefined) scene.grid.sizePx = p.sizePx;
    if (p.unitsPerCell !== undefined) scene.grid.unitsPerCell = p.unitsPerCell;
    if (p.unitLabel !== undefined) scene.grid.unitLabel = p.unitLabel;
    if (p.diagonal !== undefined) scene.grid.diagonal = p.diagonal;
    if (p.snap !== undefined) scene.grid.snap = p.snap;
    if (p.color !== undefined) scene.grid.color = p.color;
    if (p.opacity !== undefined) scene.grid.opacity = p.opacity;
  },
  modExposed: false,
});
