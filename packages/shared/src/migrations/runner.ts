import { CURRENT_SCHEMA_VERSION } from '../schema/index.js';

/** Root file kinds that carry a `schemaVersion` on disk. */
export type SaveKind = 'campaign' | 'scene' | 'snapshot' | 'session';

/**
 * A pure one-version step: takes a payload at version `from` and returns a new payload at `from + 1`.
 * It must not mutate its input and must never drop data (schema-change skill).
 */
export type MigrationStep = {
  readonly from: number;
  readonly kinds?: readonly SaveKind[];
  readonly migrate: (payload: unknown, kind: SaveKind) => unknown;
};

export type MigrationErrorCode = 'invalid-version' | 'newer-version' | 'missing-step';

export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly code: MigrationErrorCode,
    public readonly version: number,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export type MigrateOptions = {
  kind: SaveKind;
  version: number;
  payload: unknown;
  /** Defaults to the shared CURRENT_SCHEMA_VERSION; tests pass their own with a test-only chain. */
  currentVersion?: number;
  steps: readonly MigrationStep[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Brings a payload from `version` up to `currentVersion` by running steps in order.
 * If the payload carries a `schemaVersion` field (campaign files do), it is kept in sync.
 */
export function runMigrations(options: MigrateOptions): unknown {
  const { kind, version, steps } = options;
  const current = options.currentVersion ?? CURRENT_SCHEMA_VERSION;
  if (!Number.isInteger(version) || version < 0)
    throw new MigrationError(
      `Invalid schemaVersion: ${String(version)}`,
      'invalid-version',
      version,
    );
  if (version > current)
    throw new MigrationError(
      `schemaVersion ${String(version)} is newer than supported version ${String(current)}`,
      'newer-version',
      version,
    );
  let payload = options.payload;
  for (let at = version; at < current; at++) {
    const matching = steps.filter((s) => s.from === at && (!s.kinds || s.kinds.includes(kind)));
    if (matching.length !== 1)
      throw new MigrationError(
        `${matching.length === 0 ? 'No' : 'Ambiguous'} migration step from schemaVersion ${String(at)} for ${kind}`,
        'missing-step',
        at,
      );
    payload = (matching[0] as MigrationStep).migrate(payload, kind);
    if (isRecord(payload) && 'schemaVersion' in payload)
      payload = { ...payload, schemaVersion: at + 1 };
  }
  return payload;
}
