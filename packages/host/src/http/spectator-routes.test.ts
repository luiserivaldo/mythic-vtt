import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerSpectatorRoutes } from './spectator-routes.js';
import type { AuthResult } from './http-auth.js';

it('requires bound host authentication for rotating/revoking links, marks replies private and limits writes', async () => {
  const app = Fastify();
  const rotate = vi.fn(() => 'x'.repeat(43));
  const revoke = vi.fn();
  const disconnect = vi.fn();
  let result: AuthResult = { ok: false, status: 401 };
  registerSpectatorRoutes(app, {
    auth: { authenticate: () => Promise.resolve(result) },
    links: { rotate, revoke, valid: () => false, close: () => undefined },
    disconnect,
  });
  try {
    for (const method of ['POST', 'DELETE'] as const) {
      expect((await app.inject({ method, url: '/api/spectator-link' })).statusCode).toBe(401);
      for (const role of ['none', 'player', 'codm'] as const) {
        result = { ok: true, principal: { identityId: 'test', isHost: false, role } };
        const response = await app.inject({ method, url: '/api/spectator-link' });
        expect(response.statusCode).toBe(403);
        expect(response.body).not.toContain('x'.repeat(43));
      }
      result = { ok: false, status: 401 };
    }
    expect(rotate).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    result = { ok: true, principal: { identityId: 'host', isHost: true, role: 'host' } };
    const response = await app.inject({ method: 'POST', url: '/api/spectator-link' });
    expect(response.json()).toEqual({ token: 'x'.repeat(43) });
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'DELETE', url: '/api/spectator-link' })).json()).toEqual({
      revoked: true,
    });
    expect(disconnect).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 8; i++)
      expect((await app.inject({ method: 'POST', url: '/api/spectator-link' })).statusCode).toBe(
        200,
      );
    expect((await app.inject({ method: 'POST', url: '/api/spectator-link' })).statusCode).toBe(429);
  } finally {
    await app.close();
  }
});
