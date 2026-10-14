import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionEnvelope, CURRENT_SCHEMA_VERSION, Scene } from '../index.js';
import {
  createStoreMigrate,
  MigrationError,
  runMigrations,
  storeMigrate,
  type MigrationStep,
} from './index.js';

const savesDir = fileURLToPath(new URL('../../../../fixtures/saves', import.meta.url));
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown;
const catch_ = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

// Test-only chain: a pretend v0 save stored `title`; v1 renamed it to `name`, v2 adds `tags`.
const chain: MigrationStep[] = [
  {
    from: 0,
    migrate: (p) => {
      const { title, ...rest } = p as { title: string };
      return { ...rest, name: title };
    },
  },
  { from: 1, migrate: (p) => ({ ...(p as object), tags: [] }) },
];

describe('runMigrations', () => {
  it('is a no-op at the current version', () => {
    const payload = { schemaVersion: 2, name: 'x' };
    expect(
      runMigrations({ kind: 'campaign', version: 2, currentVersion: 2, payload, steps: chain }),
    ).toBe(payload);
  });
  it('runs a registered chain in order and keeps schemaVersion in sync', () => {
    const payload = Object.freeze({ schemaVersion: 0, title: 'Old' });
    expect(
      runMigrations({ kind: 'campaign', version: 0, currentVersion: 2, payload, steps: chain }),
    ).toEqual({ schemaVersion: 2, name: 'Old', tags: [] });
    const order: number[] = [];
    const spy = chain.map((s) => ({
      ...s,
      migrate: (p: unknown, k: 'campaign' | 'scene' | 'snapshot' | 'session') => {
        order.push(s.from);
        return s.migrate(p, k);
      },
    }));
    runMigrations({
      kind: 'scene',
      version: 0,
      currentVersion: 2,
      payload: { title: 'a' },
      steps: spy,
    });
    expect(order).toEqual([0, 1]);
  });
  it('does not add schemaVersion to payloads that lack it (scenes)', () => {
    expect(
      runMigrations({
        kind: 'scene',
        version: 0,
        currentVersion: 2,
        payload: { title: 'a' },
        steps: chain,
      }),
    ).toEqual({ name: 'a', tags: [] });
  });
  it('rejects newer versions with a typed error', () => {
    const error = catch_(() =>
      runMigrations({ kind: 'scene', version: 99, payload: {}, steps: [] }),
    );
    expect(error).toBeInstanceOf(MigrationError);
    expect(error).toMatchObject({ code: 'newer-version', version: 99 });
  });
  it('rejects invalid versions and gaps in the chain', () => {
    expect(
      catch_(() => runMigrations({ kind: 'scene', version: -1, payload: {}, steps: [] })),
    ).toMatchObject({
      code: 'invalid-version',
    });
    expect(
      catch_(() => runMigrations({ kind: 'scene', version: 1.5, payload: {}, steps: [] })),
    ).toMatchObject({
      code: 'invalid-version',
    });
    expect(
      catch_(() =>
        runMigrations({ kind: 'scene', version: 0, currentVersion: 3, payload: {}, steps: chain }),
      ),
    ).toMatchObject({ code: 'missing-step', version: 2 });
  });
  it('honours per-kind steps', () => {
    const steps: MigrationStep[] = [{ from: 0, kinds: ['scene'], migrate: () => 'scene' }];
    expect(runMigrations({ kind: 'scene', version: 0, currentVersion: 1, payload: 1, steps })).toBe(
      'scene',
    );
    expect(
      catch_(() =>
        runMigrations({ kind: 'campaign', version: 0, currentVersion: 1, payload: 1, steps }),
      ),
    ).toMatchObject({ code: 'missing-step' });
  });
});

describe('createStoreMigrate', () => {
  it('builds a (kind, version, payload) hook; the shipped one is a no-op at current', () => {
    const payload = { id: 'x' };
    expect(storeMigrate('scene', CURRENT_SCHEMA_VERSION, payload)).toBe(payload);
    expect(catch_(() => storeMigrate('scene', CURRENT_SCHEMA_VERSION + 1, payload))).toBeInstanceOf(
      MigrationError,
    );
    expect(createStoreMigrate(chain, 2)('campaign', 0, { schemaVersion: 0, title: 't' })).toEqual({
      schemaVersion: 2,
      name: 't',
      tags: [],
    });
  });
});

describe('golden fixtures', () => {
  const versions = readdirSync(savesDir).filter((n) => /^v\d+$/.test(n));
  it('has a fixture for the current version', () => {
    expect(versions).toContain(`v${String(CURRENT_SCHEMA_VERSION)}`);
  });
  for (const dir of versions) {
    const version = Number(dir.slice(1));
    it(`${dir}: every file migrates to current and parses`, () => {
      const base = join(savesDir, dir, 'campaigns');
      for (const id of readdirSync(base)) {
        const campaign = readJson(join(base, id, 'campaign.json')) as { schemaVersion: number };
        expect(campaign.schemaVersion).toBe(version);
        const migrated = storeMigrate('campaign', version, campaign) as { schemaVersion: number };
        expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        for (const name of readdirSync(join(base, id, 'scenes'))) {
          const { schemaVersion, ...scene } = readJson(join(base, id, 'scenes', name)) as {
            schemaVersion: number;
          };
          expect(schemaVersion).toBe(version);
          expect(() => Scene.parse(storeMigrate('scene', version, scene))).not.toThrow();
        }
        for (const session of readdirSync(join(base, id, 'sessions'))) {
          const lines = readFileSync(join(base, id, 'sessions', session, 'log.jsonl'), 'utf8')
            .split('\n')
            .filter(Boolean);
          expect(lines.length).toBeGreaterThan(0);
          for (const line of lines)
            expect(() =>
              ActionEnvelope.parse((JSON.parse(line) as { envelope: unknown }).envelope),
            ).not.toThrow();
        }
      }
    });
  }
});
