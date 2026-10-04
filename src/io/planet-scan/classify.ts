import { makeRng } from '../../core/model/rng';
import { classLookup, inSeaBand, labHue, toLab, GRASS, SAND, SEA, type PixelClass } from './colour';
import { areaWeights, type CellEvidence } from './evidence';
import { SCAN_PROFILE } from './profile';
import { blur, chessboardDistance, close, componentsTouching, erode, fillHoles, largestComponent } from './raster';
import { atCell, coastRasters, shoreLand, SHORE_MODEL, type CoastRasters, type ShoreModel } from './shore-model';

// Sea, sand and grass from the evidence. The palette is fitted per recording, since lighting and
// exposure differ: k-means in L*a*b*, sea by its hue band, and sand from grass at an Otsu split of
// the land pixels' hue. Grass is decided first and land around it:
//
// - observed grass: the largest 4-connected run of cells whose inner area is mostly grass, holes
//   filled;
// - the grass blob (the grass vote closed and filled at sample resolution) and a row and column
//   profile of the grass outline, which interpolates edges hidden by builds, may each add a cell
//   only where it shows build texture (local contrast), so smooth or washed-out sand stays sand;
// - land is the grass plus, near the observed coast, cells the shore model calls land and,
//   elsewhere, cells more than `inland` cells inside the observed sea's edge; only land
//   8-connected to the grass stays, holes filled. The shore rim is derived later by the planet
//   model.

const G = SCAN_PROFILE.ground;

/** The recording's ground palette: cluster centres in L*a*b*, each centre's class, and the hue
 *  that splits sand from grass. */
export interface Palette {
  readonly centres: Float64Array;
  readonly classes: Uint8Array;
  readonly split: number;
}

function kmeans(samples: Float32Array, k: number, seed: number, iterations: number): { centres: Float64Array; inertia: number } {
  const n = samples.length / 3;
  const rng = makeRng(seed);
  const centres = new Float64Array(k * 3);
  const dist = new Float64Array(n).fill(Infinity);
  const d2 = (i: number, c: number) => {
    const dl = samples[i * 3]! - centres[c * 3]!;
    const da = samples[i * 3 + 1]! - centres[c * 3 + 1]!;
    const db = samples[i * 3 + 2]! - centres[c * 3 + 2]!;
    return dl * dl + da * da + db * db;
  };
  // k-means++ seeding.
  let pick = rng.int(n);
  for (let c = 0; c < k; c++) {
    centres.set(samples.subarray(pick * 3, pick * 3 + 3), c * 3);
    let total = 0;
    for (let i = 0; i < n; i++) total += dist[i] = Math.min(dist[i]!, d2(i, c));
    if (c + 1 === k) break;
    let t = rng.float() * total;
    pick = n - 1;
    for (let i = 0; i < n; i++) {
      t -= dist[i]!;
      if (t < 0) {
        pick = i;
        break;
      }
    }
  }
  const assign = new Int32Array(n).fill(-1);
  const sums = new Float64Array(k * 3);
  const counts = new Float64Array(k);
  let inertia = 0;
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    inertia = 0;
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const v = d2(i, c);
        if (v < bd) {
          bd = v;
          best = c;
        }
      }
      inertia += bd;
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
      counts[best]! += 1;
      sums[best * 3]! += samples[i * 3]!;
      sums[best * 3 + 1]! += samples[i * 3 + 1]!;
      sums[best * 3 + 2]! += samples[i * 3 + 2]!;
    }
    if (!changed) break;
    for (let c = 0; c < k; c++) {
      if (counts[c]! > 0) for (let j = 0; j < 3; j++) centres[c * 3 + j] = sums[c * 3 + j]! / counts[c]!;
    }
  }
  return { centres, inertia };
}

