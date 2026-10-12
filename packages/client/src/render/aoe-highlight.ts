import {
  AoEShape,
  cellsInAoE,
  distance,
  resolveSceneBounds,
  tokensInAoE,
  type AoE,
  type AoECell,
  type AoEInclusion,
  type Entity,
  type Grid,
  type Scene,
} from '@mythic/shared';
import { formatRulerDistance } from '../tools/ruler.js';
import type { SelectionActor } from '../tools/selection.js';
import { HIDDEN_TOKEN_NAME, labelState, type LabelSubject, type TokenLabelState } from './token-labels.js';

export interface AoEHighlightOverride {
  /** Replaces this stored AoE while it is edited; omitted for a new placement preview. */
  entityId?: string;
  aoe: AoE;
}

/** MEAS-04: one affected token, already reduced to what this viewer's panel may show. */
export interface AoEAffectedToken {
  id: string;
  /** D35: the name this viewer may read, or the neutral placeholder. */
  label: string;
  /** D35: the viewer sees the token on the board but may not read its label. */
  labelHidden: boolean;
  /** Distance from the AoE origin in cells; the panel prints it in scene units (MEAS-01). */
  distanceCells: number;
}

/** MEAS-04: the affected tokens of one AoE, so the panel can list them per AoE. */
export interface AoEAffectedGroup {
  /** Stored AoE id; omitted for an unsaved placement or edit preview. */
  entityId?: string;
  /** Stored AoE name, or `<kind> AoE` while the AoE has no name yet. */
  name: string;
  kind: AoEShape['kind'];
  cellCount: number;
  tokens: AoEAffectedToken[];
}

export interface AoEHighlightResult {
  cells: AoECell[];
  tokenIds: string[];
  /** D35: redacted names are empty and never enter this viewer-facing list. */
  tokenNames: string[];
  aoeCount: number;
  /** MEAS-04: per-AoE affected lists for the HTML panel, in scene order. */
  groups: AoEAffectedGroup[];
}

const cellKey = (cell: AoECell): string => `${String(cell.x)}:${String(cell.y)}:${String(cell.z)}`;

/** Without a viewer the derivation keeps the host's full view, which is what the overlay draws. */
const DEFAULT_ACTOR: SelectionActor = { kind: 'host' };

/**
 * MEAS-01/MEAS-04: one affected-token distance converted through the active scene's units. A
 * non-finite distance, or a grid whose units cannot be converted, has no readable value at all;
 * a negative distance is clamped to zero.
 */
export function affectedDistanceLabel(
  cells: number,
  grid: Pick<Grid, 'unitsPerCell' | 'unitLabel'>,
): string {
  if (!Number.isFinite(cells)) return '';
  if (!Number.isFinite(grid.unitsPerCell) || grid.unitsPerCell <= 0) return '';
  return formatRulerDistance(Math.max(0, cells), grid);
}

/** The label fields of a token entity, for the D35 re-check. */
const labelSubject = (entity: Entity): LabelSubject => ({
  name: entity.name,
  layer: entity.layer,
  owners: entity.owners,
  ...(entity.perms === undefined ? {} : { perms: entity.perms }),
  // A token without its own setting has a label everyone reads (TOK-04).
  labelVisibility: entity.token?.labelVisibility ?? 'all',
});

/** Nearest first, with non-finite distances last and the id breaking ties (stable DOM order). */
const nearestFirst = (a: AoEAffectedToken, b: AoEAffectedToken): number => {
  const left = Number.isFinite(a.distanceCells) ? a.distanceCells : Number.POSITIVE_INFINITY;
  const right = Number.isFinite(b.distanceCells) ? b.distanceCells : Number.POSITIVE_INFINITY;
  return left - right || a.id.localeCompare(b.id);
};

interface AoEInScene {
  entityId?: string;
  name: string;
  aoe: AoE;
}

const fallbackName = (kind: AoEShape['kind'], name: string): string =>
  name === '' ? `${kind} AoE` : name;

