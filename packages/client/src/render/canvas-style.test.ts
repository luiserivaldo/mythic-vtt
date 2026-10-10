import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID_COLOR, DEFAULT_GRID_OPACITY } from '@mythic/shared';
import {
  DEFAULT_BOARD_COLOR,
  LABEL_BACKGROUND_COLOR,
  LABEL_TEXT_COLOR,
  OUTSIDE_FALLBACK,
  compositeHex,
  contrastRatio,
  outsideColor,
} from './canvas-style.js';

describe('outsideColor (D37)', () => {
  it('uses dark blue around the default board and a charcoal surround for explicit dark scenes', () => {
    expect(outsideColor(DEFAULT_BOARD_COLOR)).toBe(OUTSIDE_FALLBACK);
    expect(outsideColor('#000000')).toBe('#1b1c21');
    expect(outsideColor('rebeccapurple')).toBe(OUTSIDE_FALLBACK);
    expect(outsideColor(undefined)).toBe(OUTSIDE_FALLBACK);
  });
  it('darkens bright backgrounds', () => {
    const out = outsideColor('#d8c8a0');
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseInt(out.slice(1, 3), 16)).toBeLessThan(0xd8 / 2);
  });
});

describe('default board contrast (PT1-08)', () => {
  it('keeps labels at WCAG AA text contrast', () => {
    expect(contrastRatio(LABEL_TEXT_COLOR, LABEL_BACKGROUND_COLOR)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps rendered default grid lines distinguishable from the board', () => {
    const renderedGrid = compositeHex(
      DEFAULT_GRID_COLOR,
      DEFAULT_BOARD_COLOR,
      DEFAULT_GRID_OPACITY,
    );
    expect(renderedGrid).not.toBeNull();
    expect(contrastRatio(renderedGrid ?? '', DEFAULT_BOARD_COLOR)).toBeGreaterThanOrEqual(3);
  });
});
