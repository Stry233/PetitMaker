/**
 * Pure cell-set geometry for the overlay's ghost and flash rendering. A large
 * drag-shape preview holds tens of thousands of cells, and drawing one Pixi
 * rect per cell — per pointer move for the ghost, per FRAME for a flash —
 * stalls the main thread. Merging each row's consecutive cells into spans
 * collapses a filled W×H shape to ~H rects, and the outline derives from
 * numeric row sets instead of string keys.
 */
import type { Corners } from '../../../core/model/types';
import type { RoadConnSide } from '../../../core/edge-cut/road-cut-states';
import { roadShapePoints } from '../../../core/edge-cut/road-shape';
import type { ErrorFlashCell } from './error-flash';

/** A horizontal run of cells: covers [x, x+w) × [y, y+1). */
export interface RowSpan { x: number; y: number; w: number }

/** A RowSpan pinned to one grid ('micro' = terrain, −HALF_TILE). */
export interface CellSpan extends RowSpan { micro: boolean }

/** Merge cells into row spans (per grid). Input order is free; duplicates collapse. */
export function mergeCellSpans(cells: readonly ErrorFlashCell[]): CellSpan[] {
  // rows keyed by (micro, y) → sorted unique x list
  const rows = new Map<string, { y: number; micro: boolean; xs: number[] }>();
  for (const c of cells) {
    const key = `${c.micro ? 1 : 0}:${c.y}`;
    const row = rows.get(key);
    if (row) row.xs.push(c.x);
    else rows.set(key, { y: c.y, micro: c.micro, xs: [c.x] });
  }
  const spans: CellSpan[] = [];
  for (const { y, micro, xs } of rows.values()) {
    xs.sort((a, b) => a - b);
    let start = xs[0]!, prev = xs[0]!;
    for (let i = 1; i < xs.length; i++) {
      const x = xs[i]!;
      if (x === prev || x === prev + 1) { prev = Math.max(prev, x); continue; }
      spans.push({ x: start, y, w: prev - start + 1, micro });
      start = prev = x;
    }
    spans.push({ x: start, y, w: prev - start + 1, micro });
  }
  return spans;
}

/** An edge segment in cell units (multiply by tile size to draw). */
export interface EdgeSegment { ax: number; ay: number; bx: number; by: number }

/**
 * The outer boundary of a cell set: every cell edge whose neighbour lies
 * outside the set. All cells are treated as one grid (the ghost draws a single
 * surface); horizontal runs merge into single segments.
 */
export function boundaryEdges(cells: readonly { x: number; y: number }[]): EdgeSegment[] {
  const rows = new Map<number, Set<number>>();
  for (const { x, y } of cells) {
    const row = rows.get(y);
    if (row) row.add(x); else rows.set(y, new Set([x]));
  }
  const has = (x: number, y: number): boolean => rows.get(y)?.has(x) ?? false;
  const edges: EdgeSegment[] = [];
  // Horizontal edges (top/bottom), merged along x per row.
  for (const [y, row] of rows) {
    const xs = [...row].sort((a, b) => a - b);
    for (const side of [-1, 1] as const) {
      const ey = side === -1 ? y : y + 1;
      let runStart: number | null = null, prev = 0;
      for (const x of xs) {
        const exposed = !has(x, y + side);
        if (exposed && runStart !== null && x === prev + 1) { prev = x; continue; }
        if (runStart !== null) edges.push({ ax: runStart, ay: ey, bx: prev + 1, by: ey });
        runStart = exposed ? x : null;
        prev = x;
      }
      if (runStart !== null) edges.push({ ax: runStart, ay: ey, bx: prev + 1, by: ey });
    }
  }
  // Vertical edges (left/right), one per exposed cell side merged along y.
  const cols = new Map<number, Set<number>>();
  for (const { x, y } of cells) {
    const col = cols.get(x);
    if (col) col.add(y); else cols.set(x, new Set([y]));
  }
  for (const [x, col] of cols) {
    const ys = [...col].sort((a, b) => a - b);
    for (const side of [-1, 1] as const) {
      const ex = side === -1 ? x : x + 1;
      let runStart: number | null = null, prev = 0;
      for (const y of ys) {
        const exposed = !has(x + side, y);
        if (exposed && runStart !== null && y === prev + 1) { prev = y; continue; }
        if (runStart !== null) edges.push({ ax: ex, ay: runStart, bx: ex, by: prev + 1 });
        runStart = exposed ? y : null;
        prev = y;
      }
      if (runStart !== null) edges.push({ ax: ex, ay: runStart, bx: ex, by: prev + 1 });
    }
  }
  return edges;
}

