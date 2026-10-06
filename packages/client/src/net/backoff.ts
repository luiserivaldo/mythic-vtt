export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  factor: number;
  /** 0 = deterministic, 1 = full jitter (delay uniformly in [0, cap]). Spreads reconnect storms. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 500,
  maxMs: 15_000,
  factor: 2,
  jitter: 0.5,
};

/** Delay before reconnect attempt number `attempt` (0-based). `random` is injected for tests. */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const cap = Math.min(options.maxMs, options.baseMs * options.factor ** Math.max(0, attempt));
  const fixed = cap * (1 - options.jitter);
  return Math.round(fixed + cap * options.jitter * random());
}
