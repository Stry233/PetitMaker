import type ClipperLib from 'clipper-lib';
import type { RoadMaterialSpec, RoadMaterialFinish } from '../../../config/catalog/road-material';
import type { RoadRegion } from './region';
import type { RoadPt } from './shape';
import { loadClipper } from './clipper-loader';
import { roadEdgeJointCuts, roadEdgeJointReach } from './edge-joints';
import { roadFeatherOutline } from './feather';
import { FNV_BASIS, fnv1aStep } from '../../../core/base/hash';
import { cellKey } from '../../../core/grid/rect';

export interface RoadMaterialPatch extends RoadMaterialFinish {
  /** Each polygon has an outer contour followed by its holes. */
  polygons: RoadPt[][][];
}

/** The bands of one square of the map grid. Equal keys describe equal patches. */
export interface RoadBandWindow {
  readonly key: string;
  /** The window's top-left cell. */
  readonly x: number;
  readonly y: number;
  /** Requires `roadMaterialReady()`. */
  patches(): RoadMaterialPatch[];
}

export interface RoadBandLayout {
  /** Every window holding a cell of the region, in row-major order. */
  readonly windows: readonly RoadBandWindow[];
  /** The window containing a point, in cells. */
  windowAt(x: number, y: number): RoadBandWindow;
}

/** Band windows are squares of this many cells aligned to the map origin. */
export const ROAD_BAND_WINDOW = 16;

// Integer clipping keeps adjacent bands coincident to 1/4096 of a macro cell.
const SCALE = 4096;

type Clipper = typeof ClipperLib;
let clipper: Clipper | null = null;
let loading: Promise<void> | null = null;
const readyListeners = new Set<() => void>();

function load(): Promise<void> {
  loading ??= loadClipper().then((lib) => {
    clipper = lib;
    const listeners = [...readyListeners];
    readyListeners.clear();
    for (const listener of listeners) listener();
  }, () => {
    // A failed load is retried at the next request; its listeners wait for that one.
    loading = null;
  });
  return loading;
}

/** Whether bands can be built now. Otherwise the clipper starts loading and `onReady` runs once it has. */
export function roadMaterialReady(onReady?: () => void): boolean {
  if (clipper) return true;
  if (onReady) readyListeners.add(onReady);
  void load();
  return false;
}

/** Resolves once bands can be built or the load has failed, so a capture never hangs on it. */
export function roadMaterialSettled(): Promise<void> {
  return clipper ? Promise.resolve() : load();
}

