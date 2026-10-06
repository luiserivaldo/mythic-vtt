import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** D24: a fresh random token per host process. Held in memory only; never written to disk. */
export function generateHostToken(): string {
  return randomBytes(24).toString('base64url');
}

export interface HostTokenGate {
  /** True exactly once, for the configured token. Wrong, repeated or unconfigured all give false. */
  consume(presented: string): boolean;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

export function createHostTokenGate(token: string | undefined): HostTokenGate {
  let pending = token === undefined ? undefined : digest(token);
  return {
    consume(presented) {
      // Hash both sides so the comparison is constant-time regardless of length.
      const ok = timingSafeEqual(digest(presented), pending ?? randomBytes(32));
      if (!ok || pending === undefined) return false;
      pending = undefined;
      return true;
    },
  };
}
