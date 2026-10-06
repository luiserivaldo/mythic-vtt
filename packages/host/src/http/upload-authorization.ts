import type { FastifyRequest } from 'fastify';

export interface AuthenticatedSeat {
  identityId: string;
  seatId: string;
}

/** HTTP authentication is deliberately behind this seam until seat/gateway wiring lands. */
export interface UploadAuthorizer {
  authorize(request: FastifyRequest): Promise<AuthenticatedSeat | null>;
}

export const denyAssetUploads: UploadAuthorizer = {
  authorize: () => Promise.resolve(null),
};
