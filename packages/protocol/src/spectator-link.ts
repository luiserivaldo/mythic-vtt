import { z } from 'zod';

/** Host-only HTTP credential management responses (M4-01), never broadcast. */
export const SpectatorLinkResponse = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const SpectatorRevokeResponse = z.strictObject({ revoked: z.literal(true) });
