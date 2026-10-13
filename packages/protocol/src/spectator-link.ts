import { z } from 'zod';

/** Host-only HTTP credential management responses (M4-01), never broadcast. */
export const SpectatorLinkResponse = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const SpectatorRevokeResponse = z.strictObject({ revoked: z.literal(true) });

/** Host-only HTTP spectator-view control (M4-02). `seatId: null` is the player view. */
export const SpectatorViewBody = z.strictObject({ seatId: z.string().min(1).max(128).nullable() });
export const SpectatorViewResponse = SpectatorViewBody;
