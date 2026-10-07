import {
  distance,
  resolveSceneBounds,
  snapToGrid,
  toSceneUnits,
  UnsupportedGridError,
  type Grid,
  type Scene,
  type Vec3,
} from '@mythic/shared';
import { DRAG_THRESHOLD_PX } from '../render/camera-2d.js';

export interface RulerSegment {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly midpoint: Vec3;
  readonly cells: number;
  readonly label: string;
  readonly horizontalCells: number;
  readonly verticalCells: number;
  readonly horizontalLabel: string;
  readonly verticalLabel: string;
}

export interface RulerMeasurement {
  readonly segments: readonly RulerSegment[];
  readonly totalCells: number;
  readonly totalLabel: string;
  readonly horizontalCells: number;
  readonly verticalCells: number;
  readonly horizontalLabel: string;
  readonly verticalLabel: string;
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** MEAS-01: every ruler readout is converted from cells through the active scene's units. */
export function formatRulerDistance(cells: number, grid: Pick<Grid, 'unitsPerCell' | 'unitLabel'>) {
  const value = trim(toSceneUnits(cells, grid));
  const unit = grid.unitLabel.trim();
  return unit ? `${value} ${unit}` : value;
}

/** Segment distances are measured independently, then summed for a multi-waypoint total. */
export function measureRuler(points: readonly Vec3[], grid: Grid): RulerMeasurement {
  const segments: RulerSegment[] = [];
  let totalCells = 0;
  let horizontalCells = 0;
  let verticalCells = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    const measured = distance(from, to, grid.diagonal);
    const cells = measured.total;
    totalCells += cells;
    horizontalCells += measured.horizontal;
    verticalCells += measured.vertical;
    segments.push({
      from,
      to,
      midpoint: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 },
      cells,
      label: formatRulerDistance(cells, grid),
      horizontalCells: measured.horizontal,
      verticalCells: measured.vertical,
      horizontalLabel: formatRulerDistance(measured.horizontal, grid),
      verticalLabel: formatRulerDistance(measured.vertical, grid),
    });
  }
  return {
    segments,
    totalCells,
    totalLabel: formatRulerDistance(totalCells, grid),
    horizontalCells,
    verticalCells,
    horizontalLabel: formatRulerDistance(horizontalCells, grid),
    verticalLabel: formatRulerDistance(verticalCells, grid),
  };
}

/** Ground-plane point, snapped when the shared grid implementation supports that grid type. */
export function prepareRulerPoint(raw: Pick<Vec3, 'x' | 'z'>, scene: Scene): Vec3 {
  let point: Vec3 = { x: raw.x, y: 0, z: raw.z };
  try {
    point = snapToGrid(point, scene.grid);
  } catch (error) {
    // Hex snapping is not implemented by the shared geometry contract yet; measurement still works.
    if (!(error instanceof UnsupportedGridError)) throw error;
  }
  const bounds = resolveSceneBounds(scene);
  return {
    x: Math.max(0, Math.min(bounds.width, point.x)),
    y: 0,
    z: Math.max(0, Math.min(bounds.height, point.z)),
  };
}

export function sameRulerPoint(a: Vec3 | undefined, b: Vec3): boolean {
  return a?.x === b.x && a.y === b.y && a.z === b.z;
}

/** Screen-space threshold keeps a short press available for click-to-add waypoint mode. */
export function rulerDragStarted(
  start: { x: number; y: number },
  current: { x: number; y: number },
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= DRAG_THRESHOLD_PX;
}

/** Minimum gap between ruler broadcasts (under the host's 30/s ephemeral rate limit, M1-07). */
export const RULER_SEND_INTERVAL_MS = 60;
/** An active ruler is re-sent this often so a still pointer does not let it expire remotely. */
export const RULER_HEARTBEAT_MS = 1000;
/** A remote ruler with no fresh message for this long is dropped (the wire has no "ended" ack). */
export const RULER_ACTIVE_TTL_MS = 3500;
/** A finished remote ruler lingers briefly so others can read the final number. */
export const RULER_FINISHED_TTL_MS = 6000;
export const MAX_RULER_POINTS = 64;

export type RulerPhase = 'active' | 'finished' | 'cancelled';

export interface RemoteRuler {
  readonly sceneId: string;
  readonly points: readonly Vec3[];
  readonly phase: RulerPhase;
  readonly at: number;
}

/** Adds a waypoint unless it repeats the previous one (a double-click lands two clicks). */
export function appendWaypoint(points: readonly Vec3[], point: Vec3): readonly Vec3[] {
  if (sameRulerPoint(points[points.length - 1], point)) return points;
  if (points.length >= MAX_RULER_POINTS) return points;
  return [...points, point];
}

/** Waypoints plus the live cursor, collapsing a cursor that sits on the last waypoint. */
export function withCursor(points: readonly Vec3[], cursor: Vec3 | null): readonly Vec3[] {
  if (!cursor || sameRulerPoint(points[points.length - 1], cursor)) return points;
  return [...points, cursor];
}

export function shouldSendRuler(lastSentAt: number | null, now: number, force: boolean): boolean {
  return force || lastSentAt === null || now - lastSentAt >= RULER_SEND_INTERVAL_MS;
}

export function rulerExpired(ruler: RemoteRuler, now: number): boolean {
  if (ruler.phase === 'cancelled') return true;
  const ttl = ruler.phase === 'active' ? RULER_ACTIVE_TTL_MS : RULER_FINISHED_TTL_MS;
  return now - ruler.at >= ttl;
}

/** Name shown beside a remote ruler: the sender's seat label, or "DM" for a seatless sender. */
export function rulerOwnerName(
  seats: Readonly<Record<string, { label: string; identityId: string | null }>>,
  from: string,
): string {
  for (const seat of Object.values(seats)) {
    if (seat.identityId === from) return seat.label;
  }
  return 'DM';
}
