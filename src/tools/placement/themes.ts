// placement/themes.ts — themed room decorators + composed crossing scenes.
//
// A ROOM is a patch of ground with a theme: the decorator for that theme fills it IN CHARACTER
// (species-pure orchard grids, crop rows, garden beds, a peak lookout, a waterfront promenade)
// instead of scattering. Crossings get mirrored vignettes so each bridge/ramp reads as a deliberate
// moment. All picks come from the live catalog pools; every placement goes through tryPlace
// (reject-and-skip). The agent's `decorate_zone` tool is the caller: it hands in the rect the user
// named as one room.
import { ItemCategory, type CatalogItem, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { getRotatedSize, objectRect } from '../../state/object-geometry';
import type { Rng } from '../../core/model/rng';
import { TUNING } from './tuning';
import { tryPlace, tryDecorate, openAt, markCells as mark, buildingGate, hasGate, type PlaceCtx } from './object';
import { getPlaceableByCategory } from '../../state/catalog';
import type { PlacementAnalysis } from './analysis';
import { bySizeDesc } from '../../core/model/geometry';

/** The six characters a room can be decorated in. */
export type ZoneTheme = 'orchard' | 'farm' | 'garden' | 'hamlet' | 'waterfront' | 'peak';

/** One room, as a decorator reads it: which cells it holds, where its middle is, and its theme. */
export interface Zone {
  id: number;
  cells: number[];        // flat indices (y*width+x)
  centroid: MacroCoord;
  theme: ZoneTheme;
}

const place = (ctx: PlaceCtx, a: PlacementAnalysis, settled: Set<string>, id: string, x: number, y: number, rot: 0 | 90 | 180 | 270 = 0): PlacedObject | null => {
  if (!openAt(a, x, y) || settled.has(`${x},${y}`)) return null;
  const obj = tryDecorate(ctx, id, x, y, rot); // decorations respect navigation clearance (blocking items only)
  if (obj) mark(obj, settled);
  return obj;
};

/** The two end cells just outside a crossing's footprint, along its long axis — where roads attach
 *  and the navigation clearance is reserved. */
export function crossingEnds(obj: PlacedObject): [MacroCoord, MacroCoord] {
  const r = objectRect(obj);
  const horizontal = r.w >= r.h;
  const midX = Math.floor(r.x + r.w / 2), midY = Math.floor(r.y + r.h / 2);
  return horizontal
    ? [{ x: Math.floor(r.x) - 1, y: midY }, { x: Math.ceil(r.x + r.w), y: midY }]
    : [{ x: midX, y: Math.floor(r.y) - 1 }, { x: midX, y: Math.ceil(r.y + r.h) }];
}


/** Rotation for a centre-anchored building at (cx, cy): a HOUSE prefers the rotation whose GATE
 *  faces open ground (approach open, and ideally the cell beyond it too) so the door can take a
 *  road spur — a random pick regularly faced cliffs/water and left the doorstep unpavable. The
 *  seeded rng start keeps variety among equally-good facings; non-gated items stay fully random. */
function gateAwareRot(a: PlacementAnalysis, item: CatalogItem, cx: number, cy: number, rng: Rng, settled: Set<string>): 0 | 90 | 180 | 270 {
  if (!item.rotatable) return 0;
  const rots = [0, 90, 180, 270] as const;
  const start = rng.int(4);
  if (!hasGate(item)) return rots[start]!;
  const free = (x: number, y: number): boolean => openAt(a, x, y) && !settled.has(`${x},${y}`);
  let best: 0 | 90 | 180 | 270 = rots[start]!, bestScore = -1;
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


/** True when the footprint EXPANDED BY ONE CELL contains no settled cell — hamlet buildings keep a
 *  walkable street margin around themselves, so a cluster can never wall itself (or its doors) in. */
function hasStreetMargin(px: number, py: number, w: number, h: number, settled: Set<string>): boolean {
  for (let y = py - 1; y <= py + h; y++) for (let x = px - 1; x <= px + w; x++) {
    if (settled.has(`${x},${y}`)) return false;
  }
  return true;
}

/** Decorate one zone in its theme's character. Density scales with the sliders. */
export function decorateZone(
  ctx: PlaceCtx, a: PlacementAnalysis, zone: Zone,
  settlement: number, nature: number, settled: Set<string>, rng: Rng,
): void {
  switch (zone.theme) {
    case 'orchard': return orchard(ctx, a, zone, nature, settled, rng);
    case 'farm': return farm(ctx, a, zone, nature, settled, rng);
    case 'garden': return garden(ctx, a, zone, nature, settled, rng);
    case 'hamlet': return hamlet(ctx, a, zone, settlement, settled, rng);
    case 'waterfront': return waterfront(ctx, a, zone, settled, rng);
    case 'peak': return peak(ctx, a, zone, settled, rng);
  }
}

/** One fruit species in a stride grid — a working orchard, not a forest. */
function orchard(ctx: PlaceCtx, a: PlacementAnalysis, zone: Zone, nature: number, settled: Set<string>, rng: Rng): void {
  const trees = getPlaceableByCategory(ItemCategory.Tree);
  if (!trees.length) return;
  const sp = trees[rng.int(trees.length)]!;
  const target = Math.max(6, Math.round(zone.cells.length / TUNING.orchardCellsPerTree * (0.5 + nature)));
  let placed = 0;
  for (const i of zone.cells) {
    if (placed >= target) break;
    const x = i % a.width, y = (i / a.width) | 0;
    if (x % TUNING.orchardStride !== 0 || y % TUNING.orchardStride !== 0) continue;
    if (place(ctx, a, settled, sp.id, x, y)) placed++;
  }
}

/** Crop rows of one flora species with walkable gaps — farmland under cultivation. */
function farm(ctx: PlaceCtx, a: PlacementAnalysis, zone: Zone, nature: number, settled: Set<string>, rng: Rng): void {
  const flora = getPlaceableByCategory(ItemCategory.Flora);
  if (!flora.length) return;
  const sp = flora[rng.int(flora.length)]!;
  const target = Math.max(8, Math.round(zone.cells.length / TUNING.farmCellsPerCrop * (0.5 + nature)));
  let placed = 0;
  for (const i of zone.cells) {
    if (placed >= target) break;
    const x = i % a.width, y = (i / a.width) | 0;
    if (y % 2 !== 0) continue; // rows on even y → gaps between
    if (place(ctx, a, settled, sp.id, x, y)) placed++;
  }
}

/** Two-three species-pure flower BEDS (clustered discs), not scatter. */
function garden(ctx: PlaceCtx, a: PlacementAnalysis, zone: Zone, nature: number, settled: Set<string>, rng: Rng): void {
  const flora = getPlaceableByCategory(ItemCategory.Flora);
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
      if (place(ctx, a, settled, sp.id, cx + dx, cy + dy)) placed++;
    }
  }
}

