import { z } from 'zod';
import { Id } from './ids.js';
import { Scene } from './scene.js';
import { Seat } from './seat.js';

/** Bumped by the `schema-change` skill; migrations live in `../migrations`. */
export const CURRENT_SCHEMA_VERSION = 1;

export const Campaign = z.object({
  id: Id,
  name: z.string(),
  schemaVersion: z.number().int().positive(),
  settings: z.object({
    defaultBinding: z.enum(['persistent', 'session']),
    instanceMode: z.enum(['linked', 'forked']),
    spectators: z.object({ enabled: z.boolean(), view: z.enum(['players', 'follow-dm']) }),
  }),
  seats: z.record(Id, Seat),
  scenes: z.record(Id, Scene),
  activeSceneId: Id.nullable(),
});
export type Campaign = z.infer<typeof Campaign>;
