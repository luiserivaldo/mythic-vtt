import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { AssetStore, CampaignStore } from './types.js';
import type { CampaignFile, LogEntry } from './types.js';
import type { Scene } from '@mythic/shared';

const campaignId = '01J00000000000000000000001';
const sceneId = '01J00000000000000000000002';
const sessionId = '01J00000000000000000000003';
export const sampleCampaign: CampaignFile = {
  id: campaignId,
  name: 'Test',
  schemaVersion: 1,
  settings: {
    defaultBinding: 'persistent',
    instanceMode: 'linked',
    spectators: { enabled: false, view: 'players' },
  },
  seats: {},
  activeSceneId: sceneId,
};
export const sampleScene: Scene = {
  id: sceneId,
  name: 'Scene',
  grid: {
    type: 'square',
    sizePx: 50,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'chebyshev',
    snap: true,
  },
  environment: { background: '#000' },
  layers: {},
  entities: {},
};
export const sampleLog: LogEntry = {
  envelope: {
    id: '01J00000000000000000000004',
    type: 'scene.rename',
    payload: { name: 'Next' },
    actor: { kind: 'host' },
    campaignId,
    sceneId,
    sessionId,
    seq: 1,
    ts: 1,
  },
  inversePatches: [],
};
export function campaignStoreConformance(
  create: () => { store: CampaignStore; close: () => Promise<void> },
): void {
  describe('CampaignStore conformance', () => {
    it('round trips campaign metadata and scenes', async () => {
      const { store, close } = create();
      try {
        await store.saveCampaign(campaignId, sampleCampaign);
        await store.saveScene(campaignId, sampleScene);
        expect(await store.load(campaignId)).toEqual({
          campaign: sampleCampaign,
          scenes: [sampleScene],
        });
        expect((await store.list()).map((entry) => entry.id)).toContain(campaignId);
      } finally {
        await close();
      }
    });
    it('accepts logs and snapshots', async () => {
      const { store, close } = create();
      try {
        await store.appendLog(campaignId, sessionId, [sampleLog]);
        await store.writeSnapshot(campaignId, sessionId, 'start', {
          seq: 1,
          state: { ...sampleCampaign, scenes: { [sceneId]: sampleScene } },
        });
      } finally {
        await close();
      }
    });
  });
}
export function assetStoreConformance(
  create: () => { store: AssetStore; close: () => Promise<void> },
): void {
  describe('AssetStore conformance', () => {
    it('stores and reads content by SHA-256', async () => {
      const { store, close } = create();
      const bytes = Buffer.from('sample asset');
      const hash = createHash('sha256').update(bytes).digest('hex');
      try {
        expect(await store.has(hash)).toBe(false);
        await store.put(hash, Readable.from([bytes]), {
          mime: 'text/plain',
          size: bytes.length,
          ext: 'txt',
        });
        expect(await store.has(hash)).toBe(true);
        const chunks: Buffer[] = [];
        for await (const chunk of await store.get(hash))
          chunks.push(Buffer.from(chunk as Uint8Array));
        expect(Buffer.concat(chunks)).toEqual(bytes);
      } finally {
        await close();
      }
    });
  });
}
