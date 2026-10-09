import { fastify } from 'fastify';
import { describe, expect, it } from 'vitest';
import { makeCampaign, IDS } from '../../../shared/src/actions/testing.js';
import { registerHistoryRoutes } from './history-routes.js';
import type { AuthResult } from './http-auth.js';

const host: AuthResult = {
  ok: true,
  principal: { identityId: IDS.identity, isHost: true, role: 'host' },
};
async function appWith(auth: AuthResult = host, corrupt = false) {
  const app = fastify();
  registerHistoryRoutes(app, {
    auth: { authenticate: () => Promise.resolve(auth) },
    engine: { state: makeCampaign, seq: () => 0, idle: () => Promise.resolve() },
    store: {
      readSessions: () =>
        Promise.resolve([{ schemaVersion: 1, sessionId: IDS.session, startedAt: 0 }]),
      readSessionLog: () => {
        if (corrupt) throw new Error('private /storage/path');
        return Promise.resolve([]);
      },
    },
    now: () => 1000,
  });
  return app;
}

describe('history HTTP boundary', () => {
  it('rejects unauthenticated access and malformed/spoofed queries', async () => {
    const denied = await appWith({ ok: false, status: 401 });
    try {
      expect((await denied.inject('/api/history')).statusCode).toBe(401);
    } finally {
      await denied.close();
    }
    const app = await appWith();
    try {
      for (const query of [
        'limit=101',
        'limit=0',
        'limit=NaN',
        'before=-1',
        'seatId=bad',
        'entityId=bad',
        'isHost=true',
      ])
        expect((await app.inject(`/api/history?${query}`)).statusCode).toBe(400);
      const reply = await app.inject('/api/history?limit=1');
      expect(reply.statusCode).toBe(200);
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(reply.json()).toEqual({ entries: [] });
    } finally {
      await app.close();
    }
  });
  it('bounds reads per identity and returns neutral storage errors', async () => {
    const app = await appWith();
    try {
      for (let index = 0; index < 20; index++)
        expect((await app.inject('/api/history')).statusCode).toBe(200);
      expect((await app.inject('/api/history')).statusCode).toBe(429);
    } finally {
      await app.close();
    }
    const corrupt = await appWith(host, true);
    try {
      const reply = await corrupt.inject('/api/history');
      expect(reply.statusCode).toBe(503);
      expect(reply.body).not.toContain('private');
    } finally {
      await corrupt.close();
    }
  });
});
