// TOK-09. Interim local table (M1-04 will own the canonical sizes in @mythic/shared; swap then).
// Entities store `sizeCells` directly; the names document the standard footprints.
export const SIZE_CELLS = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
} as const;

/** Footprint edge in cells; a malformed value falls back to one cell rather than vanishing. */
export function footprintCells(sizeCells: number | undefined): number {
  return sizeCells !== undefined && Number.isFinite(sizeCells) && sizeCells > 0 ? sizeCells : 1;
}
