// src/io/share/glyph/decode.ts — PetitGlyph v2 decoder. Recovers the payload bytes from an RGBA
// image containing a rendered code band. The band's grid footprint is FIXED (GRID_COLS ×
// GRID_ROWS), so once the finder pair is located the module pitch and origin are known exactly —
// no per-module search. The pipeline mirrors encode.ts in reverse:
//   finder pair → calibrate (learn 16 color centroids + a black→white grayscale ramp) →
//   header (grayscale, RS(8), erasure-aware) → data (color, erasure-aware, per-tier grid) →
//   symbols→bytes → un-whiten → deinterleave → per-block RS(71) → crc32 check.
// Every failure path returns null; the whole per-candidate attempt is wrapped in try/catch so a
// bounds bug can never throw out of the decoder.
import {
  GRID_COLS, GRID_ROWS, TOP_ROWS, RS_N, RS_K, HEADER_NSYM, HEADER_BYTES,
  HEADER_OFFSET, HEADER_ENC_BYTES, HEADER_SYMBOL_BITS, HEADER_MODULES, FINDER, CALIB_CELLS,
  TIERS, type Tier, calibrationRect, headerModuleAt, nBlocks,
} from './geometry';
import { PALETTE8_INDICES, HEADER_LEVELS, BG, rgbToYcc, classify, paletteForVersion, type RGB } from './palette';
import { rsDecode } from './rs';
import { deinterleave, deinterleaveErasures } from './interleave';
import { symbolsToBytes, symbolErasuresToByteErasures } from './bitpack';
import { crc32 } from '../crypto/crc32';
import { whiten } from './encode';

const ERASURE_CONF = 0.2;      // data-module confidence below this → RS erasure
const HEADER_ERASURE_CONF = 0.15; // header-module confidence below this → RS erasure

/** A connected dark blob's bounding box + pixel count. */
interface Comp { minx: number; maxx: number; miny: number; maxy: number; count: number }

/** One fixed-geometry candidate derived from a finder pair. */
interface Geo { ox: number; oy: number; module: number }

/** Luma of an RGB triple (BT.601), reusing the palette's forward transform. */
function luma(c: RGB): number {
  return rgbToYcc(c[0], c[1], c[2])[0];
}

const HEADER_LUMAS: number[] = HEADER_LEVELS.map((c) => luma(c));

/** Median of a numeric array (lower-middle for even length). Empty → 0. */
function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = vals.slice().sort((a, b) => a - b);
  return s[(s.length - 1) >> 1]!;
}

/** Median RGB over the inner half (inset 25% per side) of a float pixel rect, sampling at integer
 *  coords. Returns null if the rect lies entirely outside the image. */
function sampleRect(rgba: Uint8Array, width: number, height: number, x0: number, y0: number, w: number, h: number): RGB | null {
  const ix0 = x0 + w * 0.25, ix1 = x0 + w * 0.75;
  const iy0 = y0 + h * 0.25, iy1 = y0 + h * 0.75;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    rs.push(rgba[i]!); gs.push(rgba[i + 1]!); bs.push(rgba[i + 2]!);
  };
  const xa = Math.ceil(ix0), xb = Math.floor(ix1);
  const ya = Math.ceil(iy0), yb = Math.floor(iy1);
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) push(x, y);
  if (rs.length === 0) push(Math.round((x0 + w / 2)), Math.round((y0 + h / 2))); // tiny module fallback
  if (rs.length === 0) return null;
  return [median(rs), median(gs), median(bs)];
}

/** Median luma over a horizontal strip of rows (used for the white quiet-zone reference). */
function sampleStripLuma(rgba: Uint8Array, width: number, height: number, x0: number, x1: number, y: number): number | null {
  const yi = Math.round(y);
  if (yi < 0 || yi >= height) return null;
  const xa = Math.max(0, Math.round(x0)), xb = Math.min(width - 1, Math.round(x1));
  const vals: number[] = [];
  for (let x = xa; x <= xb; x++) {
    const i = (yi * width + x) * 4;
    vals.push(luma([rgba[i]!, rgba[i + 1]!, rgba[i + 2]!]));
  }
  return vals.length ? median(vals) : null;
}

