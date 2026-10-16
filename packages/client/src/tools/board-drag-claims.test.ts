import { describe, expect, it } from 'vitest';
import { emptyBoardLeftDrag } from '../render/board-input.js';
import { railTools } from '../ui/registries.js';
import {
  claimEmptyBoardDrag,
  hasEmptyBoardDragClaim,
  MARQUEE_THROUGH_TOOLS,
  toolClaimsEmptyBoardDrag,
} from './board-drag-claims.js';

describe('board drag claims (MV-272)', () => {
  it('Measure and Draw claim the drag; only the marquee-through tools leave it to the marquee', () => {
    expect(toolClaimsEmptyBoardDrag('measure')).toBe(true);
    expect(toolClaimsEmptyBoardDrag('draw')).toBe(true);
    for (const tool of ['select', 'create-prop', 'initiative'])
      expect(toolClaimsEmptyBoardDrag(tool)).toBe(false);
  });

  it('MV-275: a tool that neither claims nor is listed keeps the drag (no silent marquee)', () => {
    expect(toolClaimsEmptyBoardDrag('some-future-tool')).toBe(true);
    expect(emptyBoardLeftDrag('some-future-tool')).toBeNull();
  });

  it('MV-275: every rail tool is Pan, claims the drag, or is deliberately marquee-through', () => {
    const unclassified = railTools
      .all()
      .map((tool) => tool.id)
      .filter(
        (id) => id !== 'pan' && !hasEmptyBoardDragClaim(id) && !MARQUEE_THROUGH_TOOLS.has(id),
      );
    expect(unclassified).toEqual([]);
    // Nothing is listed both ways, and the list names only real rail tools.
    for (const id of MARQUEE_THROUGH_TOOLS) {
      expect(railTools.get(id)).toBeDefined();
      expect(hasEmptyBoardDragClaim(id)).toBe(false);
    }
    // The tools with their own drag behaviour today.
    expect(emptyBoardLeftDrag('pan')).toBe('pan');
    expect(emptyBoardLeftDrag('measure')).toBeNull();
    expect(emptyBoardLeftDrag('draw')).toBeNull();
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
