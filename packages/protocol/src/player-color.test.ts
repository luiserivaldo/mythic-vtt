import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  isSupportedVersion,
} from './index.js';
import { Hello, PlayerColor, RulerPreview } from './messages.js';
import { PROTOCOL_VERSION } from './version.js';

it('allows bounded hex colours and rejects invalid profile/preview colours at the wire boundary', () => {
  for (const color of ['#123abc', '#ABCDEF'])
    expect(PlayerColor.safeParse(color).success).toBe(true);
  for (const color of ['red', '#abc', '#1234567', 'url(secret)', 123])
    expect(PlayerColor.safeParse(color).success).toBe(false);
  const hello = {
    t: 'hello',
    v: PROTOCOL_VERSION,
    identityId: '0'.repeat(26),
    identitySecret: 'fixture',
    displayName: 'Guest',
  };
  expect(Hello.safeParse(hello).success).toBe(true);
  expect(Hello.safeParse({ ...hello, color: '#123456' }).success).toBe(true);
  expect(Hello.safeParse({ ...hello, color: 'bad' }).success).toBe(false);
  const preview = {
    t: 'ephemeral',
    channel: 'ruler.preview',
    data: { sceneId: '0'.repeat(26), points: [], phase: 'cancelled', color: 'bad' },
  };
  expect(RulerPreview.safeParse(preview).success).toBe(false);
});

it('still decodes the v5 join-profile golden frames, though v5 is no longer a supported version', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../fixtures/protocol/v5/join-profile.json', import.meta.url),
      'utf8',
    ),
  ) as { client: unknown[]; server: unknown[] };
  for (const frame of fixture.client) {
    const decoded = decodeClientMessage(JSON.stringify(frame));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('invalid v5 client fixture');
    expect(JSON.parse(encodeClientMessage(decoded.message))).toEqual(frame);
    if (decoded.message.t === 'hello') expect(isSupportedVersion(decoded.message.v)).toBe(false);
  }
  for (const frame of fixture.server) {
    const decoded = decodeServerMessage(JSON.stringify(frame));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('invalid v5 server fixture');
    expect(JSON.parse(encodeServerMessage(decoded.message))).toEqual(frame);
  }
  expect(isSupportedVersion(4)).toBe(false);
  expect(isSupportedVersion(5)).toBe(false);
});
