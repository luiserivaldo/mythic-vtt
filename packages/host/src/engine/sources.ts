import { randomBytes } from 'node:crypto';

/** Host time in ms. Injected so the engine is testable and `shared` never reads the clock. */
export type Clock = () => number;

/** Cryptographically secure random bytes (§4.1 `rng`, ULIDs). Injected for deterministic tests. */
export type RandomSource = (n: number) => Uint8Array;

export const systemClock: Clock = () => Date.now();
export const cryptoRandom: RandomSource = (n) => new Uint8Array(randomBytes(n));

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID (48-bit ms time + 80 random bits, Crockford base32). */
export function ulid(nowMs: number, random: RandomSource): string {
  let time = '';
  let t = Math.floor(nowMs);
  for (let i = 0; i < 10; i++) {
    time = (ALPHABET[t % 32] ?? '0') + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  // 16 chars x 5 bits; one byte per char keeps it simple (top 3 bits discarded).
  for (const byte of random(16)) rand += ALPHABET[byte & 31] ?? '0';
  return time + rand;
}

/** `count` uniform floats in [0, 1) from 32 random bits each, for `envelope.rng`. */
export function randomFloats(count: number, random: RandomSource): number[] {
  if (count <= 0) return [];
  const bytes = random(count * 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(view.getUint32(i * 4) / 2 ** 32);
  return out;
}