/** A small home cluster with a garden ring — the residential room. The anchor is ONE landmark cabin
 *  the map doesn't have yet; homes fall back to repeatable stalls once the cabins are spoken for.
 *  Consumed uniques are never re-tried, so later rooms still get buildings and the island's homes
 *  spread coast to coast instead of clumping on one hillside. */
function hamlet(ctx: PlaceCtx, a: PlacementAnalysis, zone: Zone, settlement: number, settled: Set<string>, rng: Rng): void {
  const all = getPlaceableByCategory(ItemCategory.Building);
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
    const rot = gateAwareRot(a, item, x, y, rng, settled);
    const sz = getRotatedSize(item, rot);
    const px = x - Math.floor(sz.w / 2), py = y - Math.floor(sz.h / 2);
    const obj = openAt(a, x, y) && hasStreetMargin(px, py, sz.w, sz.h, settled) ? tryPlace(ctx, item.id, px, py, rot) : null;
    if (obj) { mark(obj, settled); placed++; if (item === anchor) anchor = null; }
    else if (anchor && ++anchorTries >= TUNING.hamletAnchorTries) anchor = null; // this pocket can't seat the cabin — stall homes instead
  }
  // garden ring
  const flora = getPlaceableByCategory(ItemCategory.Flora);
  if (flora.length) {
    const sp = flora[rng.int(flora.length)]!;
    let n = 0;
    for (const i of ordered) {
      if (n >= TUNING.gardenRingMax) break;
      const x = i % W, y = (i / W) | 0;
      const d = Math.hypot(x - zone.centroid.x, y - zone.centroid.y);
      if (d < TUNING.gardenRingInner || d > TUNING.gardenRingOuter) continue;
      if (place(ctx, a, settled, sp.id, x, y)) n++;
    }
  }
}

