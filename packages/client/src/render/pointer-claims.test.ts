import { describe, expect, it } from 'vitest';
import { createPointerClaims } from './pointer-claims.js';

describe('pointer claims', () => {
  it('tracks claims per pointer id and releases them', () => {
    const claims = createPointerClaims();
    expect(claims.isClaimed(1)).toBe(false);
    claims.claim(1, 'token drag');
    expect(claims.isClaimed(1)).toBe(true);
    expect(claims.owner()).toBe('token drag');
    expect(claims.isClaimed(2)).toBe(false);
    claims.release(1);
    expect(claims.isClaimed(1)).toBe(false);
    expect(claims.owner()).toBeNull();
  });

  it('notifies subscribers only when ownership changes', () => {
    const claims = createPointerClaims();
    let changes = 0;
    const unsubscribe = claims.subscribe(() => {
      changes += 1;
    });
    claims.claim(1, 'ruler');
    claims.release(2);
    claims.release(1);
    unsubscribe();
    claims.claim(2, 'gizmo');
    expect(changes).toBe(2);
  });
});
