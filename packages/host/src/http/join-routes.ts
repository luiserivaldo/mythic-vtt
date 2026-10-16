import type { FastifyInstance } from 'fastify';
import type { Campaign } from '@mythic/shared';
import { buildJoinPayload, type HostProfile } from '../engine/join-payload.js';
import { createRateLimiter } from './rate-limit.js';

/**
 * UX-44 / UI-JOIN-01: `GET /api/join`, the data behind the join screen. Deliberately
 * unauthenticated, like the player join link itself: a visitor has no identity yet and this is
 * the only thing they may learn first. The body is `JoinPayload` (strict; see
 * `buildJoinPayload`) and nothing else. It is `no-store` and rate-limited per address.
 */
export function registerJoinRoutes(
  app: FastifyInstance,
  options: {
    state: () => Campaign;
    host: () => Promise<HostProfile | undefined>;
    maxPerMinute?: number;
    now?: () => number;
  },
): void {
  const limiter = createRateLimiter({
    max: options.maxPerMinute ?? 60,
    windowMs: 60_000,
    ...(options.now ? { now: options.now } : {}),
  });
  app.get('/api/join', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!limiter.hit(request.ip)) {
      // MV-270: say when to come back, so join screens behind one shared address back off
      // instead of retrying into the same spent window.
      reply.header(
        'retry-after',
        String(Math.max(1, Math.ceil(limiter.retryAfterMs(request.ip) / 1000))),
      );
      return reply.code(429).send({ error: 'too many requests' });
    }
    return buildJoinPayload(options.state(), await options.host());
  });
}
