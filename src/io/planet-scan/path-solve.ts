import { SCAN_PROFILE } from './profile';

/**
 * How the lattice pins enter the path solve. The scan pins them (`pinned`: at `pinWeight` with the
 * calibrated period); the other modes exist for the eval to compare against, and nothing else
 * selects them:
 * - `light`: pins at `LIGHT_PIN_WEIGHT`;
 * - `scaled`: each axis's period solved as an unknown, absorbing a scale mismatch between the
 *   calibrated period and the tracked ground motion, on axes with `SCALE_MIN_PINS` pins or more;
 * - `unpinned`: no pins; the lattice is fitted to the unpinned path afterwards.
 */
export type PinMode = 'pinned' | 'light' | 'scaled' | 'unpinned';
export const LIGHT_PIN_WEIGHT = 1;
export const SCALE_MIN_PINS = 8;

// The camera path as weighted least squares. Unknowns are each distinct frame's tile origin in
// scan coordinates (frame 0 at the origin). An edge from frame a to frame b with shift d states
// pos[a] - pos[b] = d, the shift that carries a's content onto b's. A lattice pin states that a
// still run saw a chunk line at tile offset `phase`, so pos + phase sits on the scan's one
// lattice: pos + phase = origin + n * period, with the integer n unwrapped against the path
// solved without pins and the lattice origin solved with the path.
//
// Path positions place each tile's origin so that every tile's chunk lines fall on one lattice;
// a point `t` tile pixels from frame k's origin sits at pos[k] + t. In `scaled` mode the tracked
// shifts are first divided by a per-axis scale, the one under which the pins' lattice has the
// calibrated period; content the shifts tracked then moves `scale` tile pixels per path pixel
// between frames. In the other modes the scale is 1.
//
// Weights multiply residuals, as rows of a weighted least-squares system do, so the normal
// equations carry their squares. The axes are solved and reweighted independently. Each round
// keeps an edge whose residual is within `outlierScale` robust scales at its prior weight and
// drops the others to `outlierWeight`, small enough to be no constraint yet keeping the path
// connected. The normal equations are solved by conjugate gradients preconditioned with their
// tridiagonal part, which the consecutive edges dominate; the solve is deterministic.

export const EDGE_CONSECUTIVE = 0;
export const EDGE_CLOSURE = 1;
/** A revisit whose verified shift lay beyond the tracking gate; kept for reporting, weight 0. */
export const EDGE_GATED = 2;

/** The shift was verified on the whole tiles or the predicted overlap. */
export const SOURCE_VERIFIED = 0;
/** The shift was found by trying recovery shifts after the whole tiles did not match. */
export const SOURCE_RECOVERED = 1;
/** No match verified; the edge repeats the previous step. */
export const SOURCE_ASSUMED = 2;

/** A growable list of path edges in typed arrays. */
export class EdgeList {
  count = 0;
  a = new Int32Array(64);
  b = new Int32Array(64);
  dx = new Float64Array(64);
  dy = new Float64Array(64);
  /** Prior weight: 1 for a matched shift, the outlier weight for an assumed one, 0 when gated. */
  weight = new Float64Array(64);
  kind = new Uint8Array(64);
  source = new Uint8Array(64);
  /** Overlap correlation of the match; NaN for an assumed edge. */
  ncc = new Float64Array(64);

  add(a: number, b: number, dx: number, dy: number, weight: number, kind: number, source = SOURCE_VERIFIED, ncc = Number.NaN): void {
    if (this.count === this.a.length) this.grow();
    const i = this.count++;
    this.a[i] = a;
    this.b[i] = b;
    this.dx[i] = dx;
    this.dy[i] = dy;
    this.weight[i] = weight;
    this.kind[i] = kind;
    this.source[i] = source;
    this.ncc[i] = ncc;
  }

  private grow(): void {
    const n = this.a.length * 2;
    const copy = <T extends Int32Array | Float64Array | Uint8Array>(src: T, make: (n: number) => T): T => {
      const out = make(n);
      out.set(src);
      return out;
    };
    this.a = copy(this.a, (k) => new Int32Array(k));
    this.b = copy(this.b, (k) => new Int32Array(k));
    this.dx = copy(this.dx, (k) => new Float64Array(k));
    this.dy = copy(this.dy, (k) => new Float64Array(k));
    this.weight = copy(this.weight, (k) => new Float64Array(k));
    this.kind = copy(this.kind, (k) => new Uint8Array(k));
    this.source = copy(this.source, (k) => new Uint8Array(k));
    this.ncc = copy(this.ncc, (k) => new Float64Array(k));
  }
}

