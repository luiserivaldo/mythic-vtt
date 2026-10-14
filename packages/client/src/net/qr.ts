/**
 * QR Code generation for identity transfer (SES-09).
 *
 * Byte mode at error-correction level L, versions 1-9, no dependency: the client ships no QR
 * library and the payload (a small JSON document holding one identity) never needs more than the
 * 232 bytes version 9 holds. `qr.test.ts` pins the output against matrices from an independent
 * encoder in `qr-golden.ts`.
 */

export type QrModuleKind = 'data' | 'function' | 'format' | 'version';

export interface QrCode {
  readonly version: number;
  readonly size: number;
  /** Mask pattern applied to the data modules (0-7). */
  readonly mask: number;
  /** The 15 format bits stored in the symbol, mask included. */
  readonly formatBits: number;
  readonly modules: readonly (readonly boolean[])[];
}

export interface QrOptions {
  /** Force a mask pattern (0-7); the default scores all eight and keeps the cheapest. */
  readonly mask?: number;
}

/** Byte-mode error correction blocks at level L, indexed by `version - 1`. */
interface QrLayout {
  readonly ecPerBlock: number;
  /** `[block count, data codewords per block]`, group 1 then group 2. */
  readonly groups: readonly (readonly [number, number])[];
}

const LAYOUTS_L: readonly QrLayout[] = [
  { ecPerBlock: 7, groups: [[1, 19]] },
  { ecPerBlock: 10, groups: [[1, 34]] },
  { ecPerBlock: 15, groups: [[1, 55]] },
  { ecPerBlock: 20, groups: [[1, 80]] },
  { ecPerBlock: 26, groups: [[1, 108]] },
  { ecPerBlock: 18, groups: [[2, 68]] },
  { ecPerBlock: 20, groups: [[2, 78]] },
  { ecPerBlock: 24, groups: [[2, 97]] },
  { ecPerBlock: 30, groups: [[2, 116]] },
];

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

/** Bits left over after the last codeword: filled with light modules. */
const REMAINDER_BITS: readonly number[] = [0, 7, 7, 7, 7, 7, 0, 0, 0];

const MAX_VERSION = LAYOUTS_L.length;

/** Cell order of the first format copy, most significant bit first. */
const FORMAT_COPY_1: readonly (readonly [number, number])[] = [
  [8, 0],
  [8, 1],
  [8, 2],
  [8, 3],
  [8, 4],
  [8, 5],
  [8, 7],
  [8, 8],
  [7, 8],
  [5, 8],
  [4, 8],
  [3, 8],
  [2, 8],
  [1, 8],
  [0, 8],
];

function layoutFor(version: number): QrLayout {
  if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION)
    throw new Error(`QR version ${String(version)} is not supported.`);
  const layout = LAYOUTS_L[version - 1];
  if (!layout) throw new Error(`QR version ${String(version)} is not supported.`);
  return layout;
}

export function qrModuleCount(version: number): number {
  layoutFor(version);
  return 17 + 4 * version;
}

/** Text bytes that fit in `version` at level L, byte mode. */
export function qrCapacityBytes(version: number): number {
  const layout = layoutFor(version);
  const codewords = layout.groups.reduce((sum, [count, per]) => sum + count * per, 0);
  // Four mode bits plus an eight-bit character count for versions 1-9, rounded up to 2 bytes.
  return codewords - 2;
}

function dataCodewords(version: number): number {
  const layout = layoutFor(version);
  const total = layout.groups.reduce((sum, [count, per]) => sum + count * per, 0);
  const blocks = layout.groups.reduce((sum, [count]) => sum + count, 0);
  return total + blocks * layout.ecPerBlock;
}

function versionFor(byteLength: number): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    if (byteLength <= qrCapacityBytes(version)) return version;
  }
  throw new Error(
    `The QR code payload is too large: ${String(byteLength)} bytes, at most ${String(qrCapacityBytes(MAX_VERSION))}.`,
  );
}

/**
 * Which cells a version reserves: finder patterns with their separators, timing patterns,
 * alignment patterns, both format copies, the dark module, and the version information blocks.
 */
export function qrModuleKind(version: number, row: number, col: number): QrModuleKind {
  const size = qrModuleCount(version);
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    col < 0 ||
    row >= size ||
    col >= size
  )
    throw new Error(`Cell ${String(row)},${String(col)} is outside version ${String(version)}.`);
  return buildKinds(version)[row]?.[col] ?? 'data';
}

