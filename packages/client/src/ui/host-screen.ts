import { CampaignList, type CampaignListEntry } from '@mythic/protocol';
import { authorizationHeader, type UploadCredential } from '../assets/image-upload.js';

/**
 * UI-HOST-01: set just before "I'm the DM" reloads the page with the DM link, read once on start.
 * Only a UI hint: the host screen shows nothing the host does not hand this identity itself.
 */
export const HOST_SCREEN_KEY = 'mythic.host.screen';

/** The slice of `fetch` these calls need, so a test can stand in for the host. */
export type HostFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * D24: the token a pasted DM link carries (`…/#host=<token>`), or a bare token. The token only
 * ever reaches the host in `hello`, exactly as opening the DM link does; nothing here checks it.
 */
export function dmLinkToken(text: string): string | undefined {
  const trimmed = text.trim();
  const hash = trimmed.indexOf('#');
  const token = hash === -1 ? trimmed : new URLSearchParams(trimmed.slice(hash + 1)).get('host');
  // The host makes 32-character tokens; a configured one may differ, so the bound is loose.
  return token !== null && /^[\w-]{16,256}$/.test(token) ? token : undefined;
}

/**
 * MV-284: the host a pasted DM link points at, when that is not this page's origin; null for a
 * bare token, a bare `#host=` fragment, a relative link or a link to this page. The token would go to this page's
 * host, so a link for another one is worth a second look. Not refused: the printed link may be the
 * public URL while the DM opens the host on localhost or the LAN.
 */
export function foreignDmLinkHost(text: string, pageOrigin: string): string | null {
  const trimmed = text.trim();
  const hash = trimmed.indexOf('#');
  const address = hash === -1 ? '' : trimmed.slice(0, hash);
  if (address === '') return null;
  let url: URL;
  try {
    // A relative link (`/`, `./play`, `?x=1`) is for this page; `//host/` still names one.
    url = /^[/.?]/.test(address)
      ? new URL(address, pageOrigin)
      : new URL(/^https?:\/\//i.test(address) ? address : `http://${address}`);
  } catch {
    return address;
  }
  if (url.origin === pageOrigin) return null;
  // Same host on another scheme or port still names the whole origin, so the difference shows.
  return url.hostname === new URL(pageOrigin).hostname ? url.origin : url.host;
}

/** UI-HOST-02: last played first; never-played campaigns last, in the host's order. */
export function sortCampaigns(entries: readonly CampaignListEntry[]): CampaignListEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) => (b.entry.lastPlayedAt ?? -1) - (a.entry.lastPlayedAt ?? -1) || a.index - b.index,
    )
    .map(({ entry }) => entry);
}

export interface CampaignRow {
  id: string;
  name: string;
  played: string;
  hasThumbnail: boolean;
  /** The campaign this host process has open: the only one that can be played right now. */
  current: boolean;
}

export function campaignRows(
  list: CampaignList,
  formatTime: (ms: number) => string,
): CampaignRow[] {
  return sortCampaigns(list.campaigns).map((c) => ({
    id: c.id,
    name: c.name || 'Untitled campaign',
    played:
      c.lastPlayedAt === undefined ? 'Never played' : `Last played ${formatTime(c.lastPlayedAt)}`,
    hasThumbnail: c.thumbnail !== undefined,
    current: c.id === list.current,
  }));
}

export type ListState =
  { kind: 'loading' } | { kind: 'denied' } | { kind: 'error' } | { kind: 'ok'; list: CampaignList };

export type HostStep = 'campaigns' | 'table' | 'done';

/**
 * HOST-03: the host opens one campaign per process (chosen at start-up), so only that one goes on
 * to the table. Another is explained, not switched: switching at runtime is a host change.
 */
export function pickCampaign(
  list: CampaignList,
  id: string,
): { step: HostStep; notice: string | null } {
  if (id === list.current) return { step: 'table', notice: null };
  const name = list.campaigns.find((c) => c.id === id)?.name ?? 'that campaign';
  return {
    step: 'campaigns',
    notice: `This host has another campaign open. To play ${name}, restart the host and choose it at start-up (or start it with --campaign "${name}").`,
  };
}

export type HostScreenView = 'connecting' | 'refused' | 'error' | HostStep;

/**
 * The host decides: the list is fetched with this identity and only a 200 shows anything. A
 * refused DM link (fatal `hello`) or a 401/403 from the list both end on `refused`.
 */
export function hostScreenView(i: {
  fatalError: string | null;
  ready: boolean;
  list: ListState;
  step: HostStep;
}): HostScreenView {
  if (i.step === 'done') return 'done';
  if (i.fatalError !== null || i.list.kind === 'denied') return 'refused';
  if (!i.ready || i.list.kind === 'loading') return 'connecting';
  if (i.list.kind === 'error') return 'error';
  return i.step;
}

/** `GET /api/campaigns` as this identity; host only (D36), so anyone else gets `denied`. */
export async function fetchCampaignList(
  fetchFn: HostFetch,
  credential: UploadCredential,
): Promise<ListState> {
  try {
    const response = await fetchFn('/api/campaigns', {
      headers: { Authorization: authorizationHeader(credential) },
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (!response.ok) return { kind: 'error' };
    const parsed = CampaignList.safeParse(await response.json());
    return parsed.success ? { kind: 'ok', list: parsed.data } : { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * The thumbnail route needs the Authorization header, which an `<img>` cannot send, so it is
 * fetched and shown from a blob. The browser's cache revalidates it with the ETag (304).
 */
export async function fetchCampaignThumbnail(
  fetchFn: HostFetch,
  credential: UploadCredential,
  campaignId: string,
): Promise<Blob | null> {
  try {
    const response = await fetchFn(`/api/campaigns/${encodeURIComponent(campaignId)}/thumbnail`, {
      headers: { Authorization: authorizationHeader(credential) },
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.type.startsWith('image/') ? blob : null;
  } catch {
    return null;
  }
}
