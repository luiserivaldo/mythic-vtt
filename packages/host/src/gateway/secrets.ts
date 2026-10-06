import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// TECHNICAL.md §18: identity secrets are stored hashed. The secrets are 32 random bytes, so the
// KDF is about defence in depth if the store leaks, not about stretching a weak password.
const KEY_LENGTH = 32;

function derive(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEY_LENGTH, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** Returns `scrypt$<saltHex>$<hashHex>`; the salt is per secret. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(secret, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Constant-time check of a presented secret against a stored hash. */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || saltHex === undefined || hashHex === undefined) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(secret, Buffer.from(saltHex, 'hex'));
  return timingSafeEqual(actual, expected);
}

/**
 * Host authority secret (TECHNICAL.md §7.2): created on first run and stored locally on the host,
 * never in the repo. Returns the secret and whether this call created it.
 */
export async function loadOrCreateHostSecret(
  path: string,
): Promise<{ secret: string; created: boolean }> {
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (existing.length > 0) return { secret: existing, created: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const secret = randomBytes(32).toString('hex');
  await mkdir(dirname(path), { recursive: true });
  // 'wx' so two starting processes cannot both believe they created it.
  try {
    await writeFile(path, `${secret}\n`, { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { secret: (await readFile(path, 'utf8')).trim(), created: false };
    }
    throw err;
  }
  await chmod(path, 0o600);
  return { secret, created: true };
}

export function verifyHostSecret(presented: string, secret: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