function buildKinds(version: number): QrModuleKind[][] {
  const size = qrModuleCount(version);
  const kinds: QrModuleKind[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, (): QrModuleKind => 'data'),
  );
  const reserve = (r: number, c: number, kind: QrModuleKind): void => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    const target = kinds[r];
    if (target) target[c] = kind;
  };
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) reserve(top + r, left + c, 'function');
    }
  }
  for (let index = 0; index < size; index++) {
    reserve(6, index, 'function');
    reserve(index, 6, 'function');
  }
  const centres = ALIGNMENT_CENTRES[version - 1] ?? [];
  for (const centreRow of centres) {
    for (const centreCol of centres) {
      if (
        (centreRow === 6 && centreCol === 6) ||
        (centreRow === 6 && centreCol === size - 7) ||
        (centreRow === size - 7 && centreCol === 6)
      )
        continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) reserve(centreRow + r, centreCol + c, 'function');
      }
    }
  }
  for (const [r, c] of FORMAT_COPY_1) reserve(r, c, 'format');
  for (let index = 0; index < 7; index++) reserve(size - 1 - index, 8, 'format');
  for (let index = 0; index < 8; index++) reserve(8, size - 8 + index, 'format');
  reserve(size - 8, 8, 'function');
  if (version >= 7) {
    for (let index = 0; index < 18; index++) {
      const row = Math.floor(index / 3);
      const col = (index % 3) + size - 11;
      reserve(row, col, 'version');
      reserve(col, row, 'version');
    }
  }
  return kinds;
}

/** The eight data masks of ISO/IEC 18004 table 23. `mask` outside 0-7 is a programming error. */
export function qrMaskSets(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      throw new Error(`Mask pattern ${String(mask)} does not exist.`);
  }
}

/**
 * The standard mask evaluation (rules 1-4). Lower is better; the encoder keeps the cheapest of
 * the eight masked candidates, which is what decoders expect of a well-formed symbol.
 */
export function qrPenalty(modules: readonly (readonly boolean[])[]): number {
  const rows = modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join(''));
  const size = rows.length;
  let score = 0;
  const runsOf = (line: string): number => {
    let total = 0;
    let run = 1;
    for (let index = 1; index <= line.length; index++) {
      if (index < line.length && line[index] === line[index - 1]) {
        run++;
      } else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    return total;
  };
  for (let index = 0; index < size; index++) {
    score += runsOf(rows[index] ?? '');
    score += runsOf(rows.map((row) => row[index] ?? '0').join(''));
  }
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const cell = rows[row]?.[col];
      if (
        cell !== undefined &&
        cell === rows[row]?.[col + 1] &&
        cell === rows[row + 1]?.[col] &&
        cell === rows[row + 1]?.[col + 1]
      )
        score += 3;
    }
  }
  const lines = [...rows];
  for (let index = 0; index < size; index++) {
    lines.push(rows.map((row) => row[index] ?? '0').join(''));
  }
  for (const line of lines) {
    for (let index = 0; index + 11 <= line.length; index++) {
      const pattern = line.slice(index, index + 11);
      if (pattern === '10111010000' || pattern === '00001011101') score += 40;
    }
  }
  let dark = 0;
  for (const row of rows) for (const cell of row) if (cell === '1') dark++;
  const percent = (dark * 100) / (size * size);
  score += 10 * Math.floor(Math.abs(percent - 50) / 5);
  return score;
}

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let value = 1, index = 0; index < 255; index++) {
  EXP[index] = value;
  LOG[value] = index;
  value <<= 1;
  if ((value & 0x100) !== 0) value ^= 0x11d;
}
for (let index = 255; index < 512; index++) EXP[index] = EXP[index - 255] ?? 0;

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return EXP[(LOG[left] ?? 0) + (LOG[right] ?? 0)] ?? 0;
}

