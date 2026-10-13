import { expect, it } from 'vitest';
import type { HistoryEntry } from '@mythic/shared';
import { historyGroups } from './history-groups.js';

it('groups adjacent turns while preserving chronology, ungrouped entries and revisited turns', () => {
  const entry = (seq: number, round?: number, turn?: number): HistoryEntry => ({
    seq,
    ts: seq,
    type: 'token.move',
    sessionId: '0'.repeat(26),
    changes: [],
    ...(round !== undefined ? { round } : {}),
    ...(turn !== undefined ? { turn } : {}),
  });
  const entries = [
    entry(6, 2, 2),
    entry(5, 2, 1),
    entry(4, 2, 1),
    entry(3, 2, 2),
    entry(2),
    entry(1),
  ];
  const snapshot = structuredClone(entries);
  expect(historyGroups(entries).map((group) => group.entries.map((item) => item.seq))).toEqual([
    [6],
    [5, 4],
    [3],
    [2, 1],
  ]);
  expect(entries).toEqual(snapshot);
  expect(historyGroups([])).toEqual([]);
});
