import { SpectatorLinkResponse, SpectatorRevokeResponse } from '@mythic/protocol';
import { loadOrCreateIdentity } from '../net/identity.js';

export async function changeSpectatorLink(method: 'POST' | 'DELETE'): Promise<string | null> {
  const identity = loadOrCreateIdentity(
    localStorage,
    Date.now(),
    () => crypto.getRandomValues(new Uint8Array(1))[0] ?? 0,
  );
  const response = await fetch('/api/spectator-link', {
    method,
    headers: { Authorization: `Mythic ${identity.identityId}.${identity.identitySecret}` },
  });
  if (!response.ok) throw new Error('Could not change the spectator link');
  const body: unknown = await response.json();
  if (method === 'DELETE') {
    SpectatorRevokeResponse.parse(body);
    return null;
  }
  return SpectatorLinkResponse.parse(body).token;
}

export function spectatorUrl(playerUrl: string, token: string): string {
  const url = new URL(playerUrl);
  url.hash = new URLSearchParams({ watch: token }).toString();
  return url.toString();
}
