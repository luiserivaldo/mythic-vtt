import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ACTORS, IDS } from '../../../shared/src/actions/testing.js';
import { HISTORY_READ_BYTES, HISTORY_SCAN_LIMIT, readHistoryChunk } from './history-log-reader.js';
const entry = (seq: number) => ({
  envelope: {
    id: IDS.action,
    type: 'scene.rename',
    actor: ACTORS.host,
    payload: {},
    campaignId: IDS.campaign,
    sessionId: IDS.session,
    seq,
    ts: 1000,
  },
  inversePatches: [],
});
describe('bounded history JSONL reader', () => {
  it('reads descending windows without parsing an older corrupt prefix', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'mythic-history-'));
    try {
      const dir = join(folder, 'sessions', IDS.session);
      await mkdir(dir, { recursive: true });
      const lines = Array.from({ length: HISTORY_SCAN_LIMIT * 2 + 3 }, (_, index) =>
        JSON.stringify(entry(index + 1)),
      );
      await writeFile(join(dir, 'log.jsonl'), 'corrupt old prefix\n' + lines.join('\n') + '\n');
      const first = await readHistoryChunk(folder, [IDS.session]);
      expect(first.entries).toHaveLength(HISTORY_SCAN_LIMIT);
      expect(first.entries[0]?.envelope.seq).toBe(lines.length);
      expect(first.next).toBeDefined();
      const second = await readHistoryChunk(folder, [IDS.session], first.next);
      expect(second.entries).toHaveLength(HISTORY_SCAN_LIMIT);
      expect(second.entries[0]?.envelope.seq).toBe(lines.length - HISTORY_SCAN_LIMIT);
      expect(second.next).toBeDefined();
      await expect(readHistoryChunk(folder, [IDS.session], second.next)).rejects.toThrow();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  it('continues across session files and byte-limited whitespace windows', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'mythic-history-'));
    try {
      for (const id of [IDS.session, IDS.otherIdentity])
        await mkdir(join(folder, 'sessions', id), { recursive: true });
      await writeFile(
        join(folder, 'sessions', IDS.session, 'log.jsonl'),
        JSON.stringify(entry(2)) + '\n'.repeat(HISTORY_READ_BYTES + 1),
      );
      await writeFile(
        join(folder, 'sessions', IDS.otherIdentity, 'log.jsonl'),
        JSON.stringify({
          ...entry(1),
          envelope: { ...entry(1).envelope, sessionId: IDS.otherIdentity },
        }) + '\n',
      );
      const first = await readHistoryChunk(folder, [IDS.session, IDS.otherIdentity]);
      expect(first.entries).toEqual([]);
      expect(first.next?.session).toBe(0);
      const second = await readHistoryChunk(folder, [IDS.session, IDS.otherIdentity], first.next);
      expect(second.entries.map((value) => value.envelope.seq)).toEqual([2, 1]);
      expect(second.next).toBeUndefined();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  it('bounds a single oversized entry and handles missing/empty sessions', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'mythic-history-'));
    try {
      expect(await readHistoryChunk(folder, [IDS.session])).toEqual({ entries: [] });
      const dir = join(folder, 'sessions', IDS.session);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'log.jsonl'), 'x'.repeat(HISTORY_READ_BYTES + 1) + '\n');
      await expect(readHistoryChunk(folder, [IDS.session])).rejects.toThrow('read budget');
      await writeFile(join(dir, 'log.jsonl'), '');
      expect(await readHistoryChunk(folder, [IDS.session])).toEqual({ entries: [] });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
