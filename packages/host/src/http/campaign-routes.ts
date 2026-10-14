import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import {
  ArchiveError,
  DEFAULT_IMPORT_LIMITS,
  type CampaignStore,
  type ImportLimits,
  type LocalCampaignStore,
} from '../storage/index.js';
import { createRateLimiter } from './rate-limit.js';
import type { HttpAuthenticator } from './http-auth.js';

const CAMPAIGN_ID = /^[0-9A-Za-z_-]{1,64}$/;
const DENIED = { 401: 'unauthorized', 403: 'forbidden', 429: 'too many requests' } as const;

export interface CampaignRouteOptions {
  store: Pick<CampaignStore, 'list' | 'export'> & Pick<LocalCampaignStore, 'import'>;
  auth: HttpAuthenticator;
  importLimits?: Partial<ImportLimits>;
  /** Export/import are heavy: budget per host identity per minute. */
  maxPerMinute?: number;
  now?: () => number;
}

/**
 * D36: host-only campaign export/import over REST. Anything short of the bound host identity is
 * refused, co-DM seats included (a whole-campaign copy exposes every hidden layer, PERM-03).
 */
export function registerCampaignRoutes(app: FastifyInstance, options: CampaignRouteOptions): void {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...options.importLimits };
  const limiter = createRateLimiter({
    max: options.maxPerMinute ?? 10,
    windowMs: 60_000,
    ...(options.now ? { now: options.now } : {}),
  });

  // Stream the zip through untouched; the importer enforces `maxArchiveBytes` while staging.
  app.addContentTypeParser(
    'application/zip',
    { bodyLimit: limits.maxArchiveBytes },
    (_request, payload, done) => {
      done(null, payload);
    },
  );

  async function hostOnly(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const result = await options.auth.authenticate(request);
    let status: 401 | 403 | 429 | undefined = result.ok ? undefined : result.status;
    if (result.ok) {
      if (!result.principal.isHost) status = 403;
      else if (!limiter.hit(result.principal.identityId)) status = 429;
    }
    if (status === undefined) return true;
    await reply.code(status).send({ error: DENIED[status] });
    return false;
  }

  app.get<{ Params: { id: string } }>('/api/campaigns/:id/export', async (request, reply) => {
    if (!(await hostOnly(request, reply))) return reply;
    const { id } = request.params;
    if (!CAMPAIGN_ID.test(id)) return reply.code(400).send({ error: 'invalid campaign id' });
    if (!(await options.store.list()).some((c) => c.id === id)) {
      return reply.code(404).send({ error: 'campaign not found' });
    }
    const zip = await options.store.export(id);
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="campaign-${id}.zip"`)
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(zip);
  });

  app.post('/api/campaigns/import', async (request, reply) => {
    if (!(await hostOnly(request, reply))) return reply;
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > limits.maxArchiveBytes) {
      return reply.code(413).send({ error: 'archive too large' });
    }
    const body = request.body;
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as Readable).pipe !== 'function'
    ) {
      return reply.code(415).send({ error: 'application/zip body required' });
    }
    try {
      const result = await options.store.import(body as Readable, options.importLimits);
      return await reply.code(201).send(result);
    } catch (error) {
      if (error instanceof ArchiveError) {
        const status = { conflict: 409, 'too-large': 413 }[error.code as string] ?? 400;
        // Archive error messages describe the file, not the host, and are safe to return.
        return reply.code(status).send({ error: error.message });
      }
      throw error;
    }
  });
}
