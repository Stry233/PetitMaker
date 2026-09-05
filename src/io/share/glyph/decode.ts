import {
  GRID_COLS, TOP_ROWS, CURRENT_TOP_ROWS, RS_N, RS_K, HEADER_NSYM, HEADER_BYTES, HEADER_VERSION,
  HEADER_OFFSET, HEADER_ENC_BYTES, HEADER_SYMBOL_BITS, HEADER_MODULES, FINDER, CALIB_CELLS,
  TIERS, type Tier, calibrationRect, headerModuleAt, nBlocks,
} from './geometry';
import { dataCellAt, GLYPH_PROFILES, planFor, type GlyphPlan } from './profiles';
import {
  PALETTE8_INDICES, HEADER_LEVELS, rgbToYcc, classify, paletteForVersion, type RGB,
} from './palette';
import { rsDecode } from './rs';
import { deinterleave, deinterleaveErasures } from './interleave';
import { bytesToSymbols, symbolsToBytes, symbolErasuresToByteErasures } from './bitpack';
import { crc32 } from '../crypto/crc32';
import { whiten } from './encode';
import { convolutionDecode, codedBits } from './convolution';
import { BlockRecovery, type RecoveryBudget } from './recovery';

const ERASURE_CONFIDENCE = 0.2;
const HEADER_ERASURE_CONFIDENCE = 0.15;

interface Component { minx: number; maxx: number; miny: number; maxy: number; count: number }
interface Geometry { ox: number; oy: number; module: number }

function luminance(color: RGB): number {
  return rgbToYcc(color[0], color[1], color[2])[0];
}

const HEADER_LUMAS = HEADER_LEVELS.map((color) => luminance(color));

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1]!;
}

/** Median RGB over the inner half of a pixel rectangle. */
function sampleRect(
  rgba: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): RGB | null {
  const xa = Math.ceil(x0 + w * 0.25);
  const xb = Math.floor(x0 + w * 0.75);
  const ya = Math.ceil(y0 + h * 0.25);
  const yb = Math.floor(y0 + h * 0.75);
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 4;
    red.push(rgba[index]!);
    green.push(rgba[index + 1]!);
    blue.push(rgba[index + 2]!);
  };
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) push(x, y);
  }
  if (red.length === 0) push(Math.round(x0 + w / 2), Math.round(y0 + h / 2));
  return red.length > 0 ? [median(red), median(green), median(blue)] : null;
}

