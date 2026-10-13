import type { SelectionActor } from '../tools/selection.js';
import { contrastRatio, LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR } from './canvas-style.js';
import { footprintCells } from './token-footprint.js';
import { HIDDEN_TOKEN_NAME, labelState, type LabelSubject } from './token-labels.js';
import { labelAnchor3d } from './token-standee.js';

/**
 * UI-TOKEN-01: gap between the card's bottom edge and what it must clear below — the 2D elevation
 * badge (drawn 0.2 above the token's top edge) or the 3D standee's label anchor.
 */
export const PREVIEW_GAP = 0.6;

/** UI-TOKEN-01 / §8: the least contrast a value colour may have against the card, in WCAG ratio. */
export const MIN_VALUE_CONTRAST = 3;

/**
 * UI-TOKEN-01 / TOK-04 / D35: the name the card may print. A name this viewer may not read —
 * including one the host already blanked — becomes the neutral stand-in, exactly as the board label
 * does, so a hidden name never reaches the card as data.
 */
export function previewName(subject: LabelSubject, actor: SelectionActor): string {
  return labelState(subject, actor) === 'visible' && subject.name.trim() !== ''
    ? subject.name
    : HIDDEN_TOKEN_NAME;
}

/**
 * UI-TOKEN-01: the card's anchor, in the view's "up": world -Z in the top-down 2D camera (the same
 * axis `TOKEN_GROUND_FRAME` gives the elevation badge) and world +Y in 3D, above the standee and
 * its label. The card itself is screen-space HTML (CAM-04), so it stays upright and readable at
 * every zoom. A malformed footprint clamps to one cell rather than anchoring the card at NaN.
 */
export function previewAnchor(
  mode: '2d' | '3d',
  position: readonly [number, number, number],
  sizeCells: number | undefined,
): readonly [number, number, number] {
  const cells = footprintCells(sizeCells);
  switch (mode) {
    case '2d':
      return [position[0], position[1], position[2] - (cells / 2 + PREVIEW_GAP)];
    case '3d':
      return [position[0], position[1] + labelAnchor3d(cells)[1] + PREVIEW_GAP, position[2]];
  }
}

/**
 * UI-TOKEN-01 / §8: the colour of a quick field's value. A colour the card cannot read against its
 * own background falls back to the card's text colour; the field's label still carries the meaning,
 * so colour is never the only signal.
 */
export function previewValueColor(color: string | null): string {
  if (color === null) return LABEL_TEXT_COLOR;
  return (contrastRatio(color, LABEL_BACKGROUND_COLOR) ?? 0) >= MIN_VALUE_CONTRAST
    ? color
    : LABEL_TEXT_COLOR;
}
