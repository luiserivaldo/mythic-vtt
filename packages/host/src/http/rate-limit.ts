/** Simple fixed-window in-memory limiter: enough for a LAN host, no dependency (D36). */
export interface RateLimiter {
  /** Counts one hit for `key`; false once the window's budget is spent. */
  hit(key: string): boolean;
  /** True if `key` has already spent its budget (does not count a hit). */
  exhausted(key: string): boolean;
}

export function createRateLimiter(options: {
  max: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, { start: number; count: number }>();
  const current = (key: string): { start: number; count: number } => {
    const t = now();
    // Opportunistic sweep so a long-lived host does not accumulate stale keys.
    if (windows.size > 1024) {
      for (const [k, w] of windows) if (t - w.start >= options.windowMs) windows.delete(k);
    }
    const existing = windows.get(key);
    if (existing && t - existing.start < options.windowMs) return existing;
    const fresh = { start: t, count: 0 };
    windows.set(key, fresh);
    return fresh;
  };
  return {
    hit(key) {
      const w = current(key);
      w.count += 1;
      return w.count <= options.max;
    },
    exhausted: (key) => current(key).count >= options.max,
  };
}
