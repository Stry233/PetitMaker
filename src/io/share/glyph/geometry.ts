// src/io/share/glyph/geometry.ts — the single source of truth for PetitGlyph v2's fixed
// code-band layout. A code is always laid out on a FIXED grid footprint
// (GRID_COLS × GRID_ROWS "cells" at some physical module-base `mb` px/cell) regardless of how
// much payload it carries — density scales by subdividing each data cell into `tier.div` finer
// modules per axis, not by growing the band. This keeps calibration swatches, header modules and
// finder patterns at fixed cell coordinates across every tier; only the DATA region's per-module
// pixel size shrinks as div grows.
//
// The 6-tier ladder trades module count (div: how finely each data cell subdivides) and colors
// per module (bits/colors: how much a single module encodes) for payload capacity. T0→T1 holds
// the coarsest module grid (div=1) but doubles bits-per-module (8→16 colors); T1→T5 then holds
// 16-color modules and grows the module grid itself (div 1→1.5→2→3→4). See `nBlocks` below for
// how a tier's raw bit capacity turns into a whole number of 184-byte RS(255,184) blocks.
//
// Pure arithmetic module: no imports, no side effects — every export is a deterministic function
// of its inputs (or a literal derived from the formulas here), so the encoder, the decoder and
// the export compose all agree on where every pixel of a code lives.

/** Fixed grid footprint, in "base cells" (a T0/T1 data module IS one base cell; finer tiers
 *  subdivide a base cell into `div` modules per axis). */
export const GRID_COLS = 124;
export const GRID_ROWS = 30;

/** Finder-pattern size (cells) — corner markers used for orientation/scale detection. */
export const FINDER = 3;

/** Rows reserved above the data region for finders + calibration swatches + header. */
export const TOP_ROWS = 3;

/** Base (T0/T1) data region row count: GRID_ROWS - TOP_ROWS. */
export const DATA_ROWS = 27;

/** Reed-Solomon block shape: 255 total symbols per block, RS_K data symbols, one byte per symbol.
 *
 *  The parity is sized for the threat this code actually faces: an image recompressed by a chat
 *  app or a social platform, which perturbs colours. It is NOT sized for a camera photographing a
 *  screen, or for a crop taking a bite out of the band — neither is a way anyone shares one of
 *  these. Measured across the corpus: the rated envelope (chroma subsampling, JPEG q60, a 0.75
 *  downscale) survives even at 9% parity, so 28% was far more than that envelope asks for. Past
 *  it the levels do separate — the largest map holds to q30/0.5 here and to q25/0.45 at 28% — so
 *  the surplus is spent, but not all of it: what is left over pays for the margin the band sits
 *  in, a narrower band at the same module size, and every tier still carries at least what the
 *  full-width band did. */
export const RS_N = 255;
export const RS_K = 200;

/** Header: an 8-byte fixed record (tier id, dims, payload length, etc. — see encode.ts),
 *  protected by its own tiny RS(HEADER_NSYM, HEADER_BYTES) code so it survives independently of
 *  the data region's own ECC. */
export const HEADER_BYTES = 8;
export const HEADER_NSYM = 8;

/** Header wire format (the single source both `buildHeaderBytes` and `parseHeader` read).
 *  Layout: version(u8) | tier(u8) | payloadLen(u16 LE) | crc32(payload)(u32 LE). */
export const HEADER_VERSION = 1;
export const HEADER_OFFSET = { version: 0, tier: 1, payloadLen: 2, crc: 4 } as const;

/** Header transport ladder: the 8-byte record is RS(HEADER_NSYM)-encoded to HEADER_ENC_BYTES,
 *  then packed as HEADER_SYMBOL_BITS-bit symbols and painted as HEADER_MODULES grayscale cells.
 *  All three derive from HEADER_BYTES/HEADER_NSYM so a header-size change propagates here alone. */
export const HEADER_ENC_BYTES = HEADER_BYTES + HEADER_NSYM;                 // 16
export const HEADER_SYMBOL_BITS = 2;
export const HEADER_MODULES = (HEADER_ENC_BYTES * 8) / HEADER_SYMBOL_BITS;  // 64

/** Calibration swatch size (cells per axis) — each PALETTE16 swatch is CALIB_CELLS × CALIB_CELLS. */
export const CALIB_CELLS = 2;

/** Smallest module-base (px/cell) a composition width can offer before density tiering refuses
 *  to lay out a code at all (below this, modules are too small to survive capture reliably). */
export const MIN_MODULE_BASE = 12;

/** One density tier: a fixed data-module grid (`dataCols` × `dataRows`, `dataCols = GRID_COLS *
 *  div`) of `bits`-bit (`colors`-color) modules, and the resulting whole-block payload capacity
 *  in bytes (see `nBlocks`). */
