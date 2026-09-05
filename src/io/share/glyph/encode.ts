import {
  GRID_COLS, TOP_ROWS, CURRENT_TOP_ROWS, currentBandSize, RS_N, RS_K, HEADER_NSYM, HEADER_BYTES, HEADER_VERSION, HEADER_OFFSET,
  HEADER_SYMBOL_BITS, FINDER, CALIB_CELLS,
  type Tier, tierFor, bandSize, calibrationRect, headerModuleAt, dataModuleRect, nBlocks,
} from './geometry';
import {
  PALETTE16, PALETTE8_INDICES, HEADER_LEVELS, BG, PRODUCT_HEADER_LEVELS, PRODUCT_INK,
  PRODUCT_PAPER, type RGB,
} from './palette';
import { dataCellAt, choosePlan, planFor, type GlyphPlan, type GlyphProfile } from './profiles';
import { rsEncode } from './rs';
import { interleaveBlocks } from './interleave';
import { bytesToSymbols } from './bitpack';
import { convolutionEncode } from './convolution';
import { crc32 } from '../crypto/crc32';

export interface EncodedGlyph {
  rgba: Uint8Array;
  width: number;
  height: number;
  profile: GlyphProfile;
  plan: GlyphPlan;
}

export interface LegacyEncodedGlyph {
  rgba: Uint8Array;
  width: number;
  height: number;
  tier: Tier;
}

/** Build version(u8), transport id(u8), payload length(u16 LE), and CRC-32(u32 LE). */
export function buildHeaderBytes(version: number, transportId: number, payload: Uint8Array): Uint8Array {
  if (version < 0 || version > 0xff || transportId < 0 || transportId > 0xff || payload.length > 0xffff) {
    throw new Error('PetitGlyph header field is out of range');
  }
  const out = new Uint8Array(HEADER_BYTES);
  const view = new DataView(out.buffer);
  view.setUint8(HEADER_OFFSET.version, version);
  view.setUint8(HEADER_OFFSET.tier, transportId);
  view.setUint16(HEADER_OFFSET.payloadLen, payload.length, true);
  view.setUint32(HEADER_OFFSET.crc, crc32(payload) >>> 0, true);
  return out;
}

/** XOR-whiten a stream against a deterministic LCG. Applying it twice restores the input. */
export function whiten(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let state = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = bytes[i]! ^ (state >>> 24);
  }
  return out;
}