interface Interval { x: number; e: number }

/** a minus b over intervals; both sorted, non-overlapping. */
function subtractIntervals(a: readonly Interval[], b: readonly Interval[] | undefined): Interval[] {
  if (!b || b.length === 0) return [...a];
  const out: Interval[] = [];
  for (const iv of a) {
    let x = iv.x;
    for (const cut of b) {
      if (cut.e <= x) continue;
      if (cut.x >= iv.e) break;
      if (cut.x > x) out.push({ x, e: cut.x });
      x = Math.max(x, cut.e);
      if (x >= iv.e) break;
    }
    if (x < iv.e) out.push({ x, e: iv.e });
  }
  return out;
}

/**
 * Boundary of a span set WITHOUT expanding to cells — O(spans), so a map-size
 * shape preview costs its row count, not its area. Requires per-row MERGED
 * spans (no two spans in one row touch or overlap), which every producer here
 * guarantees. Same edge coverage as boundaryEdges over the expanded cells.
 */
export function boundaryEdgesFromSpans(spans: readonly RowSpan[]): EdgeSegment[] {
  const rows = new Map<number, Interval[]>();
  for (const s of spans) {
    const list = rows.get(s.y);
    const iv = { x: s.x, e: s.x + s.w };
    if (list) list.push(iv); else rows.set(s.y, [iv]);
  }
  for (const list of rows.values()) list.sort((a, b) => a.x - b.x);

  const edges: EdgeSegment[] = [];
  // Horizontal edges: what this row covers that the row above/below does not.
  for (const [y, list] of rows) {
    for (const iv of subtractIntervals(list, rows.get(y - 1))) edges.push({ ax: iv.x, ay: y, bx: iv.e, by: y });
    for (const iv of subtractIntervals(list, rows.get(y + 1))) edges.push({ ax: iv.x, ay: y + 1, bx: iv.e, by: y + 1 });
  }
  // Vertical edges: every span end is exposed (merged rows have gaps between
  // spans); contiguous ends at the same x merge into one segment.
  const ends = new Map<number, number[]>(); // x → row ys with an edge at this x
  const noteEnd = (x: number, y: number): void => {
    const ys = ends.get(x);
    if (ys) ys.push(y); else ends.set(x, [y]);
  };
  for (const s of spans) { noteEnd(s.x, s.y); noteEnd(s.x + s.w, s.y); }
  for (const [x, ys] of ends) {
    ys.sort((a, b) => a - b);
    let start = ys[0]!, prev = ys[0]!;
    for (let i = 1; i < ys.length; i++) {
      const y = ys[i]!;
      if (y === prev + 1) { prev = y; continue; }
      edges.push({ ax: x, ay: start, bx: x, by: prev + 1 });
      start = prev = y;
    }
    edges.push({ ax: x, ay: start, bx: x, by: prev + 1 });
  }
  return edges;
}

/**
 * The outline of a ghost whose shape auto-trim will change — the silhouette of the trimmed cells,
 * not the square footprint.
 *
 * Worked out at QUADRANT resolution, because that is where the trim lives: a cell is four half-tile
 * quadrants, and a corner state says which of them survive and in what shape. That makes every case
 * one case. `square` keeps its whole quadrant; a `tri-*` keeps the two sides it is named for and
 * cuts across; a `fan` keeps the same two sides and curves between them. A Γ patch is the same
 * machinery seen from the other side: only one of its quadrants exists at all, anchored AT the
 * corner it fills rather than away from it, so its curve bulges into the notch.
 *
 * A quadrant side is drawn when the quadrant across it does not also fill it — the boundary of the
 * union, with no seams through the middle. Corners are indexed [TL, TR, BL, BR].
 */