/** The promenade: a pavilion-like facility by the water + a flora line along the waterline. */
function waterfront(ctx: PlaceCtx, a: PlacementAnalysis, zone: Zone, settled: Set<string>, rng: Rng): void {
  const W = a.width;
  const shore = zone.cells.filter((i) => a.distToWater[i]! >= 1 && a.distToWater[i]! <= 2);
  const fac = [...getPlaceableByCategory(ItemCategory.Facility)].sort(bySizeDesc);
  for (const f of fac) {
    let done = false;
    for (const i of shore) { if (place(ctx, a, settled, f.id, i % W, (i / W) | 0)) { done = true; break; } }
    if (done) break;
  }
  const flora = getPlaceableByCategory(ItemCategory.Flora);
  if (flora.length) {
    const sp = flora[rng.int(flora.length)]!;
    let n = 0;
    for (const i of shore) {
      if (n >= Math.round(shore.length / 3)) break;
      const x = i % W, y = (i / W) | 0;
      if ((x + y) % 3 !== 0) continue; // an even promenade line, not a thicket
      if (place(ctx, a, settled, sp.id, x, y)) n++;
    }
  }
}

/** The lookout: a symmetric tree ring + flora heart at the summit. */
function peak(ctx: PlaceCtx, a: PlacementAnalysis, zone: Zone, settled: Set<string>, rng: Rng): void {
  const trees = getPlaceableByCategory(ItemCategory.Tree), flora = getPlaceableByCategory(ItemCategory.Flora);
  const c = zone.centroid;
  if (trees.length) {
    const sp = trees[rng.int(trees.length)]!;
    for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) place(ctx, a, settled, sp.id, c.x + dx, c.y + dy);
  }
  if (flora.length) {
    const sp = flora[rng.int(flora.length)]!;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]] as const) place(ctx, a, settled, sp.id, c.x + dx, c.y + dy);
  }
}

/** The crossing SCENE: mirrored one-species flora pairs framing both ends — a composed vignette. */
export function decorateCrossing(ctx: PlaceCtx, a: PlacementAnalysis, obj: PlacedObject, settled: Set<string>, rng: Rng): void {
  const flora = getPlaceableByCategory(ItemCategory.Flora);
  if (!flora.length) return;
  const sp = flora[rng.int(flora.length)]!;
  const r = objectRect(obj);
  const horizontal = r.w >= r.h;
  const ends: MacroCoord[] = horizontal
    ? [{ x: Math.floor(r.x) - 1, y: Math.floor(r.y) }, { x: Math.ceil(r.x + r.w), y: Math.floor(r.y) }]
    : [{ x: Math.floor(r.x), y: Math.floor(r.y) - 1 }, { x: Math.floor(r.x), y: Math.ceil(r.y + r.h) }];
  for (const e of ends) {
    for (let k = 0; k < TUNING.sceneFloraPairs; k++) {
      const off = k + 1;
      if (horizontal) { place(ctx, a, settled, sp.id, e.x, e.y - off); place(ctx, a, settled, sp.id, e.x, e.y + off); }
      else { place(ctx, a, settled, sp.id, e.x - off, e.y); place(ctx, a, settled, sp.id, e.x + off, e.y); }
    }
  }
}
