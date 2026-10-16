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

export const IDENTITY_STORAGE_KEY = 'mythic.identity.v1';
/**
 * MV-270: "Join As Spectator" connects with its own identity, never the visitor's own: the host
 * puts an identity back in the seat it holds on connect, so watching with a seat-bound identity
 * would take that seat under the name "Spectator". This one is never seated or named.
 */
export const SPECTATOR_IDENTITY_STORAGE_KEY = 'mythic.spectator-identity.v1';

function isIdentity(v: unknown): v is Identity {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['identityId'] === 'string' && typeof o['identitySecret'] === 'string';
}

/** SES-02: generated on first visit and persisted; the secret travels only in `hello` or an explicit SES-09 backup. */
export function loadOrCreateIdentity(
  store: KeyValueStore,
  nowMs: number,
  randomByte: () => number,
  key: string = IDENTITY_STORAGE_KEY,
): Identity {
  const raw = store.getItem(key);
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
  store.setItem(key, JSON.stringify(identity));
  return identity;
}