/** Connected-component dark-blob scan → fixed-geometry finder-pair candidates, best first.
 *  Ported from petitglyph/poster.ts findFinders, with the module search replaced by the fixed
 *  132-col span geometry. */
function findFinders(rgba: Uint8Array, width: number, height: number): Geo[] {
  // Threshold is deliberately tighter than "any dark-ish pixel": the darkest DATA/calibration
  // palette colors (luma-band-0) are intentionally dark for contrast but must NOT flood-fill-merge
  // with a finder square that happens to sit directly adjacent to one of them (finders and data
  // share a border with no reserved gap row/col on that side) — a merge corrupts the finder's
  // bounding box, which the shape/size filters below then reject, making the TRUE finder
  // undetectable for that image. True finder pixels are exactly (0,0,0) and stay far under this
  // bound even after heavy capture degradation (see robustness.test.ts). The nearest confusable
  // non-finder dark is band 0's channel-sum minimum: 121 in the v1 palette, 119 in v2. That margin
  // is what caps band 0's chroma scale in palette.ts, since the entry pushing both Cb and Cr
  // negative darkens as that scale rises.
  const dark = (idx: number) => rgba[idx * 4]! + rgba[idx * 4 + 1]! + rgba[idx * 4 + 2]! < 100;
  const seen = new Uint8Array(width * height);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let p = 0; p < width * height; p++) {
    if (seen[p] || !dark(p)) continue;
    let minx = width, maxx = 0, miny = height, maxy = 0, count = 0;
    stack.push(p); seen[p] = 1;
    while (stack.length) {
      const q = stack.pop()!; const x = q % width, y = (q / width) | 0;
      count++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x > 0 && !seen[q - 1] && dark(q - 1)) { seen[q - 1] = 1; stack.push(q - 1); }
      if (x < width - 1 && !seen[q + 1] && dark(q + 1)) { seen[q + 1] = 1; stack.push(q + 1); }
      if (y > 0 && !seen[q - width] && dark(q - width)) { seen[q - width] = 1; stack.push(q - width); }
      if (y < height - 1 && !seen[q + width] && dark(q + width)) { seen[q + width] = 1; stack.push(q + width); }
      if (count > width * height) return []; // pathological (e.g. random image) → bail
    }
    const w = maxx - minx + 1, h = maxy - miny + 1;
    if (w >= 6 && h >= 6 && count > 0.55 * w * h && w / h > 0.6 && w / h < 1.66) comps.push({ minx, maxx, miny, maxy, count });
  }
  if (comps.length < 2) return [];
  // The two finders are equal-size solid squares sharing a top edge, far apart horizontally.
  comps.sort((a, b) => b.count - a.count);
  const cand = comps.slice(0, 12);
  const pairs: { left: Comp; right: Comp; score: number }[] = [];
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
    const A = cand[i]!, B = cand[j]!;
    const wA = A.maxx - A.minx + 1, hA = A.maxy - A.miny + 1, wB = B.maxx - B.minx + 1, hB = B.maxy - B.miny + 1;
    if (Math.min(wA, wB) / Math.max(wA, wB) < 0.7 || Math.min(hA, hB) / Math.max(hA, hB) < 0.7) continue; // equal size
    if (Math.abs(A.miny - B.miny) > Math.max(hA, hB)) continue;                                            // same top edge
    const cxA = (A.minx + A.maxx) / 2, cxB = (B.minx + B.maxx) / 2;
    if (Math.abs(cxA - cxB) < 4 * Math.max(wA, wB)) continue;                                              // far apart
    const [left, right] = cxA < cxB ? [A, B] : [B, A];
    pairs.push({ left, right, score: A.count + B.count });
  }
  if (!pairs.length) return [];
  pairs.sort((a, b) => b.score - a.score); // prefer the largest blobs (the real finders)

  // Fixed geometry: the finder pair spans the full GRID_COLS grid by construction, so the module
  // pitch is (right.maxx - left.minx + 1) / GRID_COLS and the origin is the TL finder's top-left.
  const out: Geo[] = [];
  for (const { left, right } of pairs.slice(0, 4)) {
    const module = (right.maxx - left.minx + 1) / GRID_COLS;
    if (module < 2.5) continue;
    const ox = left.minx, oy = left.miny;
    // Implied band must fit the image (within a blur-bleed tolerance of 2 modules).
    if (ox + GRID_COLS * module > width + 2 * module) continue;
    if (oy + GRID_ROWS * module > height + 2 * module) continue;
    // Each finder's measured size should be ~FINDER modules.
    const sizeL = (left.maxx - left.minx + 1 + (left.maxy - left.miny + 1)) / 2;
    const sizeR = (right.maxx - right.minx + 1 + (right.maxy - right.miny + 1)) / 2;
    if (Math.abs(sizeL - FINDER * module) > 1.5 * module) continue;
    if (Math.abs(sizeR - FINDER * module) > 1.5 * module) continue;
    out.push({ ox, oy, module });
  }
  return out;
}

