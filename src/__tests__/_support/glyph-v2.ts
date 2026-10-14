/** The retired PetitGlyph v2 encoder. The product writes v3 only and still reads v2 images, so
 *  the v2 writer lives with the tests that feed the v2 decoder. */
import {
  GRID_COLS, TOP_ROWS, RS_N, RS_K, HEADER_NSYM, HEADER_SYMBOL_BITS, FINDER, CALIB_CELLS, TIERS,
  type Tier, calibrationRect, headerModuleAt, nBlocks,
} from '../../io/share/glyph/geometry';
import { PALETTE8_INDICES, HEADER_LEVELS, paletteForVersion, type RGB } from '../../io/share/glyph/palette';
import { buildHeaderBytes, whiten } from '../../io/share/glyph/encode';
import { rsEncode } from '../../io/share/glyph/rs';
import { interleaveBlocks } from '../../io/share/glyph/interleave';
import { bytesToSymbols } from '../../io/share/glyph/bitpack';

/* The legacy palettes' derivation inputs, which the baked v1/v2 tables are checked against. */

/** The 4 luma band centers, dark to light. */
export const Y_LEVELS: readonly number[] = [56, 112, 168, 214];

/** The 4 chroma columns as (Cb, Cr) offsets at scale 1, one per chroma variant. */
export const BASE_CHROMA_OFFSETS: readonly (readonly [number, number])[] = [
  [-48, 38],
  [42, 44],
  [46, -40],
  [-44, -46],
];

/** Per-luma-band chroma scale for each baked legacy palette. */
export const CHROMA_SCALES: Readonly<Record<number, readonly number[]>> = {
  // Squared nearest-neighbour separations: 1767, 7032, 7032, 1767.
  1: [0.5, 1, 1, 0.5],
  // Squared nearest-neighbour separations: 1801, 3438, 3438, 1801.
  2: [0.51, 0.7, 0.7, 0.509],
};

/** Off-white background / quiet-zone fill. */
export const BG: RGB = [0xf0, 0xf0, 0xeb];

/** The fixed v2 decoder palette the v2 writer paints. */
const PALETTE16_V2 = paletteForVersion(2)!;

/** The v1/v2 band height in base cells. */
export const GRID_ROWS = 30;

/** Smallest legacy tier whose payload capacity fits `payloadLen`. */
export function tierFor(payloadLen: number): Tier | null {
  for (const t of TIERS) {
    if (payloadLen <= t.payloadCap) return t;
  }
  return null;
}

/** The v1/v2 footprint at base-cell size `mb`. */
export function bandSize(mb: number): { width: number; height: number } {
  return { width: GRID_COLS * mb, height: GRID_ROWS * mb };
}

/** Pixel rectangle of row-major data module `k`. */
export function dataModuleRect(profile: { readonly div: number; readonly dataCols: number }, k: number, mb: number): { x: number; y: number; size: number } {
  const size = mb / profile.div;
  const col = k % profile.dataCols;
  const row = Math.floor(k / profile.dataCols);
  return { x: col * size, y: TOP_ROWS * mb + row * size, size };
}

export interface LegacyEncodedGlyph {
  rgba: Uint8Array;
  width: number;
  height: number;
  tier: Tier;
}

interface Raster { rgba: Uint8Array; width: number; height: number }
interface Box { x0: number; y0: number; x1: number; y1: number }

function fillRect(img: Raster, box: Box, color: RGB): void {
  const { rgba, width, height } = img;
  const xa = Math.max(0, Math.floor(box.x0)), xb = Math.min(width, Math.ceil(box.x1));
  const ya = Math.max(0, Math.floor(box.y0)), yb = Math.min(height, Math.ceil(box.y1));
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const index = (y * width + x) * 4;
      rgba[index] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = 255;
    }
  }
}

/** Encode the v2 transport, which this build only decodes, for compatibility tests and research. */
export function encodeGlyphV2(payload: Uint8Array, moduleBase: number): LegacyEncodedGlyph | null {
  const tier = tierFor(payload.length);
  if (!tier) return null;
  const { width, height } = bandSize(moduleBase);
  const rgba = new Uint8Array(width * height * 4);
  const img: Raster = { rgba, width, height };
  fillRect(img, { x0: 0, y0: 0, x1: width, y1: height }, BG);
  fillRect(img, { x0: 0, y0: 0, x1: FINDER * moduleBase, y1: TOP_ROWS * moduleBase }, [0, 0, 0]);
  fillRect(img, { x0: (GRID_COLS - FINDER) * moduleBase, y0: 0, x1: width, y1: TOP_ROWS * moduleBase }, [0, 0, 0]);

  for (let i = 0; i < PALETTE16_V2.length; i++) {
    const { col, row } = calibrationRect(i);
    fillRect(img, { x0: col * moduleBase, y0: row * moduleBase, x1: (col + CALIB_CELLS) * moduleBase, y1: (row + CALIB_CELLS) * moduleBase }, PALETTE16_V2[i]!);
  }

  const header = bytesToSymbols(rsEncode(buildHeaderBytes(2, tier.id, payload), HEADER_NSYM), HEADER_SYMBOL_BITS);
  for (let k = 0; k < header.length; k++) {
    const { col, row } = headerModuleAt(k);
    fillRect(img, { x0: col * moduleBase, y0: row * moduleBase, x1: (col + 1) * moduleBase, y1: (row + 1) * moduleBase }, HEADER_LEVELS[header[k]!]!);
  }

  const blockCount = nBlocks(tier);
  const padded = new Uint8Array(blockCount * RS_K);
  padded.set(payload);
  const blocks: Uint8Array[] = [];
  for (let block = 0; block < blockCount; block++) {
    blocks.push(rsEncode(padded.subarray(block * RS_K, (block + 1) * RS_K), RS_N - RS_K));
  }
  const symbols = bytesToSymbols(whiten(interleaveBlocks(blocks)), tier.bits);
  for (let k = 0; k < symbols.length; k++) {
    const rect = dataModuleRect(tier, k, moduleBase);
    const symbol = symbols[k]!;
    const paletteIndex = tier.colors === 8 ? PALETTE8_INDICES[symbol]! : symbol;
    fillRect(img, {
      x0: Math.round(rect.x), y0: Math.round(rect.y),
      x1: Math.round(rect.x + rect.size), y1: Math.round(rect.y + rect.size),
    }, PALETTE16_V2[paletteIndex]!);
  }
  return { rgba, width, height, tier };
}
