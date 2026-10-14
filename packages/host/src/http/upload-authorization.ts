import type { FastifyRequest } from 'fastify';
import { createRateLimiter } from './rate-limit.js';
import type { HttpAuthenticator } from './http-auth.js';

/** `status` distinguishes unauthenticated (401), unauthorised (403) and throttled (429). */
export type UploadDecision =
  { ok: true; identityId: string; seatId?: string } | { ok: false; status: 401 | 403 | 429 };

export interface UploadAuthorizer {
  authorize(request: FastifyRequest): Promise<UploadDecision>;
}

export const denyAssetUploads: UploadAuthorizer = {
  authorize: () => Promise.resolve({ ok: false, status: 401 }),
};

/** D23/D36: map-layer and prop content is host/admin territory, so only the host and co-DMs upload. */
export function createSeatUploadAuthorizer(
  auth: HttpAuthenticator,
  options: { maxPerMinute?: number; now?: () => number } = {},
): UploadAuthorizer {
  const limiter = createRateLimiter({
    max: options.maxPerMinute ?? 60,
    windowMs: 60_000,
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    async authorize(request) {
      const result = await auth.authenticate(request);
      if (!result.ok) return result;
      const { principal } = result;
      if (principal.role !== 'host' && principal.role !== 'codm') return { ok: false, status: 403 };
      if (!limiter.hit(principal.identityId)) return { ok: false, status: 429 };
      return {
        ok: true,
        identityId: principal.identityId,
        ...(principal.seatId ? { seatId: principal.seatId } : {}),
      };
    },
  };
}