/** Lattice pins on one axis: still run `frame[i]` saw a line at tile offset `phase[i]`. */
export interface AxisPins {
  readonly frame: Int32Array;
  readonly phase: Float64Array;
}

/** Solve tuning; each value defaults to, and is documented in, `SCAN_PROFILE.tracking.solve`. */
export interface PathSolveOptions {
  readonly iterations?: number;
  readonly outlierScale?: number;
  readonly minScale?: number;
  readonly outlierWeight?: number;
  readonly pinWeight?: number;
  readonly pinReject?: number;
  /** The eval's comparison modes; the scan leaves it at `pinned`. */
  readonly pins?: PinMode;
  readonly scaleInlier?: number;
  readonly pinFirstReject?: number;
  /** The calibrated lattice period per axis in rectified pixels; defaults to the chunk size. */
  readonly period?: { readonly x: number; readonly y: number };
}

/** The lattice the pins of one axis agree on. */
export interface PinFit {
  /** Lines sit at `origin + n * period` in scan coordinates; origin in [0, period). */
  readonly origin: number;
  /** The calibrated period. */
  readonly period: number;
  /** The tracked shifts were divided by this to put the pins' lattice at the calibrated period;
   *  1 unless `scaled`. */
  readonly scale: number;
  /** `scaled` fitted the scale; false in the other modes, and when the axis had under
   *  `SCALE_MIN_PINS` pins or an unusable slope, which leaves the scale at 1. */
  readonly scaleFitted: boolean;
  readonly pins: number;
  /** Pins within `pinReject` of the final lattice; every pin in `unpinned` mode. */
  readonly accepted: number;
  /** On the path solved from the tracked shifts without pins: the RMS distance of the pins from
   *  one lattice of the calibrated period, and the slope of that distance along the scan
   *  (residual pixels per scan pixel); a slope is a scale mismatch between the period and the
   *  tracked motion. */
  readonly rmsBefore: number;
  readonly slope: number;
  /** RMS residual of the accepted pins on the final path; equal to `rmsBefore` when unpinned. */
  readonly rmsAfter: number;
}

export interface PathSolution {
  readonly mode: PinMode;
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Final weight of each edge per axis. */
  readonly weightX: Float64Array;
  readonly weightY: Float64Array;
  /** Edges rejected on either axis, and the consecutive ones among them. */
  readonly rejected: number;
  readonly rejectedConsecutive: number;
  /** Assumed edges that no matched path spans: where the camera moved too fast to follow and no
   *  revisit tells where it went. Edge indices. */
  readonly unbridged: Int32Array;
  /** Revisits dropped by the tracking gate. Edge indices. */
  readonly gated: Int32Array;
  /** Per frame, its part of the path over matched edges, numbered from 0 in frame order. Frames
   *  in different parts are placed relative to each other only by assumed edges. */
  readonly matchedPart: Int32Array;
  /** Median edge residual on the final path, in scan pixels. */
  readonly edgeResidual: number;
  readonly lattice: { readonly x: PinFit | null; readonly y: PinFit | null };
}

const SOLVE = SCAN_PROFILE.tracking.solve;
/** Normal-equation weight holding the lattice origin at its unwrap estimate when every pin is
 *  rejected; negligible otherwise. */
const LATTICE_PRIOR = 1e-6;

/** Pins of one axis prepared for the solve: pos[frame] - origin = target. */
interface Pinned {
  readonly pins: AxisPins;
  readonly target: Float64Array;
  readonly weight: Float64Array;
  readonly origin: number;
  readonly rmsBefore: number;
  readonly slope: number;
}

/** One axis's normal equations: frame unknowns, then the lattice origin when pinned. */
class AxisSystem {
  readonly unknowns: number;
  readonly rhs: Float64Array;
  private readonly upper: Float64Array;
  /** Thomas factors of the tridiagonal preconditioner over the frames. */
  private readonly cPrime: Float64Array;
  private readonly denom: Float64Array;
  private readonly originDiag: number;

