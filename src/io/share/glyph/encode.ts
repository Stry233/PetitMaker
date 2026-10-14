import {
  GRID_COLS, TOP_ROWS, CURRENT_TOP_ROWS, currentBandSize, HEADER_NSYM, HEADER_BYTES, HEADER_VERSION, HEADER_OFFSET,
  HEADER_SYMBOL_BITS, FINDER, CALIB_CELLS,
  calibrationRect, headerModuleAt,
} from './geometry';
import { PRODUCT_HEADER_LEVELS, PRODUCT_INK, PRODUCT_PAPER, type RGB } from './palette';
import { dataCellAt, choosePlan, type GlyphPlan, type GlyphProfile } from './profiles';
import { rsEncode } from './rs';
import { interleaveBlocks } from './interleave';
import { bytesToSymbols } from './bitpack';
import { convolutionEncode } from './convolution';
import { crc32 } from '../../../core/base/crc32';

export interface EncodedGlyph {
  rgba: Uint8Array;
  width: number;
  height: number;
  profile: GlyphProfile;
  plan: GlyphPlan;
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

/** An RGBA pixel buffer and its size. */
interface Raster { rgba: Uint8Array; width: number; height: number }

/** A pixel box from (x0, y0) to (x1, y1), exclusive at the far edge. */
interface Box { x0: number; y0: number; x1: number; y1: number }

function fillRect(img: Raster, box: Box, color: RGB): void {
  const { rgba, width, height } = img;
  const { x0, y0, x1, y1 } = box;
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

function fillRoundedRect(img: Raster, box: Box, radius: number, color: RGB): void {
  const { rgba, width, height } = img;
  const { x0, y0, x1, y1 } = box;
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

function paintCurrentChrome(img: Raster, profile: GlyphProfile, payload: Uint8Array, moduleBase: number): void {
  const { width, height } = img;
  fillRect(img, { x0: 0, y0: 0, x1: width, y1: height }, PRODUCT_PAPER);
  fillRoundedRect(img, { x0: 0, y0: 0, x1: FINDER * moduleBase, y1: TOP_ROWS * moduleBase }, FINDER * moduleBase / 2, PRODUCT_INK);
  fillRoundedRect(img, { x0: (GRID_COLS - FINDER) * moduleBase, y0: 0, x1: width, y1: TOP_ROWS * moduleBase }, FINDER * moduleBase / 2, PRODUCT_INK);

  for (let i = 0; i < profile.palette.length; i++) {
    const { col, row } = calibrationRect(i);
    fillRoundedRect(img, {
      x0: col * moduleBase + 1, y0: row * moduleBase + 1,
      x1: (col + CALIB_CELLS) * moduleBase - 1, y1: (row + CALIB_CELLS) * moduleBase - 1,
    }, 4, profile.palette[i]!);
  }

  const header = bytesToSymbols(
    rsEncode(buildHeaderBytes(HEADER_VERSION, profile.id, payload), HEADER_NSYM),
    HEADER_SYMBOL_BITS,
  );
  for (let k = 0; k < header.length; k++) {
    const { col, row } = headerModuleAt(k);
    fillRoundedRect(img, {
      x0: col * moduleBase + 1, y0: row * moduleBase + 1,
      x1: (col + 1) * moduleBase - 1, y1: (row + 1) * moduleBase - 1,
    }, moduleBase / 4, PRODUCT_HEADER_LEVELS[header[k]!]!);
  }
}

function encodePlannedGlyph(payload: Uint8Array, moduleBase: number, plan: GlyphPlan): EncodedGlyph {
  const { profile } = plan;
  const { width, height } = currentBandSize(moduleBase);
  const rgba = new Uint8Array(width * height * 4);
  const img: Raster = { rgba, width, height };
  paintCurrentChrome(img, profile, payload, moduleBase);

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
  // Readers sample only active cells; repeat the coded pattern across unused capacity.
  const modules = Uint8Array.from({ length: plan.moduleCount }, (_, k) => symbols[k % symbols.length]!);
  for (let k = 0; k < symbols.length; k++) {
    const { col, row } = dataCellAt(k, plan);
    modules[row * profile.dataCols + col] = symbols[k]!;
  }
  const size = moduleBase / profile.div;
  for (let k = 0; k < modules.length; k++) {
    const col = k % profile.dataCols;
    const row = Math.floor(k / profile.dataCols);
    const x = col * size;
    const y = CURRENT_TOP_ROWS * moduleBase + row * size;
    fillRect(img, { x0: Math.round(x), y0: Math.round(y), x1: Math.round(x + size), y1: Math.round(y + size) }, profile.palette[modules[k]!]!);
  }

  return { rgba, width, height, profile, plan };
}

/** Encode a fixed-height v3 ribbon with concatenated error correction. */
export function encodeGlyph(payload: Uint8Array, moduleBase: number): EncodedGlyph | null {
  const plan = choosePlan(payload.length);
  return plan ? encodePlannedGlyph(payload, moduleBase, plan) : null;
}
