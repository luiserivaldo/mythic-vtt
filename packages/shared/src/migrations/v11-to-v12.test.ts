import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Campaign, CURRENT_SCHEMA_VERSION, Scene } from '../schema/index.js';
import { makeCampaign } from '../actions/testing.js';
import { createStoreMigrate, MigrationError, storeMigrate } from './index.js';
import { v11ToV12 } from './v11-to-v12.js';

const migrate = createStoreMigrate(undefined, 12);
const fixture = (version: string, file: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../../fixtures/saves/${version}/campaigns/01J8Z0000000000000000CAMP1/${file}`,
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ) as unknown;
const SCENE = 'scenes/01J8Z0000000000000000SCN01.json';

describe('v11 to v12 vision contract migration (FOG-01)', () => {
  it('is registered and is the current version', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(12);
    expect(v11ToV12.from).toBe(11);
  });

  it('is lossless: the v11 fixture comes through unchanged apart from schemaVersion', () => {
    const campaign = fixture('v11', 'campaign.json') as Record<string, unknown>;
    const before = structuredClone(campaign);
    expect(migrate('campaign', 11, campaign)).toEqual({ ...campaign, schemaVersion: 12 });
    expect(campaign).toEqual(before);
    const { schemaVersion, ...scene } = fixture('v11', SCENE) as Record<string, unknown>;
    expect(schemaVersion).toBe(11);
    expect(migrate('scene', 11, scene)).toBe(scene);
    expect(Scene.parse(migrate('scene', 11, scene))).toEqual(Scene.parse(scene));
  });

  it('bumps snapshot state, keeps seq, and never mutates its input', () => {
    const state = { ...makeCampaign(), schemaVersion: 11 };
    const before = structuredClone(state);
    const out = migrate('snapshot', 11, { schemaVersion: 11, state, seq: 7 });
    expect(out).toEqual({ schemaVersion: 12, state: { ...state, schemaVersion: 12 }, seq: 7 });
    expect(state).toEqual(before);
    expect(Campaign.parse((out as { state: unknown }).state).schemaVersion).toBe(12);
  });

  it('is idempotent: running the step twice equals running it once', () => {
    const state = { ...makeCampaign(), schemaVersion: 11 };
    for (const [kind, payload] of [
      ['snapshot', { schemaVersion: 11, state, seq: 1 }],
      ['campaign', state],
      ['scene', fixture('v11', SCENE)],
    ] as const) {
      const once = v11ToV12.migrate(payload, kind);
      expect(v11ToV12.migrate(once, kind)).toEqual(once);
    }
    // A v12 save is already current: the shipped hook leaves it alone.
    const v12 = fixture('v12', 'campaign.json');
    expect(storeMigrate('campaign', 12, v12)).toBe(v12);
  });

  it('passes malformed payloads through untouched', () => {
    expect(v11ToV12.migrate(null, 'snapshot')).toBeNull();
    expect(v11ToV12.migrate({ seq: 1 }, 'snapshot')).toEqual({ seq: 1 });
    expect(v11ToV12.migrate({ state: 3 }, 'snapshot')).toEqual({ state: 3 });
  });

  it('the v12 fixture parses and carries every vision field', () => {
    const { schemaVersion, ...raw } = fixture('v12', SCENE) as Record<string, unknown>;
    expect(schemaVersion).toBe(12);
    const scene = Scene.parse(raw);
    const entities = Object.values(scene.entities);
    expect(scene.vision).toEqual({ dynamicLighting: true });
    expect(entities.filter((e) => e.wall && !e.wall.door)).toHaveLength(1);
    const doors = entities.flatMap((e) => (e.wall?.door ? [e.wall.door] : []));
    expect(doors).toHaveLength(2);
    expect(doors).toEqual(expect.arrayContaining([{ open: false }, { open: false, secret: true }]));
    expect(entities.filter((e) => e.blocksSight && e.shape?.kind === 'box')).toHaveLength(1);
    const regions = entities.filter((e) => e.fogRegion);
    expect(regions).toHaveLength(2);
    expect(regions.every((e) => e.layer === 'map' && e.name !== '')).toBe(true);
    expect(regions.map((e) => e.fogRegion?.revealed)).toEqual(
      expect.arrayContaining([undefined, true]),
    );
    const campaign = Campaign.parse({ ...(fixture('v12', 'campaign.json') as object), scenes: {} });
    const tools = Object.values(campaign.seats).map((seat) => seat.tools);
    expect(tools.some((t) => t?.interact === true)).toBe(true);
    expect(tools.some((t) => t !== undefined && !('interact' in t))).toBe(true);
  });

  it('an older host still refuses a v12 save, and this host refuses anything newer', () => {
    const v11Host = createStoreMigrate(undefined, 11);
    expect(() => v11Host('campaign', 12, fixture('v12', 'campaign.json'))).toThrow(MigrationError);
    expect(() => storeMigrate('campaign', 13, {})).toThrow(MigrationError);
  });
});
