import { describe, expect, it } from 'vitest';
import { loadOrCreateIdentity, type KeyValueStore } from './identity.js';
import { serializeIdentityFile } from './identity-file.js';
import {
  IDENTITY_QR_ERROR,
  encodeIdentityQr,
  identityQrPayload,
  parseIdentityQr,
} from './identity-qr.js';

function memory(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('identity QR codes (SES-09)', () => {
  it('carries exactly the identity file payload', () => {
    const identity = loadOrCreateIdentity(memory(), 123, () => 7);
    expect(identityQrPayload(identity)).toBe(serializeIdentityFile(identity));
    // A real identity is 136 bytes of JSON: version 7 at level L.
    expect(encodeIdentityQr(identity)).toMatchObject({ version: 7, size: 45 });
  });

  it('accepts the payload back, and nothing else', () => {
    const identity = { identityId: '01J9Z6M4Q0AAAAAAAAAAAAAAAA', identitySecret: 'b'.repeat(64) };
    expect(parseIdentityQr(identityQrPayload(identity))).toEqual(identity);
    for (const text of ['', '{broken', 'null', '{"identityId":"x","identitySecret":"y"}']) {
      expect(() => parseIdentityQr(text)).toThrow(IDENTITY_QR_ERROR);
    }
    expect(() => parseIdentityQr(`MYTHIC ${identity.identitySecret}`)).toThrow(IDENTITY_QR_ERROR);
  });

  it('never echoes what it could not read', () => {
    const secret = 'f'.repeat(64);
    try {
      parseIdentityQr(`{"identitySecret":"${secret}"`);
      throw new Error('expected a rejection');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).toBe(IDENTITY_QR_ERROR);
      expect(message).not.toContain(secret);
    }
  });

  it('refuses an identity that would not fit, without falling through to the file message', () => {
    const identity = { identityId: '01J9Z6M4Q0AAAAAAAAAAAAAAAA', identitySecret: 'c'.repeat(400) };
    expect(() => encodeIdentityQr(identity)).toThrow(/too large/i);
  });

  it('round trips an identity with a non-ASCII secret', () => {
    const identity = {
      identityId: '01J9Z6M4Q0AAAAAAAAAAAAAAAA',
      identitySecret: 'ünïcøde-🔑'.repeat(4),
    };
    const code = encodeIdentityQr(identity);
    expect(code.version).toBeGreaterThanOrEqual(1);
    expect(parseIdentityQr(identityQrPayload(identity))).toEqual(identity);
  });
});
