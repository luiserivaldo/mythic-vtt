import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  isSupportedVersion,
  JoinPayload,
  PROTOCOL_VERSION,
} from './index.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/protocol/v10/join-flow.json', import.meta.url), 'utf8'),
) as { client: unknown[]; server: unknown[]; joinPayload: unknown };

describe('v10 join flow', () => {
  it('round-trips the synthetic v10 frames', () => {
    for (const frame of fixture.client) {
      const decoded = decodeClientMessage(JSON.stringify(frame));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) throw new Error('invalid client fixture');
      expect(JSON.parse(encodeClientMessage(decoded.message))).toEqual(frame);
      if (decoded.message.t === 'hello') expect(decoded.message.v).toBe(10);
    }
    for (const frame of fixture.server)
      expect(decodeServerMessage(JSON.stringify(frame)).ok).toBe(true);
    // UX-38 moved the wire to v11 (initiative scores); v10 frames stay decodable but unsupported.
    expect(PROTOCOL_VERSION).toBe(11);
    expect(isSupportedVersion(10)).toBe(false);
    expect(isSupportedVersion(9)).toBe(false);
  });

  it('accepts only coherent temporary and spectator joins', () => {
    const ok = (frame: unknown) => decodeClientMessage(JSON.stringify(frame)).ok;
    const seatId = '00000000000000000000000002';
    expect(ok({ t: 'join', as: 'temporary', label: 'Bard' })).toBe(true);
    expect(ok({ t: 'join', as: 'spectator' })).toBe(true);
    expect(ok({ t: 'join', as: 'temporary' })).toBe(false);
    expect(ok({ t: 'join', as: 'temporary', label: '   ' })).toBe(false);
    expect(ok({ t: 'join', as: 'temporary', label: 'x'.repeat(81) })).toBe(false);
    expect(ok({ t: 'join', as: 'spectator', label: 'Name' })).toBe(false);
    expect(ok({ t: 'join', label: 'Name' })).toBe(false);
    expect(ok({ t: 'join', as: 'temporary', label: 'Bard', seatId })).toBe(false);
    expect(ok({ t: 'join', as: 'spectator', seatToken: 'x' })).toBe(false);
    expect(ok({ t: 'join', as: 'guest' })).toBe(false);
  });

  it('validates the pre-join payload strictly so nothing else can ride along', () => {
    expect(JoinPayload.parse(fixture.joinPayload).seats).toHaveLength(2);
    const accepts = (path: (string | number)[], value: unknown) => {
      const copy = structuredClone(fixture.joinPayload);
      let node = copy as Record<string | number, unknown>;
      for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
      node[path[path.length - 1] as string | number] = value;
      return JoinPayload.safeParse(copy).success;
    };
    const foreignId = '1'.repeat(26);
    expect(JoinPayload.safeParse(fixture.joinPayload).success).toBe(true);
    expect(accepts(['spectators'], 3)).toBe(false);
    expect(accepts(['host', 'identityId'], foreignId)).toBe(false);
    expect(accepts(['campaign', 'scenes'], {})).toBe(false);
    expect(accepts(['seats', 0, 'identityId'], foreignId)).toBe(false);
    expect(accepts(['seats', 0, 'permissions'], {})).toBe(false);
    expect(accepts(['seats', 0, 'claim'], 'offline')).toBe(false);
    expect(accepts(['seats', 0, 'icon'], { kind: 'image', hash: 'not-a-hash' })).toBe(false);
  });
});
