import type { QrCode } from './qr.js';
import { encodeQrCode } from './qr.js';
import type { Identity } from './identity.js';
import { parseIdentityFile, serializeIdentityFile } from './identity-file.js';

/** SES-09: shown when a scanned code is not an identity backup. */
export const IDENTITY_QR_ERROR = 'This QR code does not contain a Mythic identity.';
export const IDENTITY_QR_TOO_LARGE =
  'This identity is too large for a QR code. Use the identity file.';

/**
 * A QR code holds the same document as the identity file, so one parser and one installer cover
 * both transfer routes and a scan can never smuggle in a different shape.
 */
export function identityQrPayload(identity: Identity): string {
  return serializeIdentityFile(identity);
}

export function encodeIdentityQr(identity: Identity): QrCode {
  try {
    return encodeQrCode(identityQrPayload(identity));
  } catch {
    throw new Error(IDENTITY_QR_TOO_LARGE);
  }
}

export function parseIdentityQr(text: string): Identity {
  try {
    return parseIdentityFile(text);
  } catch {
    // Never echo the scanned text: it holds a secret.
    throw new Error(IDENTITY_QR_ERROR);
  }
}
