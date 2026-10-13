import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SpectatorViewBody } from '@mythic/protocol';
import type { SpectatorView } from '../gateway/spectator-view.js';
import type { HttpAuthenticator } from './http-auth.js';
import { createRateLimiter } from './rate-limit.js';

/** M4-02: only the bound host chooses what spectators see; co-DMs cannot change session access. */
export function registerSpectatorViewRoutes(
  app: FastifyInstance,
  options: {
    auth: HttpAuthenticator;
    view: Pick<SpectatorView, 'get' | 'set'>;
    /** Applies the choice live; resolves false for an unknown or co-DM seat. */
    apply: (seatId: string | null) => Promise<boolean>;
  },
) {
  const limiter = createRateLimiter({ max: 30, windowMs: 60000 });
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
    if (!limiter.hit(auth.principal.identityId)) {
      await reply.code(429).send({ error: 'too many requests' });
      return false;
    }
    return true;
  };
  app.get('/api/spectator-view', async (request, reply) => {
    if (!(await hostOnly(request, reply))) return reply;
    return { seatId: options.view.get() };
  });
  app.put('/api/spectator-view', async (request, reply) => {
    if (!(await hostOnly(request, reply))) return reply;
    const body = SpectatorViewBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid spectator view' });
    if (!(await options.apply(body.data.seatId)))
      return reply.code(400).send({ error: 'seat cannot be a spectator source' });
    options.view.set(body.data.seatId);
    return { seatId: body.data.seatId };
  });
}
