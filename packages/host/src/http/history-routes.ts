import type { FastifyInstance } from 'fastify';
import {
  HistoryPage,
  HistoryQuery,
  type Audience,
  type Campaign,
  type Entity,
} from '@mythic/shared';
import type { Engine } from '../engine/index.js';
import type { LocalCampaignStore } from '../storage/local-campaign-store.js';
import {
  readHistoryChunk,
  type HistoryChunk,
  type HistoryPosition,
} from '../storage/history-log-reader.js';
import type { HttpAuthenticator } from './http-auth.js';
import { createRateLimiter } from './rate-limit.js';
import { scanHistory } from './history-view.js';

interface Continuation {
  seq: number;
  expires: number;
  checkpoint: Campaign;
  latestEntities: Map<string, Entity>;
  sessions: string[];
  pending: HistoryChunk['entries'];
  next?: HistoryPosition;
}

export function registerHistoryRoutes(
  app: FastifyInstance,
  options: {
    store: Pick<LocalCampaignStore, 'readSessions' | 'folder' | 'flushLogs'>;
    engine: Pick<Engine, 'state' | 'seq' | 'idle'>;
    auth: HttpAuthenticator;
    now?: () => number;
    readChunk?: typeof readHistoryChunk;
  },
): void {
  const now = options.now ?? Date.now;
  const limiter = createRateLimiter({ max: 20, windowMs: 60000, now });
  const global = createRateLimiter({ max: 60, windowMs: 60000, now });
  const cursors = new Map<string, Continuation>();
  let active = false;
  const cursorKey = (identity: string, query: HistoryQuery) =>
    JSON.stringify([identity, query.before, query.seatId, query.entityId, query.limit]);
  app.get('/api/history', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const auth = await options.auth.authenticate(request);
    if (!auth.ok) return reply.code(auth.status).send({ error: 'history access denied' });
    const query = HistoryQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid history query' });
    if (active || !global.hit('history') || !limiter.hit(auth.principal.identityId))
      return reply.code(429).send({ error: 'too many requests' });
    active = true;
    try {
      await options.engine.idle();
      const current = options.engine.state(),
        seq = options.engine.seq();
      for (const [key, value] of cursors)
        if (value.seq !== seq || value.expires <= now()) cursors.delete(key);
      const seat = auth.principal.seatId ? current.seats[auth.principal.seatId] : undefined;
      const audience: Audience = auth.principal.isHost
        ? { kind: 'host' }
        : seat?.identityId === auth.principal.identityId
          ? { kind: 'seat', seatId: seat.id }
          : { kind: 'spectators' };
      let resume: Continuation;
      if (query.data.before !== undefined) {
        const saved = cursors.get(cursorKey(auth.principal.identityId, query.data));
        if (!saved)
          return await reply.code(410).send({ error: 'history cursor expired; refresh history' });
        resume = saved;
      } else {
        const sessions = (await options.store.readSessions(current.id, 1024))
          .reverse()
          .map((session) => session.sessionId);
        resume = {
          seq,
          expires: now() + 60000,
          checkpoint: current,
          latestEntities: new Map(),
          sessions,
          pending: [],
          next: { session: 0 },
        };
      }
      await options.store.flushLogs();
      const chunk = resume.pending.length
        ? { entries: resume.pending, ...(resume.next ? { next: resume.next } : {}) }
        : resume.next
          ? await (options.readChunk ?? readHistoryChunk)(
              options.store.folder(current.id),
              resume.sessions,
              resume.next,
            )
          : { entries: [] };
      // Permissions and state must still match the checkpoint after asynchronous disk reads.
      await options.engine.idle();
      if (options.engine.seq() !== seq)
        return await reply.code(409).send({ error: 'history changed; refresh history' });
      const result = scanHistory(
        current,
        resume.checkpoint,
        chunk.entries,
        audience,
        query.data,
        resume.latestEntities,
        chunk.next !== undefined,
        seq,
      );
      if (result.page.before === undefined && chunk.next)
        result.page.before = query.data.before ?? seq + 1;
      if (result.page.before !== undefined) {
        const key = cursorKey(auth.principal.identityId, {
          ...query.data,
          before: result.page.before,
        });
        const next: Continuation = {
          seq,
          expires: now() + 60000,
          checkpoint: result.checkpoint,
          latestEntities: result.latestEntities,
          sessions: resume.sessions,
          pending: chunk.entries.slice(result.consumed),
          ...(chunk.next ? { next: chunk.next } : {}),
        };
        cursors.delete(key);
        cursors.set(key, next);
        while (cursors.size > 8) {
          const oldest = cursors.keys().next().value;
          if (oldest !== undefined) cursors.delete(oldest);
        }
      }
      return HistoryPage.parse(result.page);
    } catch {
      return await reply.code(503).send({ error: 'history unavailable' });
    } finally {
      active = false;
    }
  });
}
