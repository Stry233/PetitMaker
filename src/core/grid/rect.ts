/* Boxes, cell keys and half-grid tests on the map's lattice, in cells. */
import { GRIDS } from '../game/profile';
import type { GridId } from './grids';
import type { MacroCoord } from '../base/coords';

/** A macro-unit box [x, x+w) × [y, y+h). Origin and size may be fractional: an object's footprint
 *  sits on the half grid wherever its anchor does (a landmark, a ramp/bridge). */
export interface Rect { x: number; y: number; w: number; h: number; }

/** Whether cell (x, y) of `grid` overlaps `rect`. This one test lets a fractional-edge footprint
 *  (a landmark) and a whole-cell footprint share the same overlap logic. */
export function cellOverlapsRect(rect: Rect, x: number, y: number, grid: GridId): boolean {
  const o = GRIDS[grid].offset;
  const cl = x + o.x, ct = y + o.y;
  return cl < rect.x + rect.w && cl + 1 > rect.x && ct < rect.y + rect.h && ct + 1 > rect.y;
}

/** `v` rounded to the nearest half cell. */
export function snapHalf(v: number): number {
  return Math.round(v * 2) / 2;
}

/** Whether point (x, y) lies in `r`; the far edges are exclusive. */
export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** The bounding box of the cells `cellOf` reads off `items`, or null when there are none: the one
 *  bounding-box loop. */
export function boundsOf<T>(items: Iterable<T>, cellOf: (item: T) => { x: number; y: number }): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const item of items) {
    const c = cellOf(item);
    if (c.x < x0) x0 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.x > x1) x1 = c.x;
    if (c.y > y1) y1 = c.y;
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
}

/** The bounding box of `cells`, or null when there are none. */
export function cellsBounds(cells: readonly { x: number; y: number }[]): Rect | null {
  return boundsOf(cells, (c) => c);
}

/** A region's size and its bounding box, inclusive on all four sides. */
export interface RegionBounds {
  count: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A region's cell count and inclusive bounds, or null for an empty region: `[]` means the whole
 *  map, not a box of zero cells. */
export function regionBounds(region: readonly { x: number; y: number }[]): RegionBounds | null {
  const box = cellsBounds(region);
  return box && { count: region.length, x1: box.x, y1: box.y, x2: box.x + box.w - 1, y2: box.y + box.h - 1 };
}

/** The bounding box of flat cell indices on a grid `W` cells wide; none answers a zero rect. */
export function indexBounds(cells: readonly number[], W: number): Rect {
  return boundsOf(cells, (i) => ({ x: i % W, y: (i / W) | 0 })) ?? { x: 0, y: 0, w: 0, h: 0 };
}

/** AABB overlap of two macro rects. Touching edges (a.x + a.w === b.x) do not
 *  count as overlapping — matches the object-to-object "strict <" rule. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** `r` grown by `pad` cells on every side (a negative `pad` shrinks it). */
export function inflateRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
}

/** The overlap of two rects, fractional wherever either is; empty (a zero or negative side) when
 *  they do not overlap. */
export function rectIntersection(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function isInBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

/** Whether a coordinate names a cell or a cell boundary — the only two things a placement
 *  may sit on (the boundary is what the halfStep trait grants ramps and bridges). */
export function onHalfGrid(v: number): boolean {
  return Number.isInteger(v * 2);
}

/** The macro cell indices a (possibly half) coordinate straddles: one at a whole
 *  coordinate, the two either side of a half one. */
export function straddledCells(v: number): { lo: number; hi: number } {
  const mv = Math.round(v * 2);
  return mv % 2 === 0 ? { lo: mv / 2, hi: mv / 2 } : { lo: (mv - 1) / 2, hi: (mv + 1) / 2 };
}

/** A chunk's key: chunk coordinates keyed as `cellKey` keys a cell. */
export function chunkKey(cx: number, cy: number): string {
  return cellKey(cx, cy);
}

/** Flat (row-major) index of a cell — the canonical home for the `y*width+x` idiom. */
export const flatIndex = (x: number, y: number, width: number): number => y * width + x;

/** A W by H cell grid: its bounds test and row-major index, for code that asks both per cell. */
export interface MapGrid {
  readonly W: number;
  readonly H: number;
  inB(x: number, y: number): boolean;
  idx(x: number, y: number): number;
}

export function mapGrid(W: number, H: number): MapGrid {
  return { W, H, inB: (x, y) => x >= 0 && y >= 0 && x < W && y < H, idx: (x, y) => y * W + x };
}

/** The canonical "x,y" key of an integer pair: a cell, a chunk, or a point of any other lattice. */
export const cellKey = (x: number, y: number): string => `${x},${y}`;

/** The `cellKey` of a fractional point rounded to `1/steps` of a unit, so points that agree to that
 *  precision share a key. */
export const quantisedKey = (x: number, y: number, steps: number): string => cellKey(Math.round(x * steps), Math.round(y * steps));

/** The cell a `cellKey` names; a malformed key reads as NaN coordinates. */
export function parseCellKey(key: string): MacroCoord {
  const comma = key.indexOf(',');
  return { x: Number(key.slice(0, comma)), y: Number(key.slice(comma + 1)) };
}

/** `cells` with each cell kept once, at its first place. */
export function uniqueCells(cells: Iterable<MacroCoord>): MacroCoord[] {
  const seen = new Set<string>();
  const out: MacroCoord[] = [];
  for (const c of cells) {
    const k = cellKey(c.x, c.y);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Letterbox `srcAspect` (= width/height) inside `rect`, centered, never stretched.
 *  A picture fitted this way is never distorted. */
export function fitAspect(rect: Rect, srcAspect: number): Rect {
  const rA = rect.w / rect.h;
  if (srcAspect > rA) {
    const h = rect.w / srcAspect;
    return { x: rect.x, y: rect.y + (rect.h - h) / 2, w: rect.w, h };
  }
  const w = rect.h * srcAspect;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y, w, h: rect.h };
}
