import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cameraPress,
  DRAG_THRESHOLD_PX,
  emptyBoardLeftDrag,
  isDrag,
  MOUSE_LEFT,
  MOUSE_MIDDLE,
  MOUSE_RIGHT,
  rightReleaseOpensMenu,
} from './board-input.js';

describe('board-input', () => {
  it('separates click from drag at exactly the threshold', () => {
    const start = { x: 100, y: 100 };
    expect(isDrag(start, start)).toBe(false);
    expect(isDrag(start, { x: 100 + DRAG_THRESHOLD_PX - 0.01, y: 100 })).toBe(false);
    expect(isDrag(start, { x: 100 + DRAG_THRESHOLD_PX, y: 100 })).toBe(true);
    expect(isDrag(start, { x: 100, y: 100 - DRAG_THRESHOLD_PX })).toBe(true);
    // Diagonal: 3-4-5 triangle with a 4 px threshold is already a drag.
    expect(isDrag(start, { x: 103, y: 104 })).toBe(true);
  });

  it('is a drag exactly when the distance reaches the threshold, in any direction', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        (x, y, dx, dy) => {
          const dragged = isDrag({ x, y }, { x: x + dx, y: y + dy });
          const d = Math.hypot(dx, dy);
          if (Math.abs(d - DRAG_THRESHOLD_PX) > 1e-6) expect(dragged).toBe(d > DRAG_THRESHOLD_PX);
          // Symmetric: dragging back to the start is the same distance.
          expect(isDrag({ x: x + dx, y: y + dy }, { x, y })).toBe(dragged);
        },
      ),
    );
  });

  it('left moves the camera only with the Pan tool, in 2D and 3D', () => {
    for (const view of ['2d', '3d'] as const) {
      expect(cameraPress(view, 'mouse', MOUSE_LEFT, 'pan')).toBe('pan');
      for (const tool of ['select', 'measure', 'draw', 'create-prop', 'initiative'])
        expect(cameraPress(view, 'mouse', MOUSE_LEFT, tool)).toBeNull();
    }
  });

  it('middle always pans, whatever the tool', () => {
    for (const view of ['2d', '3d'] as const)
      for (const tool of ['select', 'pan', 'measure', 'draw'])
        expect(cameraPress(view, 'mouse', MOUSE_MIDDLE, tool)).toBe('pan');
  });

  it('right orbits in 3D and leaves the camera alone in 2D', () => {
    for (const tool of ['select', 'pan', 'measure']) {
      expect(cameraPress('3d', 'mouse', MOUSE_RIGHT, tool)).toBe('orbit');
      expect(cameraPress('2d', 'mouse', MOUSE_RIGHT, tool)).toBeNull();
    }
  });

  it('ignores other mouse buttons; touch keeps its gesture mapping', () => {
    expect(cameraPress('2d', 'mouse', 3, 'pan')).toBeNull();
    expect(cameraPress('3d', 'mouse', 4, 'pan')).toBeNull();
    expect(cameraPress('2d', 'touch', 0, 'select')).toBe('pan');
    expect(cameraPress('3d', 'touch', 0, 'select')).toBe('orbit');
    expect(cameraPress('3d', 'pen', 0, 'select')).toBe('orbit');
  });

  it('a left drag on empty board is a marquee with Select and a pan with Pan', () => {
    expect(emptyBoardLeftDrag('select')).toBe('marquee');
    expect(emptyBoardLeftDrag('create-prop')).toBe('marquee');
    expect(emptyBoardLeftDrag('initiative')).toBe('marquee');
    expect(emptyBoardLeftDrag('pan')).toBe('pan');
    expect(emptyBoardLeftDrag('measure')).toBeNull();
    expect(emptyBoardLeftDrag('draw')).toBeNull();
  });

  it('MV-272: the marquee runs unless the active tool claims the drag', () => {
    const claimed = new Set(['create-prop']);
    const claims = (tool: string) => claimed.has(tool);
    expect(emptyBoardLeftDrag('create-prop', claims)).toBeNull();
    expect(emptyBoardLeftDrag('select', claims)).toBe('marquee');
    expect(emptyBoardLeftDrag('measure', claims)).toBe('marquee');
    // Pan's left drag is the camera's, whatever the claims say.
    expect(emptyBoardLeftDrag('pan', () => true)).toBe('pan');
  });

  it('a right release opens the menu only when the press stayed a click', () => {
    expect(rightReleaseOpensMenu(false)).toBe(true);
    expect(rightReleaseOpensMenu(true)).toBe(false);
  });
});
