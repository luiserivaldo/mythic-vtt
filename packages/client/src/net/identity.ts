import { randomSecret, ulid } from './ulid.js';

export interface Identity {
  identityId: string;
  identitySecret: string;
}

/** The slice of Storage we need, so tests and a future IndexedDB store (M1-11) can stand in. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'mythic.identity.v1';

function isIdentity(v: unknown): v is Identity {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['identityId'] === 'string' && typeof o['identitySecret'] === 'string';
}

/** SES-02: generated on first visit and persisted; the secret never leaves except in `hello`. */
export function loadOrCreateIdentity(
  store: KeyValueStore,
  nowMs: number,
  randomByte: () => number,
): Identity {
  const raw = store.getItem(KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isIdentity(parsed)) return parsed;
    } catch {
      // Corrupt entry: fall through and mint a new identity.
    }
  }
  const identity = {
    identityId: ulid(nowMs, randomByte),
    identitySecret: randomSecret(32, randomByte),
  };
  store.setItem(KEY, JSON.stringify(identity));
  return identity;
}
