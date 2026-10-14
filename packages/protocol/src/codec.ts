import type { z } from 'zod';
import { ClientMessage, ServerMessage } from './messages.js';

export type DecodeResult<T> = { ok: true; message: T } | { ok: false; error: string };

function decode<S extends z.ZodType>(schema: S, raw: string): DecodeResult<z.infer<S>> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, message: parsed.data }
    : { ok: false, error: parsed.error.message };
}

export const decodeClientMessage = (raw: string): DecodeResult<ClientMessage> =>
  decode(ClientMessage, raw);
export const decodeServerMessage = (raw: string): DecodeResult<ServerMessage> =>
  decode(ServerMessage, raw);

/** Encode after validating, so a bug cannot put a malformed frame on the wire. */
export function encodeClientMessage(m: ClientMessage): string {
  return JSON.stringify(ClientMessage.parse(m));
}
export function encodeServerMessage(m: ServerMessage): string {
  return JSON.stringify(ServerMessage.parse(m));
}
