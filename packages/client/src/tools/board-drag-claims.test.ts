import { describe, expect, it } from 'vitest';
import { emptyBoardLeftDrag } from '../render/board-input.js';
import { claimEmptyBoardDrag, toolClaimsEmptyBoardDrag } from './board-drag-claims.js';

describe('board drag claims (MV-272)', () => {
  it('Measure and Draw claim the drag; every other tool leaves it to the marquee', () => {
    expect(toolClaimsEmptyBoardDrag('measure')).toBe(true);
    expect(toolClaimsEmptyBoardDrag('draw')).toBe(true);
    for (const tool of ['select', 'create-prop', 'initiative', 'some-future-tool'])
      expect(toolClaimsEmptyBoardDrag(tool)).toBe(false);
  });

  it('a registered claim is asked on each press and can depend on tool state', () => {
    let placing = false;
    const release = claimEmptyBoardDrag('create-prop', () => placing);
    try {
      expect(emptyBoardLeftDrag('create-prop')).toBe('marquee');
      placing = true;
      expect(toolClaimsEmptyBoardDrag('create-prop')).toBe(true);
      expect(emptyBoardLeftDrag('create-prop')).toBeNull();
    } finally {
      release();
    }
    expect(toolClaimsEmptyBoardDrag('create-prop')).toBe(false);
    expect(emptyBoardLeftDrag('create-prop')).toBe('marquee');
  });

  it('releasing a claim restores the one it replaced', () => {
    const release = claimEmptyBoardDrag('measure', () => false);
    expect(emptyBoardLeftDrag('measure')).toBe('marquee');
    release();
    expect(emptyBoardLeftDrag('measure')).toBeNull();
  });

  it('a stale release does not remove a newer claim', () => {
    const first = claimEmptyBoardDrag('initiative', () => true);
    first();
    const second = claimEmptyBoardDrag('initiative', () => true);
    first();
    expect(toolClaimsEmptyBoardDrag('initiative')).toBe(true);
    second();
    expect(toolClaimsEmptyBoardDrag('initiative')).toBe(false);
  });
});