/** The Otsu threshold of the land samples' hue histogram over `G.hueRange` in 1-degree bins. */
function hueSplit(samples: Float32Array): number {
  const [lo, hi] = G.hueRange;
  const bins = hi - lo;
  const hist = new Float64Array(bins);
  for (let i = 0; i < samples.length; i += 3) {
    const h = labHue(samples[i + 1]!, samples[i + 2]!);
    if (inSeaBand(h) || h < lo || h > hi) continue;
    hist[Math.min(bins - 1, Math.floor(h - lo))]! += 1;
  }
  let best = 0;
  let split: number = G.fallbackSplit;
  for (let t = 1; t < bins; t++) {
    let w0 = 0, w1 = 0, s0 = 0, s1 = 0;
    for (let b = 0; b < bins; b++) {
      const c = lo + b + 0.5;
      if (b < t) {
        w0 += hist[b]!;
        s0 += hist[b]! * c;
      } else {
        w1 += hist[b]!;
        s1 += hist[b]! * c;
      }
    }
    if (w0 === 0 || w1 === 0) continue;
    const v = w0 * w1 * (s0 / w0 - s1 / w1) ** 2;
    if (v > best) {
      best = v;
      split = lo + t;
    }
  }
  return split;
}

/** Fits the palette to L*a*b* samples (`colour.ts:PaletteSampler`); deterministic. */
export function fitPalette(samples: Float32Array): Palette {
  const P = G.palette;
  if (samples.length < P.clusters * 3) throw new Error('too few colour samples for the palette');
  let best: { centres: Float64Array; inertia: number } | null = null;
  for (let r = 0; r < P.restarts; r++) {
    const run = kmeans(samples, P.clusters, P.seed + r, P.iterations);
    if (!best || run.inertia < best.inertia) best = run;
  }
  const centres = best!.centres;
  const split = hueSplit(samples);
  const classes = new Uint8Array(P.clusters);
  for (let c = 0; c < P.clusters; c++) {
    const h = labHue(centres[c * 3 + 1]!, centres[c * 3 + 2]!);
    classes[c] = inSeaBand(h) ? SEA : h < split ? SAND : GRASS;
  }
  return { centres, classes, split };
}

/** The class lookup of a palette: each colour takes its nearest centre's class. */
export function paletteLookup(palette: Palette): Uint8Array {
  const lab = new Float64Array(3);
  const k = palette.classes.length;
  return classLookup((r, g, b): PixelClass => {
    toLab(r, g, b, lab);
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < k; c++) {
      const d = (lab[0]! - palette.centres[c * 3]!) ** 2 + (lab[1]! - palette.centres[c * 3 + 1]!) ** 2 + (lab[2]! - palette.centres[c * 3 + 2]!) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return palette.classes[best] as PixelClass;
  });
}

/** Per-cell readings the ground decision and the landmark search share. */
export interface CellReadings {
  readonly cols: number;
  readonly rows: number;
  /** Seen: the centre's weight exceeds `SCAN_PROFILE.evidence.known`. */
  readonly known: Uint8Array;
  /** Vote shares over the inner area; unseen points count as sea. */
  readonly grass: Float32Array;
  readonly sand: Float32Array;
  readonly sea: Float32Array;
  /** Share of the inner area inside the grass blob. */
  readonly blob: Float32Array;
  /** Local contrast over the central `contrastArea` of the cell. */
  readonly texture: Float32Array;
  /** L*a*b* distance of the inner area's mean colour from the recording's sand. */
  readonly sandDistance: Float32Array;
}

function pointsGrassBlob(ev: CellEvidence): Uint8Array {
  const { width, height, grass } = ev.points;
  const m = new Uint8Array(width * height);
  for (let i = 0; i < m.length; i++) m[i] = grass[i]! > G.vote ? 1 : 0;
  const r = Math.max(1, Math.round((G.blobClose * ev.sub) / ((SCAN_PROFILE.cell.width + SCAN_PROFILE.cell.height) / 2)));
  return largestComponent(fillHoles(close(m, width, height, r), width, height), width, height);
}

function pointsContrast(ev: CellEvidence): Float32Array {
  const { width, height, lightness, weight } = ev.points;
  const s = G.contrastSigma * ev.sub;
  const smooth = blur(lightness, width, height, s / SCAN_PROFILE.cell.width, s / SCAN_PROFILE.cell.height, weight);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = weight[i]! > 0 ? Math.abs(lightness[i]! - smooth[i]!) : 0;
  return out;
}