  constructor(
    private readonly frames: number,
    private readonly edges: EdgeList,
    shift: Float64Array,
    private readonly w: Float64Array,
    private readonly pinned: Pinned | null,
  ) {
    const n = (this.unknowns = frames + (pinned ? 1 : 0));
    const diag = new Float64Array(n);
    const upper = (this.upper = new Float64Array(n));
    const rhs = (this.rhs = new Float64Array(n));
    // Frame 0 is the origin.
    diag[0]! += 1;
    for (let e = 0; e < edges.count; e++) {
      const we = w[e]! * w[e]!;
      if (we === 0) continue;
      const a = edges.a[e]!;
      const b = edges.b[e]!;
      diag[a]! += we;
      diag[b]! += we;
      if (Math.abs(a - b) === 1) upper[Math.min(a, b)]! -= we;
      rhs[a]! += we * shift[e]!;
      rhs[b]! -= we * shift[e]!;
    }
    if (pinned) {
      const o = frames;
      diag[o]! += LATTICE_PRIOR;
      rhs[o]! += LATTICE_PRIOR * pinned.origin;
      const { pins, target, weight } = pinned;
      for (let p = 0; p < pins.frame.length; p++) {
        const wp = weight[p]! * weight[p]!;
        if (wp === 0) continue;
        const k = pins.frame[p]!;
        diag[k]! += wp;
        diag[o]! += wp;
        rhs[k]! += wp * target[p]!;
        rhs[o]! -= wp * target[p]!;
      }
    }
    this.originDiag = pinned ? diag[frames]! : 1;
    this.cPrime = new Float64Array(frames);
    this.denom = new Float64Array(frames);
    let c = 0;
    for (let i = 0; i < frames; i++) {
      // A tiny diagonal lift keeps the preconditioner definite where the chain is broken.
      const d = diag[i]! * (1 + 1e-12) + 1e-12 - (i > 0 ? upper[i - 1]! * c : 0);
      this.denom[i] = d;
      c = this.cPrime[i] = upper[i]! / d;
    }
  }

  private multiply(v: Float64Array, out: Float64Array): void {
    const { edges, w, frames, pinned } = this;
    out.fill(0);
    out[0]! += v[0]!;
    for (let e = 0; e < edges.count; e++) {
      const we = w[e]! * w[e]!;
      if (we === 0) continue;
      const a = edges.a[e]!;
      const b = edges.b[e]!;
      const t = we * (v[a]! - v[b]!);
      out[a]! += t;
      out[b]! -= t;
    }
    if (pinned) {
      const o = frames;
      out[o]! += LATTICE_PRIOR * v[o]!;
      const { pins, weight } = pinned;
      for (let p = 0; p < pins.frame.length; p++) {
        const wp = weight[p]! * weight[p]!;
        if (wp === 0) continue;
        const k = pins.frame[p]!;
        const t = wp * (v[k]! - v[o]!);
        out[k]! += t;
        out[o]! -= t;
      }
    }
  }

  private precondition(r: Float64Array, out: Float64Array): void {
    const { frames, upper, cPrime, denom } = this;
    let prev = 0;
    for (let i = 0; i < frames; i++) prev = out[i] = (r[i]! - (i > 0 ? upper[i - 1]! * prev : 0)) / denom[i]!;
    for (let i = frames - 2; i >= 0; i--) out[i]! -= cPrime[i]! * out[i + 1]!;
    if (this.unknowns > frames) out[frames] = r[frames]! / this.originDiag;
  }

  /** Preconditioned conjugate gradients from `x`, in place, to a relative residual of 1e-12. */
  solve(x: Float64Array): void {
    const n = this.unknowns;
    const r = new Float64Array(n);
    const z = new Float64Array(n);
    const p = new Float64Array(n);
    const q = new Float64Array(n);
    this.multiply(x, q);
    let bNorm = 0;
    for (let i = 0; i < n; i++) {
      r[i] = this.rhs[i]! - q[i]!;
      bNorm += this.rhs[i]! ** 2;
    }
    const tol = 1e-24 * Math.max(bNorm, 1);
    this.precondition(r, z);
    p.set(z);
    let rz = 0;
    for (let i = 0; i < n; i++) rz += r[i]! * z[i]!;
    for (let iter = 0; iter < 10 * n + 50; iter++) {
      let rr = 0;
      for (let i = 0; i < n; i++) rr += r[i]! * r[i]!;
      if (rr <= tol) break;
      this.multiply(p, q);
      let pq = 0;
      for (let i = 0; i < n; i++) pq += p[i]! * q[i]!;
      if (!(pq > 0)) break;
      const alpha = rz / pq;
      for (let i = 0; i < n; i++) {
        x[i]! += alpha * p[i]!;
        r[i]! -= alpha * q[i]!;
      }
      this.precondition(r, z);
      let rzNext = 0;
      for (let i = 0; i < n; i++) rzNext += r[i]! * z[i]!;
      const beta = rzNext / rz;
      rz = rzNext;
      for (let i = 0; i < n; i++) p[i] = z[i]! + beta * p[i]!;
    }
  }
}

