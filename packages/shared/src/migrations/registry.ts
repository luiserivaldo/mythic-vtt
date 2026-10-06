import { CURRENT_SCHEMA_VERSION } from '../schema/index.js';
import { runMigrations, type MigrationStep, type SaveKind } from './runner.js';

/**
 * Append-only list of real migrations (one file per step: `v<N>-to-v<N+1>.ts`).
 * Empty while the current version is 1: there is no v0 save format.
 */
export const MIGRATION_STEPS: readonly MigrationStep[] = [];

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
