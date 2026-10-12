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

it('round-trips the v6 quick-field golden frames without accepting an outdated peer version', () => {
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
    if (decoded.message.t === 'hello') expect(isSupportedVersion(decoded.message.v)).toBe(false);
  }
  for (const frame of fixture.server) {
    const decoded = decodeServerMessage(JSON.stringify(frame));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('invalid v6 server fixture');
    expect(JSON.parse(encodeServerMessage(decoded.message))).toEqual(frame);
  }
  expect(PROTOCOL_VERSION).toBe(7);
  expect(isSupportedVersion(PROTOCOL_VERSION)).toBe(true);
  for (const old of [1, 2, 3, 4, 5, 6]) expect(isSupportedVersion(old)).toBe(false);
});
