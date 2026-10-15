import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { POPOVER_GAP, railPopoverPlacement, type Box } from './rail-popover.js';

const box = (left: number, top: number, right: number, bottom: number): Box => ({
  left,
  top,
  right,
  bottom,
});

describe('UI-MEAS-01 rail popover placement', () => {
  const frame = box(300, 50, 1300, 850);
  const rail = box(308, 300, 420, 600);

  it('sits just right of the rail, top-aligned with its button', () => {
    const at = railPopoverPlacement(frame, rail, box(312, 400, 416, 430), 200);
    expect(at).toEqual({ left: 120 + POPOVER_GAP, top: 350, maxHeight: 800 - 2 * POPOVER_GAP });
  });

  it('moves up when the panel would run off the bottom', () => {
    const at = railPopoverPlacement(frame, rail, box(312, 700, 416, 730), 400);
    expect(at.top).toBe(800 - POPOVER_GAP - 400);
  });

  it('pins to the top and scrolls when the panel is taller than the board', () => {
    const at = railPopoverPlacement(frame, rail, box(312, 400, 416, 430), 5000);
    expect(at.top).toBe(POPOVER_GAP);
    expect(at.maxHeight).toBe(800 - 2 * POPOVER_GAP);
  });

  it('always stays inside the board', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 2000 }),
        fc.integer({ min: -500, max: 2500 }),
        fc.integer({ min: 0, max: 4000 }),
        (height, buttonTop, panel) => {
          const f = box(0, 0, 1000, height);
          const at = railPopoverPlacement(f, rail, box(0, buttonTop, 10, buttonTop + 30), panel);
          expect(at.top).toBeGreaterThanOrEqual(POPOVER_GAP);
          expect(at.top + Math.min(panel, at.maxHeight)).toBeLessThanOrEqual(height);
        },
      ),
    );
  });
});
