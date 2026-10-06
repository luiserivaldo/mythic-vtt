/**
 * D37: colours for the scene canvas. Inside the bounds the scene's own background shows;
 * outside is a darker neutral so the edge reads at a glance. Pure, no Three.js.
 */
export const OUTSIDE_FALLBACK = '#1b1c21';
export const BORDER_COLOR = '#e8c46a';

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color);
  if (!m?.[1]) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const luminance = ([r, g, b]: [number, number, number]) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Outside colour for a scene background. Bright backgrounds are darkened toward neutral;
 * backgrounds that are already dark (or not a plain hex) use a fixed charcoal.
 */
export function outsideColor(background: string | undefined): string {
  const rgb = background ? parseHex(background) : null;
  if (!rgb || luminance(rgb) < 0.12) return OUTSIDE_FALLBACK;
  const grey = luminance(rgb) * 255;
  const mix = (c: number) => Math.round((c * 0.5 + grey * 0.5) * 0.35);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${rgb.map((c) => hex(mix(c))).join('')}`;
}
