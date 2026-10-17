/**
 * The one fit a dragged route takes, while it is drawn and when it is let go.
 *
 * Pointer samples are decimated to `samplePx` css px apart, so the hand's jitter between them
 * never reaches the fit. The kept samples simplify (Ramer-Douglas-Peucker) at `tolerancePx` into
 * the anchors the route's spline runs through; a real corner deviates far past the tolerance and
 * keeps its anchor, and an anchor where the path turns by more than `cornerDeg` is drawn as a
 * corner (zero handles) so the spline meets it straight rather than swinging past it. Both lengths
 * are screen px, read through the cell's on-screen size captured at
 * the press, so one gesture draws the same line at every zoom.
 *
 * Anchors land on the half-cell lattice, so a route's anchors move in half-cell steps; an anchor
 * that rounds onto the one before it is dropped.
 *
 * The fit is incremental: once the simplified tail holds more than `heldAnchors` anchors, all but
 * the last few are committed and never refitted, so a long drag costs only its tail and the line
 * behind the pointer stays still. The live frame and the released route are both `routeFitAnchors`
 * of the same state, so letting go changes nothing.
 */
import type { MacroCoord } from '../types';
import type { CurveAnchor } from '../../base/spline';
import { snapHalf } from '../../grid/rect';

const ROUTE_FIT = {
  /** The least pointer travel, in css px, that adds a sample. */
  samplePx: 8,
  /** The largest deviation, in css px, a dropped sample may have from the fitted path. */
  tolerancePx: 8,
  /** The turn, in degrees, from which an anchor is a corner rather than a bend. */
  cornerDeg: 60,
  /** Anchors at the moving end that stay open to refitting; the rest are committed. */
  heldAnchors: 3,
  /** The cell size a fit assumes where no view reports one (headless callers, Help figures). */
  referenceCellPx: 16,
} as const;

export interface RouteFit {
  /** Css px of one cell at the press; the fit's lengths read through it. */
  readonly cellPixels: number;
  /** Kept samples, in cells. */
  readonly samples: MacroCoord[];
  /** Anchors that no later sample can move; the last one is `samples[tailStart]`. */
  readonly committed: MacroCoord[];
  tailStart: number;
}

const copy = (p: MacroCoord): MacroCoord => ({ x: p.x, y: p.y });

/** The indices Ramer-Douglas-Peucker keeps of `points` at `tolerance`, first and last included. */
function simplifyIndices(points: readonly MacroCoord[], tolerance: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a]!;
    const pb = points[b]!;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let farDist = tolerance;
    for (let i = a + 1; i < b; i++) {
      const p = points[i]!;
      const d = len === 0
        ? Math.hypot(p.x - pa.x, p.y - pa.y)
        : Math.abs(dx * (pa.y - p.y) - (pa.x - p.x) * dy) / len;
      if (d > farDist) { farDist = d; far = i; }
    }
    if (far < 0) continue;
    keep[far] = true;
    stack.push([a, far], [far, b]);
  }
  const out: number[] = [];
  keep.forEach((k, i) => { if (k) out.push(i); });
  return out;
}

/** A fit opened at the press point. */
export function startRouteFit(p: MacroCoord, cellPixels: number = ROUTE_FIT.referenceCellPx): RouteFit {
  const cell = cellPixels > 0 ? cellPixels : ROUTE_FIT.referenceCellPx;
  return { cellPixels: cell, samples: [copy(p)], committed: [copy(p)], tailStart: 0 };
}

/** The tail's anchor indices into `samples`. */
function tailIndices(fit: RouteFit): number[] {
  const tail = fit.samples.slice(fit.tailStart);
  return simplifyIndices(tail, ROUTE_FIT.tolerancePx / fit.cellPixels).map((i) => i + fit.tailStart);
}

/** Feed one pointer sample. Returns whether it was kept, which is when the fit can change. */
export function extendRouteFit(fit: RouteFit, p: MacroCoord): boolean {
  const last = fit.samples[fit.samples.length - 1]!;
  if (Math.hypot(p.x - last.x, p.y - last.y) * fit.cellPixels < ROUTE_FIT.samplePx) return false;
  fit.samples.push(copy(p));
  const tail = tailIndices(fit);
  if (tail.length > ROUTE_FIT.heldAnchors + 1) {
    const settled = tail.slice(1, tail.length - ROUTE_FIT.heldAnchors);
    for (const i of settled) fit.committed.push(copy(fit.samples[i]!));
    fit.tailStart = settled[settled.length - 1]!;
  }
  return true;
}

/** The route's anchors as the fit stands: what the live frame draws and what release keeps. */
export function routeFitAnchors(fit: RouteFit): CurveAnchor[] {
  const tail = tailIndices(fit).slice(1).map((i) => fit.samples[i]!);
  return withCorners(onHalfLattice([...fit.committed, ...tail]));
}

/** `points` rounded to the half-cell lattice, each that rounds onto the one before it dropped. */
function onHalfLattice(points: readonly MacroCoord[]): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (const p of points) {
    const q = { x: snapHalf(p.x), y: snapHalf(p.y) };
    const last = out[out.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) out.push(q);
  }
  return out;
}

/** Interior anchors that turn by `cornerDeg` or more take zero handles on both sides. */
function withCorners(points: readonly MacroCoord[]): CurveAnchor[] {
  const limit = (ROUTE_FIT.cornerDeg * Math.PI) / 180;
  return points.map((p, i) => {
    const a = points[i - 1], c = points[i + 1];
    if (!a || !c) return { x: p.x, y: p.y };
    let turn = Math.abs(Math.atan2(c.y - p.y, c.x - p.x) - Math.atan2(p.y - a.y, p.x - a.x));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    return turn >= limit ? { x: p.x, y: p.y, hx: 0, hy: 0, ihx: 0, ihy: 0 } : { x: p.x, y: p.y };
  });
}

/** A whole sampled path through the same fit, as a drag over it would draw it. */
export function fitRoutePath(points: readonly MacroCoord[], cellPixels: number = ROUTE_FIT.referenceCellPx): CurveAnchor[] {
  if (points.length === 0) return [];
  const fit = startRouteFit(points[0]!, cellPixels);
  for (const p of points.slice(1)) extendRouteFit(fit, p);
  return routeFitAnchors(fit);
}
