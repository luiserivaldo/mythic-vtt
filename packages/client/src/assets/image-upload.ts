// Contract of the host's `POST /assets/images` (packages/host/src/http/asset-routes.ts): the body
// is the raw image bytes; 201/200 return the processed image (WebP, content-addressed).
// Validated by hand: the client has no direct zod dependency and the shape is tiny.

export interface UploadedImage {
  hash: string;
  width: number;
  height: number;
}

/** Injectable so the UI and tests never need a real host. */
export type ImageUploader = (file: Blob) => Promise<UploadedImage>;

/** The slice of the SES-02 identity the host's HTTP auth needs (D36). */
export interface UploadCredential {
  identityId: string;
  identitySecret: string;
}

/** `Authorization: Mythic <identityId>.<secret>`; header only, never in the URL (D36). */
export function authorizationHeader(credential: UploadCredential): string {
  return `Mythic ${credential.identityId}.${credential.identitySecret}`;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export function uploadFailureMessage(error: UploadError): string {
  if (error.status === 401)
    return 'The host did not recognise this client. Reload the page and try again.';
  if (error.status === 403) return 'Only the host and co-DMs can upload images.';
  if (error.status === 429) return 'Too many uploads. Wait a moment and try again.';
  if (error.status === 415) return 'That file is not a supported image (PNG, JPEG or WebP).';
  if (error.status === 413) return 'That image is too large for this host.';
  return `The upload failed (${error.message}).`;
}

function readStoredImage(body: unknown): UploadedImage | null {
  if (typeof body !== 'object' || body === null) return null;
  const image = (body as { image?: unknown }).image;
  if (typeof image !== 'object' || image === null) return null;
  const { hash, width, height } = image as Record<string, unknown>;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return { hash, width: width as number, height: height as number };
}

export function createHttpUploader(
  baseUrl: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  /** Read per upload so a late-created identity is still picked up. Omitted: no credential. */
  credential?: () => UploadCredential | undefined,
): ImageUploader {
  return async (file) => {
    const identity = credential?.();
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/assets/images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(identity ? { Authorization: authorizationHeader(identity) } : {}),
        },
        body: file,
      });
    } catch {
      throw new UploadError('network error', null);
    }
    if (!response.ok) throw new UploadError(`HTTP ${String(response.status)}`, response.status);
    const image = readStoredImage(await response.json().catch(() => null));
    if (!image) throw new UploadError('unexpected response from host', response.status);
    return image;
  };
}
