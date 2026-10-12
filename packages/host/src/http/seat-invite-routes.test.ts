import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixtureCampaign, T } from '../engine/testing.js';
import { createSeatInvites, type SeatInvites } from '../gateway/seat-invites.js';
import type { AuthResult, Principal } from './http-auth.js';
import { registerSeatInviteRoutes } from './seat-invite-routes.js';

let dir: string;
let app: FastifyInstance;
let invites: SeatInvites;
let result: AuthResult;
let state: ReturnType<typeof fixtureCampaign>;
let claimSeat: ReturnType<typeof vi.fn<(identityId: string, seatId: string) => Promise<boolean>>>;
const logs: string[] = [];

const principal = (over: Partial<Principal>): AuthResult => ({
  ok: true,
  principal: { identityId: T.bob, isHost: false, role: 'none', ...over },
});
const HOST = principal({ identityId: T.host, isHost: true, role: 'host' });
const redeem = (seatId: string, token: unknown) =>
  app.inject({ method: 'POST', url: '/api/seat-invites/redeem', payload: { seatId, token } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mythic-seat-routes-'));
  invites = createSeatInvites(join(dir, 'index.sqlite'), T.campaign);
  claimSeat = vi.fn(() => Promise.resolve(true));
  state = fixtureCampaign();
  result = { ok: false, status: 401 };
  logs.length = 0;
  app = Fastify({
    logger: { level: 'trace', stream: { write: (line: string) => logs.push(line) } },
  });
  registerSeatInviteRoutes(app, {
    auth: { authenticate: () => Promise.resolve(result) },
    invites,
    state: () => state,
    claimSeat,
  });
});
afterEach(async () => {
  await app.close();
  invites.close();
  rmSync(dir, { recursive: true, force: true });
});

it('only the bound host may issue, list or revoke; everyone else is denied without side effects', async () => {
  const calls = [
    { method: 'POST', url: `/api/seat-invites/${T.seatB}` },
    { method: 'DELETE', url: `/api/seat-invites/${T.seatB}` },
    { method: 'GET', url: '/api/seat-invites' },
  ] as const;
  for (const call of calls) expect((await app.inject(call)).statusCode).toBe(401);
  for (const role of ['none', 'player', 'codm'] as const) {
    result = principal({ role });
    for (const call of calls) expect((await app.inject(call)).statusCode).toBe(403);
  }
  result = { ok: false, status: 403 }; // cross-origin
  for (const call of calls) expect((await app.inject(call)).statusCode).toBe(403);
  expect(invites.seatIds()).toEqual([]);
});

it('issues, lists without secrets, regenerates and revokes; replies are private', async () => {
  result = HOST;
  const first = await app.inject({ method: 'POST', url: `/api/seat-invites/${T.seatB}` });
  expect(first.headers['cache-control']).toBe('no-store');
  const { seatId, token } = first.json<{ seatId: string; token: string }>();
  expect(seatId).toBe(T.seatB);
  const listed = await app.inject({ method: 'GET', url: '/api/seat-invites' });
  expect(listed.json()).toEqual({ seatIds: [T.seatB] });
  expect(listed.body).not.toContain(token);

  const second = await app.inject({ method: 'POST', url: `/api/seat-invites/${T.seatB}` });
  const next = second.json<{ token: string }>().token;
  expect(next).not.toBe(token);
  expect(invites.valid(T.seatB, token)).toBe(false);
  expect(invites.valid(T.seatB, next)).toBe(true);

  expect(
    (await app.inject({ method: 'DELETE', url: `/api/seat-invites/${T.seatB}` })).json(),
  ).toEqual({
    revoked: true,
  });
  expect(invites.valid(T.seatB, next)).toBe(false);
  // Unknown or malformed seat ids never create credentials.
  for (const id of [tid26(), 'nope'])
    expect((await app.inject({ method: 'POST', url: `/api/seat-invites/${id}` })).statusCode).toBe(
      404,
    );
  expect(invites.seatIds()).toEqual([]);
});

const tid26 = () => 'Z'.repeat(26);

it('redeem seats the caller, is immediate on revoke and regenerate, and gives one generic failure', async () => {
  const token = invites.rotate(T.seatB);
  result = principal({ identityId: T.bob });
  const ok = await redeem(T.seatB, token);
  expect(ok.statusCode).toBe(200);
  expect(ok.json()).toEqual({ seatId: T.seatB });
  expect(ok.headers['cache-control']).toBe('no-store');
  expect(claimSeat).toHaveBeenCalledWith(T.bob, T.seatB);

  const next = invites.rotate(T.seatB);
  const bodies = new Set<string>();
  for (const [seatId, bad] of [
    [T.seatB, token], // regenerated away
    [T.seatA, next], // another seat
    [T.seatB, 'x'.repeat(43)],
    [T.seatB, 'short'],
    [T.seatB, 42],
    [tid26(), next], // unknown seat
  ] as const) {
    const response = await redeem(seatId, bad);
    expect(response.statusCode).toBe(404);
    bodies.add(response.body);
  }
  expect(bodies.size).toBe(1);
  invites.revoke(T.seatB);
  expect((await redeem(T.seatB, next)).statusCode).toBe(404);
  expect(claimSeat).toHaveBeenCalledTimes(1);
});

it('redeem rejects the host and unauthenticated callers, reports a taken seat and throttles guessing', async () => {
  const token = invites.rotate(T.seatB);
  expect((await redeem(T.seatB, token)).statusCode).toBe(401);
  result = HOST;
  expect((await redeem(T.seatB, token)).statusCode).toBe(403);
  expect(claimSeat).not.toHaveBeenCalled();

  result = principal({ identityId: T.carol });
  claimSeat.mockResolvedValueOnce(false);
  expect((await redeem(T.seatB, token)).statusCode).toBe(409);

  for (let i = 0; i < 10; i++) expect((await redeem(T.seatB, 'bad')).statusCode).toBe(404);
  // Even the right token is refused once the caller has spent its guess budget.
  expect((await redeem(T.seatB, token)).statusCode).toBe(429);
});

it('never writes the token or its hash to logs or error bodies', async () => {
  result = HOST;
  const issued = await app.inject({ method: 'POST', url: `/api/seat-invites/${T.seatB}` });
  const { token } = issued.json<{ token: string }>();
  result = principal({ identityId: T.bob });
  const bad = await redeem(T.seatB, `${token.slice(0, 42)}A`);
  expect(bad.body).not.toContain(token);
  await redeem(T.seatB, token);
  expect(logs.join('\n')).not.toContain(token);
});

it('makes an existing invite unavailable after its seat is archived', async () => {
  const token = invites.rotate(T.seatB);
  const seat = state.seats[T.seatB];
  if (!seat) throw new Error('missing seat');
  seat.archived = true;
  result = principal({ identityId: T.bob });
  const response = await redeem(T.seatB, token);
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'invite unavailable' });
  expect(claimSeat).not.toHaveBeenCalled();
  result = HOST;
  expect((await app.inject({ method: 'GET', url: '/api/seat-invites' })).json()).toEqual({
    seatIds: [],
  });
  expect(
    (await app.inject({ method: 'POST', url: `/api/seat-invites/${T.seatB}` })).statusCode,
  ).toBe(404);
});
