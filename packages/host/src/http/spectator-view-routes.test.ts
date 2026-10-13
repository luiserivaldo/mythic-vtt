import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerSpectatorViewRoutes } from './spectator-view-routes.js';
import type { AuthResult } from './http-auth.js';

it('lets only the bound host read or choose the spectator view, validates input and applies it live', async () => {
  const app = Fastify();
  let stored: string | null = null;
  const apply = vi.fn((seatId: string | null) => Promise.resolve(seatId !== 'codm'));
  let result: AuthResult = { ok: false, status: 401 };
  registerSpectatorViewRoutes(app, {
    auth: { authenticate: () => Promise.resolve(result) },
    view: {
      get: () => stored,
      set: (seatId) => {
        stored = seatId;
      },
    },
    apply,
  });
  const put = (payload: unknown) =>
    app.inject({ method: 'PUT', url: '/api/spectator-view', payload: payload as object });
  try {
    expect((await app.inject({ method: 'GET', url: '/api/spectator-view' })).statusCode).toBe(401);
    for (const role of ['none', 'player', 'codm'] as const) {
      result = { ok: true, principal: { identityId: 'x', isHost: false, role } };
      expect((await app.inject({ method: 'GET', url: '/api/spectator-view' })).statusCode).toBe(
        403,
      );
      expect((await put({ seatId: 'seat-1' })).statusCode).toBe(403);
    }
    expect(apply).not.toHaveBeenCalled();
    expect(stored).toBeNull();

    result = { ok: true, principal: { identityId: 'host', isHost: true, role: 'host' } };
    const read = await app.inject({ method: 'GET', url: '/api/spectator-view' });
    expect(read.json()).toEqual({ seatId: null });
    expect(read.headers['cache-control']).toBe('no-store');

    for (const bad of [{}, { seatId: 1 }, { seatId: '' }, { seatId: 'a', extra: true }])
      expect((await put(bad)).statusCode).toBe(400);
    expect(apply).not.toHaveBeenCalled();

    // The engine refuses (co-DM / unknown seat): nothing is persisted.
    expect((await put({ seatId: 'codm' })).statusCode).toBe(400);
    expect(stored).toBeNull();

    expect((await put({ seatId: 'seat-1' })).json()).toEqual({ seatId: 'seat-1' });
    expect(stored).toBe('seat-1');
    expect((await put({ seatId: null })).json()).toEqual({ seatId: null });
    expect(stored).toBeNull();
  } finally {
    await app.close();
  }
});
