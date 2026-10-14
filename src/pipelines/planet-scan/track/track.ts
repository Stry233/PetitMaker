import { EDGE_CLOSURE, EDGE_CONSECUTIVE, EDGE_GATED, EdgeList, SOURCE_ASSUMED, SOURCE_RECOVERED, SOURCE_VERIFIED } from './path-solve';
import { type HighPassScratch, PhaseCorrelator, highPass, highPassScratch } from './phase-correlate';
import { SCAN_PROFILE } from '../profile';
import type { GreyImage, ShiftEstimate } from '../types';

// Camera tracking over distinct frames. Each frame's tile is high-passed and matched against the
// previous frame (consecutive edges), and kept as signed bytes so that revisits can be matched
// once the whole path is predicted (closure edges). Tiles may be sampled every `step` rectified
// pixels; every shift and position reported here is in rectified pixels, positions being the
// scan coordinates of the tile's origin.
//
// Phase correlation is reliable while two tiles overlap by about 0.4 of the tile on each axis.
// A revisit is therefore matched on the predicted overlap alone: both tiles are cropped to it at
// the predicted shift, so the correlation only has to find the small residual.

const T = SCAN_PROFILE.tracking;
/** Above any frame count a recording yields. */
const PAIR_KEY = 1 << 24;

/** Box-filters a tile to half size on both axes, the resolution tracking runs at. */
export function halveTile(tile: GreyImage, out?: Float32Array): GreyImage {
  const width = tile.width >> 1;
  const height = tile.height >> 1;
  const dst = out ?? new Float32Array(width * height);
  const src = tile.data;
  const w = tile.width;
  for (let y = 0; y < height; y++) {
    const r0 = 2 * y * w;
    const r1 = r0 + w;
    for (let x = 0; x < width; x++) {
      const c = 2 * x;
      dst[y * width + x] = 0.25 * (src[r0 + c]! + src[r0 + c + 1]! + src[r1 + c]! + src[r1 + c + 1]!);
    }
  }
  return { width, height, data: dst };
}

/** High-passed tiles of every distinct frame as signed bytes, `scale` steps per grey level. */
export class TileStore {
  private readonly tiles: Int8Array[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly scale: number = T.storeScale,
  ) {}

  get size(): number {
    return this.tiles.length;
  }

  /** Bytes held. */
  get bytes(): number {
    return this.tiles.length * this.width * this.height;
  }

  add(tile: GreyImage): void {
    const packed = new Int8Array(this.width * this.height);
    const { data } = tile;
    const s = this.scale;
    for (let i = 0; i < packed.length; i++) {
      const v = Math.round(data[i]! * s);
      packed[i] = v > 127 ? 127 : v < -127 ? -127 : v;
    }
    this.tiles.push(packed);
  }

  /** Copies the `width` by `height` window at (x0, y0) of tile `index`, in grey levels. */
  crop(index: number, rect: { x0: number; y0: number; width: number; height: number }, out: Float32Array): GreyImage {
    const { x0, y0, width, height } = rect;
    const t = this.tiles[index];
    if (!t) throw new Error(`no stored tile ${index}`);
    const inv = 1 / this.scale;
    for (let y = 0; y < height; y++) {
      const src = (y0 + y) * this.width + x0;
      const dst = y * width;
      for (let x = 0; x < width; x++) out[dst + x] = t[src + x]! * inv;
    }
    return { width, height, data: out };
  }
}

