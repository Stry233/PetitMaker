/**
 * Themed rooms and composed crossing scenes. A room is a patch of ground with a theme, and its
 * decorator fills it in character (single-species orchard grids, crop rows, garden beds, a peak
 * lookout, a waterfront promenade) rather than scattering. A crossing gets a mirrored vignette at
 * both ends. Every pick comes from the live catalog pools and every placement goes through the
 * placement door's `tryPlace` or `tryDecorate`. The bodies run inside the caller's stroke group.
 */
import { type CatalogItem, type MacroCoord, type PlacedObject, type Rotation, ROTATIONS } from '../../../core/model/types';
import { hasGate, crossingRunsAlongX, objectRect } from '../../../state/object-geometry';
import { getRotatedSize } from '../../../core/grid/footprint';
import { makeRng, type Rng } from '../../../core/base/rng';
import { analyzeTerrain, type PlacementAnalysis } from '../../placement/analysis';
import {
  buildingGate, forEachFootprintCell, makeCtx, markCells as mark, openAt, tryDecorate, tryPlace, type PlaceCtx,
} from '../../placement/object';
import { scanPortals } from '../roads/portals';
import { crossingPool, type CrossingKind } from '../../placement/crossings';
import { getPlaceableByRole } from '../../../state/catalog';
import { bySizeDesc } from '../../../core/grid/cell-sets';
import { cellKey } from '../../../core/grid/rect';
import type { MacroContext } from '../context';

/** The decorators' knobs. */
const TUNING = {
  orchardCellsPerTree: 16,    // orchard target = room cells / this x (0.5 + nature)
  orchardStride: 2,           // cells between orchard trees (clears the exclusion radius)
  farmCellsPerCrop: 9,        // farm target = room cells / this x (0.5 + nature)
  hamletAnchorTries: 24,      // failed seats before the landmark cabin yields to stalls
  gardenRingInner: 4,         // garden ring: flora ring radius around the room centroid...
  gardenRingOuter: 6,         // ...between these two distances
  gardenRingMax: 8,           // ...capped at this many plants
  sceneFloraPairs: 3,         // mirrored flora pairs per bridge or ramp scene
} as const;

/** The characters a room can be decorated in. */
export const ROOM_THEMES = ['orchard', 'farm', 'garden', 'hamlet', 'waterfront', 'peak'] as const;
export type RoomTheme = (typeof ROOM_THEMES)[number];

/** One room, as a decorator reads it: which cells it holds, where its middle is, and its theme. */
interface Zone {
  id: number;
  cells: number[];        // flat indices (y*width+x)
  centroid: MacroCoord;
  theme: RoomTheme;
}

/** One decorating pass: the placement door, the analysis it reads, the cells already taken, and its rng. */
interface Decorating {
  ctx: PlaceCtx;
  a: PlacementAnalysis;
  settled: Set<string>;
  rng: Rng;
}

const place = ({ ctx, a, settled }: Decorating, id: string, x: number, y: number, rot: Rotation = 0): PlacedObject | null => {
  if (!openAt(a, x, y) || settled.has(cellKey(x, y))) return null;
  const obj = tryDecorate(ctx, id, x, y, rot); // decorations respect navigation clearance (blocking items only)
  if (obj) mark(obj, settled);
  return obj;
};


/** Rotation for a centre-anchored building at (cx, cy): a gated building takes the rotation whose
 *  gate faces open ground (approach open, and ideally the cell beyond it too), so the door can take
 *  a road spur. The seeded rng start keeps variety among equally good facings; items without a gate
 *  stay fully random. */
function gateAwareRot({ a, rng, settled }: Decorating, item: CatalogItem, cx: number, cy: number): Rotation {
  if (!item.rotatable) return 0;
  const rots = ROTATIONS;
  const start = rng.int(4);
  if (!hasGate(item)) return rots[start]!;
  const free = (x: number, y: number): boolean => openAt(a, x, y) && !settled.has(cellKey(x, y));
  let best: Rotation = rots[start]!, bestScore = -1;
  for (let k = 0; k < 4; k++) {
    const rot = rots[(start + k) % 4]!;
    const sz = getRotatedSize(item, rot);
    const px = cx - Math.floor(sz.w / 2), py = cy - Math.floor(sz.h / 2);
    const { gate, approach } = buildingGate({ x: px, y: py, w: sz.w, h: sz.h }, rot);
    const beyond = { x: approach.x * 2 - gate.x, y: approach.y * 2 - gate.y };
    const score = (free(approach.x, approach.y) ? 2 : 0) + (free(beyond.x, beyond.y) ? 1 : 0);
    if (score > bestScore) { best = rot; bestScore = score; if (score === 3) break; }
  }
  return best;
}


