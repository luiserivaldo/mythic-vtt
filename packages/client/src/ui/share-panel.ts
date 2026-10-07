import type { Notice } from '../store/store.js';

export interface JoinUrl {
  kind: 'lan' | 'public';
  url: string;
}

export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

/** The game host strips fragments; this final guard also protects output from future callers. */
export function playerVisibleUrl(url: string): string {
  return url.split('#', 1)[0] ?? '';
}

/** Decode only the two M1-38 notice codes and reject unsafe or malformed link text. */
export function joinUrlsFromNotices(notices: readonly Notice[]): JoinUrl[] {
  const unique = new Map<string, JoinUrl>();
  for (const notice of notices) {
    const kind =
      notice.code === 'join-url-lan' ? 'lan' : notice.code === 'join-url-public' ? 'public' : null;
    if (kind === null) continue;
    try {
      const parsed = new URL(notice.message);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hash !== '') continue;
      const url = parsed.href.replace(/\/$/, notice.message.endsWith('/') ? '/' : '');
      unique.set(`${kind}:${url}`, { kind, url });
    } catch {
      // A malformed host report cannot become a clickable or copyable URL.
    }
  }
  return [...unique.values()];
}

function legacyCopy(text: string): Promise<void> {
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  // Browsers expose no modern clipboard API on an HTTP LAN origin; keep this compatibility path
  // until self-hosted tables can assume a secure context.
  const legacyDocument = document as unknown as { execCommand(commandId: string): boolean };
  const copied = legacyDocument['execCommand']('copy');
  input.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('copy command was refused'));
}

export function copyJoinUrl(url: string, clipboard?: ClipboardWriter): Promise<void> {
  const text = playerVisibleUrl(url);
  // LAN tables commonly run on non-secure HTTP origins, where the modern Clipboard API is absent.
  return clipboard ? clipboard.writeText(text) : legacyCopy(text);
}