/** Finder separation distinguishes the share band from dark shapes elsewhere in the image. */
function findFinders(rgba: Uint8Array, width: number, height: number): Geometry[] {
  const dark = (pixel: number) => rgba[pixel * 4]! + rgba[pixel * 4 + 1]! + rgba[pixel * 4 + 2]! < 100;
  const seen = new Uint8Array(width * height);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (seen[pixel] || !dark(pixel)) continue;
    let minx = width;
    let maxx = 0;
    let miny = height;
    let maxy = 0;
    let count = 0;
    stack.push(pixel);
    seen[pixel] = 1;
    while (stack.length > 0) {
      const current = stack.pop()!;
      const x = current % width;
      const y = Math.floor(current / width);
      count++;
      minx = Math.min(minx, x);
      maxx = Math.max(maxx, x);
      miny = Math.min(miny, y);
      maxy = Math.max(maxy, y);
      if (x > 0 && !seen[current - 1] && dark(current - 1)) { seen[current - 1] = 1; stack.push(current - 1); }
      if (x < width - 1 && !seen[current + 1] && dark(current + 1)) { seen[current + 1] = 1; stack.push(current + 1); }
      if (y > 0 && !seen[current - width] && dark(current - width)) { seen[current - width] = 1; stack.push(current - width); }
      if (y < height - 1 && !seen[current + width] && dark(current + width)) { seen[current + width] = 1; stack.push(current + width); }
      if (count > width * height) return [];
    }
    const componentWidth = maxx - minx + 1;
    const componentHeight = maxy - miny + 1;
    if (
      componentWidth >= 6
      && componentHeight >= 6
      && count > 0.55 * componentWidth * componentHeight
      && componentWidth / componentHeight > 0.6
      && componentWidth / componentHeight < 1.66
    ) {
      components.push({ minx, maxx, miny, maxy, count });
    }
  }
  if (components.length < 2) return [];

  components.sort((a, b) => b.count - a.count);
  const candidates = components.slice(0, 64);
  const pairs: { left: Component; right: Component; score: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      const aw = a.maxx - a.minx + 1;
      const ah = a.maxy - a.miny + 1;
      const bw = b.maxx - b.minx + 1;
      const bh = b.maxy - b.miny + 1;
      if (Math.min(aw, bw) / Math.max(aw, bw) < 0.7 || Math.min(ah, bh) / Math.max(ah, bh) < 0.7) continue;
      if (Math.abs(a.miny - b.miny) > Math.max(ah, bh)) continue;
      const acx = (a.minx + a.maxx) / 2;
      const bcx = (b.minx + b.maxx) / 2;
      const spanInFinderWidths = Math.abs(acx - bcx) / ((aw + bw) / 2);
      if (spanInFinderWidths < 28 || spanInFinderWidths > 60) continue;
      const [left, right] = acx < bcx ? [a, b] : [b, a];
      pairs.push({ left, right, score: a.count + b.count });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const geometries: Geometry[] = [];
  for (const { left, right } of pairs.slice(0, 4)) {
    const leftCx = (left.minx + left.maxx + 1) / 2;
    const rightCx = (right.minx + right.maxx + 1) / 2;
    const leftCy = (left.miny + left.maxy + 1) / 2;
    const rightCy = (right.miny + right.maxy + 1) / 2;
    const centeredModule = (rightCx - leftCx) / (GRID_COLS - FINDER);
    const candidatesForPair: Geometry[] = [
      {
        module: centeredModule,
        ox: leftCx - FINDER * centeredModule / 2,
        oy: (leftCy + rightCy) / 2 - FINDER * centeredModule / 2,
      },
      {
        module: (right.maxx - left.minx + 1) / GRID_COLS,
        ox: left.minx,
        oy: left.miny,
      },
    ];
    for (const geometry of candidatesForPair) {
      const { module, ox, oy } = geometry;
      if (module < 2.5) continue;
      if (ox + GRID_COLS * module > width + 2 * module) continue;
      if (oy + TOP_ROWS * module > height + 2 * module) continue;
      const leftSize = (left.maxx - left.minx + 1 + left.maxy - left.miny + 1) / 2;
      const rightSize = (right.maxx - right.minx + 1 + right.maxy - right.miny + 1) / 2;
      if (Math.abs(leftSize - FINDER * module) > 1.5 * module) continue;
      if (Math.abs(rightSize - FINDER * module) > 1.5 * module) continue;
      if (!geometries.some((item) => Math.abs(item.ox - ox) < 0.01 && Math.abs(item.oy - oy) < 0.01 && Math.abs(item.module - module) < 0.01)) {
        geometries.push(geometry);
      }
    }
  }
  return geometries;
}

/** Finder darkness supplies fractional edge coverage after antialiased resizing. */
function refineGeometry(rgba: Uint8Array, width: number, height: number, geometry: Geometry): Geometry {
  const { ox, oy, module } = geometry;
  const ink = sampleRect(rgba, width, height, ox, oy, FINDER * module, FINDER * module);
  const paper = sampleRect(rgba, width, height, ox + 80 * module, oy + module, module, module);
  if (!ink || !paper) return geometry;
  const white = luminance(paper);
  const contrast = white - luminance(ink);
  if (contrast < 80) return geometry;
  const center = (left: number): { x: number; y: number } => {
    let sx = 0, sy = 0, total = 0;
    for (let y = Math.max(0, Math.floor(oy - 2)); y < Math.min(height, oy + FINDER * module + 2); y++) {
      for (let x = Math.max(0, Math.floor(left - 2)); x < Math.min(width, left + FINDER * module + 2); x++) {
        const p = (y * width + x) * 4;
        const value = luminance([rgba[p]!, rgba[p + 1]!, rgba[p + 2]!]);
        const weight = Math.max(0, Math.min(1, (white - value) / contrast));
        sx += (x + 0.5) * weight;
        sy += (y + 0.5) * weight;
        total += weight;
      }
    }
    return { x: sx / total, y: sy / total };
  };
  const left = center(ox), right = center(ox + (GRID_COLS - FINDER) * module);
  const refinedModule = (right.x - left.x) / (GRID_COLS - FINDER);
  return { module: refinedModule, ox: left.x - FINDER * refinedModule / 2,
    oy: (left.y + right.y) / 2 - FINDER * refinedModule / 2 };
}

