import { DEFAULT_SCENE_BACKGROUND } from '@mythic/shared';

/** UI-SHELL-02 defaults keep the grey board distinct from dark blue space. Pure, no Three.js. */
export const DEFAULT_BOARD_COLOR = DEFAULT_SCENE_BACKGROUND;
export const OUTSIDE_FALLBACK = '#152942';
export const BORDER_COLOR = '#334155';
export const LABEL_BACKGROUND_COLOR = '#111827';
export const LABEL_TEXT_COLOR = '#f8fafc';
export const SELECTION_COLOR = '#9f1239';
export const RULER_LOCAL_COLOR = '#075985';
export const RULER_REMOTE_COLOR = '#9a3412';
export const AOE_HIGHLIGHT_COLOR = '#9a3412';
export const GHOST_COLOR = '#6d28d9';
export const DEFAULT_TOKEN_COLOR = '#0e7490';
export const GIZMO_MOVE_COLOR = '#7c2d12';
export const GIZMO_SCALE_COLOR = '#166534';
export const GIZMO_ROTATE_COLOR = '#075985';

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color);
  if (!m?.[1]) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
};

/** WCAG-style contrast ratio for two plain hex colours. */
export function contrastRatio(foreground: string, background: string): number | null {
  const front = parseHex(foreground);
  const back = parseHex(background);
  if (!front || !back) return null;
  const a = luminance(front);
  const b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Result of drawing a translucent foreground over an opaque background. */
export function compositeHex(
  foreground: string,
  background: string,
  opacity: number,
): string | null {
  const front = parseHex(foreground);
  const back = parseHex(background);
  if (!front || !back || !Number.isFinite(opacity)) return null;
  const alpha = Math.max(0, Math.min(1, opacity));
  const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  return `#${front.map((channel, index) => hex(channel * alpha + (back[index] ?? 0) * (1 - alpha))).join('')}`;
}

/**
 * The default board gets the dark-blue surround. Explicit backgrounds retain the established
 * derived surround, including the charcoal used for dark scenes.
 */
export function outsideColor(background: string | undefined): string {
  const rgb = background ? parseHex(background) : null;
  if (!rgb || background?.toLowerCase() === DEFAULT_BOARD_COLOR) return OUTSIDE_FALLBACK;
  if (luminance(rgb) < 0.12) return '#1b1c21';
  const grey = luminance(rgb) * 255;
  const mix = (c: number) => Math.round((c * 0.5 + grey * 0.5) * 0.35);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${rgb.map((c) => hex(mix(c))).join('')}`;
}
