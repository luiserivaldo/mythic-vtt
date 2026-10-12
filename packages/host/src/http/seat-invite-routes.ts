import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SeatInviteRedeemRequest } from '@mythic/protocol';
import type { Campaign } from '@mythic/shared';
import type { SeatInvites } from '../gateway/seat-invites.js';
import type { HttpAuthenticator } from './http-auth.js';
import { createRateLimiter } from './rate-limit.js';

const SEAT_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * SES-04. Issuing, listing and revoking are bound-host only (co-DMs cannot change table access,
 * as with spectator links). Redeeming needs only a valid identity: the invite token is the
 * authority to take that one seat. Responses are `no-store`; the token appears only in the reply
 * that issues it, and never in an error, a log line or a URL path or query.
 */
export function registerSeatInviteRoutes(
  app: FastifyInstance,
  options: {
    auth: HttpAuthenticator;
    invites: SeatInvites;
    state: () => Campaign;
    claimSeat: (identityId: string, seatId: string) => Promise<boolean>;
  },
) {
  const writeLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });
  // Counts bad guesses per caller; a correct redeem does not burn the budget.
  const redeemFailures = createRateLimiter({ max: 10, windowMs: 60_000 });

  const hostOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    const auth = await options.auth.authenticate(request);
    if (!auth.ok) {
      await reply.code(auth.status).send({ error: 'unauthorized' });
      return false;
    }
    if (!auth.principal.isHost) {
      await reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    if (!writeLimiter.hit(auth.principal.identityId)) {
      await reply.code(429).send({ error: 'too many requests' });
      return false;
    }
    return true;
  };
  const seatParam = (request: FastifyRequest): string | undefined => {
    const seatId = (request.params as { seatId?: unknown }).seatId;
    return typeof seatId === 'string' && SEAT_ID.test(seatId) && seatId in options.state().seats
      ? seatId
      : undefined;
  };

  app.get('/api/seat-invites', async (request, reply) => {
    if (!(await hostOnly(request, reply))) return reply;
    return { seatIds: options.invites.seatIds() };
  });
  app.post('/api/seat-invites/:seatId', async (request, reply) => {
    if (!(await hostOnly(request, reply))) return reply;
    const seatId = seatParam(request);
    if (seatId === undefined) return reply.code(404).send({ error: 'unknown seat' });
    return { seatId, token: options.invites.rotate(seatId) };
  });
  app.delete('/api/seat-invites/:seatId', async (request, reply) => {
    if (!(await hostOnly(request, reply))) return reply;
    const seatId = seatParam(request);
    if (seatId === undefined) return reply.code(404).send({ error: 'unknown seat' });
    options.invites.revoke(seatId);
    return { revoked: true };
  });

  app.post('/api/seat-invites/redeem', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const auth = await options.auth.authenticate(request);
    if (!auth.ok) return reply.code(auth.status).send({ error: 'unauthorized' });
    const { identityId, isHost } = auth.principal;
    // The host already owns the table and must not be seated by a link.
    if (isHost) return reply.code(403).send({ error: 'forbidden' });
    const key = `${request.ip}|${identityId}`;
    if (redeemFailures.exhausted(key)) return reply.code(429).send({ error: 'too many requests' });
    // One generic answer for malformed, wrong, revoked and unknown: no oracle for guessers.
    const unavailable = () => {
      redeemFailures.hit(key);
      return reply.code(404).send({ error: 'invite unavailable' });
    };
    const body = SeatInviteRedeemRequest.safeParse(request.body);
    if (!body.success) return unavailable();
    const { seatId, token } = body.data;
    if (!(seatId in options.state().seats) || !options.invites.valid(seatId, token))
      return unavailable();
    if (!(await options.claimSeat(identityId, seatId)))
      return reply.code(409).send({ error: 'seat unavailable' });
    return { seatId };
  });
}
