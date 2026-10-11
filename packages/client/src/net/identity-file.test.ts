import { describe, expect, it } from 'vitest';
import { IDENTITY_STORAGE_KEY, loadOrCreateIdentity, type KeyValueStore } from './identity.js';
import { installIdentityFile, parseIdentityFile, serializeIdentityFile } from './identity-file.js';

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('identity files (SES-09)', () => {
  it('round trips into another store without minting a new identity', () => {
    const original = loadOrCreateIdentity(memory(), 123, () => 7);
    const destination = memory();
    destination.setItem('mythic.host', '1');
    destination.setItem('mythic.profile.v1', '{"displayName":"Previous","spectator":true}');
    installIdentityFile(destination, parseIdentityFile(serializeIdentityFile(original)));
    expect(
      loadOrCreateIdentity(destination, 456, () => {
        throw new Error('must reuse imported identity');
      }),
    ).toEqual(original);
    expect(destination.getItem('mythic.host')).toBe('0');
    expect(destination.getItem('mythic.profile.v1')).toBe('null');
    expect(
      Object.keys(JSON.parse(serializeIdentityFile(original)) as Record<string, unknown>),
    ).toEqual(['identityId', 'identitySecret']);
  });

  it.each([
    '{broken',
    'null',
    '{}',
    '{"identityId":"invalid","identitySecret":"private"}',
    ' '.repeat(4097),
  ])('rejects malformed or oversized content without echoing it', (text) => {
    expect(() => parseIdentityFile(text)).toThrow('This is not a valid Mythic identity file.');
  });

  it('rejects extra fields and empty secrets before touching storage', () => {
    const destination = memory();
    const original = loadOrCreateIdentity(destination, 123, () => 7);
    const before = new Map(destination.data);
    expect(() =>
      parseIdentityFile(JSON.stringify({ ...original, hostToken: 'not-an-identity-field' })),
    ).toThrow();
    expect(() => {
      installIdentityFile(destination, { ...original, identitySecret: '' });
    }).toThrow();
    expect(destination.data).toEqual(before);
  });

  it('rolls back join hints when identity persistence fails', () => {
    const destination = memory();
    const original = loadOrCreateIdentity(destination, 123, () => 7);
    destination.setItem('mythic.host', '1');
    destination.setItem('mythic.profile.v1', '{"displayName":"Previous"}');
    const before = new Map(destination.data);
    let failed = false;
    const store: KeyValueStore = {
      getItem: (key) => destination.getItem(key),
      setItem: (key, value) => {
        if (key === IDENTITY_STORAGE_KEY && !failed) {
          failed = true;
          throw new Error('storage denied');
        }
        destination.setItem(key, value);
      },
    };
    expect(() => {
      installIdentityFile(store, original);
    }).toThrow('The identity could not be saved.');
    expect(destination.data).toEqual(before);
  });
});
