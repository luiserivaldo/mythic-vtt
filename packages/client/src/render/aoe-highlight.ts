import {
  AoEShape,
  cellsInAoE,
  resolveSceneBounds,
  tokensInAoE,
  type AoE,
  type AoECell,
  type AoEInclusion,
  type Scene,
} from '@mythic/shared';

export interface AoEHighlightOverride {
  /** Replaces this stored AoE while it is edited; omitted for a new placement preview. */
  entityId?: string;
  aoe: AoE;
}

export interface AoEHighlightResult {
  cells: AoECell[];
  tokenIds: string[];
  /** D35: redacted names are empty and never enter this viewer-facing list. */
  tokenNames: string[];
  aoeCount: number;
}

const cellKey = (cell: AoECell): string => `${String(cell.x)}:${String(cell.y)}:${String(cell.z)}`;

/**
 * MEAS-04: derive highlights solely from the already host-filtered Scene (PERM-03). Local layer
 * hiding is an additional viewer filter; a placement/edit draft may replace or extend stored AoEs.
 */
export function deriveAoEHighlights(
  scene: Scene,
  options: {
    hiddenLayers?: ReadonlySet<string>;
    inclusion?: AoEInclusion;
    override?: AoEHighlightOverride | null;
  } = {},
): AoEHighlightResult {
  const hiddenLayers = options.hiddenLayers;
  const inclusion = options.inclusion ?? 'center';
  const override = options.override;
  const aoes: AoE[] = [];
  const tokens = Object.values(scene.entities).flatMap((entity) => {
    if (hiddenLayers?.has(entity.layer) || !entity.token) return [];
    return [
      {
        id: entity.id,
        name: entity.name,
        position: entity.transform.position,
        sizeCells: entity.token.sizeCells,
        heightCells: entity.token.heightCells,
      },
    ];
  });

  for (const entity of Object.values(scene.entities)) {
    if (
      hiddenLayers?.has(entity.layer) ||
      !entity.aoe ||
      (override?.entityId !== undefined && override.entityId === entity.id)
    )
      continue;
    const shape = AoEShape.safeParse(entity.aoe);
    if (shape.success)
      aoes.push({ ...shape.data, position: entity.transform.position, rotation: entity.transform.rotation });
  }
  if (override) aoes.push(override.aoe);

  const affectedTokens = new Map<string, (typeof tokens)[number]>();
  const affectedCells = new Map<string, AoECell>();
  const bounds = resolveSceneBounds(scene);
  for (const aoe of aoes) {
    for (const token of tokensInAoE(aoe, tokens, inclusion)) affectedTokens.set(token.id, token);
    for (const cell of cellsInAoE(aoe, scene.grid, inclusion)) {
      if (cell.x < 0 || cell.z < 0 || cell.x >= bounds.width || cell.z >= bounds.height) continue;
      affectedCells.set(cellKey(cell), cell);
    }
  }

  return {
    cells: [...affectedCells.values()],
    tokenIds: [...affectedTokens.keys()],
    tokenNames: [...affectedTokens.values()]
      .map((token) => token.name.trim())
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b)),
    aoeCount: aoes.length,
  };
}
