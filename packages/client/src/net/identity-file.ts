import { Hello } from '@mythic/protocol';
import { IDENTITY_STORAGE_KEY, type Identity, type KeyValueStore } from './identity.js';

export const IDENTITY_FILE_MAX_BYTES = 4096;
const FileIdentity = Hello.pick({ identityId: true, identitySecret: true });
const INVALID_FILE = 'This is not a valid Mythic identity file.';

export function parseIdentityFile(text: string): Identity {
  try {
    if (new TextEncoder().encode(text).length > IDENTITY_FILE_MAX_BYTES) throw new Error();
    const parsed: unknown = JSON.parse(text);
    const result = FileIdentity.safeParse(parsed);
    if (!result.success) throw new Error();
    return result.data;
  } catch {
    // SES-09: never include imported content or schema diagnostics containing the secret.
    throw new Error(INVALID_FILE);
  }
}

export function serializeIdentityFile(identity: Identity): string {
  return JSON.stringify(parseIdentityFile(JSON.stringify(identity)), null, 2);
}

/** Keep local join hints from the previous identity out of the next connection. */
export function installIdentityFile(store: KeyValueStore, identity: Identity): void {
  const serialized = serializeIdentityFile(identity);
  const keys = ['mythic.host', 'mythic.profile.v1', IDENTITY_STORAGE_KEY];
  const previous = keys.map((key) => store.getItem(key));
  try {
    store.setItem('mythic.host', '0');
    store.setItem('mythic.profile.v1', 'null');
    store.setItem(IDENTITY_STORAGE_KEY, serialized);
  } catch {
    for (const [index, key] of keys.entries()) {
      try {
        store.setItem(key, previous[index] ?? 'null');
      } catch {
        // Storage may be unavailable; leave the running connection untouched.
      }
    }
    throw new Error('The identity could not be saved. Check browser storage and try again.');
  }
}
