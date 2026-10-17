/**
 * Pure ghost and flash outlines over trimmed cells: the silhouette auto-trim will leave, road tiles
 * in their cut state, and which flashed cells need their real shape. Row spans come from
 * `core/grid/cell-spans.ts`.
 */
import type { Corners, MacroCoord } from '../../../core/model/types';
import type { RoadConnSide } from '../../../core/domain/edge-cut/road-cut-states';
import { roadShapePoints } from '../road/shape';
import { cellGrid, type GridCellRef, type GridId } from '../../../core/grid/grids';
import type { EdgeSegment } from '../../../core/grid/cell-spans';
import { TERRAIN_GRID } from '../../../core/game/profile';
import type { Side } from '../../../core/grid/directions';
import { SIDES, SIDE_DELTA, OPPOSITE_SIDE } from '../../../core/grid/directions';
import { cellKey } from '../../../core/grid/rect';

/**
 * The outline of a ghost whose shape auto-trim will change: the silhouette of the trimmed cells,
 * worked out per half-tile quadrant, where the trim lives. `square` keeps its whole quadrant; a
 * `tri-*` keeps its two named sides and cuts across; a `fan` keeps them and curves between. A Γ
 * patch has a single quadrant anchored at the corner it fills, so its curve bulges into the notch.
 * A quadrant side is drawn when the quadrant across does not also fill it. Corners are
 * [TL, TR, BL, BR].
 */
export interface TrimmedGhostCell { x: number; y: number; corners: readonly string[]; patch: boolean }

/** A plain-tint ghost's wash and loss wash alpha in each view; a preview card brings its own. The
 *  views keep their own tuned values. */
export const GHOST_WASH_ALPHA = { map2d: 0.32, map3d: 0.4 } as const;

/** The strength a note ghost draws at in both views: the note as it would land, lighter. */
export const NOTE_GHOST_ALPHA = 0.55;

