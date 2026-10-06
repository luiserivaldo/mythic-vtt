import type { AssetRef } from '@mythic/shared';

/**
 * URL of an asset on the game host (M1-08: `GET /assets/:hash`, content-addressed, immutable).
 * `baseUrl` is the host origin; '' means same-origin (the dev server proxies `/assets`).
 * Library assets (D16) are resolved by a later milestone, so they have no URL here and the
 * caller shows the placeholder.
 */
export function assetUrl(baseUrl: string, ref: AssetRef | undefined): string | null {
  if (!ref || ref.source !== 'local') return null;
  return `${baseUrl.replace(/\/+$/, '')}/assets/${ref.hash}`;
}
