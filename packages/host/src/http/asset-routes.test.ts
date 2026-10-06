import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalAssetStore } from '../storage/index.js';
import { registerAssetRoutes } from './asset-routes.js';
import type { UploadAuthorizer } from './upload-authorization.js';

interface UploadResponse {
  image: { hash: string; mime: string; size: number; width: number; height: number };
  thumbnail: { hash: string; mime: string; size: number; width: number; height: number };
  deduplicated: boolean;
}

describe('asset HTTP routes', () => {
  let app: FastifyInstance;
  let root: string;
  let store: LocalAssetStore;
  let authorized = true;

  const authorizer: UploadAuthorizer = {
    authorize: () =>
      Promise.resolve(
        authorized
          ? { ok: true, identityId: 'identity-1', seatId: 'seat-1' }
          : { ok: false, status: 401 },
      ),
  };

  beforeEach(async () => {
    authorized = true;
    root = await mkdtemp(join(tmpdir(), 'mythic-assets-'));
    store = new LocalAssetStore(root);
    app = Fastify();
    registerAssetRoutes(app, {
      assetStore: store,
      uploadAuthorizer: authorizer,
      maxUploadBytes: 1024 * 1024,
    });
  });

  afterEach(async () => {
    await app.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  async function sourceImage(): Promise<Buffer> {
    return sharp({
      create: { width: 640, height: 480, channels: 3, background: '#5b21b6' },
    })
      .png()
      .toBuffer();
  }

  it('requires an authenticated seat before accepting an upload', async () => {
    authorized = false;
    const response = await app.inject({
      method: 'POST',
      url: '/assets/images',
      headers: { 'content-type': 'image/png' },
      payload: await sourceImage(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('validates bytes, writes WebP derivatives, deduplicates, and serves by hash', async () => {
    const payload = await sourceImage();
    const first = await app.inject({
      method: 'POST',
      url: '/assets/images',
      // Deliberately wrong: decoded bytes, not this client claim, determine the accepted type.
      headers: { 'content-type': 'image/jpeg' },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const uploaded = JSON.parse(first.body) as UploadResponse;
    expect(uploaded).toMatchObject({
      image: { mime: 'image/webp', width: 640, height: 480 },
      thumbnail: { mime: 'image/webp', width: 320, height: 240 },
      deduplicated: false,
    });
    expect(uploaded.image.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(uploaded.thumbnail.hash).toMatch(/^[0-9a-f]{64}$/);

    const second = await app.inject({
      method: 'POST',
      url: '/assets/images',
      headers: { 'content-type': 'application/octet-stream' },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body)).toEqual({ ...uploaded, deduplicated: true });

    const delivered = await app.inject({
      method: 'GET',
      url: `/assets/${uploaded.image.hash}`,
    });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.headers['content-type']).toBe('image/webp');
    expect(delivered.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(delivered.headers.etag).toBe(`"${uploaded.image.hash}"`);
    expect(delivered.rawPayload.byteLength).toBe(uploaded.image.size);
    expect((await sharp(delivered.rawPayload).metadata()).format).toBe('webp');
  });

  it('rejects invalid content even when its declared MIME is accepted', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/assets/images',
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from('not an image'),
    });
    expect(response.statusCode).toBe(415);
  });

  it('rejects a decodable image type outside the allowlist', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    const response = await app.inject({
      method: 'POST',
      url: '/assets/images',
      headers: { 'content-type': 'application/octet-stream' },
      payload: svg,
    });
    expect(response.statusCode).toBe(415);
  });

  it('enforces the configured byte limit and rejects unknown hashes', async () => {
    const limited = Fastify();
    registerAssetRoutes(limited, {
      assetStore: store,
      uploadAuthorizer: authorizer,
      maxUploadBytes: 8,
    });
    const tooLarge = await limited.inject({
      method: 'POST',
      url: '/assets/images',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(9),
    });
    expect(tooLarge.statusCode).toBe(413);
    await limited.close();

    expect((await app.inject({ method: 'GET', url: '/assets/not-a-hash' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/assets/${'0'.repeat(64)}` })).statusCode).toBe(
      404,
    );
  });
});
