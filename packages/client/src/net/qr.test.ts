import { describe, expect, it } from 'vitest';
import { QR_GOLDEN } from './qr-golden.js';
import {
  encodeQrCode,
  qrCapacityBytes,
  qrMaskSets,
  qrModuleKind,
  qrPenalty,
  qrReadFormat,
  qrVersionBits,
} from './qr.js';

const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ALIGNMENT_CENTRES: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
];
const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
const ALIGNMENT = ['11111', '10001', '10101', '10001', '11111'];

function matrix(rows: readonly string[]): boolean[][] {
  return rows.map((row) => Array.from({ length: row.length }, (_, index) => row[index] === '1'));
}

function ascii(modules: readonly (readonly boolean[])[]): string {
  return modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('\n');
}

function window(
  modules: readonly (readonly boolean[])[],
  top: number,
  left: number,
  size: number,
): string[] {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) =>
      modules[top + row]?.[left + col] === true ? '1' : '0',
    ).join(''),
  );
}

function xor(a: boolean, b: boolean): boolean {
  return a !== b;
}

describe('qr encoder (byte mode, ECC L)', () => {
  it.each(QR_GOLDEN.map((golden) => [`v${String(golden.version)}`, golden] as const))(
    'matches an independent encoder on %s',
    (_name, golden) => {
      const code = encodeQrCode(golden.text);
      expect({ version: code.version, size: code.size }).toEqual({
        version: golden.version,
        size: 17 + 4 * golden.version,
      });
      const reference = matrix(golden.rows);
      const referenceFormat = qrReadFormat(reference);
      // The fixture's own format modules are a valid codeword and read as ECC L with mask 2. The
      // service that produced it always masks with pattern 2, so the mask itself is not compared
      // module for module: format modules are skipped and data modules are compared unmasked.
      expect(referenceFormat).toEqual({ bits: 0x7daa, ecc: 'L', mask: 2 });
      const differences: string[] = [];
      for (let row = 0; row < code.size; row++) {
        for (let col = 0; col < code.size; col++) {
          const kind = qrModuleKind(golden.version, row, col);
          if (kind === 'format') continue;
          const mine = code.modules[row]?.[col] === true;
          const theirs = reference[row]?.[col] === true;
          const equal =
            kind === 'data'
              ? xor(mine, qrMaskSets(code.mask, row, col)) === xor(theirs, qrMaskSets(2, row, col))
              : mine === theirs;
          if (!equal) differences.push(`${String(row)},${String(col)} (${kind})`);
        }
      }
      expect(differences).toEqual([]);
    },
  );

  it('covers the byte capacity of every supported version', () => {
    expect(SUPPORTED_VERSIONS.map(qrCapacityBytes)).toEqual([
      17, 32, 53, 78, 106, 134, 154, 192, 230,
    ]);
    expect(encodeQrCode('m'.repeat(17)).version).toBe(1);
    expect(encodeQrCode('m'.repeat(18)).version).toBe(2);
    expect(encodeQrCode('m'.repeat(106)).version).toBe(5);
    expect(encodeQrCode('m'.repeat(107)).version).toBe(6);
    expect(encodeQrCode('m'.repeat(230)).version).toBe(9);
    expect(() => encodeQrCode('m'.repeat(231))).toThrow(/too large/i);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // Nine characters, eighteen bytes: counting characters would pick version 1.
    expect(encodeQrCode('é'.repeat(9))).toMatchObject({ version: 2, size: 25 });
    expect(encodeQrCode('').version).toBe(1);
  });

  it.each(SUPPORTED_VERSIONS)('lays out the function patterns of version %i', (version) => {
    const code = encodeQrCode('x'.repeat(qrCapacityBytes(version)));
    const { size, modules } = code;
    expect(code.version).toBe(version);
    const at = (row: number, col: number): boolean => modules[row]?.[col] === true;
    for (const [row, col] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      expect(window(modules, row, col, 7)).toEqual(FINDER);
    }
    // Separators around the top-left finder are light.
    expect(code.modules[7]?.slice(0, 8)).toEqual(new Array<boolean>(8).fill(false));
    expect(Array.from({ length: 8 }, (_, row) => code.modules[row]?.[7])).toEqual(
      new Array<boolean>(8).fill(false),
    );
    // Timing patterns alternate, starting dark at even coordinates.
    for (let index = 8; index < size - 8; index++) {
      expect(at(6, index)).toBe(index % 2 === 0);
      expect(at(index, 6)).toBe(index % 2 === 0);
    }
    // The dark module sits beside the bottom-left finder.
    expect(at(size - 8, 8)).toBe(true);
    // Alignment patterns sit at the standard centres, except where a finder already covers them.
    const centres = ALIGNMENT_CENTRES[version - 1] ?? [];
    let placed = 0;
    for (const row of centres) {
      for (const col of centres) {
        if (
          (row === 6 && col === 6) ||
          (row === 6 && col === size - 7) ||
          (row === size - 7 && col === 6)
        )
          continue;
        expect(window(modules, row - 2, col - 2, 5)).toEqual(ALIGNMENT);
        placed++;
      }
    }
    expect(placed).toBe(centres.length === 0 ? 0 : centres.length ** 2 - 3);
  });

  it('picks the mask with the lowest penalty', () => {
    for (const text of ['hello', 'identity payload '.repeat(4)]) {
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) =>
        qrPenalty(encodeQrCode(text, { mask }).modules),
      );
      expect(encodeQrCode(text).mask).toBe(scores.indexOf(Math.min(...scores)));
    }
  });

  it('declares ECC L and its own mask in the format modules', () => {
    for (const version of [1, 2, 5, 6, 9]) {
      const code = encodeQrCode('x'.repeat(qrCapacityBytes(version)));
      expect(qrReadFormat(code.modules)).toEqual({
        bits: code.formatBits,
        ecc: 'L',
        mask: code.mask,
      });
    }
    // Both format copies are written.
    const code = encodeQrCode('hello');
    const copies: string[] = [];
    for (let bit = 0; bit < 15; bit++) {
      const value = ((code.formatBits >> bit) & 1) === 1;
      copies.push(value ? '1' : '0');
    }
    expect(copies.length).toBe(15);
    expect(qrReadFormat(code.modules)?.bits).toBe(code.formatBits);
  });

  it('writes the standard version information for versions 7 and up', () => {
    expect([7, 8, 9].map(qrVersionBits)).toEqual([0x07c94, 0x085bc, 0x09a99]);
    expect(qrVersionBits(6)).toBe(0);
    const bits = qrVersionBits(9);
    const code = encodeQrCode('x'.repeat(qrCapacityBytes(9)));
    // The blocks straddle the top-right and bottom-left corners, least significant bit first.
    for (let index = 0; index < 18; index++) {
      const row = Math.floor(index / 3);
      const col = (index % 3) + code.size - 11;
      const value = ((bits >> index) & 1) === 1;
      expect(code.modules[row]?.[col]).toBe(value);
      expect(code.modules[col]?.[row]).toBe(value);
    }
  });

  it('produces a stable, square matrix', () => {
    const code = encodeQrCode('hello');
    expect(code.size).toBe(code.modules.length);
    for (const row of code.modules) expect(row.length).toBe(code.size);
    expect(ascii(code.modules)).toBe(ascii(encodeQrCode('hello').modules));
    for (let row = 0; row < code.size; row++) {
      for (let col = 0; col < code.size; col++) {
        expect(typeof code.modules[row]?.[col]).toBe('boolean');
      }
    }
  });
});