export interface Tier {
  readonly id: 0 | 1 | 2 | 3 | 4 | 5;
  readonly div: 1 | 1.5 | 2 | 3 | 4;
  readonly bits: 3 | 4;
  readonly colors: 8 | 16;
  readonly dataCols: number;
  readonly dataRows: number;
  readonly payloadCap: number;
}

/** Largest number of whole RS(255,184) blocks that fit in a tier's raw module capacity:
 *  floor(dataCols * dataRows * bits / 8) total capacity bytes, then the largest n with
 *  n * RS_N <= that many bytes (a partial block's worth of bits is wasted, never split). */
export function nBlocks(tier: Pick<Tier, 'dataCols' | 'dataRows' | 'bits'>): number {
  const capacityBytes = Math.floor((tier.dataCols * tier.dataRows * tier.bits) / 8);
  return Math.floor(capacityBytes / RS_N);
}

function makeTier(id: Tier['id'], div: Tier['div'], bits: Tier['bits'], colors: Tier['colors'], dataCols: number, dataRows: number): Tier {
  const base = { id, div, bits, colors, dataCols, dataRows };
  return { ...base, payloadCap: nBlocks(base) * RS_K };
}

/** The 6-tier density ladder, smallest capacity first. T0/T1 share the coarsest module grid
 *  (div=1) and differ only in colors-per-module (8→16); T1..T5 hold 16 colors and grow the
 *  module grid itself (div 1→1.5→2→3→4, i.e. dataCols/dataRows = GRID_COLS/DATA_ROWS * div). */
export const TIERS: readonly Tier[] = [
  makeTier(0, 1, 3, 8, GRID_COLS, 27),
  makeTier(1, 1, 4, 16, GRID_COLS, 27),
  makeTier(2, 1.5, 4, 16, GRID_COLS * 1.5, 40),
  makeTier(3, 2, 4, 16, GRID_COLS * 2, 54),
  makeTier(4, 3, 4, 16, GRID_COLS * 3, 81),
  makeTier(5, 4, 4, 16, GRID_COLS * 4, 108),
];

/** Smallest tier whose payload capacity fits `payloadLen` bytes; null if it exceeds every tier
 *  (i.e. bigger than T5's cap). */
export function tierFor(payloadLen: number): Tier | null {
  for (const t of TIERS) {
    if (payloadLen <= t.payloadCap) return t;
  }
  return null;
}

/** Largest module-base (px/base-cell), a multiple of 6, whose band fits in `availableWidth` — the
 *  pixel width the composition gives the band, already inset by whatever margin it wants. A
 *  multiple of 6 keeps every tier's subdivision on whole pixels, which is what lets the band be
 *  painted rather than resampled. Null below MIN_MODULE_BASE: too small to host a legible code. */
export function moduleBaseFor(availableWidth: number): number | null {
  const mb = 6 * Math.floor(availableWidth / (GRID_COLS * 6));
  return mb < MIN_MODULE_BASE ? null : mb;
}

/** Physical footprint of the fixed GRID_COLS x GRID_ROWS band at module-base `mb`. */
export function bandSize(mb: number): { width: number; height: number } {
  return { width: GRID_COLS * mb, height: GRID_ROWS * mb };
}

/** Top-left cell of calibration swatch `i` (row 0, cols advancing by CALIB_CELLS starting at col 4
 *  — the first 4 cols are reserved for the top-left finder pattern). Each swatch is
 *  CALIB_CELLS × CALIB_CELLS cells. */
export function calibrationRect(i: number): { col: number; row: number } {
  return { col: 4 + i * CALIB_CELLS, row: 0 };
}

/** Cell holding header module `k` (k < HEADER_MODULES — the header row, row 2, right after the
 *  calibration row and the finder rows). */
export function headerModuleAt(k: number): { col: number; row: number } {
  return { col: 4 + k, row: 2 };
}

/** Pixel rect of data module `k` (0-indexed, row-major over `tier.dataCols`) at module-base `mb`.
 *  Module size is `mb / tier.div` (an integer whenever `mb` is a multiple of `tier.div`, e.g.
 *  any multiple of 6 against div ∈ {1,1.5,2,3,4} — kept as float here; callers round per the
 *  rounded-span rule). The data region starts below the fixed TOP_ROWS band header, at
 *  `y0 = TOP_ROWS * mb`. */
export function dataModuleRect(tier: Pick<Tier, 'div' | 'dataCols'>, k: number, mb: number): { x: number; y: number; size: number } {
  const size = mb / tier.div;
  const col = k % tier.dataCols;
  const row = Math.floor(k / tier.dataCols);
  return { x: col * size, y: TOP_ROWS * mb + row * size, size };
}
