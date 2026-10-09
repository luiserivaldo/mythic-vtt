import type { HistoryEntry } from '@mythic/shared';

export interface HistoryGroup {
  round?: number;
  turn?: number;
  entries: HistoryEntry[];
}

/** Keep chronological runs separate when a DM revisits an earlier round/turn. */
export function historyGroups(entries: readonly HistoryEntry[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    if (previous && previous.round === entry.round && previous.turn === entry.turn)
      previous.entries.push(entry);
    else
      groups.push({
        ...(entry.round !== undefined ? { round: entry.round } : {}),
        ...(entry.turn !== undefined ? { turn: entry.turn } : {}),
        entries: [entry],
      });
  }
  return groups;
}