/** True when the footprint grown by one cell holds no settled cell: hamlet buildings keep a walkable
 *  street margin around themselves, so a cluster never walls itself or its doors in. */
function hasStreetMargin(px: number, py: number, w: number, h: number, settled: Set<string>): boolean {
  for (let y = py - 1; y <= py + h; y++) for (let x = px - 1; x <= px + w; x++) {
    if (settled.has(cellKey(x, y))) return false;
  }
  return true;
}

/** Decorate one zone in its theme's character. Density scales with the sliders. */
function decorateZone(d: Decorating, zone: Zone, density: { settlement: number; nature: number }): void {
  switch (zone.theme) {
    case 'orchard': return orchard(d, zone, density.nature);
    case 'farm': return farm(d, zone, density.nature);
    case 'garden': return garden(d, zone, density.nature);
    case 'hamlet': return hamlet(d, zone, density.settlement);
    case 'waterfront': return waterfront(d, zone);
    case 'peak': return peak(d, zone);
  }
}

/** One fruit species in a stride grid — a working orchard, not a forest. */
function orchard(d: Decorating, zone: Zone, nature: number): void {
  const { a, rng } = d;
  const trees = getPlaceableByRole('canopy');
  if (!trees.length) return;
  const sp = trees[rng.int(trees.length)]!;
  const target = Math.max(6, Math.round(zone.cells.length / TUNING.orchardCellsPerTree * (0.5 + nature)));
  let placed = 0;
  for (const i of zone.cells) {
    if (placed >= target) break;
    const x = i % a.width, y = (i / a.width) | 0;
    if (x % TUNING.orchardStride !== 0 || y % TUNING.orchardStride !== 0) continue;
    if (place(d, sp.id, x, y)) placed++;
  }
}

/** Crop rows of one flora species with walkable gaps — farmland under cultivation. */
function farm(d: Decorating, zone: Zone, nature: number): void {
  const { a, rng } = d;
  const flora = getPlaceableByRole('groundcover');
  if (!flora.length) return;
  const sp = flora[rng.int(flora.length)]!;
  const target = Math.max(8, Math.round(zone.cells.length / TUNING.farmCellsPerCrop * (0.5 + nature)));
  let placed = 0;
  for (const i of zone.cells) {
    if (placed >= target) break;
    const x = i % a.width, y = (i / a.width) | 0;
    if (y % 2 !== 0) continue; // rows on even y → gaps between
    if (place(d, sp.id, x, y)) placed++;
  }
}

/** Two-three species-pure flower beds (clustered discs), not scatter. */
function garden(d: Decorating, zone: Zone, nature: number): void {
  const { a, rng } = d;
  const flora = getPlaceableByRole('groundcover');
  if (!flora.length) return;
  const beds = 2 + rng.int(2);
  const W = a.width;
  for (let b = 0; b < beds; b++) {
    const at = zone.cells[rng.int(zone.cells.length)]!;
    const cx = at % W, cy = (at / W) | 0;
    const sp = flora[rng.int(flora.length)]!;
    const r = 2 + rng.int(2);
    let placed = 0;
    const cap = Math.round(Math.PI * r * r * (0.5 + 0.5 * nature));
    for (let dy = -r; dy <= r && placed < cap; dy++) for (let dx = -r; dx <= r && placed < cap; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      if (place(d, sp.id, cx + dx, cy + dy)) placed++;
    }
  }
}

/** A small home cluster with a garden ring — the residential room. The anchor is one landmark cabin
 *  the map doesn't have yet; homes fall back to repeatable stalls once the cabins are spoken for.
 *  Consumed uniques are never re-tried, so later rooms still get buildings and the planet's homes
 *  spread coast to coast instead of clumping on one hillside. */
