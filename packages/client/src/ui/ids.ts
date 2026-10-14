import { ulid } from '../net/ulid.js';

/** Browser edge: the only place the UI reads the clock and randomness for new ids (SES-02). */
export function newId(): string {
  return ulid(Date.now(), () => crypto.getRandomValues(new Uint8Array(1))[0] ?? 0);
}
