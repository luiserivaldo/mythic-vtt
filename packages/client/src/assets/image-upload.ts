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

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export function uploadFailureMessage(error: UploadError): string {
  if (error.status === 401) return 'The host is not accepting uploads from this client yet.';
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
): ImageUploader {
  return async (file) => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/assets/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
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
