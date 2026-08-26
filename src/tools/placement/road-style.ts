/**
 * WHAT KIND OF ROADS THIS MAP ALREADY HAS.
 *
 * A route laid blind reads as an intrusion: a winding lane across a lego town, a ruler-straight
 * street through an organic valley. Two facts are readable without asking anyone:
 *
 *  - the ROADS THEMSELVES, by measured bend density: what fraction of paved cells turn. A
 *    hand-drawn grid measures near zero, a hand-drawn ramble near one;
 *  - the ALIGNMENTS: the axis each standing street runs on, so a new route can extend or parallel
 *    one instead of cutting a fresh diagonal past it.
 *
 * A caller that reads neither — `roads.ts` calls `makeCtx(state, …)` without a naturalness — routes at
 * the organic default whatever the map underneath it is.
 */
import { ItemCategory, type GridState, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { clamp01 } from '../../core/model/math';
import { getCatalogItem } from '../../state/catalog';
import { TUNING } from './tuning';
import { forEachFootprintCell } from './object';

/** A* cost added per direction change, from the 0..1 naturalness the map reads at: 0 (rectilinear)
 *  buys the full penalty, so a route holds its line; 1 (organic) adds none and the route winds
 *  where the ground invites it. THE one mapping — nothing else derives a turn cost. */
export function turnPenaltyFor(naturalness: number): number {
  return (1 - clamp01(naturalness)) * TUNING.styleTurnPenaltyMax;
}

export interface RoadStyle {
  /** A* cost per direction change, in `astar`'s own units (`turnPenaltyFor(naturalness)`). */
  turnPenalty: number;
  /** The naturalness this was read at, 0 rectilinear .. 1 organic. */
  naturalness: number;
  /** Flat index -> the axis a standing street runs on there. A route moving ALONG that axis at or
   *  beside such a cell is discounted, so it joins the line rather than crossing it obliquely. */
  alignment: ReadonlyMap<number, 'x' | 'y'>;
  /** What to pave with: the material of the road nearest the work, so a new lane matches the street
   *  it grows out of rather than the pool's first entry. Undefined on a map with no roads. */
  materialId: string | undefined;
  /** Which branch answered. A test that cannot say this cannot tell a read from a default. */
  source: 'measured' | 'default';
}

/** A fully organic generated network measures around here (bendDensity), so `measured / BEND_ORGANIC`
 *  reads a hand-built network on the same 0..1 scale the turn penalty is derived from. Named and unit-tested
 *  rather than folded into `readRoadStyle`'s expression. */
export const BEND_ORGANIC = 0.45;

/** Fewer paved cells than this and there is no character to read: the map answers `default`. */
export const STYLE_MIN_ROADS = 12;

/** Fraction of paved cells whose two paved neighbours are not collinear: 0 = a grid, 1 = a ramble.
 *  Cells with fewer than two paved orthogonal neighbours (ends, isolated tiles) are not counted —
 *  an end-cap has no direction to keep or break. */
export function bendDensity(roadCells: ReadonlySet<number>, W: number, H: number): number {
  let bends = 0, eligible = 0;
  for (const i of roadCells) {
    const x = i % W, y = (i / W) | 0;
    const dirs: Array<[number, number]> = [];
    if (x > 0 && roadCells.has(i - 1)) dirs.push([-1, 0]);
    if (x < W - 1 && roadCells.has(i + 1)) dirs.push([1, 0]);
    if (y > 0 && roadCells.has(i - W)) dirs.push([0, -1]);
    if (y < H - 1 && roadCells.has(i + W)) dirs.push([0, 1]);
    if (dirs.length < 2) continue;
    eligible++;
    const collinear = dirs.length === 2 && dirs[0]![0] + dirs[1]![0] === 0 && dirs[0]![1] + dirs[1]![1] === 0;
    if (!collinear) bends++;
  }
  return eligible === 0 ? 0 : bends / eligible;
}

/** The axis a paved cell reads as running on: whichever of x/y holds more paved orthogonal
 *  neighbours. A tie (an intersection, an isolated tile, a dead corner) has no single axis and is
 *  left out of the map. */
function buildAlignment(roadCells: ReadonlySet<number>, W: number, H: number): ReadonlyMap<number, 'x' | 'y'> {
  const out = new Map<number, 'x' | 'y'>();
  for (const i of roadCells) {
    const x = i % W, y = (i / W) | 0;
    const xN = (x > 0 && roadCells.has(i - 1) ? 1 : 0) + (x < W - 1 && roadCells.has(i + 1) ? 1 : 0);
    const yN = (y > 0 && roadCells.has(i - W) ? 1 : 0) + (y < H - 1 && roadCells.has(i + W) ? 1 : 0);
    if (xN > yN) out.set(i, 'x');
    else if (yN > xN) out.set(i, 'y');
  }
  return out;
}

/** The catalogId of the road object nearest `near` (Manhattan; default the map origin), ties broken
 *  by lowest flat index — deterministic whatever order `state.objects` iterates in. */
function nearestMaterial(roadObjs: readonly PlacedObject[], near: MacroCoord | undefined, W: number): string | undefined {
  const p = near ?? { x: 0, y: 0 };
  let best: PlacedObject | undefined, bestDist = Infinity, bestIdx = Infinity;
  for (const o of roadObjs) {
    const dist = Math.abs(o.position.x - p.x) + Math.abs(o.position.y - p.y);
    const idx = o.position.y * W + o.position.x;
    if (dist < bestDist || (dist === bestDist && idx < bestIdx)) { best = o; bestDist = dist; bestIdx = idx; }
  }
  return best?.catalogId;
}

/** Reads the map's own road character off its paved cells, falling back to the organic default a
 *  bare map has always routed at. Walks `state.objects` once through `state/catalog` for the road
 *  category (the same read `roads.ts` makes). */
export function readRoadStyle(state: GridState, near?: MacroCoord): RoadStyle {
  const W = state.template.width, H = state.template.height;
  const roadCells = new Set<number>();
  const roadObjs: PlacedObject[] = [];
  for (const o of state.objects.values()) {
    const item = getCatalogItem(o.catalogId);
    if (item?.category !== ItemCategory.Road) continue;
    roadObjs.push(o);
    forEachFootprintCell(o, (x, y) => roadCells.add(y * W + x));
  }

  let naturalness: number, source: RoadStyle['source'];
  if (roadCells.size >= STYLE_MIN_ROADS) {
    naturalness = clamp01(bendDensity(roadCells, W, H) / BEND_ORGANIC);
    source = 'measured';
  } else {
    naturalness = 1;
    source = 'default';
  }

  return {
    turnPenalty: turnPenaltyFor(naturalness),
    naturalness,
    alignment: buildAlignment(roadCells, W, H),
    materialId: nearestMaterial(roadObjs, near, W),
    source,
  };
}
