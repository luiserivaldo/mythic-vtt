// ENV-07: pure background/skybox model. No Three.js; Skybox.tsx turns this into a dome.

import { DEFAULT_BOARD_COLOR, OUTSIDE_FALLBACK } from './canvas-style.js';

export const DEFAULT_BACKGROUND = DEFAULT_BOARD_COLOR;
export const DEFAULT_SKYBOX_HORIZON = OUTSIDE_FALLBACK;
export const DEFAULT_ZENITH = '#284564';

export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parses #rgb / #rrggbb into 0..255 channels; anything else is null. */
export function parseColor(text: string | undefined): Rgb | null {
  const m = text === undefined ? null : HEX.exec(text.trim());
  if (!m?.[1]) return null;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const isValidColor = (text: string): boolean => parseColor(text) !== null;

export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Normalises to #rrggbb, falling back for malformed stored values (never throws). */
export function resolveColor(text: string | undefined, fallback = DEFAULT_BACKGROUND): string {
  const rgb = parseColor(text);
  return rgb ? toHex(rgb) : fallback;
}

export interface BackgroundSpec {
  /** Plain colour, or the horizon colour of a gradient. */
  horizon: string;
  /** Gradient top; null when the scene is a plain colour. */
  zenith: string | null;
}

export function resolveBackground(
  background: string | undefined,
  zenith: string | undefined,
): BackgroundSpec {
  const horizon = resolveColor(background);
  const top = parseColor(zenith);
  const usesDefault = parseColor(background) === null || horizon === DEFAULT_BACKGROUND;
  return {
    horizon: usesDefault ? DEFAULT_SKYBOX_HORIZON : horizon,
    zenith: top ? toHex(top) : usesDefault ? DEFAULT_ZENITH : null,
  };
}

/** Colour at elevation t in [-1, 1]: below the horizon stays the horizon colour. */
export function gradientAt(spec: BackgroundSpec, t: number): Rgb {
  const h = parseColor(spec.horizon) ?? [0, 0, 0];
  const z = spec.zenith ? parseColor(spec.zenith) : null;
  if (!z) return h;
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return [h[0] + (z[0] - h[0]) * k, h[1] + (z[1] - h[1]) * k, h[2] + (z[2] - h[2]) * k];
}

/** Per-vertex 0..1 RGB for a dome whose vertex heights (unit-sphere y) are given. */
export function domeColors(spec: BackgroundSpec, unitY: readonly number[]): Float32Array {
  const out = new Float32Array(unitY.length * 3);
  unitY.forEach((y, i) => {
    const c = gradientAt(spec, y);
    out[i * 3] = c[0] / 255;
    out[i * 3 + 1] = c[1] / 255;
    out[i * 3 + 2] = c[2] / 255;
  });
  return out;
}
