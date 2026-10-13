/**
 * The frame loop behind the identity QR scanner (SES-09). Camera plumbing stays in the component;
 * what lives here is the "keep looking until something readable shows up, then stop" behaviour, so
 * it can be tested without a camera.
 */

export type QrScanResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'timeout' | 'aborted' };

export interface QrScanOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Aborting stops the loop before its next frame, without waiting for the timeout. */
  readonly signal?: AbortSignal;
}

/** Reads a frame and resolves with the first QR payload it can see, or `null` for a blank one. */
export type QrCapture = () => Promise<string | null>;

export async function pollQrText(
  capture: QrCapture,
  options: QrScanOptions = {},
): Promise<QrScanResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 150;
  const now = options.now ?? ((): number => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
      }));
  const deadline = now() + timeoutMs;
  for (;;) {
    if (options.signal?.aborted === true) return { ok: false, reason: 'aborted' };
    try {
      const text = await capture();
      if (text !== null && text !== '') return { ok: true, text };
    } catch {
      // A blank or unreadable frame is normal while the camera settles; keep trying.
    }
    // The deadline is checked after the read so a zero timeout still looks once.
    if (now() >= deadline) return { ok: false, reason: 'timeout' };
    await sleep(intervalMs);
  }
}