function hamlet(d: Decorating, zone: Zone, settlement: number): void {
  const { ctx, a, settled, rng } = d;
  const all = getPlaceableByRole('home');
  const placedIds = new Set<string>();
  for (const o of ctx.state.objects.values()) if (!o.locked) placedIds.add(o.catalogId);
  const uniques = all.filter((b) => b.maxCount === 1 && !placedIds.has(b.id));
  const stalls = all.filter((b) => b.maxCount !== 1);
  let anchor: CatalogItem | null = uniques.length ? uniques[rng.int(uniques.length)]! : null;
  const target = Math.max(2, Math.round(2 + settlement * 3));
  const W = a.width;
  let placed = 0, anchorTries = 0;
  // near-centroid first, deterministic spiral over the zone's cells sorted by centroid distance
  const ordered = [...zone.cells].sort((p, q) => {
    const dp = (p % W - zone.centroid.x) ** 2 + (((p / W) | 0) - zone.centroid.y) ** 2;
    const dq = (q % W - zone.centroid.x) ** 2 + (((q / W) | 0) - zone.centroid.y) ** 2;
    return dp - dq || p - q;
  });
  for (const i of ordered) {
    if (placed >= target) break;
    const x = i % W, y = (i / W) | 0;
    const item = anchor ?? (stalls.length ? stalls[rng.int(stalls.length)]! : null);
    if (!item) break;
    const rot = gateAwareRot(d, item, x, y);
    const sz = getRotatedSize(item, rot);
    const px = x - Math.floor(sz.w / 2), py = y - Math.floor(sz.h / 2);
    const obj = openAt(a, x, y) && hasStreetMargin(px, py, sz.w, sz.h, settled) ? tryPlace(ctx, item.id, px, py, rot) : null;
    if (obj) { mark(obj, settled); placed++; if (item === anchor) anchor = null; }
    else if (anchor && ++anchorTries >= TUNING.hamletAnchorTries) anchor = null; // this pocket can't seat the cabin — stall homes instead
  }
  // garden ring
  const flora = getPlaceableByRole('groundcover');
  if (flora.length) {
    const sp = flora[rng.int(flora.length)]!;
    let n = 0;
    for (const i of ordered) {
      if (n >= TUNING.gardenRingMax) break;
      const x = i % W, y = (i / W) | 0;
      const dist = Math.hypot(x - zone.centroid.x, y - zone.centroid.y);
      if (dist < TUNING.gardenRingInner || dist > TUNING.gardenRingOuter) continue;
      if (place(d, sp.id, x, y)) n++;
    }
  }
}

/** The promenade: a pavilion-like facility by the water + a flora line along the waterline. */
function waterfront(d: Decorating, zone: Zone): void {
  const { a, rng } = d;
  const W = a.width;
  const shore = zone.cells.filter((i) => a.distToWater[i]! >= 1 && a.distToWater[i]! <= 2);
  const fac = [...getPlaceableByRole('amenity')].sort(bySizeDesc);
  for (const f of fac) {
    let done = false;
    for (const i of shore) { if (place(d, f.id, i % W, (i / W) | 0)) { done = true; break; } }
    if (done) break;
  }
  const flora = getPlaceableByRole('groundcover');
  if (flora.length) {
    const sp = flora[rng.int(flora.length)]!;
    let n = 0;
    for (const i of shore) {
      if (n >= Math.round(shore.length / 3)) break;
      const x = i % W, y = (i / W) | 0;
      if ((x + y) % 3 !== 0) continue; // an even promenade line, not a thicket
      if (place(d, sp.id, x, y)) n++;
    }
  }
}

/** The lookout: a symmetric tree ring + flora heart at the summit. */
function peak(d: Decorating, zone: Zone): void {
  const { rng } = d;
  const trees = getPlaceableByRole('canopy'), flora = getPlaceableByRole('groundcover');
  const c = zone.centroid;
  if (trees.length) {
    const sp = trees[rng.int(trees.length)]!;
    for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) place(d, sp.id, c.x + dx, c.y + dy);
  }
  if (flora.length) {
    const sp = flora[rng.int(flora.length)]!;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]] as const) place(d, sp.id, c.x + dx, c.y + dy);
  }
}

