import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashSecret, loadOrCreateHostSecret, verifyHostSecret, verifySecret } from './secrets.js';

describe('identity secret hashing', () => {
  it('verifies the right secret and rejects others', async () => {
    const h = await hashSecret('s3cret');
    expect(h).not.toContain('s3cret');
    expect(await verifySecret('s3cret', h)).toBe(true);
    expect(await verifySecret('other', h)).toBe(false);
  });
  it('salts each hash and rejects malformed stored values', async () => {
    expect(await hashSecret('a')).not.toBe(await hashSecret('a'));
    expect(await verifySecret('a', 'garbage')).toBe(false);
    expect(await verifySecret('a', 'scrypt$zz$00')).toBe(false);
  });
});

describe('host secret', () => {
  it('is created once, private, and reused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mythic-host-'));
    const path = join(dir, 'nested', 'host-secret');
    const first = await loadOrCreateHostSecret(path);
    expect(first.created).toBe(true);
    expect(first.secret).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(path)).mode & 0o077).toBe(0);
    expect((await readFile(path, 'utf8')).trim()).toBe(first.secret);
    const second = await loadOrCreateHostSecret(path);
    expect(second).toEqual({ secret: first.secret, created: false });
    expect(verifyHostSecret(first.secret, first.secret)).toBe(true);
    expect(verifyHostSecret('x', first.secret)).toBe(false);
  });
});
