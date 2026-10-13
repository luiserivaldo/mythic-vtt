import { distance, type Entity, type Grid, type Scene, type Vec3 } from '@mythic/shared';
import { formatRulerDistance, type RulerMeasurement } from '../tools/ruler.js';
import type { ViewMode } from './view-mode-store.js';

/** MEAS-05: the three components of a token-to-token range, already in the scene's units. */
export interface RangeMeasurement {
  readonly cells: number;
  readonly horizontalCells: number;
  readonly verticalCells: number;
  /** Total distance, formatted with the scene's unit label ("30 ft"). */
  readonly label: string;
  readonly horizontalLabel: string;
  readonly verticalLabel: string;
}

/**
 * One wording for every measurement readout (the M3-06 ruler and the MEAS-05 range), so the two can
 * never drift apart while both are on screen.
 */
export function formatRangeBreakdown(
  horizontalLabel: string,
  verticalLabel: string,
  totalLabel: string,
): string {
  return `H ${horizontalLabel} · V ${verticalLabel} · T ${totalLabel}`;
}

/**
 * M3-11: a 3D ruler is one straight segment, so it reads its total length only; the MEAS-02
 * horizontal/vertical breakdown appears while the line or the label is hovered. A 2D ruler always
 * reads its total — its waypoints carry their own segment labels — so a hover never changes 2D.
 */
export function rulerLabel(
  measured: Pick<RulerMeasurement, 'horizontalLabel' | 'verticalLabel' | 'totalLabel'>,
  mode: ViewMode,
  hovered: boolean,
): string {
  return mode === '3d' && hovered
    ? formatRangeBreakdown(measured.horizontalLabel, measured.verticalLabel, measured.totalLabel)
    : measured.totalLabel;
}

/**
 * MEAS-05 measures through the same shared geometry and the same unit conversion as the ruler
 * (MEAS-01), so a range readout and a ruler between the same two points always agree.
 */
export function measureRange(from: Vec3, to: Vec3, grid: Grid): RangeMeasurement {
  const measured = distance(from, to, grid.diagonal);
  return {
    cells: measured.total,
    horizontalCells: measured.horizontal,
    verticalCells: measured.vertical,
    label: formatRulerDistance(measured.total, grid),
    horizontalLabel: formatRulerDistance(measured.horizontal, grid),
    verticalLabel: formatRulerDistance(measured.vertical, grid),
  };
}

/**
 * A range ends at a token, so a missing token component disqualifies that end. A non-finite
 * position (a corrupt transform reaching a client) does too, rather than printing "Infinity ft".
 */
function tokenPosition(entity: Entity | undefined): Vec3 | null {
  const position = entity?.token ? entity.transform.position : null;
  if (!position) return null;
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)
    ? position
    : null;
}

/**
 * The origin of a readout: exactly one selected token. Nothing selected means there is nothing to
 * measure from, and several selected tokens (shift-click) would make the origin arbitrary.
 */
export function selectedTokenId(scene: Scene | null, selected: readonly string[]): string | null {
  if (!scene) return null;
  const tokens = selected.filter((id) => tokenPosition(scene.entities[id]) !== null);
  return tokens.length === 1 ? (tokens[0] ?? null) : null;
}

export interface RangeTarget {
  readonly originId: string;
  readonly targetId: string;
  readonly origin: Vec3;
  readonly target: Vec3;
  readonly measurement: RangeMeasurement;
}

/**
 * MEAS-05: hovering one token while a different token is selected. Hovering the origin itself
 * shows nothing (a zero readout would only hide the token under a pill), and so does hovering an
 * entity without a token — the readout is token-to-token by definition.
 */
export function rangeTarget(
  scene: Scene | null,
  selected: readonly string[],
  hoveredId: string | null,
): RangeTarget | null {
  if (!scene || hoveredId === null) return null;
  const originId = selectedTokenId(scene, selected);
  if (originId === null || originId === hoveredId) return null;
  const origin = tokenPosition(scene.entities[originId]);
  const target = tokenPosition(scene.entities[hoveredId]);
  if (!origin || !target) return null;
  return {
    originId,
    targetId: hoveredId,
    origin,
    target,
    measurement: measureRange(origin, target, scene.grid),
  };
}
