import { describe, expect, it } from 'vitest';
import { pollQrText } from './qr-scan.js';

function clock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  elapsed: () => number;
} {
  let time = 0;
  return {
    now: () => time,
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        time += ms;
        resolve();
      }),
    elapsed: () => time,
  };
}

describe('camera QR polling', () => {
  it('returns the first code it reads without waiting again', async () => {
    const time = clock();
    let calls = 0;
    const result = await pollQrText(
      () => {
        calls++;
        return Promise.resolve('identity payload');
      },
      { now: time.now, sleep: time.sleep },
    );
    expect(result).toEqual({ ok: true, text: 'identity payload' });
    expect(calls).toBe(1);
    expect(time.elapsed()).toBe(0);
  });

  it('keeps looking until the code lines up', async () => {
    const time = clock();
    const empty: (string | null)[] = [null, null, '', 'found'];
    const result = await pollQrText(() => Promise.resolve(empty.shift() ?? null), {
      now: time.now,
      sleep: time.sleep,
      intervalMs: 100,
    });
    expect(result).toEqual({ ok: true, text: 'found' });
    expect(time.elapsed()).toBe(300);
  });

  it('gives up once the timeout has passed', async () => {
    const time = clock();
    let attempts = 0;
    const result = await pollQrText(
      () => {
        attempts++;
        return Promise.resolve(null);
      },
      { now: time.now, sleep: time.sleep, timeoutMs: 1000, intervalMs: 100 },
    );
    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(attempts).toBeGreaterThan(5);
    expect(time.elapsed()).toBeGreaterThanOrEqual(1000);
  });

  it('stops as soon as the reader is cancelled', async () => {
    const time = clock();
    const controller = new AbortController();
    let attempts = 0;
    const result = await pollQrText(
      () => {
        attempts++;
        if (attempts === 3) controller.abort();
        return Promise.resolve(null);
      },
      { now: time.now, sleep: time.sleep, intervalMs: 100, signal: controller.signal },
    );
    expect(result).toEqual({ ok: false, reason: 'aborted' });
    expect(attempts).toBe(3);
  });

  it('reads once even when there is no time left', async () => {
    const time = clock();
    let attempts = 0;
    const result = await pollQrText(
      () => {
        attempts++;
        return Promise.resolve(null);
      },
      { now: time.now, sleep: time.sleep, timeoutMs: 0 },
    );
    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(attempts).toBe(1);
  });

  it('keeps polling when the camera throws', async () => {
    const time = clock();
    let attempts = 0;
    const result = await pollQrText(
      () => {
        attempts++;
        if (attempts < 3) return Promise.reject(new Error('no frame yet'));
        return Promise.resolve('payload');
      },
      { now: time.now, sleep: time.sleep, intervalMs: 50 },
    );
    expect(result).toEqual({ ok: true, text: 'payload' });
    expect(attempts).toBe(3);
  });
});