/** The readings of every cell of the evidence. */
export function cellReadings(ev: CellEvidence): CellReadings {
  const { cols, rows } = ev.grid;
  const s = ev.sub;
  const pw = ev.points.width;
  const n = cols * rows;
  const known = new Uint8Array(n);
  const grass = new Float32Array(n);
  const sand = new Float32Array(n);
  const sea = new Float32Array(n);
  const blobShare = new Float32Array(n);
  const texture = new Float32Array(n);
  const blob = pointsGrassBlob(ev);
  const contrast = pointsContrast(ev);
  const inner = areaWeights(s, SCAN_PROFILE.evidence.inner);
  const edge = areaWeights(s, G.contrastArea);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = r * cols + c;
      known[cell] = ev.weight[cell]! > SCAN_PROFILE.evidence.known ? 1 : 0;
      let g = 0, w = 0, b = 0, cnt = 0;
      for (let j = 0; j < s; j++) {
        for (let i = 0; i < s; i++) {
          const a = inner[i]! * inner[j]!;
          if (a === 0) continue;
          const p = (r * s + j) * pw + c * s + i;
          g += a * ev.points.grass[p]!;
          w += a * ev.points.sea[p]!;
          b += a * blob[p]!;
          cnt += a;
        }
      }
      grass[cell] = g / cnt;
      sea[cell] = w / cnt;
      sand[cell] = Math.max(0, 1 - (g + w) / cnt);
      blobShare[cell] = b / cnt;
      let t = 0, tw = 0;
      for (let j = 0; j < s; j++) {
        for (let i = 0; i < s; i++) {
          const wt = edge[i]! * edge[j]!;
          t += wt * contrast[(r * s + j) * pw + c * s + i]!;
          tw += wt;
        }
      }
      texture[cell] = t / tw;
    }
  }
  // The recording's sand: the median inner colour of confidently sandy cells.
  const sandCells: number[] = [];
  for (let i = 0; i < n; i++) if (sand[i]! > G.sandVote && ev.weight[i]! > G.sandWeight) sandCells.push(i);
  const med = (plane: Float32Array) => {
    const v = Float64Array.from(sandCells, (i) => plane[i]!).sort();
    return v.length === 0 ? Number.NaN : v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
  };
  const sl = med(ev.inner.l), sa = med(ev.inner.a), sb = med(ev.inner.b);
  const sandDistance = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(ev.inner.l[i]! - sl, ev.inner.a[i]! - sa, ev.inner.b[i]! - sb);
    sandDistance[i] = Number.isFinite(d) && ev.inner.weight[i]! > 0 ? d : Infinity;
  }
  return { cols, rows, known, grass, sand, sea, blob: blobShare, texture, sandDistance };
}

/** Rounds to the nearest integer, a half to the even neighbour, so an outline midway between two
 *  certain lines does not lean outward. */
function roundEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v - Math.trunc(v)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * One side of the grass outline per line (a row, or a column through the transposed view), scanned
 * from the outside in (`reverse` scans from the end). Per line: the outline's index when the first
 * cell that is seen and not certainly non-grass is grass; otherwise the interval between that cell
 * and the first grass inside it, to be interpolated; NaN for lines without grass.
 */
function sideBounds(
  lines: number, length: number, at: (line: number, i: number) => number,
  grass: Uint8Array, notGrass: Uint8Array, known: Uint8Array, reverse: boolean,
): { pos: Float64Array; lo: Float64Array; hi: Float64Array; certain: Uint8Array } {
  const pos = new Float64Array(lines).fill(Number.NaN);
  const lo = new Float64Array(lines).fill(Number.NaN);
  const hi = new Float64Array(lines).fill(Number.NaN);
  const certain = new Uint8Array(lines);
  for (let l = 0; l < lines; l++) {
    let any = false;
    for (let i = 0; i < length; i++) if (grass[at(l, i)]) any = true;
    if (!any) continue;
    let first = -1;
    for (let k = 0; k < length; k++) {
      const i = reverse ? length - 1 - k : k;
      const c = at(l, i);
      if (!(notGrass[c] || !known[c])) {
        first = i;
        break;
      }
    }
    if (first < 0) continue;
    if (grass[at(l, first)]) {
      pos[l] = lo[l] = hi[l] = first;
      certain[l] = 1;
      continue;
    }
    const step = reverse ? -1 : 1;
    let g = -1;
    for (let i = first; i >= 0 && i < length; i += step) {
      if (grass[at(l, i)]) {
        g = i;
        break;
      }
    }
    if (g < 0) continue;
    lo[l] = Math.min(g, first);
    hi[l] = Math.max(g, first);
  }
  return { pos, lo, hi, certain };
}

