import { surfaceHeightAt, type WalkableSurface } from '@mythic/shared';
import { standeeDimensions } from './token-standee.js';
import type { RenderEntity, RenderScene } from './scene-model.js';

// M2-07 / TOK-05: pure geometry for the 3D drop line and ground shadow marker.

/** Within this height of the surface below, a token counts as standing on it: no helper is drawn. */
export const DROP_LINE_MIN_HEIGHT = 0.05;
/** The disc floats a hair above the surface to avoid z-fighting with it. */
export const DISC_LIFT = 0.012;
/** Disc diameter as a multiple of the token's base disc, so it reads as a soft shadow. */
export const DISC_RADIUS_SCALE = 1.1;

export interface DropLine {
  /** Token feet, world space. */
  from: readonly [number, number, number];
  /** Surface point directly below. */
  surfaceY: number;
  length: number;
  discRadius: number;
}

/** Walkable surfaces of a rendered scene (the walkable form of RenderShape, ENV-04). */
export function walkablesOf(entities: readonly RenderEntity[]): WalkableSurface[] {
  const out: WalkableSurface[] = [];
  for (const e of entities) {
    if (!e.shape?.walkable) continue;
    out.push({
      kind: e.shape.kind,
      position: { x: e.position[0], y: e.position[1], z: e.position[2] },
      scale: e.shape.scale,
      yaw: e.shape.yaw,
    });
  }
  return out;
}

/**
 * The line and disc for one token, or undefined when it stands on its surface. The surface below is
 * the highest walkable top at or below the token's feet (a platform overhead is not "below"), else the ground.
 */
export function dropLineFor(
  entity: Pick<RenderEntity, 'position' | 'sizeCells'>,
  walkables: readonly WalkableSurface[],
): DropLine | undefined {
  const [x, y, z] = entity.position;
  if (!Number.isFinite(y)) return undefined;
  const surfaceY = surfaceHeightAt(x, z, walkables, {
    currentElevation: y,
    maxStepUp: DROP_LINE_MIN_HEIGHT,
  });
  const length = y - surfaceY;
  if (length <= DROP_LINE_MIN_HEIGHT) return undefined;
  return {
    from: [x, y, z],
    surfaceY,
    length,
    discRadius: standeeDimensions(entity.sizeCells).baseRadius * DISC_RADIUS_SCALE,
  };
}

/** Every token in the scene that needs helpers. Only tokens the client received are rendered (PERM-03). */
export function dropLinesFor(scene: RenderScene): Array<{ id: string; line: DropLine }> {
  const walkables = walkablesOf(scene.entities);
  const out: Array<{ id: string; line: DropLine }> = [];
  for (const e of scene.entities) {
    if (!e.token) continue;
    const line = dropLineFor(e, walkables);
    if (line) out.push({ id: e.id, line });
  }
  return out;
}
