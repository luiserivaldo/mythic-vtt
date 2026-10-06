import { describe, expect, it } from 'vitest';
import { createHttpUploader, UploadError, uploadFailureMessage } from './image-upload.js';

const hash = 'a'.repeat(64);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createHttpUploader', () => {
  it('posts the bytes to /assets/images and returns hash and size', async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const upload = createHttpUploader('http://host/', (url, init) => {
      seen = { url: typeof url === 'string' ? url : '', init };
      return Promise.resolve(
        json(201, {
          image: { hash, mime: 'image/webp', size: 5, width: 1400, height: 700 },
          thumbnail: { hash: 'b'.repeat(64), width: 10, height: 5 },
          deduplicated: false,
        }),
      );
    });
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    await expect(upload(blob)).resolves.toEqual({
      hash,
      width: 1400,
      height: 700,
    });
    expect(seen?.url).toBe('http://host/assets/images');
    expect(seen?.init?.method).toBe('POST');
    expect(seen?.init?.body).toBe(blob);
  });

  it('maps the denied-upload and bad-image statuses to readable errors', async () => {
    const denied = createHttpUploader('', () => Promise.resolve(json(401, { error: 'x' })));
    const err = await denied(new Blob([])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(uploadFailureMessage(err as UploadError)).toMatch(/not accepting uploads/);
    const bad = createHttpUploader('', () => Promise.resolve(json(415, { error: 'x' })));
    const err2 = (await bad(new Blob([])).catch((e: unknown) => e)) as UploadError;
    expect(uploadFailureMessage(err2)).toMatch(/not a supported image/);
  });

  it('rejects malformed success bodies and network failures', async () => {
    const odd = createHttpUploader('', () => Promise.resolve(json(201, { nope: true })));
    await expect(odd(new Blob([]))).rejects.toBeInstanceOf(UploadError);
    const down = createHttpUploader('', () => Promise.reject(new TypeError('offline')));
    await expect(down(new Blob([]))).rejects.toMatchObject({ status: null });
  });
});