/**
 * MEAS-04: derive highlights solely from the already host-filtered Scene (PERM-03) and the shared
 * containment helpers, never from a second client-side geometry. Local layer hiding and D35 label
 * visibility are additional viewer filters; a placement/edit draft may replace or extend stored AoEs.
 */
export function deriveAoEHighlights(
  scene: Scene,
  options: {
    hiddenLayers?: ReadonlySet<string>;
    inclusion?: AoEInclusion;
    override?: AoEHighlightOverride | null;
    /** D35: whose label visibility decides the panel rows. Defaults to the host's full view. */
    actor?: SelectionActor;
  } = {},
): AoEHighlightResult {
  const hiddenLayers = options.hiddenLayers;
  const inclusion = options.inclusion ?? 'center';
  const override = options.override;
  const actor = options.actor ?? DEFAULT_ACTOR;
  const tokens = Object.values(scene.entities).flatMap((entity) => {
    if (hiddenLayers?.has(entity.layer) || !entity.token) return [];
    return [
      {
        id: entity.id,
        entity,
        position: entity.transform.position,
        sizeCells: entity.token.sizeCells,
        heightCells: entity.token.heightCells,
      },
    ];
  });

  const aoes: AoEInScene[] = [];
  for (const entity of Object.values(scene.entities)) {
    if (hiddenLayers?.has(entity.layer) || !entity.aoe) continue;
    if (override?.entityId !== undefined && override.entityId === entity.id) continue;
    const shape = AoEShape.safeParse(entity.aoe);
    if (!shape.success) continue;
    aoes.push({
      entityId: entity.id,
      name: fallbackName(entity.aoe.kind, entity.name.trim()),
      aoe: {
        ...shape.data,
        position: entity.transform.position,
        rotation: entity.transform.rotation,
      },
    });
  }
  if (override) {
    // An edited AoE keeps the stored name; a fresh placement has no name until the host stores it.
    const stored = override.entityId === undefined ? undefined : scene.entities[override.entityId];
    aoes.push({
      ...(override.entityId === undefined ? {} : { entityId: override.entityId }),
      name: fallbackName(override.aoe.kind, stored?.name.trim() ?? ''),
      aoe: override.aoe,
    });
  }

  const affected = new Map<string, { token: (typeof tokens)[number]; state: TokenLabelState }>();
  const affectedCells = new Map<string, AoECell>();
  const bounds = resolveSceneBounds(scene);
  const groups: AoEAffectedGroup[] = [];
  for (const entry of aoes) {
    const inside = tokensInAoE(entry.aoe, tokens, inclusion);
    const cells = cellsInAoE(entry.aoe, scene.grid, inclusion).filter(
      (cell) => cell.x >= 0 && cell.z >= 0 && cell.x < bounds.width && cell.z < bounds.height,
    );
    for (const cell of cells) affectedCells.set(cellKey(cell), cell);
    const rows: AoEAffectedToken[] = [];
    for (const token of inside) {
      const state = labelState(labelSubject(token.entity), actor);
      // D35: a token this viewer cannot see at all is absent, never a placeholder.
      if (state === 'invisible') continue;
      const name = token.entity.name.trim();
      const readable = state === 'visible' && name !== '';
      affected.set(token.id, { token, state });
      rows.push({
        id: token.id,
        label: readable ? name : HIDDEN_TOKEN_NAME,
        labelHidden: !readable,
        distanceCells: distance(entry.aoe.position, token.position, scene.grid.diagonal).total,
      });
    }
    rows.sort(nearestFirst);
    groups.push({
      ...(entry.entityId === undefined ? {} : { entityId: entry.entityId }),
      name: entry.name,
      kind: entry.aoe.kind,
      cellCount: cells.length,
      tokens: rows,
    });
  }

  return {
    cells: [...affectedCells.values()],
    tokenIds: [...affected.keys()],
    tokenNames: [...affected.values()]
      .flatMap(({ token, state }) => {
        const name = token.entity.name.trim();
        return state === 'visible' && name !== '' ? [name] : [];
      })
      .sort((a, b) => a.localeCompare(b)),
    aoeCount: aoes.length,
    groups,
  };
}