interface Header { version: number; palette: readonly RGB[]; tier: Tier; payloadLen: number; crc: number }

/** Attempt a full decode at one fixed-geometry candidate. Returns payload or null.
 *
 *  The header is read FIRST: it is drawn in grayscale against the finder/quiet-zone references, so
 *  it needs no color calibration, and the version it carries is what says which palette the band
 *  below it is drawn in. That palette is resolved once here — the per-module classifier below
 *  never branches on version. */
function decodeAt(rgba: Uint8Array, width: number, height: number, geo: Geo): Uint8Array | null {
  const { ox, oy, module } = geo;

  // Grayscale references: black from the TL finder interior, white from the quiet zone above it.
  const black = sampleRect(rgba, width, height, ox, oy, FINDER * module, FINDER * module);
  if (!black) return null;
  const blackY = luma(black);
  const whiteYsample = sampleStripLuma(rgba, width, height, ox, ox + GRID_COLS * module, oy - 1.5 * module);
  const whiteY = whiteYsample ?? luma(BG);
  const headerRefs = HEADER_LUMAS.map((lv) => blackY + (whiteY - blackY) * (lv / 255));

  // ── Header: HEADER_MODULES grayscale modules → 2-bit symbols → RS(8) → HEADER_BYTES record. ──
  const headerSymbols: number[] = [];
  const headerErasures: number[] = [];
  for (let k = 0; k < HEADER_MODULES; k++) {
    const { col, row } = headerModuleAt(k);
    const s = sampleRect(rgba, width, height, ox + col * module, oy + row * module, module, module);
    if (!s) return null;
    const y = luma(s);
    // Nearest header reference on luma only (header positions are known; never compare vs BG).
    let best = 0, d1 = Infinity, d2 = Infinity;
    for (let j = 0; j < headerRefs.length; j++) {
      const d = Math.abs(y - headerRefs[j]!);
      if (d < d1) { d2 = d1; d1 = d; best = j; } else if (d < d2) { d2 = d; }
    }
    headerSymbols.push(best);
    const conf = d2 > 0 ? (d2 - d1) / d2 : 1;
    if (conf < HEADER_ERASURE_CONF) headerErasures.push(k);
  }
  const headerBytes = symbolsToBytes(headerSymbols, HEADER_SYMBOL_BITS, HEADER_ENC_BYTES);
  const headerByteErasures = symbolErasuresToByteErasures(headerErasures, HEADER_SYMBOL_BITS, HEADER_ENC_BYTES);
  if (headerByteErasures.length > HEADER_NSYM) return null;
  const headerData = rsDecode(headerBytes, HEADER_NSYM, headerByteErasures);
  if (!headerData || headerData.length < HEADER_BYTES) return null;
  const header = parseHeader(headerData);
  if (!header) return null;
  const { palette, tier, payloadLen, crc } = header;

  // ── Calibration: learn one centroid per palette entry from the swatch row. ──
  // The centroids are MEASURED off this image, not read from the version's table, so the data
  // region is classified against the colors the band actually carries after whatever recompression
  // it went through. The version fixes how many swatches there are and what each index means.
  const centroids: RGB[] = [];
  for (let i = 0; i < palette.length; i++) {
    const { col } = calibrationRect(i);
    const x = ox + col * module, y = oy;
    const s = sampleRect(rgba, width, height, x, y, CALIB_CELLS * module, CALIB_CELLS * module);
    if (!s) return null;
    centroids.push(s);
  }

  // ── Data: sample exactly the codeword-backed module count, classify to symbols. ──
  const blocks = nBlocks(tier);
  const streamBytes = blocks * RS_N;
  const symbolCount = Math.ceil((streamBytes * 8) / tier.bits);
  const size = module / tier.div;
  const dataY0 = oy + TOP_ROWS * module;

  // Centroid subset: for 8-color tiers, build it in PALETTE8_INDICES order so classify's returned
  // index IS the symbol value; for 16-color tiers the full learned set (idx = symbol).
  const tierCentroids: RGB[] = tier.colors === 8
    ? PALETTE8_INDICES.map((idx) => centroids[idx]!)
    : centroids;

  const symbols: number[] = new Array(symbolCount);
  const dataErasures: number[] = [];
  for (let k = 0; k < symbolCount; k++) {
    const col = k % tier.dataCols, rowIdx = Math.floor(k / tier.dataCols);
    const x = ox + col * size, y = dataY0 + rowIdx * size;
    const s = sampleRect(rgba, width, height, x, y, size, size);
    if (!s) return null;
    const { idx, confidence } = classify(s, tierCentroids);
    symbols[k] = idx;
    if (confidence < ERASURE_CONF) dataErasures.push(k);
  }

  // ── Transport reverse. ──
  const packed = symbolsToBytes(symbols, tier.bits, streamBytes);
  const stream = whiten(packed); // XOR self-inverse → un-whiten
  const byteErasures = symbolErasuresToByteErasures(dataErasures, tier.bits, streamBytes);
  const perBlock = deinterleave(stream, blocks, RS_N);
  const perBlockErasures = deinterleaveErasures(byteErasures, blocks, RS_N);

  const dataParts: Uint8Array[] = [];
  for (let b = 0; b < blocks; b++) {
    const eras = perBlockErasures[b]!;
    if (eras.length > RS_N - RS_K) return null; // > 71 erasures — uncorrectable
    const decoded = rsDecode(perBlock[b]!, RS_N - RS_K, eras);
    if (!decoded) return null;
    dataParts.push(decoded);
  }

  const full = new Uint8Array(blocks * RS_K);
  for (let b = 0; b < blocks; b++) full.set(dataParts[b]!, b * RS_K);
  if (payloadLen > full.length) return null;
  const payload = full.slice(0, payloadLen);
  if ((crc32(payload) >>> 0) !== (crc >>> 0)) return null;
  return payload;
}

