import { describe, expect, it } from 'vitest';
import { encodeQrCode } from '../net/qr.js';
import { qrSvg } from './qr-svg.js';

function modulesFromPath(
  path: string,
  scale: number,
  quietZone: number,
  size: number,
): boolean[][] {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  for (const match of path.matchAll(/M(\d+) (\d+)h(\d+)v\d+h-\d+z/g)) {
    const col = Number(match[1]) / scale - quietZone;
    const row = Number(match[2]) / scale - quietZone;
    if (!Number.isInteger(col) || !Number.isInteger(row)) throw new Error(`off-grid ${match[0]}`);
    const target = grid[row];
    if (!target || target[col] === undefined) throw new Error(`off-grid ${match[0]}`);
    target[col] = true;
  }
  return grid;
}

describe('qr svg', () => {
  it('draws one square per dark module, inside a quiet zone', () => {
    const code = {
      version: 1,
      size: 2,
      mask: 0,
      formatBits: 0,
      modules: [
        [true, false],
        [false, true],
      ],
    };
    const svg = qrSvg(code, { modulePixels: 3, quietZone: 1 });
    // (2 modules + 1 module of quiet zone on each side) * 3 pixels per module.
    expect(svg.viewBox).toBe('0 0 12 12');
    expect(svg.path).toBe('M3 3h3v3h-3zM6 6h3v3h-3z');
  });

  it('maps a real code back to its own modules', () => {
    const code = encodeQrCode('identity payload '.repeat(3));
    const svg = qrSvg(code);
    expect(svg.viewBox).toBe(`0 0 ${String((code.size + 8) * 4)} ${String((code.size + 8) * 4)}`);
    expect(modulesFromPath(svg.path, 4, 4, code.size)).toEqual(
      code.modules.map((row) => row.map((cell) => cell)),
    );
  });

  it('handles an all-light matrix', () => {
    const svg = qrSvg({
      version: 1,
      size: 1,
      mask: 0,
      formatBits: 0,
      modules: [[false]],
    });
    expect(svg.path).toBe('');
    expect(svg.viewBox).toBe('0 0 36 36');
  });
});