/** The two sides a `tri-*` keeps, straight from its name. */
const TRI_SIDES: Record<string, [Side, Side]> = {
  'tri-NW': ['N', 'W'], 'tri-NE': ['N', 'E'], 'tri-SW': ['S', 'W'], 'tri-SE': ['S', 'E'],
};
/** A cut corner keeps the two sides `AWAY` from it; a patch keeps the two `AT` it. */
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
  for (const t of trims) shape.set(cellKey(t.x, t.y), t);
  const listed = new Set(cells.map((c) => cellKey(c.x, c.y)));
  /** Which sides of the quadrant at (cell corner) are solid; empty means the quadrant is not there. */
  const sidesOf = (x: number, y: number, i: number): Side[] | null => {
    const t = shape.get(cellKey(x, y));
    if (!t) return listed.has(cellKey(x, y)) || inShape(x, y) ? [...SIDES] : null;
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
    const k = cellKey(c.x, c.y);
    if (seen.has(k)) continue;
    seen.add(k);
    for (let i = 0; i < 4; i++) {
      const sides = sidesOf(c.x, c.y, i);
      if (sides) present.set(cellKey(2 * c.x + (i % 2), 2 * c.y + (i < 2 ? 0 : 1)), sides);
    }
  }

  const out: EdgeSegment[] = [];
  for (const [k, sides] of present) {
    const [qx, qy] = k.split(',').map(Number) as [number, number];
    const ox = qx * H, oy = qy * H;                  // the quadrant's top-left, in cell units
    const pt = (p: [number, number]) => ({ x: ox + p[0] * H, y: oy + p[1] * H });
    for (const side of sides) {
      const [dx, dy] = SIDE_DELTA[side];
      const nqx = qx + dx, nqy = qy + dy;
      const neighbour = present.get(cellKey(nqx, nqy))
        ?? sidesOf(Math.floor(nqx / 2), Math.floor(nqy / 2), (((nqy % 2) + 2) % 2) * 2 + (((nqx % 2) + 2) % 2));
      if (neighbour?.includes(OPPOSITE_SIDE[side])) continue;   // interior: both quadrants fill it
      const [a, b] = sideEnds(side).map(pt) as [{ x: number; y: number }, { x: number; y: number }];
      out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
    if (sides.length !== 2) continue;                // a whole quadrant: no cut to draw
    const shared = meetingPoint(sides[0]!, sides[1]!);
    const a = pt(farEnd(sides[0]!, shared)), b = pt(farEnd(sides[1]!, shared));
    const t = shape.get(cellKey(Math.floor(qx / 2), Math.floor(qy / 2)));
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

/** One road tile of a ghost whose shape auto-trim will cut, in the frame it is drawn in: canonical
 *  corners plus the side it connects on (see `view/shared/road/shape`). */
export interface RoadTrimmedGhostCell { x: number; y: number; corners: Corners; road: RoadConnSide }

const ON_EDGE = 1e-9;

/**
 * The outline of a road ghost some of whose tiles auto-trim will cut. A cut road's silhouette is
 * the polygon `drawRoadShape` fills, so this walks polygons. A cut road always keeps its connected
 * edges whole (`validateCut` refuses otherwise), so a polygon edge on a full cell side with a paved
 * neighbour across it is interior and everything else is outline; a trimmed neighbour counts as
 * inside.
 */
export function roadTrimmedOutline(
  cells: readonly { x: number; y: number }[],
  trims: readonly RoadTrimmedGhostCell[],
  inShape: (x: number, y: number) => boolean = () => false,
): EdgeSegment[] {
  const trimAt = new Map(trims.map((t) => [cellKey(t.x, t.y), t] as const));
  const listed = new Set(cells.map((c) => cellKey(c.x, c.y)));
  const filled = (x: number, y: number): boolean =>
    trimAt.has(cellKey(x, y)) || listed.has(cellKey(x, y)) || inShape(x, y);
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
  for (const c of cells) if (!trimAt.has(cellKey(c.x, c.y))) squareCell(c.x, c.y);

  for (const t of trims) {
    const pts = roadShapePoints(t.corners, t.road, { x: t.x, y: t.y, w: 1, h: 1 });
    if (!pts) { squareCell(t.x, t.y); continue; }
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % pts.length]!;
      // A kept edge is a whole cell side, so this test is exact for every state that has one.
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


/**
 * A Γ patch drawn as the shape it adds, and nothing else.
 *
 * A patch is a fillet at its own tier sitting on the block below: the terrain layer draws it in two
 * passes, the square quadrants in the lower tier's colour and only the cut one at the cell's own.
 * So a preview that draws all four quadrants hangs a square box off every step of the shape, which
 * the map does not have.
 */
export function filletOnly(corners: readonly string[], patch: boolean): readonly string[] {
  return patch ? corners.map((c) => (c === 'square' ? 'empty' : c)) : corners;
}

/** A trimmed cell as a ghost receives it: its corners, whether it is a Γ patch, and a road tile's
 *  connection sides. */
interface GhostTrim { corners: readonly string[]; patch: boolean; road?: unknown }

/**
 * What a ghost on `grid` draws, the one plan both views follow: the cells on its own grid (which
 * carry the trim and the card), the cells naming another grid (drawn beside it as plain
 * footprints), and each trimmed cell in the shape the stroke adds.
 *
 * Only a terrain cell is reduced through `filletOnly`. A road tile's corners are canonical-state
 * tokens, not quadrants, and turning its `square` markers into `empty` would leave a state the road
 * painter does not recognise, so a road trim keeps its corners as they are.
 */
export function ghostPlan<C extends MacroCoord | GridCellRef, T extends GhostTrim>(
  cells: readonly C[], grid: GridId, trims: readonly T[] = [],
): { own: C[]; across: C[]; trim: T[] } {
  const own: C[] = [];
  const across: C[] = [];
  for (const c of cells) (cellGrid(c, grid) === grid ? own : across).push(c);
  const trim = trims.map((t): T => (t.road ? t : { ...t, corners: filletOnly(t.corners, t.patch) as T['corners'] }));
  return { own, across, trim };
}

/** What a flashed cell should be drawn as. */
export interface FlashShape { x: number; y: number; corners: CornerList; patchOnly: boolean; grid: GridId }
type CornerList = readonly string[];

/**
 * Split the cells of a flash into the ones whose real shape has to be drawn and the ones a plain
 * rect covers.
 *
 * The flash lands right after the trim pass, so the map already holds the shape it is announcing —
 * flat squares would advertise a result the stroke did not leave. Only a terrain cell asks: an
 * object footprint lies on the placement grid and has no corners of its own.
 */
export function splitFlashShapes(
  cells: readonly GridCellRef[],
  shapeAt: (x: number, y: number) => { corners?: CornerList; patchOnly?: boolean } | null,
): { shaped: FlashShape[]; plain: GridCellRef[] } {
  const shaped: FlashShape[] = [];
  const plain: GridCellRef[] = [];
  for (const c of cells) {
    const shape = c.grid === TERRAIN_GRID ? shapeAt(c.x, c.y) : null;
    const cut = shape?.corners?.some((k) => k !== 'square') || shape?.patchOnly;
    if (shape?.corners && cut) {
      shaped.push({
        x: c.x, y: c.y, grid: c.grid, patchOnly: !!shape.patchOnly,
        corners: filletOnly(shape.corners, !!shape.patchOnly),
      });
    } else {
      plain.push(c);
    }
  }
  return { shaped, plain };
}
