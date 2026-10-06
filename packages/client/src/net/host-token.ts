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

/** Hands the token out once (the first hello); reconnects must not resend a consumed token. */
export function createHostTokenTaker(token: string | undefined): () => string | undefined {
  let pending = token;
  return () => {
    const t = pending;
    pending = undefined;
    return t;
  };
}
