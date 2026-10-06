import { z } from 'zod';

const AssetKind = z.enum(['image', 'model', 'audio', 'effect']);

// D16: a local/library union from M0 so Library content (M12) needs no save-format break.
export const AssetRef = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('local'),
    hash: z.string().regex(/^[0-9a-f]{64}$/, 'expected a lowercase SHA-256 hex digest'),
    kind: AssetKind,
    name: z.string().optional(),
  }),
  z.object({
    source: z.literal('library'),
    libraryId: z.string().min(1),
    version: z.string().min(1),
    kind: AssetKind,
    name: z.string().optional(),
    // LIB-04: placeholder shown when the library asset is unavailable.
    fallback: z.object({
      kind: z.enum(['primitive', 'effect']),
      sizeCells: z.number().positive().optional(),
    }),
  }),
]);
export type AssetRef = z.infer<typeof AssetRef>;
