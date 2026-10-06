import type { FastifyInstance } from 'fastify';
import { InvalidImageError, processImage } from '../assets/index.js';
import { StorageDataError, type AssetStore } from '../storage/index.js';
import type { UploadAuthorizer } from './upload-authorization.js';

const UPLOAD_CONTENT_TYPES = ['application/octet-stream', 'image/jpeg', 'image/png', 'image/webp'];
const SHA256 = /^[0-9a-f]{64}$/;

export interface AssetRouteOptions {
  assetStore: AssetStore;
  uploadAuthorizer: UploadAuthorizer;
  maxUploadBytes: number;
}

export function registerAssetRoutes(app: FastifyInstance, options: AssetRouteOptions): void {
  app.addContentTypeParser(
    UPLOAD_CONTENT_TYPES,
    { parseAs: 'buffer', bodyLimit: options.maxUploadBytes },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.post('/assets/images', async (request, reply) => {
    const seat = await options.uploadAuthorizer.authorize(request);
    if (!seat) return reply.code(401).send({ error: 'authenticated seat required' });
    if (!Buffer.isBuffer(request.body) || request.body.byteLength === 0) {
      return reply.code(400).send({ error: 'image body required' });
    }
    try {
      const result = await processImage(request.body, options.assetStore);
      return await reply.code(result.deduplicated ? 200 : 201).send(result);
    } catch (error) {
      if (error instanceof InvalidImageError) {
        return reply.code(415).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get<{ Params: { hash: string } }>('/assets/:hash', async (request, reply) => {
    const { hash } = request.params;
    if (!SHA256.test(hash)) return reply.code(400).send({ error: 'invalid asset hash' });
    try {
      const data = await options.assetStore.get(hash);
      return await reply
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('ETag', `"${hash}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .type('image/webp')
        .send(data);
    } catch (error) {
      if (error instanceof StorageDataError && error.code === 'not-found') {
        return reply.code(404).send({ error: 'asset not found' });
      }
      throw error;
    }
  });
}
