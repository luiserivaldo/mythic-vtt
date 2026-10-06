export interface StoredIdentity {
  identityId: string;
  /** `scrypt$salt$hash`; the raw secret is never stored (TECHNICAL.md §18). */
  secretHash: string;
  displayName: string;
  avatar?: string;
}

/**
 * Seam for persistence. M0-07/M0-10 will back this with the CampaignStore; until then the
 * in-memory implementation below is used.
 */
export interface IdentityStore {
  get(identityId: string): Promise<StoredIdentity | undefined>;
  /** Atomically store `candidate` if no identity with that id exists; returns whichever is stored. */
  registerIfAbsent(candidate: StoredIdentity): Promise<StoredIdentity>;
  update(identityId: string, patch: { displayName: string; avatar?: string }): Promise<void>;
  /** D24: the identity bound as host, if any. */
  getHostIdentityId(): Promise<string | undefined>;
  /** Atomically bind `identityId` as host if none is bound; returns the bound host identity. */
  bindHostIfAbsent(identityId: string): Promise<string>;
}

export function createMemoryIdentityStore(): IdentityStore {
  const map = new Map<string, StoredIdentity>();
  let hostId: string | undefined;
  return {
    getHostIdentityId: () => Promise.resolve(hostId),
    bindHostIfAbsent(identityId) {
      hostId ??= identityId;
      return Promise.resolve(hostId);
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
