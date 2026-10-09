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
      folder: () => '/test-history',
      flushLogs: () => Promise.resolve(),
    },
    readChunk: () => {
      if (corrupt) throw new Error('private /storage/path');
      return Promise.resolve({ entries: [] });
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

describe('history continuation and shared budgets', () => {
  it('reuses checkpoints, binds cursors to identity/filter and expires them on actions or time', async () => {
    const state = makeCampaign();
    let seq = 3,
      clock = 1000,
      reads = 0;
    let identity = IDS.identity;
    const app = fastify();
    const entries = [3, 2, 1].map((n) => ({
      envelope: {
        id: IDS.action,
        type: 'scene.rename',
        actor: { kind: 'host' as const },
        campaignId: IDS.campaign,
        sessionId: IDS.session,
        seq: n,
        ts: 1000,
        payload: {},
      },
      inversePatches: [
        {
          op: 'replace' as const,
          path: ['scenes', IDS.scene, 'name'],
          value: `Name ${String(n - 1)}`,
        },
      ],
    }));
    registerHistoryRoutes(app, {
      auth: {
        authenticate: () =>
          Promise.resolve({
            ok: true,
            principal: { identityId: identity, isHost: true, role: 'host' },
          }),
      },
      engine: { state: () => state, seq: () => seq, idle: () => Promise.resolve() },
      store: {
        readSessions: () =>
          Promise.resolve([{ schemaVersion: 1, sessionId: IDS.session, startedAt: 0 }]),
        folder: () => '/test',
        flushLogs: () => Promise.resolve(),
      },
      readChunk: () => {
        reads++;
        return Promise.resolve({ entries });
      },
      now: () => clock,
    });
    try {
      const first = await app.inject('/api/history?limit=1');
      expect(first.statusCode).toBe(200);
      expect(first.json<{ before: number }>().before).toBe(3);
      const second = await app.inject('/api/history?limit=1&before=3');
      expect(second.statusCode).toBe(200);
      expect(second.json<{ entries: { seq: number }[] }>().entries[0]?.seq).toBe(2);
      expect(reads).toBe(1);
      identity = IDS.otherIdentity;
      expect((await app.inject('/api/history?limit=1&before=3')).statusCode).toBe(410);
      identity = IDS.identity;
      expect(
        (await app.inject(`/api/history?limit=1&before=3&entityId=${IDS.entity}`)).statusCode,
      ).toBe(410);
      seq++;
      expect((await app.inject('/api/history?limit=1&before=3')).statusCode).toBe(410);
      await app.inject('/api/history?limit=1');
      clock += 60001;
      expect((await app.inject('/api/history?limit=1&before=3')).statusCode).toBe(410);
    } finally {
      await app.close();
    }
  });
  it('continues past a byte-limited empty window without restarting its physical scan', async () => {
    const app = fastify();
    const positions: unknown[] = [];
    registerHistoryRoutes(app, {
      auth: { authenticate: () => Promise.resolve(host) },
      engine: { state: makeCampaign, seq: () => 1, idle: () => Promise.resolve() },
      store: {
        readSessions: () => Promise.resolve([]),
        folder: () => '/test',
        flushLogs: () => Promise.resolve(),
      },
      readChunk: (_folder, _sessions, position) => {
        positions.push(position);
        return Promise.resolve(
          positions.length === 1
            ? { entries: [], next: { session: 0, offset: 123 } }
            : { entries: [] },
        );
      },
    });
    try {
      const first = await app.inject('/api/history');
      expect(first.json()).toEqual({ entries: [], before: 2 });
      const second = await app.inject('/api/history?before=2');
      expect(second.json()).toEqual({ entries: [] });
      expect(positions).toEqual([{ session: 0 }, { session: 0, offset: 123 }]);
    } finally {
      await app.close();
    }
  });
  it('enforces a global limit even when every request uses a new identity', async () => {
    let count = 0,
      reads = 0;
    const app = fastify();
    registerHistoryRoutes(app, {
      auth: {
        authenticate: () =>
          Promise.resolve({
            ok: true,
            principal: {
              identityId: String(count++).padStart(26, '0'),
              isHost: true,
              role: 'host',
            },
          }),
      },
      engine: { state: makeCampaign, seq: () => 0, idle: () => Promise.resolve() },
      store: {
        readSessions: () => Promise.resolve([]),
        folder: () => '/test',
        flushLogs: () => Promise.resolve(),
      },
      readChunk: () => {
        reads++;
        return Promise.resolve({ entries: [] });
      },
      now: () => 1000,
    });
    try {
      for (let index = 0; index < 60; index++)
        expect((await app.inject('/api/history')).statusCode).toBe(200);
      expect((await app.inject('/api/history')).statusCode).toBe(429);
      expect(reads).toBe(60);
    } finally {
      await app.close();
    }
  });
  it('permits only one in-flight disk/replay request', async () => {
    let release: ((value: { entries: [] }) => void) | undefined, started: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<{ entries: [] }>((resolve) => {
      release = resolve;
    });
    const app = fastify();
    registerHistoryRoutes(app, {
      auth: { authenticate: () => Promise.resolve(host) },
      engine: { state: makeCampaign, seq: () => 0, idle: () => Promise.resolve() },
      store: {
        readSessions: () => Promise.resolve([]),
        folder: () => '/test',
        flushLogs: () => Promise.resolve(),
      },
      readChunk: () => {
        started?.();
        return blocked;
      },
      now: () => 1000,
    });
    try {
      const first = app.inject('/api/history');
      await barrier;
      expect((await app.inject('/api/history')).statusCode).toBe(429);
      release?.({ entries: [] });
      expect((await first).statusCode).toBe(200);
    } finally {
      release?.({ entries: [] });
      await app.close();
    }
  });
});
