import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  isSupportedVersion,
} from './index.js';
import { PROTOCOL_VERSION } from './version.js';

it('round-trips the v6 quick-field golden frames and rejects every earlier version', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../fixtures/protocol/v6/quick-fields.json', import.meta.url),
      'utf8',
    ),
  ) as { client: unknown[]; server: unknown[] };
  for (const frame of fixture.client) {
    const decoded = decodeClientMessage(JSON.stringify(frame));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('invalid v6 client fixture');
    expect(JSON.parse(encodeClientMessage(decoded.message))).toEqual(frame);
    if (decoded.message.t === 'hello') expect(decoded.message.v).toBe(PROTOCOL_VERSION);
  }
  for (const frame of fixture.server) {
    const decoded = decodeServerMessage(JSON.stringify(frame));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('invalid v6 server fixture');
    expect(JSON.parse(encodeServerMessage(decoded.message))).toEqual(frame);
  }
  expect(PROTOCOL_VERSION).toBe(6);
  expect(isSupportedVersion(6)).toBe(true);
  for (const old of [1, 2, 3, 4, 5]) expect(isSupportedVersion(old)).toBe(false);
});
