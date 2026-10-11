import { z } from 'zod';
import { Id } from './ids.js';
import { SeatPermissions } from './permissions.js';

export const Seat = z.object({
  id: Id,
  label: z.string(),
  binding: z.enum(['persistent', 'session']),
  identityId: Id.nullable(),
  role: z.enum(['player', 'codm']),
  permissions: SeatPermissions,
  /** SES-03/05: retained for history; archived seats have no access or ownership. */
  archived: z.boolean().optional(),
});
export type Seat = z.infer<typeof Seat>;