/** Parse + validate the 8-byte header record. Returns null on any invalid field. */
function parseHeader(bytes: Uint8Array): Header | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint8(HEADER_OFFSET.version);
  const palette = paletteForVersion(version);
  if (!palette) return null;
  const tierId = dv.getUint8(HEADER_OFFSET.tier);
  if (tierId < 0 || tierId >= TIERS.length) return null;
  const tier = TIERS[tierId]!;
  const payloadLen = dv.getUint16(HEADER_OFFSET.payloadLen, true);
  if (payloadLen > tier.payloadCap) return null;
  const crc = dv.getUint32(HEADER_OFFSET.crc, true);
  return { version, palette, tier, payloadLen, crc };
}

/** Decode a PetitGlyph v2 code band from an RGBA image. Returns the payload bytes, or null on any
 *  failure. Never throws. */
export function decodeGlyph(rgba: Uint8Array, width: number, height: number): Uint8Array | null {
  let candidates: Geo[];
  try {
    candidates = findFinders(rgba, width, height);
  } catch {
    return null;
  }
  for (const geo of candidates) {
    try {
      const payload = decodeAt(rgba, width, height, geo);
      if (payload) return payload;
    } catch {
      // bounds bug or malformed geometry — try the next candidate
    }
  }
  return null;
}
