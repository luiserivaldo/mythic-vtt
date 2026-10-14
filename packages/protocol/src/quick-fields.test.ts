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

it('preserves v6 golden frames while only accepting the current handshake version', () => {
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
    if (decoded.message.t === 'hello') expect(decoded.message.v).toBe(6);
  }
  for (const frame of fixture.server) {
    const decoded = decodeServerMessage(JSON.stringify(frame));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('invalid v6 server fixture');
    expect(JSON.parse(encodeServerMessage(decoded.message))).toEqual(frame);
  }
  expect(isSupportedVersion(PROTOCOL_VERSION)).toBe(true);
  for (let old = 1; old < PROTOCOL_VERSION; old++) expect(isSupportedVersion(old)).toBe(false);
});