export interface TrimmedGhostCell { x: number; y: number; corners: readonly string[]; patch: boolean }

/** Quadrant sides, and the unit step to the quadrant across each. */
const SIDES = ['N', 'E', 'S', 'W'] as const;
type Side = typeof SIDES[number];
const ACROSS: Record<Side, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPPOSITE: Record<Side, Side> = { N: 'S', E: 'W', S: 'N', W: 'E' };
/** The two sides a `tri-*` keeps, straight from its name. */
const TRI_SIDES: Record<string, [Side, Side]> = {
  'tri-NW': ['N', 'W'], 'tri-NE': ['N', 'E'], 'tri-SW': ['S', 'W'], 'tri-SE': ['S', 'E'],
};
/** A cut corner keeps the two sides AWAY from it; a patch keeps the two AT it. */
const AWAY: [Side, Side][] = [['S', 'E'], ['S', 'W'], ['N', 'E'], ['N', 'W']];
const AT: [Side, Side][] = [['N', 'W'], ['N', 'E'], ['S', 'W'], ['S', 'E']];

/** The two endpoints of a quadrant side, in half-cell units within the quadrant. */
function sideEnds(side: Side): [[number, number], [number, number]] {
  switch (side) {
    case 'N': return [[0, 0], [1, 0]];
    case 'E': return [[1, 0], [1, 1]];
    case 'S': return [[0, 1], [1, 1]];
    case 'W': return [[0, 0], [0, 1]];
  }
}

/** Where two sides of one quadrant meet, in the same units (they always share exactly one end). */
function meetingPoint(a: Side, b: Side): [number, number] {
  const [a0, a1] = sideEnds(a), [b0, b1] = sideEnds(b);
  for (const p of [a0, a1]) for (const q of [b0, b1]) if (p[0] === q[0] && p[1] === q[1]) return p;
  return [0, 0];
}

/** The far end of `side` from the point the two sides share. */
function farEnd(side: Side, shared: [number, number]): [number, number] {
  const [p, q] = sideEnds(side);
  return p[0] === shared[0] && p[1] === shared[1] ? q : p;
}

