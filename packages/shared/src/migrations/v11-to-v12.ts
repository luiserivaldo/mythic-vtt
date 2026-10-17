import type { MigrationStep } from './runner.js';

/**
 * FOG-01 (MV-295, save v12, TECHNICAL.md D47 as amended by MV-303): vision data. Everything it adds
 * is optional (`Entity.wall`, `Entity.blocksSight`, `Entity.fogRegion`, `Scene.vision`,
 * `SeatTools.doors`), so a v11 save is already a valid v12 save and this step is the identity
 * apart from the snapshot's `schemaVersion`.
 *
 * The bump exists for older hosts, not for this one: a v11 host does not know walls, secret doors
 * or fog regions, so it would load a v12 save, strip nothing and send a closed secret door and the
 * names of walls and fog regions straight to players. Bumping the version makes it refuse the save
 * (`newer-version`) instead.
 */
export const v11ToV12: MigrationStep = {
  from: 11,
  migrate(payload, kind) {
    if (
      kind !== 'snapshot' ||
      typeof payload !== 'object' ||
      payload === null ||
      !('state' in payload)
    )
      return payload;
    const state = payload.state;
    if (typeof state !== 'object' || state === null) return payload;
    return { ...payload, state: { ...state, schemaVersion: 12 } };
  },
};
