import { Prefabs } from './prefab.js';
import { z } from 'zod';
import { Id } from './ids.js';
import { Scene } from './scene.js';
import { ImageHash, Seat, SeatIcon } from './seat.js';

/** Bumped by the `schema-change` skill; migrations live in `../migrations`. */
export const CURRENT_SCHEMA_VERSION = 10;

export const Campaign = z.object({
  id: Id,
  name: z.string(),
  /** UI-JOIN-01 (UX-44): shown on the join screen before anyone joins. */
  icon: SeatIcon.optional(),
  screenshot: ImageHash.optional(),
  schemaVersion: z.number().int().positive(),
  settings: z.object({
    defaultBinding: z.enum(['persistent', 'session']),
    instanceMode: z.enum(['linked', 'forked']),
    spectators: z.object({ enabled: z.boolean(), view: z.enum(['players', 'follow-dm']) }),
  }),
  seats: z.record(Id, Seat),
  scenes: z.record(Id, Scene),
  activeSceneId: Id.nullable(),
  prefabs: Prefabs.optional(),
});
export type Campaign = z.infer<typeof Campaign>;
