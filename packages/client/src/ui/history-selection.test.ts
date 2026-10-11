import { describe, expect, it } from 'vitest';
import { isUndoableType, prune, select, type Selection } from './history-selection.js';

const order = [9, 8, 7, 6, 5];
const empty: Selection = { selected: new Set() };

describe('history selection', () => {
  it('plain click selects exactly one', () => {
    const first = select(empty, order, 8, 'only');
    expect([...first.selected]).toEqual([8]);
    expect([...select(first, order, 6, 'only').selected]).toEqual([6]);
  });

  it('toggle adds and removes without touching the rest', () => {
    let s = select(empty, order, 8, 'only');
    s = select(s, order, 6, 'toggle');
    expect([...s.selected].sort()).toEqual([6, 8]);
    s = select(s, order, 8, 'toggle');
    expect([...s.selected]).toEqual([6]);
  });

  it('range extends from the anchor in either direction', () => {
    const s = select(empty, order, 8, 'only');
    expect([...select(s, order, 5, 'range').selected].sort()).toEqual([5, 6, 7, 8]);
    expect([...select(s, order, 9, 'range').selected].sort()).toEqual([8, 9]);
  });

  it('range without a usable anchor behaves like a plain click', () => {
    expect([...select(empty, order, 7, 'range').selected]).toEqual([7]);
  });

  it('ignores entries that cannot be selected and does not mutate its input', () => {
    const s = select(empty, order, 8, 'only');
    const before = new Set(s.selected);
    expect(select(s, order, 99, 'toggle')).toBe(s);
    select(s, order, 6, 'toggle');
    expect(s.selected).toEqual(before);
  });

  it('prunes entries that left the list', () => {
    const s = select(select(empty, order, 8, 'only'), order, 5, 'toggle');
    expect([...prune(s, [8, 7]).selected]).toEqual([8]);
    expect(prune(s, order)).toBe(s);
  });

  it('knows which types the host will not undo', () => {
    for (const type of ['history.undo', 'seat.assign', 'session.join', 'scene.activate'])
      expect(isUndoableType(type)).toBe(false);
    for (const type of ['token.move', 'entity.create', 'scene.rename'])
      expect(isUndoableType(type)).toBe(true);
  });
});
