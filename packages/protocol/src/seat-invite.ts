import { z } from 'zod';
import { Ulid } from './common.js';

/** SES-04 host-only and redeem HTTP responses. Never broadcast; the token is shown once. */
export const SeatInviteIssued = z.strictObject({
  seatId: Ulid,
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const SeatInviteList = z.strictObject({ seatIds: z.array(Ulid) });
export const SeatInviteRevoked = z.strictObject({ revoked: z.literal(true) });
export const SeatInviteRedeemRequest = z.strictObject({
  seatId: Ulid,
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const SeatInviteRedeemed = z.strictObject({ seatId: Ulid });