/** Reed-Solomon generator polynomial of `degree`, leading coefficient first. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let index = 0; index < degree; index++) {
    const factor = EXP[index] ?? 1;
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let position = 0; position < poly.length; position++) {
      const coefficient = poly[position] ?? 0;
      next[position] = (next[position] ?? 0) ^ coefficient;
      next[position + 1] = (next[position + 1] ?? 0) ^ gfMultiply(coefficient, factor);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data: readonly number[], degree: number): number[] {
  const generator = generatorPoly(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] ?? 0);
    for (let index = 0; index < degree - 1; index++) remainder[index] = remainder[index + 1] ?? 0;
    remainder[degree - 1] = 0;
    for (let index = 0; index < degree; index++) {
      remainder[index] = (remainder[index] ?? 0) ^ gfMultiply(generator[index + 1] ?? 0, factor);
    }
  }
  return remainder;
}

/** Mode indicator, character count, payload, terminator and pad codewords. */
function dataCodewordStream(bytes: Uint8Array, capacity: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number): void => {
    for (let index = length - 1; index >= 0; index--) bits.push((value >> index) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);
  for (let index = 0; index < 4 && bits.length < capacity * 8; index++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset++) byte = (byte << 1) | (bits[index + offset] ?? 0);
    codewords.push(byte);
  }
  for (let index = 0; codewords.length < capacity; index++)
    codewords.push(index % 2 === 0 ? 0xec : 0x11);
  return codewords;
}

/** Splits into blocks, appends the Reed-Solomon parity, then interleaves both runs. */
function interleavedCodewords(version: number, codewords: readonly number[]): number[] {
  const layout = layoutFor(version);
  const blocks: { data: number[]; parity: number[] }[] = [];
  let offset = 0;
  for (const [count, perBlock] of layout.groups) {
    for (let block = 0; block < count; block++) {
      const data = codewords.slice(offset, offset + perBlock);
      offset += perBlock;
      blocks.push({ data, parity: errorCorrection(data, layout.ecPerBlock) });
    }
  }
  const out: number[] = [];
  const widest = Math.max(...blocks.map((block) => block.data.length));
  for (let index = 0; index < widest; index++) {
    for (const block of blocks) {
      const codeword = block.data[index];
      if (codeword !== undefined) out.push(codeword);
    }
  }
  for (let index = 0; index < layout.ecPerBlock; index++) {
    for (const block of blocks) {
      const codeword = block.parity[index];
      if (codeword !== undefined) out.push(codeword);
    }
  }
  return out;
}

function bchRemainder(value: number, poly: number, dataBits: number, degree: number): number {
  let remainder = value;
  for (let index = dataBits - 1; index >= 0; index--) {
    if ((remainder & (1 << (index + degree))) !== 0) remainder ^= poly << index;
  }
  return remainder & ((1 << degree) - 1);
}

function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask;
  const codeword = (data << 10) | bchRemainder(data << 10, 0x537, 5, 10);
  return codeword ^ 0x5412;
}

/** The 18 version bits written in versions 7 and up, or 0 below that. */
export function qrVersionBits(version: number): number {
  layoutFor(version);
  if (version < 7) return 0;
  return (version << 12) | bchRemainder(version << 12, 0x1f25, 6, 12);
}

/** Reads the format modules back, preferring `null` to a corrupt symbol. */
export function qrReadFormat(
  modules: readonly (readonly boolean[])[],
): { bits: number; ecc: 'L' | 'M' | 'Q' | 'H'; mask: number } | null {
  const size = modules.length;
  const read = (cells: readonly (readonly [number, number])[]): number =>
    cells.reduce((bits, [row, col]) => (bits << 1) | (modules[row]?.[col] === true ? 1 : 0), 0);
  if (size < 21) return null;
  const copy1 = read(FORMAT_COPY_1);
  const copy2 = read([
    ...Array.from({ length: 7 }, (_, index): readonly [number, number] => [size - 1 - index, 8]),
    ...Array.from({ length: 8 }, (_, index): readonly [number, number] => [8, size - 8 + index]),
  ]);
  if (copy1 !== copy2) return null;
  const codeword = copy1 ^ 0x5412;
  if (bchRemainder(codeword, 0x537, 5, 10) !== 0) return null;
  const ecc = (['M', 'L', 'H', 'Q'] as const)[codeword >> 13];
  if (ecc === undefined) return null;
  return { bits: copy1, ecc, mask: (codeword >> 10) & 0b111 };
}

