// src/io/share/glyph/encode.ts — PetitGlyph v2 encoder: renders a payload byte string into the
// fixed GRID_COLS x GRID_ROWS code band as RGBA pixels. Pure function of (payload, moduleBase):
// same inputs always produce the same pixels. Layout/tiers come from geometry.ts; colors from
// palette.ts; error-correction/interleave/bit-packing from rs.ts/interleave.ts/bitpack.ts — this
// module only sequences those primitives and rasterizes the result.
import {
  GRID_COLS, TOP_ROWS, RS_N, RS_K, HEADER_NSYM, HEADER_BYTES, HEADER_VERSION, HEADER_OFFSET,
  HEADER_SYMBOL_BITS, FINDER, CALIB_CELLS,
  type Tier, tierFor, bandSize, calibrationRect, headerModuleAt, dataModuleRect, nBlocks,
} from './geometry';
import { PALETTE16, PALETTE8_INDICES, HEADER_LEVELS, BG, type RGB } from './palette';
import { rsEncode } from './rs';
import { interleaveBlocks } from './interleave';
import { bytesToSymbols } from './bitpack';
import { crc32 } from '../crypto/crc32';

export interface EncodedGlyph {
  rgba: Uint8Array;
  width: number;
  height: number;
  tier: Tier;
}

/** 8-byte fixed header record: version(u8) | tier(u8) | payloadLen(u16 LE) | crc32(payload)(u32 LE).
 *  Takes the payload itself (not just its length) since crc32 needs the actual bytes. */
export function buildHeaderBytes(tier: Tier, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES);
  const dv = new DataView(out.buffer);
  dv.setUint8(HEADER_OFFSET.version, HEADER_VERSION);
  dv.setUint8(HEADER_OFFSET.tier, tier.id);
  dv.setUint16(HEADER_OFFSET.payloadLen, payload.length, true);
  dv.setUint32(HEADER_OFFSET.crc, crc32(payload) >>> 0, true);
  return out;
}

/** XOR-whitens a byte stream against a deterministic LCG keystream (seed 0x9e3779b9). Applying
 *  it twice is a no-op (XOR self-inverse), so the same function is used to un-whiten on decode. */
export function whiten(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let s = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = bytes[i]! ^ (s >>> 24);
  }
  return out;
}

/** Fill pixel rect [x0,x1) x [y0,y1) (clamped to the buffer) with `color`. */
function fillRect(rgba: Uint8Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number, color: RGB): void {
  const xa = Math.max(0, x0), xb = Math.min(width, x1);
  const ya = Math.max(0, y0), yb = Math.min(height, y1);
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = 255;
    }
  }
}

export function encodeGlyph(payload: Uint8Array, moduleBase: number): EncodedGlyph | null {
  const tier = tierFor(payload.length);
  if (!tier) return null;

  const { width, height } = bandSize(moduleBase);
  const rgba = new Uint8Array(width * height * 4);

  // Chrome: background fill.
  fillRect(rgba, width, height, 0, 0, width, height, BG);

  // Finders: solid black FINDER×FINDER-cell squares at top-left (cols 0-2) and top-right
  // (cols 129-131), rows 0-2.
  const mb = moduleBase;
  fillRect(rgba, width, height, 0, 0, FINDER * mb, TOP_ROWS * mb, [0, 0, 0]);
  fillRect(rgba, width, height, (GRID_COLS - FINDER) * mb, 0, GRID_COLS * mb, TOP_ROWS * mb, [0, 0, 0]);

  // Calibration swatches: PALETTE16[i] as CALIB_CELLS×CALIB_CELLS-cell rects at calibrationRect(i).
  for (let i = 0; i < PALETTE16.length; i++) {
    const { col, row } = calibrationRect(i);
    fillRect(rgba, width, height, col * mb, row * mb, (col + CALIB_CELLS) * mb, (row + CALIB_CELLS) * mb, PALETTE16[i]!);
  }

  // Header: HEADER_BYTES record -> RS(HEADER_NSYM) -> HEADER_ENC_BYTES -> HEADER_MODULES
  // HEADER_SYMBOL_BITS-bit symbols (MSB-first) -> 4 grayscale levels at headerModuleAt(k).
  const headerBytes = buildHeaderBytes(tier, payload);
  const headerEncoded = rsEncode(headerBytes, HEADER_NSYM);
  const headerSymbols = bytesToSymbols(headerEncoded, HEADER_SYMBOL_BITS);
  for (let k = 0; k < headerSymbols.length; k++) {
    const { col, row } = headerModuleAt(k);
    const color = HEADER_LEVELS[headerSymbols[k]!]!;
    fillRect(rgba, width, height, col * mb, row * mb, (col + 1) * mb, (row + 1) * mb, color);
  }

  // Data: pad payload to nBlocks*RS_K, RS-encode each block, interleave, whiten, pack into
  // tier.bits-wide symbols, map to palette colors, draw at dataModuleRect(tier, k, mb). Any
  // remaining data modules (symbols.length < total module count) stay BG.
  const blocks = nBlocks(tier);
  const padded = new Uint8Array(blocks * RS_K);
  padded.set(payload.subarray(0, Math.min(payload.length, padded.length)));
  const encodedBlocks: Uint8Array[] = [];
  for (let b = 0; b < blocks; b++) {
    const block = padded.subarray(b * RS_K, (b + 1) * RS_K);
    encodedBlocks.push(rsEncode(block, RS_N - RS_K));
  }
  const interleaved = interleaveBlocks(encodedBlocks);
  const whitened = whiten(interleaved);
  const symbols = bytesToSymbols(whitened, tier.bits);

  const totalModules = tier.dataCols * tier.dataRows;
  for (let k = 0; k < totalModules; k++) {
    const rect = dataModuleRect(tier, k, mb);
    const x0 = Math.round(rect.x);
    const y0 = Math.round(rect.y);
    const x1 = Math.round(rect.x + rect.size);
    const y1 = Math.round(rect.y + rect.size);
    let color: RGB = BG;
    if (k < symbols.length) {
      const sym = symbols[k]!;
      const palIdx = tier.colors === 8 ? PALETTE8_INDICES[sym]! : sym;
      color = PALETTE16[palIdx]!;
    }
    fillRect(rgba, width, height, x0, y0, x1, y1, color);
  }

  return { rgba, width, height, tier };
}