function fillRect(
  rgba: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGB,
): void {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(width, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(height, Math.ceil(y1));
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

function fillRoundedRect(
  rgba: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  color: RGB,
): void {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(width, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(height, Math.ceil(y1));
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const dx = Math.max(x0 + radius - x - 0.5, 0, x + 0.5 - (x1 - radius));
      const dy = Math.max(y0 + radius - y - 0.5, 0, y + 0.5 - (y1 - radius));
      if (dx * dx + dy * dy > radius * radius) continue;
      const index = (y * width + x) * 4;
      rgba[index] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = 255;
    }
  }
}

function paintCurrentChrome(
  rgba: Uint8Array,
  width: number,
  height: number,
  profile: GlyphProfile,
  payload: Uint8Array,
  moduleBase: number,
): void {
  fillRect(rgba, width, height, 0, 0, width, height, PRODUCT_PAPER);
  fillRoundedRect(rgba, width, height, 0, 0, FINDER * moduleBase, TOP_ROWS * moduleBase, FINDER * moduleBase / 2, PRODUCT_INK);
  fillRoundedRect(rgba, width, height, (GRID_COLS - FINDER) * moduleBase, 0, width, TOP_ROWS * moduleBase, FINDER * moduleBase / 2, PRODUCT_INK);

  for (let i = 0; i < profile.palette.length; i++) {
    const { col, row } = calibrationRect(i);
    fillRoundedRect(
      rgba, width, height,
      col * moduleBase + 1, row * moduleBase + 1,
      (col + CALIB_CELLS) * moduleBase - 1, (row + CALIB_CELLS) * moduleBase - 1,
      4, profile.palette[i]!,
    );
  }

  const header = bytesToSymbols(
    rsEncode(buildHeaderBytes(HEADER_VERSION, profile.id, payload), HEADER_NSYM),
    HEADER_SYMBOL_BITS,
  );
  for (let k = 0; k < header.length; k++) {
    const { col, row } = headerModuleAt(k);
    fillRoundedRect(rgba, width, height, col * moduleBase + 1, row * moduleBase + 1,
      (col + 1) * moduleBase - 1, (row + 1) * moduleBase - 1, moduleBase / 4, PRODUCT_HEADER_LEVELS[header[k]!]!);
  }
}

function encodePlannedGlyph(payload: Uint8Array, moduleBase: number, plan: GlyphPlan): EncodedGlyph {
  const { profile } = plan;
  const { width, height } = currentBandSize(moduleBase);
  const rgba = new Uint8Array(width * height * 4);
  paintCurrentChrome(rgba, width, height, profile, payload, moduleBase);

  const padded = new Uint8Array(plan.blocks * plan.dataBytes);
  padded.set(payload);
  const blocks: Uint8Array[] = [];
  for (let block = 0; block < plan.blocks; block++) {
    const data = padded.subarray(block * plan.dataBytes, (block + 1) * plan.dataBytes);
    blocks.push(rsEncode(data, plan.parityBytes));
  }
  const bits = convolutionEncode(whiten(interleaveBlocks(blocks)));
  const symbols: number[] = [];
  for (let i = 0; i < bits.length; i += 2) {
    const value = (bits[i]! << 1) | (bits[i + 1] ?? 0);
    symbols.push([0, 1, 3, 2][value]!);
  }
  const size = moduleBase / profile.div;
  for (let k = 0; k < symbols.length; k++) {
    const { col, row } = dataCellAt(k, plan);
    const x = col * size;
    const y = CURRENT_TOP_ROWS * moduleBase + row * size;
    fillRect(rgba, width, height, Math.round(x), Math.round(y), Math.round(x + size), Math.round(y + size), profile.palette[symbols[k]!]!);
  }

  return { rgba, width, height, profile, plan };
}

/** Encode a fixed-height v3 ribbon with concatenated error correction. */
export function encodeGlyph(payload: Uint8Array, moduleBase: number): EncodedGlyph | null {
  const plan = choosePlan(payload.length);
  return plan ? encodePlannedGlyph(payload, moduleBase, plan) : null;
}

/** Encode with a specified compatible profile for diagnostics and robustness comparison. */
export function encodeGlyphWithProfile(
  payload: Uint8Array,
  moduleBase: number,
  profile: GlyphProfile,
): EncodedGlyph | null {
  const plan = planFor(payload.length, profile);
  return plan ? encodePlannedGlyph(payload, moduleBase, plan) : null;
}

/** Encode the v2 transport for compatibility fixtures and benchmarks. */
export function encodeGlyphV2(payload: Uint8Array, moduleBase: number): LegacyEncodedGlyph | null {
  const tier = tierFor(payload.length);
  if (!tier) return null;
  const { width, height } = bandSize(moduleBase);
  const rgba = new Uint8Array(width * height * 4);
  fillRect(rgba, width, height, 0, 0, width, height, BG);
  fillRect(rgba, width, height, 0, 0, FINDER * moduleBase, TOP_ROWS * moduleBase, [0, 0, 0]);
  fillRect(rgba, width, height, (GRID_COLS - FINDER) * moduleBase, 0, width, TOP_ROWS * moduleBase, [0, 0, 0]);

  for (let i = 0; i < PALETTE16.length; i++) {
    const { col, row } = calibrationRect(i);
    fillRect(
      rgba, width, height,
      col * moduleBase, row * moduleBase,
      (col + CALIB_CELLS) * moduleBase, (row + CALIB_CELLS) * moduleBase,
      PALETTE16[i]!,
    );
  }

  const header = bytesToSymbols(rsEncode(buildHeaderBytes(2, tier.id, payload), HEADER_NSYM), HEADER_SYMBOL_BITS);
  for (let k = 0; k < header.length; k++) {
    const { col, row } = headerModuleAt(k);
    fillRect(
      rgba, width, height,
      col * moduleBase, row * moduleBase,
      (col + 1) * moduleBase, (row + 1) * moduleBase,
      HEADER_LEVELS[header[k]!]!,
    );
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
    fillRect(
      rgba, width, height,
      Math.round(rect.x), Math.round(rect.y),
      Math.round(rect.x + rect.size), Math.round(rect.y + rect.size),
      PALETTE16[paletteIndex]!,
    );
  }
  return { rgba, width, height, tier };
}
