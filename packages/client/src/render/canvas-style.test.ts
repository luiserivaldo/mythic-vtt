import { describe, expect, it } from 'vitest';
import { OUTSIDE_FALLBACK, outsideColor } from './canvas-style.js';

describe('outsideColor (D37)', () => {
  it('uses a fixed charcoal for dark or non-hex backgrounds', () => {
    expect(outsideColor('#000000')).toBe(OUTSIDE_FALLBACK);
    expect(outsideColor('rebeccapurple')).toBe(OUTSIDE_FALLBACK);
    expect(outsideColor(undefined)).toBe(OUTSIDE_FALLBACK);
  });
  it('darkens bright backgrounds', () => {
    const out = outsideColor('#d8c8a0');
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseInt(out.slice(1, 3), 16)).toBeLessThan(0xd8 / 2);
  });
});