export function trimmedOutline(
  cells: readonly { x: number; y: number }[],
  trims: readonly TrimmedGhostCell[],
  /** Membership test for the whole shape. A span-form ghost only materialises its rim, so the
   *  quadrants facing its interior have to be recognised as filled some other way. */
  inShape: (x: number, y: number) => boolean = () => false,
): EdgeSegment[] {
  const H = 0.5;
  const shape = new Map<string, TrimmedGhostCell>();
  for (const t of trims) shape.set(`${t.x},${t.y}`, t);
  const listed = new Set(cells.map((c) => `${c.x},${c.y}`));
  /** Which sides of the quadrant at (cell corner) are solid; empty means the quadrant is not there. */
  const sidesOf = (x: number, y: number, i: number): Side[] | null => {
    const t = shape.get(`${x},${y}`);
    if (!t) return listed.has(`${x},${y}`) || inShape(x, y) ? [...SIDES] : null;
    const state = t.corners[i];
    if (!state || state === 'empty') return null;
    if (state === 'square') return [...SIDES];
    const tri = TRI_SIDES[state];
    if (tri) return [...tri];
    return [...(t.patch ? AT[i]! : AWAY[i]!)];       // 'fan'
  };
  // Quadrant grid: (2x + col, 2y + row) — the half-cell lattice both the cells and the cuts sit on.
  const present = new Map<string, Side[]>();
  const seen = new Set<string>();
  for (const c of [...cells, ...trims] as { x: number; y: number }[]) {
    const k = `${c.x},${c.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    for (let i = 0; i < 4; i++) {
      const sides = sidesOf(c.x, c.y, i);
      if (sides) present.set(`${2 * c.x + (i % 2)},${2 * c.y + (i < 2 ? 0 : 1)}`, sides);
    }
  }

  const out: EdgeSegment[] = [];
  for (const [k, sides] of present) {
    const [qx, qy] = k.split(',').map(Number) as [number, number];
    const ox = qx * H, oy = qy * H;                  // the quadrant's top-left, in cell units
    const pt = (p: [number, number]) => ({ x: ox + p[0] * H, y: oy + p[1] * H });
    for (const side of sides) {
      const [dx, dy] = ACROSS[side];
      const nqx = qx + dx, nqy = qy + dy;
      const neighbour = present.get(`${nqx},${nqy}`)
        ?? sidesOf(Math.floor(nqx / 2), Math.floor(nqy / 2), (((nqy % 2) + 2) % 2) * 2 + (((nqx % 2) + 2) % 2));
      if (neighbour?.includes(OPPOSITE[side])) continue;   // interior: both quadrants fill it
      const [a, b] = sideEnds(side).map(pt) as [{ x: number; y: number }, { x: number; y: number }];
      out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
    if (sides.length !== 2) continue;                // a whole quadrant: no cut to draw
    const shared = meetingPoint(sides[0]!, sides[1]!);
    const a = pt(farEnd(sides[0]!, shared)), b = pt(farEnd(sides[1]!, shared));
    const t = shape.get(`${Math.floor(qx / 2)},${Math.floor(qy / 2)}`);
    const state = t?.corners[(qy % 2) * 2 + (qx % 2)];
    if (state !== 'fan') { out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y }); continue; }
    // The curve is the quarter circle about the point the two kept sides meet.
    const c = pt(shared);
    let sweep = Math.atan2(b.y - c.y, b.x - c.x) - Math.atan2(a.y - c.y, a.x - c.x);
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    const a0 = Math.atan2(a.y - c.y, a.x - c.x);
    const steps = 6;
    let prev = a;
    for (let s = 1; s <= steps; s++) {
      const ang = a0 + (sweep * s) / steps;
      const p = { x: c.x + Math.cos(ang) * H, y: c.y + Math.sin(ang) * H };
      out.push({ ax: prev.x, ay: prev.y, bx: p.x, by: p.y });
      prev = p;
    }
  }
  return out;
}

/** One road tile of a ghost whose shape auto-trim will cut, in the frame it is DRAWN in: canonical
 *  corners plus the side it connects on (see `core/edge-cut/road-shape`). */
export interface RoadTrimmedGhostCell { x: number; y: number; corners: Corners; road: RoadConnSide }

const ON_EDGE = 1e-9;

/**
 * The outline of a ROAD ghost some of whose tiles auto-trim will cut.
 *
 * Roads are not quadrant geometry — a cut road's corner tokens are canonical-state markers, and its
 * silhouette is the polygon `drawRoadShape` fills. So this walks polygons rather than quadrants,
 * and the only thing it has to know is which of their edges are seams rather than silhouette.
 *
 * That question has one answer for every state: a cut road ALWAYS keeps its connected edges whole
 * (`validateCut` refuses any state that does not), so a polygon edge lying on a full cell side with
 * a paved neighbour across it is interior, and everything else is outline. The square tiles are the
 * ordinary case — an edge whose neighbour is outside the ghost — with a trimmed neighbour counting
 * as inside for exactly the same reason.
 */
export function roadTrimmedOutline(
  cells: readonly { x: number; y: number }[],
  trims: readonly RoadTrimmedGhostCell[],
  inShape: (x: number, y: number) => boolean = () => false,
): EdgeSegment[] {
  const trimAt = new Map(trims.map((t) => [`${t.x},${t.y}`, t] as const));
  const listed = new Set(cells.map((c) => `${c.x},${c.y}`));
  const filled = (x: number, y: number): boolean =>
    trimAt.has(`${x},${y}`) || listed.has(`${x},${y}`) || inShape(x, y);
  const out: EdgeSegment[] = [];
  /** The four cell sides as [neighbour step, segment]. */
  const sides = (x: number, y: number): [number, number, EdgeSegment][] => [
    [0, -1, { ax: x, ay: y, bx: x + 1, by: y }],
    [0, 1, { ax: x, ay: y + 1, bx: x + 1, by: y + 1 }],
    [-1, 0, { ax: x, ay: y, bx: x, by: y + 1 }],
    [1, 0, { ax: x + 1, ay: y, bx: x + 1, by: y + 1 }],
  ];

  const squareCell = (x: number, y: number): void => {
    for (const [dx, dy, seg] of sides(x, y)) if (!filled(x + dx, y + dy)) out.push(seg);
  };
  for (const c of cells) if (!trimAt.has(`${c.x},${c.y}`)) squareCell(c.x, c.y);

  for (const t of trims) {
    const pts = roadShapePoints(t.corners, t.road, t.x, t.y, 1, 1);
    if (!pts) { squareCell(t.x, t.y); continue; }
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % pts.length]!;
      // A kept edge is a WHOLE cell side, so this test is exact for every state that has one.
      const at = (v: number, edge: number) => Math.abs(v - edge) < ON_EDGE;
      let dx = 0, dy = 0;
      if (at(ax, bx)) { if (at(ax, t.x)) dx = -1; else if (at(ax, t.x + 1)) dx = 1; }
      if (at(ay, by)) { if (at(ay, t.y)) dy = -1; else if (at(ay, t.y + 1)) dy = 1; }
      if ((dx !== 0 || dy !== 0) && filled(t.x + dx, t.y + dy)) continue;
      out.push({ ax, ay, bx, by });
    }
  }
  return out;
}

/** The spans minus these cells: a trimmed cell is drawn as its own shape, so the flat run under it
 *  has to give way or the cut corner stays filled in. */
export function spansWithout(
  spans: readonly RowSpan[],
  cells: readonly { x: number; y: number }[],
): RowSpan[] {
  if (cells.length === 0) return [...spans];
  const holes = new Map<number, Set<number>>();
  for (const c of cells) {
    const row = holes.get(c.y);
    if (row) row.add(c.x); else holes.set(c.y, new Set([c.x]));
  }
  const out: RowSpan[] = [];
  for (const s of spans) {
    const row = holes.get(s.y);
    if (!row) { out.push(s); continue; }
    let start = s.x;
    for (let x = s.x; x < s.x + s.w; x++) {
      if (!row.has(x)) continue;
      if (x > start) out.push({ x: start, y: s.y, w: x - start });
      start = x + 1;
    }
    if (start < s.x + s.w) out.push({ x: start, y: s.y, w: s.x + s.w - start });
  }
  return out;
}

/**
 * A Γ patch drawn as the shape it ADDS, and nothing else.
 *
 * A patch is a fillet at its own tier sitting on the block below: the terrain layer draws it in two
 * passes, the square quadrants in the LOWER tier's colour and only the cut one at the cell's own.
 * So a preview that draws all four quadrants hangs a square box off every step of the shape, which
 * the map does not have.
 */
export function filletOnly(corners: readonly string[], patch: boolean): readonly string[] {
  return patch ? corners.map((c) => (c === 'square' ? 'empty' : c)) : corners;
}

/** What a flashed cell should be drawn as. */
export interface FlashShape { x: number; y: number; corners: CornerList; patchOnly: boolean; micro: boolean }
type CornerList = readonly string[];

/**
 * Split the cells of a flash into the ones whose real shape has to be drawn and the ones a plain
 * rect covers.
 *
 * The flash lands right after the trim pass, so the map already holds the shape it is announcing —
 * flat squares would advertise a result the stroke did not leave. Only a terrain flash asks: an
 * object footprint is on the macro grid and has no corners of its own.
 */
export function splitFlashShapes(
  cells: readonly ErrorFlashCell[],
  shapeAt: (x: number, y: number) => { corners?: CornerList; patchOnly?: boolean } | null,
): { shaped: FlashShape[]; plain: ErrorFlashCell[] } {
  const shaped: FlashShape[] = [];
  const plain: ErrorFlashCell[] = [];
  for (const c of cells) {
    const shape = c.micro ? shapeAt(c.x, c.y) : null;
    const cut = shape?.corners?.some((k) => k !== 'square') || shape?.patchOnly;
    if (shape?.corners && cut) {
      shaped.push({
        x: c.x, y: c.y, micro: c.micro, patchOnly: !!shape.patchOnly,
        corners: filletOnly(shape.corners, !!shape.patchOnly),
      });
    } else {
      plain.push(c);
    }
  }
  return { shaped, plain };
}
