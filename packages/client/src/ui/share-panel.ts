import type { ServerMessage } from '@mythic/protocol';

export type JoinUrl = NonNullable<Extract<ServerMessage, { t: 'presence' }>['joinUrls']>[number];

export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

/** The protocol forbids fragments; this final guard also protects copy output from future callers. */
export function playerVisibleUrl(url: string): string {
  return url.split('#', 1)[0] ?? '';
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
