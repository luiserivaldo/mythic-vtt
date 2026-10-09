import type { FastifyInstance } from 'fastify';
import { HistoryPage, HistoryQuery, type Audience } from '@mythic/shared';
import type { Engine } from '../engine/index.js';
import type { LocalCampaignStore } from '../storage/local-campaign-store.js';
import type { HttpAuthenticator } from './http-auth.js';
import { createRateLimiter } from './rate-limit.js';
import { historyPage } from './history-view.js';

export function registerHistoryRoutes(
  app: FastifyInstance,
  options: {
    store: Pick<LocalCampaignStore, 'readSessions' | 'readSessionLog'>;
    engine: Pick<Engine, 'state' | 'seq' | 'idle'>;
    auth: HttpAuthenticator;
    now?: () => number;
  },
): void {
  const limiter = createRateLimiter({
    max: 20,
    windowMs: 60000,
    ...(options.now ? { now: options.now } : {}),
  });
  app.get('/api/history', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const auth = await options.auth.authenticate(request);
    if (!auth.ok) return reply.code(auth.status).send({ error: 'history access denied' });
    if (!limiter.hit(auth.principal.identityId))
      return reply.code(429).send({ error: 'too many requests' });
    const query = HistoryQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid history query' });
    await options.engine.idle();
    const current = options.engine.state();
    const seq = options.engine.seq();
    const seat = auth.principal.seatId ? current.seats[auth.principal.seatId] : undefined;
    const audience: Audience = auth.principal.isHost
      ? { kind: 'host' }
      : seat?.identityId === auth.principal.identityId
        ? { kind: 'seat', seatId: seat.id }
        : { kind: 'spectators' };
    try {
      const sessions = await options.store.readSessions(current.id);
      const logs = await Promise.all(
        sessions.map((session) => options.store.readSessionLog(current.id, session.sessionId)),
      );
      return HistoryPage.parse(historyPage(current, seq, logs.flat(), audience, query.data));
    } catch {
      // Do not expose storage paths, malformed payloads or private replay data in errors.
      return reply.code(503).send({ error: 'history unavailable' });
    }
  });
}
