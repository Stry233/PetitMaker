// Finder and header coordinates are shared across transports; each version defines its data region.

/** Fixed grid footprint in base cells. A profile's `div` subdivides each data cell per axis. */
export const GRID_COLS = 124;
export const CURRENT_GRID_ROWS = 26;
export const CURRENT_TOP_ROWS = 4;

/** Finder size in base cells. */
export const FINDER = 3;

/** Base-cell rows reserved for finders, calibration swatches, and the header. */
export const TOP_ROWS = 3;

/** Legacy Reed-Solomon block shape and the upper bounds used by shortened current blocks. */
export const RS_N = 255;
export const RS_K = 200;

/** The eight-byte transport header has its own Reed-Solomon parity. */
export const HEADER_BYTES = 8;
export const HEADER_NSYM = 8;

/** Header layout: version(u8), transport id(u8), payload length(u16 LE), CRC-32(u32 LE). */
export const HEADER_VERSION = 3;
export const HEADER_OFFSET = { version: 0, tier: 1, payloadLen: 2, crc: 4 } as const;

/** The protected header is packed into fixed two-bit luma modules. */
export const HEADER_ENC_BYTES = HEADER_BYTES + HEADER_NSYM;                 // 16
export const HEADER_SYMBOL_BITS = 2;
export const HEADER_MODULES = (HEADER_ENC_BYTES * 8) / HEADER_SYMBOL_BITS;  // 64

/** Calibration swatch edge in base cells. */
export const CALIB_CELLS = 2;

/** Smallest base-cell size accepted by the export compositor. */
export const MIN_MODULE_BASE = 12;

/** A v1/v2 decoder tier whose fields are fixed wire identities. */
export interface Tier {
  readonly id: 0 | 1 | 2 | 3 | 4 | 5;
  readonly div: 1 | 1.5 | 2 | 3 | 4;
  readonly bits: 3 | 4;
  readonly colors: 8 | 16;
  readonly dataCols: number;
  readonly dataRows: number;
  readonly payloadCap: number;
}

/** Number of complete legacy RS(255,200) blocks that fit in a tier. */
export function nBlocks(tier: Pick<Tier, 'dataCols' | 'dataRows' | 'bits'>): number {
  const capacityBytes = Math.floor((tier.dataCols * tier.dataRows * tier.bits) / 8);
  return Math.floor(capacityBytes / RS_N);
}

function makeTier(shape: Omit<Tier, 'payloadCap'>): Tier {
  const { id, div, bits, colors, dataCols, dataRows } = shape;
  const base = { id, div, bits, colors, dataCols, dataRows };
  return { ...base, payloadCap: nBlocks(base) * RS_K };
}

/** The fixed v1/v2 decoder density ladder. */
export const TIERS: readonly Tier[] = [
  makeTier({ id: 0, div: 1, bits: 3, colors: 8, dataCols: GRID_COLS, dataRows: 27 }),
  makeTier({ id: 1, div: 1, bits: 4, colors: 16, dataCols: GRID_COLS, dataRows: 27 }),
  makeTier({ id: 2, div: 1.5, bits: 4, colors: 16, dataCols: GRID_COLS * 1.5, dataRows: 40 }),
  makeTier({ id: 3, div: 2, bits: 4, colors: 16, dataCols: GRID_COLS * 2, dataRows: 54 }),
  makeTier({ id: 4, div: 3, bits: 4, colors: 16, dataCols: GRID_COLS * 3, dataRows: 81 }),
  makeTier({ id: 5, div: 4, bits: 4, colors: 16, dataCols: GRID_COLS * 4, dataRows: 108 }),
];

/** Largest multiple-of-six base-cell size that fits the available pixel width. */
export function moduleBaseFor(availableWidth: number): number | null {
  const mb = 6 * Math.floor(availableWidth / (GRID_COLS * 6));
  return mb < MIN_MODULE_BASE ? null : mb;
}

/** The current transport keeps a fixed height regardless of payload length. */
export function currentBandSize(mb: number): { width: number; height: number } {
  return { width: GRID_COLS * mb, height: CURRENT_GRID_ROWS * mb };
}

/** Top-left base cell of calibration swatch `i`. */
export function calibrationRect(i: number): { col: number; row: number } {
  return { col: 4 + i * CALIB_CELLS, row: 0 };
}

/** Base cell holding header module `k`. */
export function headerModuleAt(k: number): { col: number; row: number } {
  return { col: 4 + k, row: 2 };
}
