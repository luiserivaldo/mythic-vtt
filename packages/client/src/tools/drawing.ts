import {
  clampDrawWidth,
  dropElevation,
  finiteDrawPoint,
  resolveSceneBounds,
  surfaceHeightAt,
  walkableFromEntity,
  type Scene,
  type Vec3,
  type WalkableSurface,
} from '@mythic/shared';

// LAY-05: the client's view of the drawing layer. A stroke is render-local plus a relayed
// ephemeral; nothing here is game state and nothing is ever an action. The helpers stay pure so
// the ribbon maths and the ownership rules can be tested without a canvas.

/** One freehand stroke as this client holds it: mine while the pointer is down, or relayed. */
export interface DrawStroke {
  readonly sceneId: string;
  readonly strokeId: string;
  /** The author's identity, as set by the host relay (never the sender's own claim). */
  readonly from: string;
  readonly color: string;
  readonly width: number;
  readonly points: readonly Vec3[];
  readonly phase: 'active' | 'finished';
  /** Local arrival time: orders the strips and prunes the oldest. */
  readonly at: number;
}

/** The ruler lifts by the same amount; a drawing must not hide a ruler readout. */
export const DRAW_LIFT = 0.05;
/** Minimum gap between live stroke broadcasts, under the host's 30/s ephemeral rate limit. */
export const DRAW_SEND_INTERVAL_MS = 60;
/** Local memory of drawings, mirroring the host relay's own bound. */
export const MAX_SCENE_STROKES = 512;
export const MAX_STROKE_SCENES = 64;

export interface RibbonGeometry {
  /** Flat x, y, z triples, two vertices per stroke sample. */
  readonly positions: number[];
  readonly indices: number[];
}

/**
 * Turns a freehand path into one triangle strip of the given scene-unit width. Widths are scene
 * units, so the strip is real geometry: it keeps its thickness at any zoom and looks the same in
 * 2D and 3D. A path that cannot make a strip (fewer than two samples, a non-finite sample or a
 * non-finite width) returns null and simply draws nothing.
 */
export function ribbonGeometry(points: readonly Vec3[], width: number): RibbonGeometry | null {
  if (points.length < 2 || !Number.isFinite(width)) return null;
  if (!points.every(finiteDrawPoint)) return null;
  const half = clampDrawWidth(width) / 2;

  // The strip runs in the ground plane, so each sample needs a perpendicular in x/z. A segment
  // that only moves vertically has no perpendicular there; it falls back to +x.
  const segmentNormals: [number, number][] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) return null;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    segmentNormals.push(length === 0 ? [1, 0] : [-dz / length, dx / length]);
  }

  const sampleNormal = (index: number): [number, number] => {
    const before = segmentNormals[index - 1];
    const after = segmentNormals[index];
    if (before === undefined) return after ?? [1, 0];
    if (after === undefined) return before;
    // Averaging the two joins the segments without a gap; a 180-degree turn has no average.
    const x = before[0] + after[0];
    const z = before[1] + after[1];
    const length = Math.hypot(x, z);
    return length === 0 ? after : [x / length, z / length];
  };

  const positions: number[] = [];
  for (const [index, point] of points.entries()) {
    const normal = sampleNormal(index);
    positions.push(
      point.x + normal[0] * half,
      point.y + DRAW_LIFT,
      point.z + normal[1] * half,
      point.x - normal[0] * half,
      point.y + DRAW_LIFT,
      point.z - normal[1] * half,
    );
  }
  const indices: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = index * 2;
    indices.push(left, left + 1, left + 2, left + 2, left + 1, left + 3);
  }
  return { positions, indices };
}

/** Broadcast throttle: a whole stroke is always sent, its live updates are spaced out. */
export function shouldSendStroke(lastSentAt: number | null, now: number, force: boolean): boolean {
  return force || lastSentAt === null || now - lastSentAt >= DRAW_SEND_INTERVAL_MS;
}

/** The drawings of one scene, oldest first, so a later stroke covers an earlier one. */
export function sceneStrokes(strokes: readonly DrawStroke[], sceneId: string | null): DrawStroke[] {
  if (sceneId === null) return [];
  return strokes
    .filter((stroke) => stroke.sceneId === sceneId)
    .sort((a, b) => (a.at === b.at ? a.strokeId.localeCompare(b.strokeId) : a.at - b.at));
}

/**
 * What the eraser may remove here: a viewer erases their own drawings, the DM erases any. This is
 * only what the UI offers — the host refuses an erase that is not the author's.
 */
export function erasableStrokes(
  strokes: readonly DrawStroke[],
  sceneId: string | null,
  viewerIdentityId: string,
  isDm: boolean,
): DrawStroke[] {
  return sceneStrokes(strokes, sceneId).filter(
    (stroke) => isDm || stroke.from === viewerIdentityId,
  );
}

/**
 * A pointer hit on the board as a drawing sample: clamped to the canvas (D37, like every other
 * position) but deliberately never snapped to the grid — a freehand line follows the pointer.
 * A non-finite hit resolves to null so a broken strip is never built.
 */
export function drawPointOnBoard(raw: { x: number; z: number }, scene: Scene): Vec3 | null {
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.z)) return null;
  const bounds = resolveSceneBounds(scene);
  return {
    x: Math.min(bounds.width, Math.max(0, raw.x)),
    y: 0,
    z: Math.min(bounds.height, Math.max(0, raw.z)),
  };
}

/**
 * MEAS-02-style resolution for a 3D pointer hit: a token is drawn on at its own position, any
 * other hit uses the shared surface profile so a stroke on a platform keeps that height.
 */
export function drawPoint3d(raw: Vec3, scene: Scene, entityId?: string): Vec3 | null {
  const entity = entityId === undefined ? undefined : scene.entities[entityId];
  if (entity?.token) return { ...entity.transform.position };
  const horizontal = drawPointOnBoard({ x: raw.x, z: raw.z }, scene);
  if (horizontal === null || !Number.isFinite(raw.y)) return null;
  const surfaces = drawingSurfaces(scene);
  const highest = surfaceHeightAt(horizontal.x, horizontal.z, surfaces);
  const dropped = dropElevation({ x: horizontal.x, y: raw.y, z: horizontal.z }, surfaces);
  return { ...horizontal, y: dropped > 0 || raw.y <= 0 ? dropped : highest };
}

/** Visible walkable geometry is already audience-filtered in the client's scene (PERM-03). */
function drawingSurfaces(scene: Scene): readonly WalkableSurface[] {
  return Object.values(scene.entities).flatMap((entity) => {
    const surface = walkableFromEntity(entity);
    return surface ? [surface] : [];
  });
}
