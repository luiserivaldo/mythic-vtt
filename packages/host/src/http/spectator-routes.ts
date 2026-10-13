import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SpectatorLinks } from '../gateway/spectator-links.js';
import type { HttpAuthenticator } from './http-auth.js';
import { createRateLimiter } from './rate-limit.js';

/** Only the bound host can issue credentials; co-DMs cannot change session access. */
export function registerSpectatorRoutes(
  app: FastifyInstance,
  options: {
    auth: HttpAuthenticator;
    links: SpectatorLinks;
    disconnect: () => void;
  },
) {
  const limiter = createRateLimiter({ max: 10, windowMs: 60000 });
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
  app.post('/api/spectator-link', async (request, reply) => {
    if (!(await hostOnly(request, reply))) return reply;
    const token = options.links.rotate();
    options.disconnect();
    return { token };
  });
  app.delete('/api/spectator-link', async (request, reply) => {
    if (!(await hostOnly(request, reply))) return reply;
    options.links.revoke();
    options.disconnect();
    return { revoked: true };
  });
}
