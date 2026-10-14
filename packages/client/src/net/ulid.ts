const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID from an explicit clock and random source; no ambient `Date`/`Math.random` use. */
export function ulid(nowMs: number, randomByte: () => number): string {
  let time = '';
  let t = Math.floor(nowMs);
  for (let i = 0; i < 10; i++) {
    time = (ALPHABET[t % 32] ?? '0') + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ALPHABET[randomByte() % 32] ?? '0';
  return time + rand;
}

/** Hex string of `n` random bytes, for `identitySecret` (SES-02: 32 bytes). */
export function randomSecret(n: number, randomByte: () => number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += (randomByte() & 0xff).toString(16).padStart(2, '0');
  return out;
}
