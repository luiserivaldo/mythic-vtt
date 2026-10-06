import { describe, expect, it } from 'vitest';
import { createPointerClaims } from './pointer-claims.js';

describe('pointer claims', () => {
  it('tracks claims per pointer id and releases them', () => {
    const claims = createPointerClaims();
    expect(claims.isClaimed(1)).toBe(false);
    claims.claim(1);
    expect(claims.isClaimed(1)).toBe(true);
    expect(claims.isClaimed(2)).toBe(false);
    claims.release(1);
    expect(claims.isClaimed(1)).toBe(false);
  });
});
