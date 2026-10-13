import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { Id } from '@mythic/shared';
import { LogEntry } from './types.js';

export const HISTORY_SCAN_LIMIT = 100;
export const HISTORY_READ_BYTES = 2 * 1024 * 1024;
export interface HistoryPosition {
  session: number;
  offset?: number;
}
export interface HistoryChunk {
  entries: LogEntry[];
  next?: HistoryPosition;
}

/** Read JSONL backwards with fixed I/O/parse budgets; offsets always end at a line boundary. */
export async function readHistoryChunk(
  folder: string,
  sessions: readonly string[],
  position: HistoryPosition = { session: 0 },
): Promise<HistoryChunk> {
  const entries: LogEntry[] = [];
  let session = position.session,
    offset = position.offset,
    budget = HISTORY_READ_BYTES;
  while (session < sessions.length && entries.length < HISTORY_SCAN_LIMIT && budget > 0) {
    const id = sessions[session];
    if (!id) break;
    const path = join(folder, 'sessions', Id.parse(id), 'log.jsonl');
    const file = await open(path, 'r').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (!file) {
      session++;
      offset = undefined;
      continue;
    }
    try {
      const size = (await file.stat()).size;
      const end = Math.min(offset ?? size, size);
      if (!end) {
        session++;
        offset = undefined;
        continue;
      }
      const count = Math.min(end, budget),
        start = end - count;
      const buffer = Buffer.alloc(count);
      const { bytesRead } = await file.read(buffer, 0, count, start);
      if (bytesRead !== count) throw new Error('history log changed');
      budget -= count;
      let index = count;
      while (index > 0 && entries.length < HISTORY_SCAN_LIMIT) {
        while (index > 0 && buffer[index - 1] === 10) index--;
        if (!index) break;
        const newline = buffer.lastIndexOf(10, index - 1),
          lineStart = newline + 1;
        if (newline < 0 && start > 0) {
          if (entries.length === 0 && count === HISTORY_READ_BYTES)
            throw new Error('history entry exceeds read budget');
          break;
        }
        const line = buffer.subarray(lineStart, index).toString('utf8').trim();
        if (line) entries.push(LogEntry.parse(JSON.parse(line) as unknown));
        index = lineStart;
      }
      offset = start + index;
      if (offset === 0) {
        session++;
        offset = undefined;
      }
    } finally {
      await file.close();
    }
  }
  return {
    entries,
    ...(session < sessions.length
      ? { next: { session, ...(offset !== undefined ? { offset } : {}) } }
      : {}),
  };
}