interface HeaderBase { payloadLen: number; crc: number; palette: readonly RGB[] }
interface LegacyHeader extends HeaderBase { kind: 'legacy'; tier: Tier }
interface CurrentHeader extends HeaderBase { kind: 'current'; plan: GlyphPlan }
type Header = LegacyHeader | CurrentHeader;

interface CurrentCandidate {
  geometry: Geometry;
  header: CurrentHeader;
  centroids: readonly RGB[];
  recovery: BlockRecovery;
}

function parseHeader(bytes: Uint8Array): Header | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(HEADER_OFFSET.version);
  const transportId = view.getUint8(HEADER_OFFSET.tier);
  const payloadLen = view.getUint16(HEADER_OFFSET.payloadLen, true);
  const crc = view.getUint32(HEADER_OFFSET.crc, true);
  if (version === 1 || version === 2) {
    const palette = paletteForVersion(version);
    const tier = TIERS[transportId];
    if (!palette || !tier || payloadLen > tier.payloadCap) return null;
    return { kind: 'legacy', palette, tier, payloadLen, crc };
  }
  if (version !== HEADER_VERSION) return null;
  const profile = GLYPH_PROFILES.find((item) => item.id === transportId);
  if (!profile || profile.id !== transportId) return null;
  const plan = planFor(payloadLen, profile);
  if (!plan) return null;
  return { kind: 'current', palette: profile.palette, plan, payloadLen, crc };
}

function decodeLegacy(
  rgba: Uint8Array,
  width: number,
  height: number,
  geometry: Geometry,
  header: LegacyHeader,
  centroids: readonly RGB[],
): Uint8Array | null {
  const { ox, oy, module } = geometry;
  const { tier, payloadLen, crc } = header;
  const blockCount = nBlocks(tier);
  const streamBytes = blockCount * RS_N;
  const symbolCount = Math.ceil((streamBytes * 8) / tier.bits);
  const size = module / tier.div;
  const dataY = oy + TOP_ROWS * module;
  const palette = tier.colors === 8 ? PALETTE8_INDICES.map((index) => centroids[index]!) : centroids;
  const symbols: number[] = new Array(symbolCount);
  const erased: number[] = [];
  for (let k = 0; k < symbolCount; k++) {
    const col = k % tier.dataCols;
    const row = Math.floor(k / tier.dataCols);
    const sample = sampleRect(rgba, width, height, ox + col * size, dataY + row * size, size, size);
    if (!sample) return null;
    const hit = classify(sample, palette);
    symbols[k] = hit.idx;
    if (hit.confidence < ERASURE_CONFIDENCE) erased.push(k);
  }

  const stream = whiten(symbolsToBytes(symbols, tier.bits, streamBytes));
  const byteErasures = symbolErasuresToByteErasures(erased, tier.bits, streamBytes);
  const blocks = deinterleave(stream, blockCount, RS_N);
  const blockErasures = deinterleaveErasures(byteErasures, blockCount, RS_N);
  const full = new Uint8Array(blockCount * RS_K);
  for (let block = 0; block < blockCount; block++) {
    if (blockErasures[block]!.length > RS_N - RS_K) return null;
    const decoded = rsDecode(blocks[block]!, RS_N - RS_K, blockErasures[block]!);
    if (!decoded) return null;
    full.set(decoded, block * RS_K);
  }
  if (payloadLen > full.length) return null;
  const payload = full.slice(0, payloadLen);
  return (crc32(payload) >>> 0) === (crc >>> 0) ? payload : null;
}

function decodeCurrent(
  rgba: Uint8Array, width: number, height: number, geometry: Geometry,
  header: CurrentHeader, centroids: readonly RGB[], recovery: BlockRecovery,
): Uint8Array | null {
  return recoverCurrent(rgba, width, height, { geometry, header, centroids, recovery }, 0, 0, 1, 0, 1, { attempts: 1000 });
}

