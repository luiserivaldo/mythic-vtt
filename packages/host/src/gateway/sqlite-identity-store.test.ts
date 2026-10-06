import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createSqliteIdentityStore } from './sqlite-identity-store.js';

const A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const B = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-ids-'));
  path = join(dir, 'index.sqlite');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('registers once, keeps the first secret hash and updates the profile', async () => {
  const store = createSqliteIdentityStore(path);
  try {
    expect(await store.get(A)).toBeUndefined();
    const first = await store.registerIfAbsent({
      identityId: A,
      secretHash: 'h1',
      displayName: 'Ana',
    });
    expect(first).toEqual({ identityId: A, secretHash: 'h1', displayName: 'Ana' });
    // A second registration (e.g. a forged hello) cannot replace the stored hash.
    expect(
      await store.registerIfAbsent({ identityId: A, secretHash: 'h2', displayName: 'Eve' }),
    ).toEqual(first);
    await store.update(A, { displayName: 'Ana B', avatar: 'cat' });
    expect(await store.get(A)).toEqual({
      identityId: A,
      secretHash: 'h1',
      displayName: 'Ana B',
      avatar: 'cat',
    });
    await store.update(A, { displayName: 'Ana C' });
    expect((await store.get(A))?.avatar).toBe('cat');
  } finally {
    store.close();
  }
});

it('binds the host once and persists identities and the binding across restarts', async () => {
  const first = createSqliteIdentityStore(path);
  await first.registerIfAbsent({ identityId: A, secretHash: 'h1', displayName: 'Ana' });
  expect(await first.getHostIdentityId()).toBeUndefined();
  expect(await first.bindHostIfAbsent(A)).toBe(A);
  expect(await first.bindHostIfAbsent(B)).toBe(A);
  first.close();

  const second = createSqliteIdentityStore(path);
  try {
    expect(await second.getHostIdentityId()).toBe(A);
    expect((await second.get(A))?.secretHash).toBe('h1');
  } finally {
    second.close();
  }
});
