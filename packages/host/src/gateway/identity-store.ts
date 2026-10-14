export interface StoredIdentity {
  identityId: string;
  /** `scrypt$salt$hash`; the raw secret is never stored. */
  secretHash: string;
  displayName: string;
  avatar?: string;
}

/**
 * Seam for persistence. The in-memory implementation below is for tests and ephemeral hosts; the
 * host uses the SQLite-backed store (`sqlite-identity-store.ts`).
 */
export interface IdentityStore {
  get(identityId: string): Promise<StoredIdentity | undefined>;
  /** Atomically store `candidate` if no identity with that id exists; returns whichever is stored. */
  registerIfAbsent(candidate: StoredIdentity): Promise<StoredIdentity>;
  update(identityId: string, patch: { displayName: string; avatar?: string }): Promise<void>;
  /** D24: the identity bound as host, if any. */
  getHostIdentityId(): Promise<string | undefined>;
  /**
   * D29: atomically make `identityId` the host binding, replacing any previous one. Returns the
   * previously bound identity (undefined if none). Only called after a valid startup token.
   */
  rebindHost(identityId: string): Promise<string | undefined>;
}

export function createMemoryIdentityStore(): IdentityStore {
  const map = new Map<string, StoredIdentity>();
  let hostId: string | undefined;
  return {
    getHostIdentityId: () => Promise.resolve(hostId),
    rebindHost(identityId) {
      const previous = hostId;
      hostId = identityId;
      return Promise.resolve(previous);
    },
    get: (id) => Promise.resolve(map.get(id)),
    registerIfAbsent(candidate) {
      const existing = map.get(candidate.identityId);
      if (existing) return Promise.resolve(existing);
      map.set(candidate.identityId, candidate);
      return Promise.resolve(candidate);
    },
    update(id, patch) {
      const existing = map.get(id);
      if (existing) {
        const next: StoredIdentity = { ...existing, displayName: patch.displayName };
        if (patch.avatar !== undefined) next.avatar = patch.avatar;
        map.set(id, next);
      }
      return Promise.resolve();
    },
  };
}