function decodeAt(
  rgba: Uint8Array, width: number, height: number, geometry: Geometry,
  current: CurrentCandidate[],
): Uint8Array | null {
  const { ox, oy, module } = geometry;
  const ink = sampleRect(rgba, width, height, ox, oy, FINDER * module, FINDER * module);
  const paper = sampleRect(rgba, width, height, ox + 80 * module, oy + module, module, module);
  if (!ink || !paper) return null;
  const inkY = luminance(ink);
  const paperY = luminance(paper);
  const headerReferences = HEADER_LUMAS.map((value) => inkY + (paperY - inkY) * (value / 255));

  const headerSymbols: number[] = [];
  const headerErasures: number[] = [];
  for (let k = 0; k < HEADER_MODULES; k++) {
    const { col, row } = headerModuleAt(k);
    const sample = sampleRect(rgba, width, height, ox + col * module, oy + row * module, module, module);
    if (!sample) return null;
    const value = luminance(sample);
    let best = 0;
    let nearest = Infinity;
    let second = Infinity;
    for (let index = 0; index < headerReferences.length; index++) {
      const distance = Math.abs(value - headerReferences[index]!);
      if (distance < nearest) {
        second = nearest;
        nearest = distance;
        best = index;
      } else if (distance < second) {
        second = distance;
      }
    }
    headerSymbols.push(best);
    const confidence = second > 0 ? (second - nearest) / second : 1;
    if (confidence < HEADER_ERASURE_CONFIDENCE) headerErasures.push(k);
  }
  const encodedHeader = symbolsToBytes(headerSymbols, HEADER_SYMBOL_BITS, HEADER_ENC_BYTES);
  const byteErasures = symbolErasuresToByteErasures(headerErasures, HEADER_SYMBOL_BITS, HEADER_ENC_BYTES);
  if (byteErasures.length > HEADER_NSYM) return null;
  const headerBytes = rsDecode(encodedHeader, HEADER_NSYM, byteErasures);
  if (!headerBytes || headerBytes.length < HEADER_BYTES) return null;
  const header = parseHeader(headerBytes);
  if (!header) return null;

  const centroids: RGB[] = [];
  for (let i = 0; i < header.palette.length; i++) {
    const { col, row } = calibrationRect(i);
    const sample = sampleRect(
      rgba, width, height,
      ox + col * module, oy + row * module,
      CALIB_CELLS * module, CALIB_CELLS * module,
    );
    if (!sample) return null;
    centroids.push(sample);
  }

  if (header.kind === 'legacy') return decodeLegacy(rgba, width, height, geometry, header, centroids);
  const matching = current.find((candidate) => candidate.header.crc === header.crc
    && candidate.header.payloadLen === header.payloadLen
    && candidate.header.plan.profile.id === header.plan.profile.id);
  const recovery = matching?.recovery ?? new BlockRecovery(header.plan, header.payloadLen, header.crc);
  current.push({ geometry, header, centroids, recovery });
  return decodeCurrent(rgba, width, height, geometry, header, centroids, recovery);
}

