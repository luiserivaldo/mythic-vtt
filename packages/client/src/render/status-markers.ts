import type { StatusIcon, TokenStatusMarker } from '@mythic/shared';
import { footprintCells } from './token-footprint.js';
import { standeeDimensions } from './token-standee.js';

// TOK-06 / M4-19: pure helpers for the status-marker strip. No Three.js or DOM here so they are
// unit-testable; the component in TokenStatusMarkers.tsx only turns them into elements.

/**
 * The glyph shown for a condition icon. One table for the token strip and the editing panel, so
 * what the DM picks is exactly what the table sees.
 */
export const STATUS_ICON_GLYPHS: Record<StatusIcon, string> = {
  blinded: '◉',
  charmed: '♥',
  deafened: '♬',
  frightened: '⚠',
  grappled: '⚓',
  incapacitated: '⊘',
  invisible: '◌',
  paralyzed: '⚡',
  petrified: '◆',
  poisoned: '☠',
  prone: '↘',
  restrained: '⛓',
  stunned: '✦',
  unconscious: '☾',
  exhaustion: '⌛',
};

/** Readable name for an icon ("blinded" -> "Blinded"), used as the tooltip and in the panel. */
export function statusIconLabel(icon: StatusIcon): string {
  return icon.slice(0, 1).toUpperCase() + icon.slice(1);
}

/**
 * Text drawn on the token. The icon set comes from the schema, so the table is exhaustive; state
 * crossing versions is rejected at the wire boundary before it ever reaches the renderer.
 */
export function markerText(marker: TokenStatusMarker): string {
  switch (marker.kind) {
    case 'icon':
      return STATUS_ICON_GLYPHS[marker.icon];
    case 'text':
      return marker.text;
  }
}

/** Hover tooltip: the condition's name, or the custom marker's own text. */
export function markerTitle(marker: TokenStatusMarker): string {
  return marker.kind === 'icon' ? statusIconLabel(marker.icon) : marker.text;
}

/**
 * TOK-06: markers drawn on a token before the strip is summarised. The schema allows 32, which is
 * unreadable on a one-cell token, so the render stays a fixed number of chips (render budget).
 */
export const MAX_VISIBLE_MARKERS = 6;

export interface MarkerStrip {
  readonly shown: readonly TokenStatusMarker[];
  readonly overflow: number;
}

/** The chips to draw plus how many were left out. A malformed cap draws nothing rather than all. */
export function markerStrip(
  markers: readonly TokenStatusMarker[] | undefined,
  max: number = MAX_VISIBLE_MARKERS,
): MarkerStrip {
  const all = markers ?? [];
  const limit = Number.isNaN(max) ? 0 : Math.max(0, Math.floor(max));
  const shown = all.slice(0, limit);
  return { shown, overflow: all.length - shown.length };
}

/**
 * TOK-06: strip anchor in the 2D token's ground plane (see TOKEN_GROUND_FRAME), at the footprint's
 * top-right corner. Authored in the plane like the label and badge anchors, and sized from the same
 * footprint helper so a malformed size lands where the token mesh does.
 */
export function markerAnchor2d(sizeCells: number | undefined): readonly [number, number, number] {
  const half = footprintCells(sizeCells) / 2;
  return [half, half, 0];
}

/**
 * TOK-06: strip anchor for the 3D standee, at the top-right corner of the image quad. The name
 * label sits centred above that height, so the two overlays do not cover each other.
 */
export function markerAnchor3d(sizeCells: number | undefined): readonly [number, number, number] {
  const { width, height, baseThickness } = standeeDimensions(sizeCells);
  return [width / 2, baseThickness + height, 0];
}