/** The crossing scene: mirrored one-species flora pairs framing both ends, a composed vignette. */
function decorateCrossing(d: Decorating, obj: PlacedObject): void {
  const { rng } = d;
  const flora = getPlaceableByRole('groundcover');
  if (!flora.length) return;
  const sp = flora[rng.int(flora.length)]!;
  const r = objectRect(obj);
  const horizontal = crossingRunsAlongX(obj);
  const ends: MacroCoord[] = horizontal
    ? [{ x: Math.floor(r.x) - 1, y: Math.floor(r.y) }, { x: Math.ceil(r.x + r.w), y: Math.floor(r.y) }]
    : [{ x: Math.floor(r.x), y: Math.floor(r.y) - 1 }, { x: Math.floor(r.x), y: Math.ceil(r.y + r.h) }];
  for (const e of ends) {
    for (let k = 0; k < TUNING.sceneFloraPairs; k++) {
      const off = k + 1;
      if (horizontal) { place(d, sp.id, e.x, e.y - off); place(d, sp.id, e.x, e.y + off); }
      else { place(d, sp.id, e.x - off, e.y); place(d, sp.id, e.x + off, e.y); }
    }
  }
}

/**
 * Decorates the open cells of `cells` as one room in `theme`, centred on their centroid, and returns
 * how many objects landed. With no open cell the room is every given cell around the cells' middle,
 * and the decorators skip what is not open.
 */
export function decorateRoom(kit: MacroContext, cells: readonly MacroCoord[], theme: RoomTheme, seed: number): number {
  const { state, executor, registry } = kit;
  const { width } = state.template;
  const a = analyzeTerrain(state, [...cells]);
  const open: number[] = [];
  let sumX = 0, sumY = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    const idx = c.y * width + c.x;
    if (a.open[idx] !== 1) continue;
    open.push(idx);
    sumX += c.x;
    sumY += c.y;
  }
  const zone: Zone = open.length > 0
    ? { id: 0, cells: open, centroid: { x: Math.round(sumX / open.length), y: Math.round(sumY / open.length) }, theme }
    : { id: 0, cells: cells.map((c) => c.y * width + c.x), centroid: { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) }, theme };
  const ctx = makeCtx(state, (c) => executor.execute(c), registry, seed);
  const before = state.objects.size;
  decorateZone({ ctx, a, settled: new Set<string>(), rng: makeRng(seed) }, zone, { settlement: 0.5, nature: 0.5 });
  return state.objects.size - before;
}

/** What `frameCrossingNear` did: the crossing it laid, or why it laid none. */
export type FramedCrossing =
  | { status: 'framed'; kind: CrossingKind; anchor: MacroCoord; regionA: number; regionB: number }
  | { status: 'no-site' }
  | { status: 'no-item'; kind: CrossingKind }
  | { status: 'refused'; anchor: MacroCoord };

/**
 * Lays the validated crossing site nearest `target` and frames it with a mirrored flora scene. The
 * portal scan is confined to `region` when one is given; its dry-run placements undo themselves.
 */
export function frameCrossingNear(
  kit: MacroContext, target: MacroCoord, seed: number, region: readonly MacroCoord[] | null,
): FramedCrossing {
  const { state, executor, registry } = kit;
  const a = analyzeTerrain(state, region && region.length > 0 ? [...region] : null);
  const ctx = makeCtx(state, (c) => executor.execute(c), registry, seed);
  const { portals } = scanPortals(ctx, a);
  if (portals.length === 0) return { status: 'no-site' };
  const nearest = portals.reduce((best, p) => {
    const da = (p.anchor.x - target.x) ** 2 + (p.anchor.y - target.y) ** 2;
    const db = (best.anchor.x - target.x) ** 2 + (best.anchor.y - target.y) ** 2;
    return da < db ? p : best;
  });
  const itemId = crossingPool(nearest.kind)[0]?.id;
  if (!itemId) return { status: 'no-item', kind: nearest.kind };
  const placed = tryPlace(ctx, itemId, nearest.anchor.x, nearest.anchor.y);
  if (!placed) return { status: 'refused', anchor: nearest.anchor };
  const settled = new Set<string>();
  forEachFootprintCell(placed, (x, y) => settled.add(cellKey(x, y)));
  decorateCrossing({ ctx, a, settled, rng: makeRng(seed) }, placed);
  return { status: 'framed', kind: nearest.kind, anchor: nearest.anchor, regionA: nearest.regionA, regionB: nearest.regionB };
}