function floorPowerOfTwo(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/** Correlators and crop buffers for power-of-two crops, created on first use. */
export class CropMatcher {
  private readonly pool = new Map<string, { correlator: PhaseCorrelator; a: Float32Array; b: Float32Array }>();

  constructor(private readonly store: TileStore) {}

  /**
   * The verified shift of tile `b` against tile `a` near the integer prediction (px, py), in tile
   * pixels: both are cropped to the largest power-of-two window centred in their predicted
   * overlap. Null when the overlap is below the minimum crop or the match does not correlate
   * above `minNcc`.
   */
  match(a: number, b: number, px: number, py: number, minNcc: number): ShiftEstimate | null {
    const { width: w, height: h } = this.store;
    const ox0 = Math.max(0, px);
    const ox1 = Math.min(w, w + px);
    const oy0 = Math.max(0, py);
    const oy1 = Math.min(h, h + py);
    const cw = floorPowerOfTwo(ox1 - ox0);
    const ch = floorPowerOfTwo(oy1 - oy0);
    if (ox1 - ox0 < T.closures.minCropWidth || oy1 - oy0 < T.closures.minCropHeight) return null;
    const key = `${cw}x${ch}`;
    let slot = this.pool.get(key);
    if (!slot) {
      const correlator = new PhaseCorrelator(cw, ch, { minNcc: Math.min(T.consecutiveMinNcc, T.correlation.minNcc) });
      slot = { correlator, a: new Float32Array(cw * ch), b: new Float32Array(cw * ch) };
      this.pool.set(key, slot);
    }
    const bx = (ox0 + ox1 - cw) >> 1;
    const by = (oy0 + oy1 - ch) >> 1;
    const ia = this.store.crop(a, { x0: bx - px, y0: by - py, width: cw, height: ch }, slot.a);
    const ib = this.store.crop(b, { x0: bx, y0: by, width: cw, height: ch }, slot.b);
    const est = slot.correlator.estimate(ia, ib);
    return est && est.ncc > minNcc ? { ...est, dx: est.dx + px, dy: est.dy + py } : null;
  }
}

/** What one `Tracker.addClosures` pass did. */
export interface ClosureStats {
  readonly tried: number;
  readonly added: number;
  readonly gated: number;
  /** The most gated matches agreeing on one offset from the predicted path that none agrees on
   *  the opposite of (`agreeingOffsets`). */
  readonly agreeing: number;
  /** Agreeing gated matches say the predicted path is wrong. */
  readonly failed: boolean;
}

/**
 * The most offsets within `agreement` pixels of one of them, counting none for an offset that
 * also appears opposite (within `agreement` of its negation). A wrong predicted path moves its
 * revisits one way; aliases of periodic ground verify on either side of the true shift. On
 * re-encoded reference recordings, whose compression flattens the unique detail, the sea's
 * texture verified at offsets of 127 to 129 pixels on both sides, three on one side and one on
 * the other.
 */
export function agreeingOffsets(offsets: readonly (readonly [number, number])[], agreement: number): number {
  let best = 0;
  for (const [ox, oy] of offsets) {
    let same = 0;
    let mirrored = 0;
    for (const [px, py] of offsets) {
      if (Math.hypot(px - ox, py - oy) <= agreement) same++;
      if (Math.hypot(px + ox, py + oy) <= agreement) mirrored++;
    }
    if (mirrored === 0) best = Math.max(best, same);
  }
  return best;
}

/** A frame's high-passed tile and its direct match against the last pushed frame, made by
 *  `Tracker.probe` and valid for `Tracker.push` until another frame is pushed. */
export interface TrackProbe {
  readonly hp: Float32Array;
  /** The shift in tile pixels, as a consecutive edge has it; null when the match did not verify. */
  readonly direct: ShiftEstimate | null;
  /** Frames pushed when the probe was made. */
  readonly after: number;
}

/** Tracking tuning. */
export interface TrackerOptions {
  /** Rectified pixels per tile pixel. */
  readonly step?: number;
}

/**
 * Streams the distinct frames' grey tiles and records one consecutive edge per frame after the
 * first. A pair that does not verify on the whole tiles, usually a hitch that jumped the camera
 * by half a view, is retried on the overlap predicted by the last step and by each recovery
 * shift; the best match is kept when it beats every match at a different shift by
 * `recoveryMargin`, or, when no other shift matched, verifies above `minNcc`. Otherwise the edge assumes the last step at the outlier weight and the step
 * counts as lost, for closures to correct.
 */
export class Tracker {
  readonly store: TileStore;
  readonly edges = new EdgeList();
  readonly step: number;
  private readonly correlator: PhaseCorrelator;
  private readonly matcher: CropMatcher;
  private readonly scratch: HighPassScratch;
  private readonly sigma: number;
  private previous: Float32Array<ArrayBuffer>;
  private current: Float32Array<ArrayBuffer>;
  private lastStep = { dx: 0, dy: 0 };
  private lastVerified = false;
  /** Revisit pairs, keyed `a * PAIR_KEY + b`, that produced a closure edge. */
  private readonly matched = new Set<number>();
  /** Revisit pairs whose last match was gated, to the index of their gated edge. */
  private readonly gatedAt = new Map<number, number>();
  private lostSteps = 0;
  private chainX = 0;
  private chainY = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    options: TrackerOptions = {},
  ) {
    this.step = options.step ?? 1;
    this.sigma = T.highPassSigma / this.step;
    this.store = new TileStore(width, height);
    this.correlator = new PhaseCorrelator(width, height, { minNcc: T.consecutiveMinNcc });
    this.matcher = new CropMatcher(this.store);
    this.scratch = highPassScratch(width, height);
    this.previous = new Float32Array(width * height);
    this.current = new Float32Array(width * height);
  }

  get frames(): number {
    return this.store.size;
  }

  /** The last pushed frame's position on the chain path, in rectified pixels; frame 0 at the origin. */
  get position(): { x: number; y: number } {
    return { x: this.chainX, y: this.chainY };
  }

  /** The last pushed frame's verified shift from the frame before it, in rectified pixels (the
   *  edge's convention: the previous frame's position minus this frame's); null for the first
   *  frame and for a step no match verified. */
  get lastMotion(): { dx: number; dy: number } | null {
    return this.lastVerified ? { dx: this.lastStep.dx * this.step, dy: this.lastStep.dy * this.step } : null;
  }

  /** Steps no match verified, whose edges are assumed. */
  get lost(): number {
    return this.lostSteps;
  }

  /**
   * High-passes `tile` into `out` and matches it directly against the last pushed frame, keeping
   * nothing: the frame's shift from that frame at the cost of one correlation, which `push` reuses.
   */
  probe(tile: GreyImage, out: Float32Array<ArrayBuffer>): TrackProbe {
    this.checkSize(tile);
    const hp = highPass(tile, this.sigma, out, this.scratch);
    const after = this.store.size;
    const direct = after > 0 ? this.correlator.estimate({ width: this.width, height: this.height, data: this.previous }, hp) : null;
    return { hp: hp.data, direct, after };
  }

  /** Adds the next distinct frame's grey tile, reusing its `probe` when given. */
  push(tile: GreyImage, probe?: TrackProbe): void {
    this.checkSize(tile);
    if (probe && probe.after !== this.store.size) throw new Error('the probe predates the last pushed frame');
    if (probe) this.current.set(probe.hp);
    const hp = probe ? { width: this.width, height: this.height, data: this.current } : highPass(tile, this.sigma, this.current, this.scratch);
    this.store.add(hp);
    const k = this.store.size - 1;
    if (k > 0) {
      const prev = { width: this.width, height: this.height, data: this.previous };
      const direct = probe ? probe.direct : this.correlator.estimate(prev, hp);
      const est = direct ?? this.recover(k);
      const s = this.step;
      const step = est ?? this.lastStep;
      this.chainX -= step.dx * s;
      this.chainY -= step.dy * s;
      this.lastVerified = est !== null;
      if (est) {
        this.lastStep = { dx: est.dx, dy: est.dy };
        const source = direct ? SOURCE_VERIFIED : SOURCE_RECOVERED;
        this.edges.add(k - 1, k, { dx: est.dx * s, dy: est.dy * s, weight: 1, kind: EDGE_CONSECUTIVE, source, ncc: est.ncc });
      } else {
        this.lostSteps++;
        this.edges.add(k - 1, k, {
          dx: this.lastStep.dx * s, dy: this.lastStep.dy * s, weight: T.solve.outlierWeight, kind: EDGE_CONSECUTIVE, source: SOURCE_ASSUMED,
        });
      }
    }
    [this.previous, this.current] = [this.current, this.previous];
  }

  private checkSize(tile: GreyImage): void {
    if (tile.width !== this.width || tile.height !== this.height) {
      throw new Error(`tracking expects ${this.width}x${this.height} tiles`);
    }
  }

  private recover(k: number): ShiftEstimate | null {
    const guesses: [number, number][] = [[this.lastStep.dx, this.lastStep.dy]];
    const shares = [0, ...T.recovery.flatMap((f) => [f, -f])];
    for (const fx of shares) for (const fy of shares) if (fx !== 0 || fy !== 0) guesses.push([fx * this.width, fy * this.height]);
    const found: ShiftEstimate[] = [];
    for (const [gx, gy] of guesses) {
      const est = this.matcher.match(k - 1, k, Math.round(gx), Math.round(gy), T.consecutiveMinNcc);
      if (est) found.push(est);
    }
    if (found.length === 0) return null;
    const best = found.reduce((p, q) => (q.ncc > p.ncc ? q : p));
    // Guesses that found the same shift agree; a different shift that correlates nearly as well
    // is an alias, and the step stays unknown.
    // With no rival to beat, the match must verify like a revisit.
    const near = T.correlation.suppressRadius;
    let rival = -Infinity;
    for (const e of found) if (Math.hypot(e.dx - best.dx, e.dy - best.dy) > near) rival = Math.max(rival, e.ncc);
    if (rival === -Infinity) return best.ncc > T.correlation.minNcc ? best : null;
    return best.ncc - rival >= T.recoveryMargin ? best : null;
  }

  /** The path integrated along the consecutive edges, frame 0 at the origin. */
  chainPath(): { x: Float64Array; y: Float64Array } {
    const n = this.frames;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const { edges } = this;
    for (let e = 0; e < edges.count; e++) {
      if (edges.kind[e] !== EDGE_CONSECUTIVE) continue;
      const b = edges.b[e]!;
      x[b] = x[edges.a[e]!]! - edges.dx[e]!;
      y[b] = y[edges.a[e]!]! - edges.dy[e]!;
    }
    return { x, y };
  }

  /**
   * Matches revisits predicted by `path` (the chain path unless given) and adds the verified ones
   * as closure edges. Every `stride`-th frame tries the later frames, at least `minGap` on, whose
   * predicted footprint overlaps its own most, from `minOverlap` of the tile area. A match farther
   * than `gate` rectified pixels from the prediction is kept as a gated edge with no weight: alone
   * it is a periodic alias, but `agreeingFailure` gated matches whose offsets from the prediction
   * agree within `agreement` pixels, with none on the opposite offset (`agreeingOffsets`), say
   * the predicted path is wrong (`failed`). A second pass on
   * the solved path skips the pairs that already produced a closure and retries the rest; a
   * gated pair keeps one edge, which becomes its closure when it verifies.
   */
  addClosures(path = this.chainPath()): ClosureStats {
    const C = T.closures;
    const s = this.step;
    const tw = this.width * s;
    const th = this.height * s;
    const n = this.frames;
    let tried = 0;
    let added = 0;
    let gated = 0;
    const offsets: [number, number][] = [];
    const overlap = new Float64Array(n);
    const { edges } = this;
    for (let e = 0; e < edges.count; e++) if (edges.kind[e] === EDGE_CLOSURE) this.matched.add(edges.a[e]! * PAIR_KEY + edges.b[e]!);
    for (let a = 0; a < n; a += C.stride) {
      const order: number[] = [];
      for (let b = a + C.minGap; b < n; b++) {
        const ex = Math.max(0, tw - Math.abs(path.x[a]! - path.x[b]!));
        const ey = Math.max(0, th - Math.abs(path.y[a]! - path.y[b]!));
        overlap[b] = (ex * ey) / (tw * th);
        if (overlap[b]! >= C.minOverlap) order.push(b);
      }
      order.sort((p, q) => overlap[q]! - overlap[p]! || p - q);
      for (const b of order.slice(0, C.candidates)) {
        const key = a * PAIR_KEY + b;
        if (this.matched.has(key)) continue;
        const predX = path.x[a]! - path.x[b]!;
        const predY = path.y[a]! - path.y[b]!;
        tried++;
        const est = this.matcher.match(a, b, Math.round(predX / s), Math.round(predY / s), T.correlation.minNcc);
        if (!est) continue;
        const dx = est.dx * s;
        const dy = est.dy * s;
        if (Math.hypot(dx - predX, dy - predY) > C.gate) {
          gated++;
          offsets.push([dx - predX, dy - predY]);
          const at = this.gatedAt.get(key);
          if (at === undefined) {
            this.gatedAt.set(key, edges.count);
            edges.add(a, b, { dx, dy, weight: 0, kind: EDGE_GATED, source: SOURCE_VERIFIED, ncc: est.ncc });
          } else {
            edges.dx[at] = dx;
            edges.dy[at] = dy;
            edges.ncc[at] = est.ncc;
          }
          continue;
        }
        const at = this.gatedAt.get(key);
        if (at === undefined) {
          edges.add(a, b, { dx, dy, weight: 1, kind: EDGE_CLOSURE, source: SOURCE_VERIFIED, ncc: est.ncc });
        } else {
          // The pair gated under an earlier path verifies here: its gated edge becomes the closure.
          this.gatedAt.delete(key);
          edges.dx[at] = dx;
          edges.dy[at] = dy;
          edges.ncc[at] = est.ncc;
          edges.weight[at] = 1;
          edges.kind[at] = EDGE_CLOSURE;
        }
        this.matched.add(key);
        added++;
      }
    }
    const agreeing = agreeingOffsets(offsets, C.agreement);
    return { tried, added, gated, agreeing, failed: agreeing >= C.agreeingFailure };
  }
}
