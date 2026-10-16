import { describe, expect, it } from 'vitest';
import { Ulid } from '@mythic/protocol';
import {
  SPECTATOR_IDENTITY_STORAGE_KEY,
  loadOrCreateIdentity,
  type KeyValueStore,
} from './identity.js';

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('identity', () => {
  it('creates a valid ULID + 32-byte secret once, then reuses it', () => {
    const store = memory();
    let n = 0;
    const a = loadOrCreateIdentity(store, 1_700_000_000_000, () => n++);
    expect(Ulid.safeParse(a.identityId).success).toBe(true);
    expect(a.identitySecret).toMatch(/^[0-9a-f]{64}$/);
    expect(loadOrCreateIdentity(store, 5, () => 99)).toEqual(a);
  });
  it('replaces a corrupt stored value', () => {
    const store = memory();
    store.setItem('mythic.identity.v1', '{bad');
    const a = loadOrCreateIdentity(store, 1, () => 1);
    expect(a.identitySecret).toHaveLength(64);
  });
  it('keeps the spectator identity apart from the visitor identity (MV-270)', () => {
    const store = memory();
    let n = 0;
    const own = loadOrCreateIdentity(store, 1_700_000_000_000, () => n++);
    const watcher = loadOrCreateIdentity(
      store,
      1_700_000_000_001,
      () => n++,
      SPECTATOR_IDENTITY_STORAGE_KEY,
    );
    expect(watcher.identityId).not.toBe(own.identityId);
    expect(loadOrCreateIdentity(store, 9, () => 0)).toEqual(own);
    expect(loadOrCreateIdentity(store, 9, () => 0, SPECTATOR_IDENTITY_STORAGE_KEY)).toEqual(
      watcher,
    );
  });
});
