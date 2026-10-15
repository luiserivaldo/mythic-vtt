import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { JoinPayload } from '@mythic/protocol';
import { SECRETS, fixtureCampaign } from '../engine/testing.js';
import { registerJoinRoutes } from './join-routes.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function build(maxPerMinute?: number) {
  app = Fastify({ logger: false });
  registerJoinRoutes(app, {
    state: () => fixtureCampaign(),
    host: () => Promise.resolve({ name: 'Dungeon Master' }),
    ...(maxPerMinute !== undefined ? { maxPerMinute } : {}),
  });
  return app;
}

describe('GET /api/join', () => {
  it('serves the strict join payload to an anonymous visitor, uncached', async () => {
    const response = await build().inject({ method: 'GET', url: '/api/join' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const payload = JoinPayload.parse(response.json());
    expect(payload.host.name).toBe('Dungeon Master');
    expect(payload.seats).toHaveLength(3);
    for (const secret of SECRETS) expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain('identityId');
  });

  it('is read-only', async () => {
    const response = await build().inject({ method: 'POST', url: '/api/join', payload: {} });
    expect(response.statusCode).toBe(404);
  });

  it('rate-limits an address', async () => {
    const server = build(2);
    expect((await server.inject({ method: 'GET', url: '/api/join' })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/api/join' })).statusCode).toBe(200);
    const limited = await server.inject({ method: 'GET', url: '/api/join' });
    expect(limited.statusCode).toBe(429);
    expect(limited.body).not.toContain('seats');
  });
});
