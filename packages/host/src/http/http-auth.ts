import type { FastifyRequest } from 'fastify';
import type { Campaign } from '@mythic/shared';
import { hashSecret, verifySecret, type IdentityStore } from '../gateway/index.js';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';

/**
 * D36: HTTP requests authenticate with the same Identity as the WebSocket `hello` (SES-02):
 * `Authorization: Mythic <identityId>.<secret>`. The secret is only ever in that header (never a
 * URL or query string) and is never logged or echoed.
 */
const CREDENTIAL = /^Mythic ([0-9A-HJKMNP-TV-Z]{26})\.([0-9A-Za-z_-]{1,256})$/;

export interface Credential {
  identityId: string;
  secret: string;
}

export function parseCredential(header: unknown): Credential | null {
  if (typeof header !== 'string') return null;
  const match = CREDENTIAL.exec(header);
  if (!match?.[1] || !match[2]) return null;
  return { identityId: match[1], secret: match[2] };
}

export type HttpRole = 'host' | 'codm' | 'player' | 'none';

/** Who is calling: derived server-side from the identity bindings, never from request content. */
export interface Principal {
  identityId: string;
  isHost: boolean;
  seatId?: string;
  /** `none`: a known identity that holds no seat (a spectator). */
  role: HttpRole;
}

export type AuthResult =
  { ok: true; principal: Principal } | { ok: false; status: 401 | 403 | 429 };

export interface HttpAuthenticator {
  /** 401 unless the request carries a valid identity credential from a same-origin caller. */
  authenticate(request: FastifyRequest): Promise<AuthResult>;
}

export interface HttpAuthOptions {
  identities: IdentityStore;
  /** The room's live state, for seat roles. */
  state: () => Campaign;
  now?: () => number;
  /** Seam for tests; production uses the gateway's scrypt + timingSafeEqual check. */
  verify?: (secret: string, stored: string) => Promise<boolean>;
  /** Failed attempts per client address per minute before answering 429. */
  maxFailuresPerMinute?: number;
}

/** CORS is same-origin only: a cross-site page may not drive these routes even with a credential. */
export function isSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function createHttpAuthenticator(options: HttpAuthOptions): HttpAuthenticator {
  const verify = options.verify ?? verifySecret;
  const failures: RateLimiter = createRateLimiter({
    max: options.maxFailuresPerMinute ?? 20,
    windowMs: 60_000,
    ...(options.now ? { now: options.now } : {}),
  });
  // Unknown identities are verified against this so timing does not reveal whether one exists.
  let dummyHash: Promise<string> | undefined;
  const dummy = () => (dummyHash ??= hashSecret('mythic-http-auth-dummy'));

  return {
    async authenticate(request) {
      if (!isSameOrigin(request)) return { ok: false, status: 403 };
      const address = request.ip;
      if (failures.exhausted(address)) return { ok: false, status: 429 };
      const fail = (): AuthResult => {
        failures.hit(address);
        return { ok: false, status: 401 };
      };
      const credential = parseCredential(request.headers.authorization);
      if (!credential) return fail();
      const stored = await options.identities.get(credential.identityId);
      const valid = await verify(credential.secret, stored ? stored.secretHash : await dummy());
      if (!stored || !valid) return fail();

      const isHost = (await options.identities.getHostIdentityId()) === credential.identityId;
      const seat = Object.values(options.state().seats).find(
        (s) => s.identityId === credential.identityId,
      );
      const role: HttpRole = isHost
        ? 'host'
        : seat
          ? seat.role === 'codm'
            ? 'codm'
            : 'player'
          : 'none';
      return {
        ok: true,
        principal: {
          identityId: credential.identityId,
          isHost,
          ...(seat ? { seatId: seat.id } : {}),
          role,
        },
      };
    },
  };
}
