import { z } from 'zod';

// The protocol package stays standalone (the relay imports only this), so ids are validated by
// shape here and game-state payloads are opaque: consumers validate them with `@mythic/shared`.
export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'expected a ULID');

/** Wire form of an Immer patch. */
export const WirePatch = z.object({
  op: z.enum(['add', 'remove', 'replace']),
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});
export type WirePatch = z.infer<typeof WirePatch>;
