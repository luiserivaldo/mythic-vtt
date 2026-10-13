import type { QrCode } from '../net/qr.js';

export interface QrSvg {
  readonly viewBox: string;
  /** Width of the viewBox in module pixels, including the quiet zone. */
  readonly extent: number;
  /** One subpath per dark module, so the drawing stays small and can be read back. */
  readonly path: string;
}

export interface QrSvgOptions {
  readonly modulePixels?: number;
  /** Light border a scanner needs around the symbol, in modules (four is the standard minimum). */
  readonly quietZone?: number;
}

export function qrSvg(code: QrCode, options: QrSvgOptions = {}): QrSvg {
  const scale = options.modulePixels ?? 4;
  const quietZone = options.quietZone ?? 4;
  const extent = (code.size + 2 * quietZone) * scale;
  const parts: string[] = [];
  code.modules.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (!cell) return;
      const x = (colIndex + quietZone) * scale;
      const y = (rowIndex + quietZone) * scale;
      parts.push(`M${String(x)} ${String(y)}h${String(scale)}v${String(scale)}h-${String(scale)}z`);
    });
  });
  return { viewBox: `0 0 ${String(extent)} ${String(extent)}`, extent, path: parts.join('') };
}
