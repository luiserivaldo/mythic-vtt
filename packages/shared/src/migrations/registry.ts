import { v9ToV10 } from './v9-to-v10.js';
import { v8ToV9 } from './v8-to-v9.js';
import { v7ToV8 } from './v7-to-v8.js';
import { v6ToV7 } from './v6-to-v7.js';
import { v5ToV6 } from './v5-to-v6.js';
import { v4ToV5 } from './v4-to-v5.js';
import { v3ToV4 } from './v3-to-v4.js';
import { v2ToV3 } from './v2-to-v3.js';
import { v1ToV2 } from './v1-to-v2.js';
import { CURRENT_SCHEMA_VERSION } from '../schema/index.js';
import { runMigrations, type MigrationStep, type SaveKind } from './runner.js';

/**
 * Append-only list of real migrations (one file per step: `v<N>-to-v<N+1>.ts`).
 * There is no v0 save format.
 */
export const MIGRATION_STEPS: readonly MigrationStep[] = [
  v1ToV2,
  v2ToV3,
  v3ToV4,
  v4ToV5,
  v5ToV6,
  v6ToV7,
  v7ToV8,
  v8ToV9,
  v9ToV10,
];

/**
 * Ready-made hook for the host store's injectable `migrate` option
 * (same shape as `Migration` in host/storage/types.ts).
 */
export function createStoreMigrate(
  steps: readonly MigrationStep[] = MIGRATION_STEPS,
  currentVersion: number = CURRENT_SCHEMA_VERSION,
): (kind: SaveKind, version: number, payload: unknown) => unknown {
  return (kind, version, payload) =>
    runMigrations({ kind, version, payload, steps, currentVersion });
}

export const storeMigrate = createStoreMigrate();
