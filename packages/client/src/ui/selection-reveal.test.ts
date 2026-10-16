// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOUBLE_CLICK_MS, revealDelay, whenRevealable } from './selection-reveal.js';

describe('UI-TOKEN-07 selection panel reveal', () => {
  afterEach(() => {
    for (const pointerId of [1, 2]) {
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId }));
    }
    vi.useRealTimers();
  });

  it('waits while a pointer button is held', () => {
    expect(revealDelay({ lastPress: 0, held: true }, 10_000)).toBe(Infinity);
  });

  it('waits out the double-click window after the last press', () => {
    expect(revealDelay({ lastPress: 1000, held: false }, 1100)).toBe(DOUBLE_CLICK_MS - 100);
    expect(revealDelay({ lastPress: 1000, held: false }, 1000 + DOUBLE_CLICK_MS)).toBe(0);
  });

  it('opens at once when nothing was pressed (keyboard or code selection)', () => {
    expect(revealDelay({ lastPress: -Infinity, held: false }, 0)).toBe(0);
  });

  it('holds a reveal while pressed and runs it once released and the window has passed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const reveal = vi.fn();
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, buttons: 1 }));
    const cancel = whenRevealable(reveal);
    vi.advanceTimersByTime(DOUBLE_CLICK_MS * 3);
    expect(reveal).not.toHaveBeenCalled();
    // A release the window missed: the next move with no buttons down clears the hold.
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 0 }));
    vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    expect(reveal).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('stays held while any finger of a pinch is still down', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const reveal = vi.fn();
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, buttons: 1 }));
    const cancel = whenRevealable(reveal);
    // One finger lifts: each touch pointer reports its own buttons, 0 once it is up.
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, buttons: 0 }));
    vi.advanceTimersByTime(DOUBLE_CLICK_MS * 3);
    expect(reveal).not.toHaveBeenCalled();
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, buttons: 0 }));
    vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    expect(reveal).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('cancels a pending reveal', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const reveal = vi.fn();
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, buttons: 0 }));
    const cancel = whenRevealable(reveal);
    cancel();
    vi.advanceTimersByTime(DOUBLE_CLICK_MS * 2);
    expect(reveal).not.toHaveBeenCalled();
  });
});