/** Root frame of each frame's part over the matched edges; assumed and gated edges do not join. */
function matchedParts(frames: number, edges: EdgeList): Int32Array {
  const parent = new Int32Array(frames);
  for (let i = 0; i < frames; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  for (let e = 0; e < edges.count; e++) {
    if (edges.weight[e]! <= 0 || edges.source[e] === SOURCE_ASSUMED || edges.kind[e] === EDGE_GATED) continue;
    const ra = find(edges.a[e]!);
    const rb = find(edges.b[e]!);
    if (ra !== rb) parent[ra] = rb;
  }
  for (let i = 0; i < frames; i++) parent[i] = find(i);
  return parent;
}

/** Renumbers part roots 0, 1, ... in order of each part's first frame. */
function numberParts(roots: Int32Array): Int32Array {
  const ids = new Map<number, number>();
  return roots.map((r) => {
    let id = ids.get(r);
    if (id === undefined) ids.set(r, (id = ids.size));
    return id;
  });
}

function medianOf(values: Float64Array): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const m = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

/** Least-squares line `r = a + slope * l` through the samples `use` keeps. */
function fitLine(l: Float64Array, r: Float64Array, use: (i: number) => boolean): { a: number; slope: number } {
  let n = 0;
  let sl = 0;
  let sr = 0;
  let sll = 0;
  let slr = 0;
  for (let i = 0; i < l.length; i++) {
    if (!use(i)) continue;
    n++;
    sl += l[i]!;
    sr += r[i]!;
    sll += l[i]! * l[i]!;
    slr += l[i]! * r[i]!;
  }
  const den = n * sll - sl * sl;
  if (n < 2 || den === 0) return { a: n ? sr / n : 0, slope: 0 };
  const slope = (n * slr - sl * sr) / den;
  return { a: (sr - slope * sl) / n, slope };
}

/**
 * Solves the camera path of `frames` distinct frames from `edges` and optional lattice pins: a
 * robust solve without pins, then, unless the mode is `unpinned`, a robust solve with them whose
 * first round takes the pins within `pinFirstReject` of a period of the line through their
 * residuals on the unpinned path; later rounds take the pins within `pinReject` pixels. Throws when
 * the edges, assumed ones included, leave the frames in more than one part.
 */
export function solvePath(
  frames: number,
  edges: EdgeList,
  pins: { readonly x?: AxisPins; readonly y?: AxisPins } = {},
  options: PathSolveOptions = {},
): PathSolution {
  const mode = options.pins ?? 'pinned';
  const iterations = options.iterations ?? SOLVE.iterations;
  const outlierScale = options.outlierScale ?? SOLVE.outlierScale;
  const minScale = options.minScale ?? SOLVE.minScale;
  const outlierWeight = options.outlierWeight ?? SOLVE.outlierWeight;
  const pinWeight = mode === 'light' ? LIGHT_PIN_WEIGHT : (options.pinWeight ?? SOLVE.pinWeight);
  const pinReject = options.pinReject ?? SOLVE.pinReject;
  const scaleInlier = options.scaleInlier ?? SOLVE.scaleInlier;
  const pinFirstReject = options.pinFirstReject ?? SOLVE.pinFirstReject;
  const period = options.period ?? { x: SCAN_PROFILE.chunk.width, y: SCAN_PROFILE.chunk.height };
  if (frames < 1) throw new Error('the path needs a frame');
  for (let e = 0; e < edges.count; e++) {
    const a = edges.a[e]!;
    const b = edges.b[e]!;
    if (a < 0 || b < 0 || a >= frames || b >= frames || a === b) throw new Error(`edge ${e} joins frames ${a} and ${b}`);
  }

  const m = edges.count;
  const isGated = (e: number) => edges.kind[e] === EDGE_GATED;
  const parts = matchedParts(frames, edges);
  const unbridged: number[] = [];
  const gated: number[] = [];
  {
    // Join the matched parts through the assumed edges to check the whole graph.
    const joined = Int32Array.from({ length: frames }, (_, i) => i);
    const find = (i: number): number => {
      while (joined[i] !== i) i = joined[i] = joined[joined[i]!]!;
      return i;
    };
    for (let e = 0; e < m; e++) {
      if (isGated(e)) {
        gated.push(e);
        continue;
      }
      if (edges.source[e] !== SOURCE_ASSUMED || edges.weight[e]! <= 0) continue;
      const pa = parts[edges.a[e]!]!;
      const pb = parts[edges.b[e]!]!;
      if (pa !== pb) unbridged.push(e);
      const ra = find(pa);
      const rb = find(pb);
      if (ra !== rb) joined[ra] = rb;
    }
    const roots = new Set<number>();
    for (let i = 0; i < frames; i++) roots.add(find(parts[i]!));
    if (roots.size > 1) throw new Error(`the path graph has ${roots.size} disconnected parts`);
  }

  const prior = edges.weight.subarray(0, m);
  const tracked = { x: edges.dx.subarray(0, m), y: edges.dy.subarray(0, m) };
  // Shifts in scan pixels: the tracked shifts divided by the axis's scale.
  const shift = { x: tracked.x.slice(), y: tracked.y.slice() };
  const scale = { x: 1, y: 1 };
  const fitted = { x: false, y: false };
  const weight = { x: new Float64Array(m), y: new Float64Array(m) };
  // Each axis's unknowns: the frames, then the lattice origin.
  const sol = { x: new Float64Array(frames + 1), y: new Float64Array(frames + 1) };
  const solved: number[] = [];
  for (let e = 0; e < m; e++) if (!isGated(e)) solved.push(e);
  const residual = new Float64Array(solved.length);

  const reweight = (axis: 'x' | 'y'): void => {
    const pos = sol[axis];
    const d = shift[axis];
    solved.forEach((e, i) => (residual[i] = Math.abs(pos[edges.a[e]!]! - pos[edges.b[e]!]! - d[e]!)));
    const s = Math.max(minScale, 1.4826 * medianOf(residual));
    const w = weight[axis];
    solved.forEach((e, i) => (w[e] = residual[i]! < outlierScale * s ? prior[e]! : Math.min(prior[e]!, outlierWeight)));
  };
  const pinResidual = (axis: 'x' | 'y', p: Pinned, i: number): number => {
    const pos = sol[axis];
    return pos[p.pins.frame[i]!]! - pos[frames]! - p.target[i]!;
  };
  const repin = (axis: 'x' | 'y', p: Pinned | null): void => {
    if (!p) return;
    for (let i = 0; i < p.weight.length; i++) p.weight[i] = Math.abs(pinResidual(axis, p, i)) < pinReject ? pinWeight : 0;
  };
  const robust = (pinned: { x: Pinned | null; y: Pinned | null }): void => {
    weight.x.set(prior);
    weight.y.set(prior);
    for (let round = 0; round < iterations; round++) {
      for (const axis of ['x', 'y'] as const) {
        const p = pinned[axis];
        const system = new AxisSystem(frames, edges, shift[axis], weight[axis], p);
        system.solve(sol[axis].subarray(0, system.unknowns));
        if (round + 1 < iterations) {
          reweight(axis);
          repin(axis, p);
        }
      }
    }
  };

  /** The pins of one axis unwrapped against the current path with the calibrated period. */
  const prepare = (axisPins: AxisPins | undefined, axis: 'x' | 'y'): Pinned | null => {
    if (!axisPins || axisPins.frame.length === 0) return null;
    const P = period[axis];
    const pos = sol[axis];
    const count = axisPins.frame.length;
    const line = new Float64Array(count);
    let c = 0;
    let s = 0;
    for (let i = 0; i < count; i++) {
      const k = axisPins.frame[i]!;
      if (k < 0 || k >= frames) throw new Error(`pin ${i} names frame ${k}`);
      line[i] = pos[k]! + axisPins.phase[i]!;
      c += Math.cos((2 * Math.PI * line[i]!) / P);
      s += Math.sin((2 * Math.PI * line[i]!) / P);
    }
    const origin = (Math.atan2(s, c) / (2 * Math.PI)) * P;
    const wrapped = new Float64Array(count);
    const target = new Float64Array(count);
    let sq = 0;
    for (let i = 0; i < count; i++) {
      const turns = Math.round((line[i]! - origin) / P);
      wrapped[i] = line[i]! - origin - turns * P;
      target[i] = turns * P - axisPins.phase[i]!;
      sq += wrapped[i]! ** 2;
    }
    const first = fitLine(line, wrapped, () => true);
    const fit = fitLine(line, wrapped, (i) => Math.abs(wrapped[i]! - first.a - first.slope * line[i]!) < scaleInlier);
    pos[frames] = origin;
    // The first pinned round takes only the pins near the line through the residuals: a pin read
    // off an alias of the lines sits up to half a period away, and at full weight in that round it
    // bends the path far enough to drop the true edges around it.
    const weight = new Float64Array(count);
    for (let i = 0; i < count; i++) weight[i] = Math.abs(wrapped[i]! - fit.a - fit.slope * line[i]!) < pinFirstReject * P ? pinWeight : 0;
    return { pins: axisPins, target, weight, origin, rmsBefore: Math.sqrt(sq / count), slope: fit.slope };
  };

  robust({ x: null, y: null });
  const before = { x: prepare(pins.x, 'x'), y: prepare(pins.y, 'y') };
  if (mode === 'scaled') {
    // Pins whose distance from the lattice grows by `slope` per path pixel see the lines, P tile
    // pixels apart within every tile, recur every P / (1 - slope) pixels of tracked motion. The
    // tracked shifts are divided by that scale so the path places every tile's lines on one
    // lattice of period P, and the path solved again; a second pass settles the slope. An axis
    // with too few pins or a slope of 1 or more keeps scale 1.
    for (const axis of ['x', 'y'] as const) fitted[axis] = (pins[axis]?.frame.length ?? 0) >= SCALE_MIN_PINS;
    for (let pass = 0; pass < 2; pass++) {
      for (const axis of ['x', 'y'] as const) {
        const p = pass === 0 ? before[axis] : prepare(pins[axis], axis);
        if (!p || !fitted[axis]) continue;
        if (!(1 - p.slope > 0)) {
          fitted[axis] = false;
          scale[axis] = 1;
        } else scale[axis] /= 1 - p.slope;
        const t = tracked[axis];
        const d = shift[axis];
        for (let e = 0; e < m; e++) d[e] = t[e]! / scale[axis];
      }
      robust({ x: null, y: null });
    }
  }
  const pinned = mode === 'scaled' ? { x: prepare(pins.x, 'x'), y: prepare(pins.y, 'y') } : before;
  if (mode !== 'unpinned' && (pinned.x || pinned.y)) robust(pinned);

  const report = (axis: 'x' | 'y'): PinFit | null => {
    const p = pinned[axis];
    const b = before[axis];
    if (!p || !b) return null;
    const P = period[axis];
    if (mode === 'unpinned') {
      return {
        origin: ((p.origin % P) + P) % P, period: P, scale: 1, scaleFitted: false, pins: p.weight.length, accepted: p.weight.length,
        rmsBefore: b.rmsBefore, slope: b.slope, rmsAfter: b.rmsBefore,
      };
    }
    let sq = 0;
    let accepted = 0;
    for (let i = 0; i < p.weight.length; i++) {
      if (p.weight[i] === 0) continue;
      accepted++;
      sq += pinResidual(axis, p, i) ** 2;
    }
    const at = sol[axis][frames]!;
    return {
      origin: ((at % P) + P) % P, period: P, scale: scale[axis], scaleFitted: fitted[axis], pins: p.weight.length, accepted,
      rmsBefore: b.rmsBefore, slope: b.slope, rmsAfter: accepted ? Math.sqrt(sq / accepted) : 0,
    };
  };

  const x = sol.x.slice(0, frames);
  const y = sol.y.slice(0, frames);
  let rejected = 0;
  let rejectedConsecutive = 0;
  solved.forEach((e, i) => {
    const a = edges.a[e]!;
    const b = edges.b[e]!;
    residual[i] = Math.hypot(x[a]! - x[b]! - shift.x[e]!, y[a]! - y[b]! - shift.y[e]!);
    if (weight.x[e]! < prior[e]! || weight.y[e]! < prior[e]!) {
      rejected++;
      if (edges.kind[e] === EDGE_CONSECUTIVE) rejectedConsecutive++;
    }
  });
  return {
    mode,
    x,
    y,
    weightX: weight.x,
    weightY: weight.y,
    rejected,
    rejectedConsecutive,
    unbridged: Int32Array.from(unbridged),
    gated: Int32Array.from(gated),
    matchedPart: numberParts(parts),
    edgeResidual: medianOf(residual),
    lattice: { x: report('x'), y: report('y') },
  };
}