function lib(): Clipper {
  if (!clipper) throw new Error('Road material bands need the clipper; wait for roadMaterialReady');
  return clipper;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

const toPaths = (rings: RoadPt[][]): ClipperLib.Paths => rings.map((ring) => ring.map(([x, y]) => ({
  X: Math.round(x * SCALE), Y: Math.round(y * SCALE),
})));

const before = (a: RoadPt, b: RoadPt): number => a[0] - b[0] || a[1] - b[1];

/** Contours start at their least point and polygons and holes sort by it, so equal geometry gives
 *  equal arrays whatever order the region's rings arrived in. */
function polygons(tree: ClipperLib.PolyTree): RoadPt[][][] {
  const result: RoadPt[][][] = [];
  const contour = (node: ClipperLib.PolyNode): RoadPt[] => {
    const ring = node.Contour().map((p): RoadPt => [p.X / SCALE, p.Y / SCALE]);
    let start = 0;
    for (let i = 1; i < ring.length; i++) if (before(ring[i]!, ring[start]!) < 0) start = i;
    return [...ring.slice(start), ...ring.slice(0, start)];
  };
  const visit = (node: ClipperLib.PolyNode): void => {
    if (!node.IsHole() && node.Contour().length) {
      const holes = node.Childs().filter((child) => child.IsHole()).map(contour).sort((a, b) => before(a[0]!, b[0]!));
      result.push([contour(node), ...holes]);
    }
    node.Childs().forEach(visit);
  };
  visit(tree);
  return result.sort((a, b) => before(a[0]![0]!, b[0]![0]!));
}

function execute(subject: ClipperLib.Paths, clipPaths: ClipperLib.Paths, operation: number, result: ClipperLib.PolyTree | ClipperLib.Paths): void {
  const C = lib();
  const clip = new C.Clipper();
  clip.AddPaths(subject, C.PolyType.ptSubject, true);
  if (clipPaths.length) clip.AddPaths(clipPaths, C.PolyType.ptClip, true);
  clip.Execute(operation, result, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
}

function clipPolygons(subject: ClipperLib.Paths, clipPaths: ClipperLib.Paths, operation: number): RoadPt[][][] {
  const tree = new (lib().PolyTree)();
  execute(subject, clipPaths, operation, tree);
  return polygons(tree);
}

function intersectPaths(subject: ClipperLib.Paths, clipPaths: ClipperLib.Paths): ClipperLib.Paths {
  const out: ClipperLib.Paths = [];
  if (subject.length) execute(subject, clipPaths, lib().ClipType.ctIntersection, out);
  return out;
}

function boundsOf(points: readonly RoadPt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

const overlaps = (a: Box, b: Box): boolean => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Sutherland-Hodgman against a box. The result has the input's winding at every point inside the
 *  box and keeps the input's vertices there, so offsets away from the box edge are unchanged. */
function clipRing(ring: RoadPt[], box: Box): RoadPt[] {
  let points = ring;
  const sides: [axis: 0 | 1, bound: number, keepAbove: boolean][] = [
    [0, box.x0, true], [0, box.x1, false], [1, box.y0, true], [1, box.y1, false],
  ];
  for (const [axis, bound, keepAbove] of sides) {
    const out: RoadPt[] = [];
    const inside = (p: RoadPt): boolean => (keepAbove ? p[axis] >= bound : p[axis] <= bound);
    for (let k = 0; k < points.length; k++) {
      const a = points[k]!, b = points[(k + 1) % points.length]!;
      const aIn = inside(a);
      if (aIn) out.push(a);
      if (aIn !== inside(b)) {
        const t = (bound - a[axis]) / (b[axis] - a[axis]);
        const other = axis === 0 ? 1 : 0;
        const p: RoadPt = [0, 0];
        p[axis] = bound;
        p[other] = a[other] + (b[other] - a[other]) * t;
        out.push(p);
      }
    }
    points = out;
    if (points.length < 3) return [];
  }
  return points;
}

function clipRings(rings: readonly RoadPt[][], bounds: readonly Box[], box: Box): RoadPt[][] {
  const out: RoadPt[][] = [];
  rings.forEach((ring, i) => {
    const b = bounds[i]!;
    if (!overlaps(b, box)) return;
    if (b.x0 >= box.x0 && b.x1 <= box.x1 && b.y0 >= box.y0 && b.y1 <= box.y1) { out.push(ring); return; }
    const clipped = clipRing(ring, box);
    if (clipped.length) out.push(clipped);
  });
  return out;
}

/** Everything a window needs from its region, derived once per region and spec. */
interface RegionData {
  base: RoadPt[][];
  baseBounds: Box[];
  outline: RoadPt[][];
  outlineBounds: Box[];
  cuts: { path: ClipperLib.IntPoint[]; bounds: Box }[];
}

function regionData(region: RoadRegion, spec: RoadMaterialSpec): RegionData {
  const base = region.rings.map((ring) => ring.points(0));
  const outline = region.rings.map((ring) => roadFeatherOutline(ring.points)(spec.feather));
  const cuts: RegionData['cuts'] = [];
  if (spec.edgeJoints && spec.layers.length) {
    const { spacing, width } = spec.edgeJoints;
    for (const cut of roadEdgeJointCuts(base, spec.layers[0]!.inset, spacing, width)) {
      const path = toPaths([cut])[0]!;
      const b = boundsOf(cut);
      cuts.push({ path, bounds: { x0: b.x0 * SCALE, y0: b.y0 * SCALE, x1: b.x1 * SCALE, y1: b.y1 * SCALE } });
    }
  }
  return { base, baseBounds: base.map(boundsOf), outline, outlineBounds: outline.map(boundsOf), cuts };
}

/** How far outside a window the outline still shapes its bands, in whole cells. */
function clipMargin(spec: RoadMaterialSpec): number {
  // A square-joined offset never moves geometry further than its distance times the square root of
  // two, so the box edge's own erosion stays outside the window.
  return Math.max(1, Math.ceil(Math.SQRT2 * (spec.layers[spec.layers.length - 1]?.inset ?? 0) + 1e-6));
}

/** How far outside a window a piece can change its bands, in whole cells. Pieces read their
 *  neighbours and a ring vertex joins its neighbouring elements, one cell each. */
function keyMargin(spec: RoadMaterialSpec): number {
  const joints = spec.edgeJoints && spec.layers.length
    ? roadEdgeJointReach(spec.layers[0]!.inset, spec.edgeJoints.width) : 0;
  return Math.ceil(Math.max(clipMargin(spec), joints)) + 2;
}

function windowPatches(data: RegionData, spec: RoadMaterialSpec, window: Box): RoadMaterialPatch[] {
  const C = lib();
  const margin = clipMargin(spec);
  const reach: Box = { x0: window.x0 - margin, y0: window.y0 - margin, x1: window.x1 + margin, y1: window.y1 + margin };
  const square: ClipperLib.Paths = [[
    { X: window.x0 * SCALE, Y: window.y0 * SCALE }, { X: window.x1 * SCALE, Y: window.y0 * SCALE },
    { X: window.x1 * SCALE, Y: window.y1 * SCALE }, { X: window.x0 * SCALE, Y: window.y1 * SCALE },
  ]];
  const levels: ClipperLib.Paths[] = [intersectPaths(toPaths(clipRings(data.outline, data.outlineBounds, reach)), square)];
  if (spec.layers.length && levels[0]!.length) {
    const offset = new C.ClipperOffset();
    offset.AddPaths(toPaths(clipRings(data.base, data.baseBounds, reach)), C.JoinType.jtSquare, C.EndType.etClosedPolygon);
    for (const layer of spec.layers) {
      const inset: ClipperLib.Paths = [];
      // Offsetting the union removes collapsed corridors and preserves holes after erosion.
      offset.Execute(inset, -layer.inset * SCALE);
      levels.push(intersectPaths(inset, square));
    }
  }
  const patches: RoadMaterialPatch[] = [spec.edge, ...spec.layers].map((finish, i) => ({
    color: finish.color, pattern: finish.pattern,
    polygons: levels[i]?.length ? clipPolygons(levels[i]!, levels[i + 1] ?? [], C.ClipType.ctDifference) : [],
  }));
  if (spec.edgeJoints && spec.layers.length) {
    const edge = patches[0]!;
    const scaled: Box = { x0: window.x0 * SCALE, y0: window.y0 * SCALE, x1: window.x1 * SCALE, y1: window.y1 * SCALE };
    const cuts = data.cuts.filter((cut) => overlaps(cut.bounds, scaled)).map((cut) => cut.path);
    const original = toPaths(edge.polygons.flat());
    const mortar = cuts.length && original.length ? clipPolygons(original, cuts, C.ClipType.ctIntersection) : [];
    // Both finishes partition the same band; coplanar overlapping decals would flicker in 3D.
    if (mortar.length) edge.polygons = clipPolygons(original, cuts, C.ClipType.ctDifference);
    patches.push({ color: spec.edgeJoints.color, polygons: mortar });
  }
  return patches;
}

const pointCount = (patches: RoadMaterialPatch[]): number => patches.reduce((sum, patch) =>
  sum + patch.polygons.reduce((count, polygon) => count + polygon.reduce((n, ring) => n + ring.length, 0), 0), 0);

// Renderers keep their own per-window results; this cache lets the other view and regions sharing a
// window reuse a computation, so it only ever sees misses and is bounded by windows and points.
const MAX_SHARED_WINDOWS = 512;
const MAX_SHARED_POINTS = 1_000_000;
const shared = new Map<string, { patches: RoadMaterialPatch[]; points: number }>();
let sharedPoints = 0;

function sharedPatches(key: string, make: () => RoadMaterialPatch[]): RoadMaterialPatch[] {
  const hit = shared.get(key);
  if (hit) {
    shared.delete(key);
    shared.set(key, hit);
    return hit.patches;
  }
  const patches = make();
  const points = pointCount(patches);
  shared.set(key, { patches, points });
  sharedPoints += points;
  // The newest entry is last in the map, so the loop never evicts the window it just stored.
  while (shared.size > 1 && (shared.size > MAX_SHARED_WINDOWS || sharedPoints > MAX_SHARED_POINTS)) {
    const [oldest, entry] = shared.entries().next().value!;
    shared.delete(oldest);
    sharedPoints -= entry.points;
  }
  return patches;
}

// Two independent 32-bit string hashes, summed per window so the order of pieces never matters.
function hashPair(text: string): [number, number] {
  let a = FNV_BASIS, b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = fnv1aStep(a, c);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return [a >>> 0, b >>> 0];
}

let specCount = 0;
const specIds = new WeakMap<RoadMaterialSpec, number>();
function specId(spec: RoadMaterialSpec): number {
  let id = specIds.get(spec);
  if (id === undefined) { id = ++specCount; specIds.set(spec, id); }
  return id;
}

let layouts = new WeakMap<RoadRegion, WeakMap<RoadMaterialSpec, RoadBandLayout>>();

/**
 * The region's bands cut into map-grid windows. A window's key hashes every piece that can shape
 * it, so an edit changes the keys of the windows near it and nowhere else, and the union of the
 * windows' patches is the region's bands. `size` exists for the equivalence tests.
 */
export function roadBandLayout(region: RoadRegion, spec: RoadMaterialSpec, size = ROAD_BAND_WINDOW): RoadBandLayout {
  const memo = size === ROAD_BAND_WINDOW ? layouts.get(region)?.get(spec) : undefined;
  if (memo) return memo;
  const margin = keyMargin(spec);
  const sums = new Map<string, { count: number; a: number; b: number }>();
  for (const piece of region.pieces) {
    const [a, b] = hashPair(piece.key);
    for (let i = Math.floor((piece.x - margin) / size); i <= Math.floor((piece.x + margin) / size); i++) {
      for (let j = Math.floor((piece.y - margin) / size); j <= Math.floor((piece.y + margin) / size); j++) {
        const id = cellKey(i, j);
        const sum = sums.get(id);
        if (sum) { sum.count++; sum.a = (sum.a + a) >>> 0; sum.b = (sum.b + b) >>> 0; } else sums.set(id, { count: 1, a, b });
      }
    }
  }
  const prefix = `${specId(spec)}:${region.material}:${size}`;
  let data: RegionData | null = null;
  const made = new Map<string, RoadBandWindow>();
  const windowOf = (i: number, j: number): RoadBandWindow => {
    const id = cellKey(i, j);
    const existing = made.get(id);
    if (existing) return existing;
    const sum = sums.get(id);
    const key = `${prefix}:${id}:${sum ? `${sum.count}:${sum.a}:${sum.b}` : 'empty'}`;
    const box: Box = { x0: i * size, y0: j * size, x1: (i + 1) * size, y1: (j + 1) * size };
    const window: RoadBandWindow = {
      key, x: box.x0, y: box.y0,
      patches: () => sharedPatches(key, () => windowPatches(data ??= regionData(region, spec), spec, box)),
    };
    made.set(id, window);
    return window;
  };
  const cells = new Map<string, [number, number]>();
  for (const c of region.cells) {
    const i = Math.floor(c.x / size), j = Math.floor(c.y / size);
    cells.set(cellKey(i, j), [i, j]);
  }
  const windows = [...cells.values()].sort((p, q) => p[1] - q[1] || p[0] - q[0]).map(([i, j]) => windowOf(i, j));
  const layout: RoadBandLayout = {
    windows,
    windowAt: (x, y) => windowOf(Math.floor(x / size), Math.floor(y / size)),
  };
  if (size === ROAD_BAND_WINDOW) {
    let bySpec = layouts.get(region);
    if (!bySpec) { bySpec = new WeakMap(); layouts.set(region, bySpec); }
    bySpec.set(spec, layout);
  }
  return layout;
}

/** Disjoint bands avoid coplanar overdraw and share exactly the same contours in both views. */
export function roadMaterialPatches(region: RoadRegion, spec: RoadMaterialSpec): RoadMaterialPatch[] {
  return roadBandLayout(region, spec).windows.flatMap((window) => window.patches());
}

/** Test hook: forgets every computed window, so the next request computes from scratch. */
export function __resetRoadMaterialCache(): void {
  shared.clear();
  sharedPoints = 0;
  layouts = new WeakMap();
}