/** Each uncertain line's outline from the nearest certain lines within `G.profileWindow` on either
 *  side, clamped to its interval; the interval's high end when none is near. */
function resolveBounds(b: ReturnType<typeof sideBounds>): Float64Array {
  const pos = b.pos.slice();
  const n = pos.length;
  for (let r = 0; r < n; r++) {
    if (b.certain[r] || !Number.isFinite(b.lo[r]!)) continue;
    let above = -1;
    let below = -1;
    for (let k = r - 1; k >= Math.max(0, r - G.profileWindow); k--) if (b.certain[k]) { above = k; break; }
    for (let k = r + 1; k <= Math.min(n - 1, r + G.profileWindow); k++) if (b.certain[k]) { below = k; break; }
    if (above < 0 && below < 0) {
      pos[r] = b.hi[r]!;
      continue;
    }
    const cand = [above, below].filter((k) => k >= 0).map((k) => b.pos[k]!);
    const v = cand.length === 1 ? cand[0]! : (cand[0]! + cand[1]!) / 2;
    pos[r] = Math.min(b.hi[r]!, Math.max(b.lo[r]!, roundEven(v)));
  }
  return pos;
}

/** The grass region as the outline's row and column profile: inside both the row's and the
 *  column's interval, minus certain non-grass notches on its outline, holes filled. */
function profileGrass(cert: Uint8Array, notGrass: Uint8Array, known: Uint8Array, cols: number, rows: number): Uint8Array {
  const main = fillHoles(largestComponent(cert, cols, rows), cols, rows);
  const byRow = (l: number, i: number) => l * cols + i;
  const byCol = (l: number, i: number) => i * cols + l;
  const right = resolveBounds(sideBounds(rows, cols, byRow, main, notGrass, known, true));
  const left = resolveBounds(sideBounds(rows, cols, byRow, main, notGrass, known, false));
  const bottom = resolveBounds(sideBounds(cols, rows, byCol, main, notGrass, known, true));
  const top = resolveBounds(sideBounds(cols, rows, byCol, main, notGrass, known, false));
  const g = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) g[r * cols + c] = c >= left[r]! && c <= right[r]! && r >= top[c]! && r <= bottom[c]! ? 1 : 0;
  }
  const core = erode(g, cols, rows, 1);
  for (let i = 0; i < g.length; i++) if (notGrass[i] && g[i] && !core[i]) g[i] = 0;
  return fillHoles(g, cols, rows);
}

/** The ground of a scan's grid, per cell. */
export interface GroundReading {
  readonly cols: number;
  readonly rows: number;
  /** `SEA`, `SAND` or `GRASS` per cell. */
  readonly ground: Uint8Array;
  /** Cells whose ground was decided by inference rather than observation: grass whose inner area
   *  is not mostly grass (added for build texture or enclosed by grass), land only hole filling
   *  made land, and land no frame saw. The shore model's coast decisions read observed evidence
   *  and are not flagged. */
  readonly inferred: Uint8Array;
  /** Cells no frame saw well enough to read. */
  readonly unseen: Uint8Array;
  readonly readings: CellReadings;
}

/** The build-texture guard of the grass rule: the contrast above which the blob and the profile may
 *  add a cell; defaults to `SCAN_PROFILE.ground`'s. */
export interface TextureGuard {
  readonly blobTexture: number;
  readonly profileTexture: number;
}

