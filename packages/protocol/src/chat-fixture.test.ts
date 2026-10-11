import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decodeServerMessage, encodeServerMessage } from './codec.js';

it('transports chat through ordinary filtered patches without a second message channel', () => {
  const raw = readFileSync(
    new URL('../../../fixtures/protocol/v4/chat-patch.json', import.meta.url),
    'utf8',
  );
  const decoded = decodeServerMessage(raw);
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) throw new Error(decoded.error);
  expect(JSON.parse(encodeServerMessage(decoded.message))).toEqual(JSON.parse(raw));
});
