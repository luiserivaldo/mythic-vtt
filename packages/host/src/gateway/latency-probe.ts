import { randomUUID } from 'node:crypto';

export const MAX_LATENCY_MS = 30_000;

/** UX-06: only a matching, outstanding host challenge can yield a monotonic RTT sample. */
export function createLatencyProbe(
  now: () => number = () => performance.now(),
  nonce: () => string = randomUUID,
) {
  let pending: { nonce: string; started: number } | undefined;
  return {
    start(): string {
      const value = nonce();
      pending = { nonce: value, started: now() };
      return value;
    },
    complete(payload: string): number | null {
      if (!pending || payload !== pending.nonce) return null;
      const elapsed = now() - pending.started;
      pending = undefined;
      return Number.isFinite(elapsed) && elapsed >= 0
        ? Math.min(MAX_LATENCY_MS, Math.round(elapsed))
        : null;
    },
  };
}