/** Reads sea, sand and grass from the evidence; `shore` decides land near the coast. */
export function readGround(ev: CellEvidence, shore: ShoreModel = SHORE_MODEL, guard: TextureGuard = G): GroundReading {
  const R = cellReadings(ev);
  const { cols, rows, known } = R;
  const n = cols * rows;
  const mask = (f: (i: number) => boolean) => {
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = f(i) ? 1 : 0;
    return m;
  };
  const cert = mask((i) => R.grass[i]! > G.vote);
  const observed = fillHoles(largestComponent(cert, cols, rows), cols, rows);
  const fromBlob = mask((i) => R.blob[i]! > G.vote && !observed[i] && R.texture[i]! > guard.blobTexture);
  const base = fillHoles(mask((i) => !!(observed[i] || fromBlob[i])), cols, rows);
  // Unseen cells are not certainly anything; the profile treats them as hidden on its own.
  const notGrass = mask((i) => !!known[i] && !cert[i] && (
    (R.sand[i]! + R.sea[i]! > G.vote && R.sandDistance[i]! < G.sandDistance && R.texture[i]! < G.cleanTexture) || R.sea[i]! > G.waterVote));
  const profile = profileGrass(cert, notGrass, known, cols, rows);
  const fromProfile = mask((i) => !!profile[i] && !base[i] && R.texture[i]! > guard.profileTexture && !(R.sea[i]! > G.profileSea));
  const grass = fillHoles(mask((i) => !!(base[i] || fromProfile[i])), cols, rows);

  const { land, filled } = landAround(ev, grass, coastRasters(ev), shore);
  const ground = new Uint8Array(n);
  const inferred = new Uint8Array(n);
  const unseen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    ground[i] = grass[i] ? GRASS : land[i] ? SAND : SEA;
    unseen[i] = known[i] ? 0 : 1;
    inferred[i] = (grass[i] && !cert[i]) || filled[i] || (!known[i] && land[i]) ? 1 : 0;
  }
  return { cols, rows, ground, inferred, unseen, readings: R };
}

/** Each cell centre's signed distance in cells to the observed coast, positive on land. */
function centreDistances(ev: CellEvidence, coast: CoastRasters): Float32Array {
  const { cols, rows } = ev.grid;
  const d = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) d[r * cols + c] = atCell(coast.distance, ev, c, r, 0, 0, -99);
  return d;
}

/** The cells the shore model decides: within `coastBand` chessboard steps across the observed
 *  coast, as grid indices. */
export function shoreBand(ev: CellEvidence, coast: CoastRasters, centreDistance = centreDistances(ev, coast)): number[] {
  const { cols, rows } = ev.grid;
  const n = cols * rows;
  const observedLand = new Uint8Array(n);
  const observedSea = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    observedLand[i] = centreDistance[i]! > 0 ? 1 : 0;
    observedSea[i] = observedLand[i] ? 0 : 1;
  }
  const toSea = chessboardDistance(observedLand, cols, rows);
  const toLand = chessboardDistance(observedSea, cols, rows);
  const band: number[] = [];
  for (let i = 0; i < n; i++) if (toSea[i]! + toLand[i]! <= G.coastBand) band.push(i);
  return band;
}

/** Land: the grass, plus near the observed coast the cells `shore` calls land and elsewhere the
 *  cells over `inland` cells inside the observed sea's edge; 8-connected to the grass, holes filled.
 *  `filled` marks the cells only hole filling made land. */
function landAround(ev: CellEvidence, grass: Uint8Array, coast: CoastRasters, shore: ShoreModel): { land: Uint8Array; filled: Uint8Array } {
  const { cols, rows } = ev.grid;
  const n = cols * rows;
  const centreDistance = centreDistances(ev, coast);
  const band = shoreBand(ev, coast, centreDistance);
  const p = shoreLand(ev, coast, band, shore);
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = grass[i] || centreDistance[i]! > G.inland ? 1 : 0;
  band.forEach((i, k) => { land[i] = grass[i] || p[k]! > G.vote ? 1 : 0; });
  const connected = componentsTouching(land, grass, cols, rows, true);
  const whole = fillHoles(connected, cols, rows);
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) filled[i] = whole[i] && !connected[i] ? 1 : 0;
  return { land: whole, filled };
}
