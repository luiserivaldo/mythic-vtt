export interface LocationLike {
  pathname: string;
  search: string;
  hash: string;
}

export interface HistoryLike {
  replaceState(data: unknown, unused: string, url: string): void;
}

/**
 * D24: reads `host` from the URL fragment (never the query string, so it is not sent to any
 * server) and removes it from the address bar and history entry. Other fragment params stay.
 */
export function extractHostToken(loc: LocationLike, history: HistoryLike): string | undefined {
  const params = new URLSearchParams(loc.hash.replace(/^#/, ''));
  const token = params.get('host');
  if (token === null) return undefined;
  params.delete('host');
  const rest = params.toString();
  history.replaceState(null, '', `${loc.pathname}${loc.search}${rest ? `#${rest}` : ''}`);
  return token === '' ? undefined : token;
}

/**
 * Holds the host token until the host has authenticated us. The token is resent on every hello
 * until `confirm()` (called on the first snapshot after a hello that carried it), so a socket
 * dropping before authentication does not lose it. After a successful bind it is never resent.
 */
export interface HostTokenHolder {
  /** The token to put in the next hello, if still unconfirmed. Marks it as in flight. */
  take(): string | undefined;
  /** A snapshot arrived: if the last hello carried the token, the bind succeeded; clear it. */
  confirm(): void;
}

export function createHostTokenHolder(token: string | undefined): HostTokenHolder {
  let pending = token;
  let inFlight = false;
  return {
    take() {
      inFlight = pending !== undefined;
      return pending;
    },
    confirm() {
      if (inFlight) pending = undefined;
      inFlight = false;
    },
  };
}