function recoverCurrent(
  rgba: Uint8Array, width: number, height: number, candidate: CurrentCandidate,
  dx: number, dy: number, gain: number, sharpen: number, radius: number, budget: RecoveryBudget,
  spanAdjustment = 0,
): Uint8Array | null {
  const { geometry, header: { plan }, centroids, recovery } = candidate;
  const { profile } = plan;
  const size = geometry.module / profile.div;
  const pixel = (x: number, y: number): RGB => {
    const weight = (v: number): number => {
      const a = Math.abs(v);
      return a < 1 ? 1.5 * a * a * a - 2.5 * a * a + 1 : a < 2 ? -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2 : 0;
    };
    const sx = x - 0.5, sy = y - 0.5;
    const color = [0, 0, 0];
    for (let iy = Math.floor(sy) - 1; iy <= Math.floor(sy) + 2; iy++) {
      for (let ix = Math.floor(sx) - 1; ix <= Math.floor(sx) + 2; ix++) {
        const w = weight(sx - ix) * weight(sy - iy);
        const p = (Math.max(0, Math.min(height - 1, iy)) * width + Math.max(0, Math.min(width - 1, ix))) * 4;
        for (let channel = 0; channel < 3; channel++) color[channel]! += rgba[p + channel]! * w;
      }
    }
    return color as unknown as RGB;
  };
  const soft = new Float32Array(codedBits(plan.streamBytes));
  const anchors = centroids.map(luminance);
  const mid = (anchors[0]! + anchors[3]!) / 2;
  const levels = anchors.map((value) => mid + (value - mid) * gain);
  for (let k = 0; k < plan.symbolCount; k++) {
    const { col, row } = dataCellAt(k, plan);
    const x = geometry.ox + (col + 0.5) * size + dx + ((col + 0.5) / profile.dataCols - 0.5) * spanAdjustment;
    const y = geometry.oy + CURRENT_TOP_ROWS * geometry.module + (row + 0.5) * size + dy;
    let value = luminance(pixel(x, y));
    if (sharpen > 0) {
      const neighbors = [pixel(x - radius, y), pixel(x + radius, y), pixel(x, y - radius), pixel(x, y + radius)];
      value += sharpen * (value - neighbors.reduce((sum, c) => sum + luminance(c), 0) / 4);
    }
    const distances = levels.map((level) => (value - level) ** 2);
    const labels = [0, 1, 3, 2];
    for (let bit = 0; bit < 2 && k * 2 + bit < soft.length; bit++) {
      let zero = Infinity, one = Infinity;
      for (let l = 0; l < 4; l++) {
        if ((labels[l]! >>> (1 - bit)) & 1) one = Math.min(one, distances[l]!);
        else zero = Math.min(zero, distances[l]!);
      }
      soft[k * 2 + bit] = Math.max(-4000, Math.min(4000, zero - one));
    }
  }
  const stream = convolutionDecode(soft, plan.streamBytes);
  return recovery.read(bytesToSymbols(stream, 2), Array(plan.streamBytes * 4).fill(1), budget);
}

/** Decode a v1, v2, or v3 PetitGlyph from a larger RGBA image. */
export function decodeGlyph(rgba: Uint8Array, width: number, height: number): Uint8Array | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width * height * 4 !== rgba.length) return null;
  let candidates: Geometry[];
  try {
    candidates = findFinders(rgba, width, height);
  } catch {
    return null;
  }
  const current: CurrentCandidate[] = [];
  for (const geometry of candidates) {
    try {
      const payload = decodeAt(rgba, width, height, geometry, current);
      if (payload) return payload;
    } catch {
      // A malformed candidate does not prevent testing the remaining finder pairs.
    }
  }
  for (const candidate of current.slice()) {
    const geometry = refineGeometry(rgba, width, height, candidate.geometry);
    const centroids = candidate.centroids.map((_, i): RGB => {
      const rect = calibrationRect(i);
      const x = Math.floor(geometry.ox + (rect.col + CALIB_CELLS / 2) * geometry.module);
      const y = Math.floor(geometry.oy + (rect.row + CALIB_CELLS / 2) * geometry.module);
      const p = (y * width + x) * 4;
      return [rgba[p]!, rgba[p + 1]!, rgba[p + 2]!];
    });
    current.push({ ...candidate, geometry, centroids });
  }
  const budget: RecoveryBudget = { attempts: 16_000 };
  const offsets = [[0, 0], [0, -0.25], [0, 0.25], [-0.25, 0], [0.25, 0],
    [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] as const;
  // Recompression changes color separation and pixel phase; the complete payload still needs its CRC.
  for (const [gain, sharpen, radius, span] of [[1, 0, 1, 0], [0.85, 0, 1, 0], [1, 0.25, 1, 0], [1, 0.5, 1, 0],
    [1, 0, 1, 1], [1, 0, 1, -1]] as const) {
    for (const [dx, dy] of offsets) for (const candidate of current) {
      const payload = recoverCurrent(rgba, width, height, candidate, dx, dy, gain, sharpen, radius, budget, span);
      if (payload) return payload;
      if (budget.attempts <= 0) return null;
    }
  }
  return null;
}
