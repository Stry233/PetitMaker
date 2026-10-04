import type { Rotation } from '../../core/model/types';
import type { CellReadings } from './classify';
import type { CellEvidence } from './evidence';
import { SCAN_PROFILE } from './profile';
import { close, label, open, quantile } from './raster';

// The landmark from the evidence: its paving is grey or beige, so low in chroma, bright and not
// grass, and the grass encloses it. Candidate cells inside the grass blob form a blob; the
// landmark's footprint (`SCAN_PROFILE.landmark`, either way round) is fitted to the largest one.

const L = SCAN_PROFILE.landmarkSearch;

/** Where the landmark stands, in grid cells: its footprint's top-left corner (half cells allowed),
 *  the turn of the profile's footprint, and the footprint's overlap with the paving, in (0, 1].
 *  The paving's outline is symmetric, so `rotation` is 0 or 90 and a half turn more fits as well. */
export interface PlazaDetection {
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
  readonly confidence: number;
}

/** The landmark found in the readings, or null when no paving matches its footprint. */
export function detectPlaza(ev: CellEvidence, readings: CellReadings): PlazaDetection | null {
  const { cols, rows } = readings;
  const n = cols * rows;
  const chroma = new Float64Array(n);
  const inside: number[] = [];
  for (let i = 0; i < n; i++) {
    chroma[i] = Math.hypot(ev.inner.a[i]!, ev.inner.b[i]!);
    if (readings.blob[i]! > SCAN_PROFILE.ground.vote) inside.push(i);
  }
  if (inside.length === 0) return null;
  const maxChroma = quantile(inside.map((i) => chroma[i]!), L.chromaPercentile / 100);
  const minLight = quantile(inside.map((i) => ev.inner.l[i]!), L.lightPercentile / 100);
  let cand: Uint8Array = new Uint8Array(n);
  for (const i of inside) {
    if (readings.grass[i]! < SCAN_PROFILE.ground.vote && chroma[i]! < maxChroma && ev.inner.l[i]! > minLight) cand[i] = 1;
  }
  cand = open(close(cand, cols, rows, L.close), cols, rows, L.open);
  const { labels, sizes } = label(cand, cols, rows);
  let best = 0;
  for (let k = 1; k < sizes.length; k++) if (sizes[k]! >= L.minArea && sizes[k]! > (sizes[best] ?? 0)) best = k;
  if (best === 0) return null;
  let sx = 0, sy = 0;
  const blob = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (labels[i] !== best) continue;
    blob[i] = 1;
    sx += i % cols;
    sy += Math.floor(i / cols);
  }
  const area = sizes[best]!;
  const cx = sx / area + 0.5;
  const cy = sy / area + 0.5;
  // A footprint at a half-cell corner covers the cells it overlaps by half with weight one half.
  const overlap = (x: number, y: number, w: number, h: number): number => {
    let inter = 0, foot = 0;
    for (let r = Math.floor(y); r < Math.ceil(y + h); r++) {
      const fr = Math.min(r + 1, y + h) - Math.max(r, y);
      for (let c = Math.floor(x); c < Math.ceil(x + w); c++) {
        const f = fr * (Math.min(c + 1, x + w) - Math.max(c, x));
        foot += f;
        if (r >= 0 && c >= 0 && r < rows && c < cols && blob[r * cols + c]) inter += f;
      }
    }
    return inter / (foot + area - inter);
  };
  const { width, height } = SCAN_PROFILE.landmark;
  let found: PlazaDetection | null = null;
  let offset = Infinity;
  for (const rotation of [0, 90] as const) {
    const w = rotation === 0 ? width : height;
    const h = rotation === 0 ? height : width;
    const x0 = Math.round((cx - w / 2) * 2) / 2;
    const y0 = Math.round((cy - h / 2) * 2) / 2;
    for (let dy = -L.search; dy <= L.search; dy += 0.5) {
      for (let dx = -L.search; dx <= L.search; dx += 0.5) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x + w > cols || y + h > rows) continue;
        const q = overlap(x, y, w, h);
        // Among equal overlaps (paving smaller than the footprint) the one centred on the blob wins.
        const off = (x + w / 2 - cx) ** 2 + (y + h / 2 - cy) ** 2;
        if (!found || q > found.confidence + 1e-9 || (q > found.confidence - 1e-9 && off < offset)) {
          found = { x, y, rotation, confidence: q };
          offset = off;
        }
      }
    }
  }
  return found && found.confidence >= L.minOverlap ? found : null;
}
