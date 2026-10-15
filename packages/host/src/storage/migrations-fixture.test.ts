import { CURRENT_SCHEMA_VERSION } from '@mythic/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeMigrate } from '@mythic/shared';
import { LocalCampaignStore } from './local-campaign-store.js';

const fixture = fileURLToPath(new URL('../../../../fixtures/saves/v1', import.meta.url));
const campaignId = '01J8Z0000000000000000CAMP1';
const roots: string[] = [];
const copyFixture = async (version = 'v1'): Promise<string> => {
  const root = mkdtempSync(join(tmpdir(), 'mythic-golden-'));
  roots.push(root);
  await cp(join(fixture, '..', version, 'campaigns'), join(root, 'campaigns'), { recursive: true });
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe('golden save v1 through the shared migrate hook', () => {
  it('LocalCampaignStore.load() reads the fixture', async () => {
    const store = new LocalCampaignStore(await copyFixture(), storeMigrate);
    try {
      const { campaign, scenes } = await store.load(campaignId);
      expect(campaign).toMatchObject({
        id: campaignId,
        name: 'The Sunken Chapel',
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
      expect(Object.keys(campaign.seats)).toHaveLength(2);
      expect(scenes.map((s) => s.name)).toEqual(['Flooded Nave']);
      expect(Object.keys(scenes[0]?.entities ?? {})).toHaveLength(3);
    } finally {
      await store.close();
    }
  });
  it('migrates version 1 session metadata without discarding the session', async () => {
    const root = await copyFixture();
    const sessionId = '01J8Z0000000000000000SESS1';
    await writeFile(
      join(root, 'campaigns', campaignId, 'sessions', sessionId, 'meta.json'),
      JSON.stringify({ schemaVersion: 1, sessionId, startedAt: 123 }),
    );
    const store = new LocalCampaignStore(root, storeMigrate);
    try {
      expect(await store.readSessions(campaignId)).toEqual([
        { schemaVersion: CURRENT_SCHEMA_VERSION, sessionId, startedAt: 123 },
      ]);
    } finally {
      await store.close();
    }
  });
  it('preserves v2 icon and text markers through load and save', async () => {
    const store = new LocalCampaignStore(await copyFixture('v2'), storeMigrate);
    try {
      const loaded = await store.load(campaignId);
      const scene = loaded.scenes[0];
      if (!scene) throw new Error('missing fixture scene');
      const expected = [
        { kind: 'icon', icon: 'blinded' },
        { kind: 'text', text: 'Marked by the moon' },
      ];
      expect(scene.entities['01J8Z0000000000000000ENT01']?.token?.statusMarkers).toEqual(expected);
      await store.saveScene(campaignId, scene);
      expect(
        (await store.load(campaignId)).scenes[0]?.entities['01J8Z0000000000000000ENT01']?.token
          ?.statusMarkers,
      ).toEqual(expected);
    } finally {
      await store.close();
    }
  });
  it.each(['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10'])(
    'loads and saves %s through the lasting-AoE, archive and initiative migration chain',
    async (version) => {
      const store = new LocalCampaignStore(await copyFixture(version), storeMigrate);
      try {
        const loaded = await store.load(campaignId);
        expect(loaded.campaign.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        const since = (n: number) => Number(version.slice(1)) >= n;
        if (since(7)) {
          expect(loaded.campaign.seats['01J8Z0000000000000000SEAT2']).toMatchObject({
            archived: true,
            identityId: '00000000000000000000000001',
            interactionEnabled: false,
          });
          for (const scene of loaded.scenes)
            for (const entity of Object.values(scene.entities))
              expect(entity.owners).not.toContain('01J8Z0000000000000000SEAT2');
        }
        if (since(9)) {
          // UX-44: the new optional fields survive load and save; older saves simply lack them.
          expect(loaded.campaign.icon).toEqual({ kind: 'glyph', value: '\u2694' });
          expect(loaded.campaign.screenshot).toBe('a'.repeat(64));
          expect(loaded.campaign.seats['01J8Z0000000000000000SEAT2']?.icon).toEqual({
            kind: 'glyph',
            value: 'M',
          });
        } else {
          expect(loaded.campaign.icon).toBeUndefined();
        }
        for (const scene of loaded.scenes) {
          expect(scene.maxLastingAoEsPerPlayer).toBe(1);
          if (since(6)) {
            expect(Object.values(scene.entities).some((entity) => entity.lastingAoE)).toBe(true);
            expect(Object.values(scene.entities).some((entity) => entity.token?.quickFields)).toBe(
              true,
            );
          }
          expect(scene.initiative).toEqual(
            since(8)
              ? {
                  round: 2,
                  order: ['01J8Z0000000000000000ENT01', '01J8Z0000000000000000ENT02'],
                  activeEntityId: '01J8Z0000000000000000ENT01',
                  // UX-38: v10 adds initiative scores; older saves are unscored.
                  ...(since(10)
                    ? {
                        values: {
                          '01J8Z0000000000000000ENT01': 17,
                          '01J8Z0000000000000000ENT02': 9.5,
                        },
                      }
                    : {}),
                }
              : undefined,
          );
          await store.saveScene(campaignId, scene);
        }
        await store.saveCampaign(campaignId, loaded.campaign);
        const reloaded = await store.load(campaignId);
        expect(reloaded.scenes).toEqual(loaded.scenes);
        expect(reloaded.campaign).toEqual(loaded.campaign);
      } finally {
        await store.close();
      }
    },
  );
  it('still rejects a newer schemaVersion as unsupported', async () => {
    const root = await copyFixture();
    const path = join(root, 'campaigns', campaignId);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'campaign.json'), JSON.stringify({ schemaVersion: 99 }));
    const store = new LocalCampaignStore(root, storeMigrate);
    try {
      await expect(store.load(campaignId)).rejects.toMatchObject({ code: 'unsupported-version' });
    } finally {
      await store.close();
    }
  });
});