export function encodeQrCode(text: string, options: QrOptions = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  const size = qrModuleCount(version);
  const kinds = buildKinds(version);
  const modules: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const dark = (row: number, col: number, value: boolean): void => {
    const target = modules[row];
    if (target && col >= 0 && col < size) target[col] = value;
  };
  const filled = (row: number, col: number): boolean => kinds[row]?.[col] !== 'data';

  // Function patterns.
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        const edge = row === 0 || row === 6 || col === 0 || col === 6;
        const core = row >= 2 && row <= 4 && col >= 2 && col <= 4;
        dark(top + row, left + col, edge || core);
      }
    }
  }
  for (let index = 8; index < size - 8; index++) {
    dark(6, index, index % 2 === 0);
    dark(index, 6, index % 2 === 0);
  }
  const centres = ALIGNMENT_CENTRES[version - 1] ?? [];
  for (const centreRow of centres) {
    for (const centreCol of centres) {
      if (
        (centreRow === 6 && centreCol === 6) ||
        (centreRow === 6 && centreCol === size - 7) ||
        (centreRow === size - 7 && centreCol === 6)
      )
        continue;
      for (let row = -2; row <= 2; row++) {
        for (let col = -2; col <= 2; col++) {
          const edge = Math.abs(row) === 2 || Math.abs(col) === 2;
          dark(centreRow + row, centreCol + col, edge || (row === 0 && col === 0));
        }
      }
    }
  }
  dark(size - 8, 8, true);
  const versionBits = qrVersionBits(version);
  if (version >= 7) {
    // Both encoders used as references place the least significant bit at (0, size - 11) and walk
    // the 6x3 block row by row; the second block is its transpose.
    for (let index = 0; index < 18; index++) {
      const row = Math.floor(index / 3);
      const col = (index % 3) + size - 11;
      const value = ((versionBits >> index) & 1) === 1;
      dark(row, col, value);
      dark(col, row, value);
    }
  }

  // Data modules, bottom-right first, alternating upwards.
  const stream = interleavedCodewords(version, dataCodewordStream(bytes, dataCodewords(version)));
  const bits: boolean[] = [];
  for (const codeword of stream) {
    for (let index = 7; index >= 0; index--) bits.push(((codeword >> index) & 1) === 1);
  }
  for (let index = 0; index < (REMAINDER_BITS[version - 1] ?? 0); index++) bits.push(false);
  let bit = 0;
  let upwards = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upwards ? size - 1 - step : step;
      for (let col = right; col > right - 2; col--) {
        if (filled(row, col)) continue;
        dark(row, col, bits[bit] === true);
        bit++;
      }
    }
    upwards = !upwards;
  }
  if (bit !== bits.length) throw new Error('The QR data does not fill the symbol exactly.');

  const masked = (mask: number): boolean[][] =>
    modules.map((row, rowIndex) =>
      row.map((cell, colIndex) =>
        (kinds[rowIndex]?.[colIndex] ?? 'data') === 'data' && qrMaskSets(mask, rowIndex, colIndex)
          ? !cell
          : cell,
      ),
    );
  const withFormat = (matrix: boolean[][], mask: number): boolean[][] => {
    const copy = matrix.map((row) => [...row]);
    const bitsForMask = formatBits(mask);
    const write = (row: number, col: number, value: boolean): void => {
      const target = copy[row];
      if (target && col >= 0 && col < size) target[col] = value;
    };
    FORMAT_COPY_1.forEach(([row, col], index) => {
      write(row, col, ((bitsForMask >> (14 - index)) & 1) === 1);
    });
    for (let index = 0; index < 7; index++)
      write(size - 1 - index, 8, ((bitsForMask >> (14 - index)) & 1) === 1);
    for (let index = 0; index < 8; index++)
      write(8, size - 8 + index, ((bitsForMask >> (7 - index)) & 1) === 1);
    return copy;
  };

  const requested = options.mask;
  let mask = requested ?? 0;
  if (requested === undefined) {
    let best = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < 8; candidate++) {
      const score = qrPenalty(withFormat(masked(candidate), candidate));
      if (score < best) {
        best = score;
        mask = candidate;
      }
    }
  } else if (!Number.isInteger(requested) || requested < 0 || requested > 7) {
    throw new Error(`Mask pattern ${String(requested)} does not exist.`);
  }

  return {
    version,
    size,
    mask,
    formatBits: formatBits(mask),
    modules: withFormat(masked(mask), mask),
  };
}
