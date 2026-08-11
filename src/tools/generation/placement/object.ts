import { ItemCategory, type Command, type GridState, type MacroCoord, type PlaceObjectCommand, type PlacedObject, type ValidationResult } from '../../../core/model/types';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import { NEIGHBORS4 } from '../../../core/model/grid-model';
import { getCatalogItem, isDecoration } from '../../../state/catalog';
import { objectRect, getRotatedSize } from '../../../state/object-geometry';
import { surfaceElevation } from '../../../core/edge-cut/terrain-silhouette';
import { isCoating } from '../../../core/model/traits';
import type { PlacementAnalysis } from './analysis';
import { objectPlacementCommand, removeObjectCommand } from '../../objects/object-placer';
import { generateObjectId } from '../../utils';

/** Context threaded through every placement stage. */
export interface PlaceCtx {
  state: GridState;
  execute: (c: Command) => ValidationResult;
  reg: RuleDispatcher;
  seed: number;
  /** Geometry-style knob from the generator config (1 = organic default; consumed via geoStyle). */
  naturalness: number;
  /** Cells reserved as navigation clearance around building gates and ramp/bridge ends. ALL
   *  decorations (trees, flora, facilities) are rejected here — gates and crossing approaches
   *  stay visibly open. Populated by buildNetwork; consumed via `tryDecorate`. */
  clearance: Set<number>;
  /** Cells covered by a surface-coating road. The overlap RULE deliberately exempts coatings
   *  (the manual placer strips-and-coats), so the populator must refuse to drop decorations on
   *  paved cells itself — a generated flower on a road is illegal in-game. Seeded from any roads
   *  already on the map; `tryPlace` records every road it lays. */
  roads: Set<number>;
  /** What a clearance-reserving placement does with a decoration already sitting where it just
   *  reserved: a HOUSE's own gate strip (`tryPlace`'s `hasGate` branch below), or `road-link.ts`'s
   *  own crossing-end sweep (`realizeCrossings`), which reads this field directly since it never
   *  goes through `tryPlace` for the sweep itself. `remove` (generation's, and the default when
   *  absent) sweeps it — the populator plants before it knows where a door or a crossing will
   *  land, so that is its own mistake to clear. `refuse` (every live-map gesture's) leaves it
   *  standing; the cells are still reserved, so nothing new lands there, but nothing already there
   *  is taken. */
  sweep?: 'remove' | 'refuse';
}

export function makeCtx(
  state: GridState, execute: (c: Command) => ValidationResult, reg: RuleDispatcher, seed: number,
  naturalness = 1, sweep?: 'remove' | 'refuse',
): PlaceCtx {
  const roads = new Set<number>();
  const W = state.template.width;
  for (const o of state.objects.values()) {
    const item = getCatalogItem(o.catalogId);
    if (item && isCoating(item)) forEachFootprintCell(o, (x, y) => roads.add(y * W + x));
  }
  return { state, execute, reg, seed, naturalness, clearance: new Set(), roads, ...(sweep ? { sweep } : {}) };
}

/** Reserve an N×N navigation-clearance square around (cx, cy). size 3 → a centred 3×3 (radius 1);
 *  size 2 → a 2×2 covering the cell, the one in front (+y) and the column to its left. */
export function reserveClearance(set: Set<number>, cx: number, cy: number, size: 2 | 3, W: number, H: number): void {
  const add = (x: number, y: number): void => { if (x >= 0 && y >= 0 && x < W && y < H) set.add(y * W + x); };
  if (size === 3) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(cx + dx, cy + dy); }
  else { for (let dy = 0; dy <= 1; dy++) for (let dx = -1; dx <= 0; dx++) add(cx + dx, cy + dy); }
}

/** True when (x, y) reads as PART OF THE STREET rather than beside it: 2 or more of its four edge
 *  neighbours are paved (`ctx.roads`). One paved side is a curb — `roadsideTreeLining` and the
 *  macro grammar's road border plant there on purpose — but two or more means the cell sits in a
 *  median strip or a pocket a widened/looped road encloses, which reads as flowers in the middle
 *  of the street even though the cell itself was never coated. */
function insideRoad(ctx: PlaceCtx, x: number, y: number): boolean {
  const W = ctx.state.template.width, H = ctx.state.template.height;
  let paved = 0;
  for (const [dx, dy] of NEIGHBORS4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    if (ctx.roads.has(ny * W + nx)) paved++;
  }
  return paved >= 2;
}

/** Place a DECORATION through the rules, but first reject any decoration whose footprint would
 *  intrude on a reserved clearance zone (gates/crossing approaches stay open), sit on a PAVED
 *  road cell (the overlap rule exempts coatings, so this is the only guard against a generated
 *  flower/tree on a road), or land INSIDE the road (`insideRoad`, a median/enclosed pocket).
 *  Infrastructure (buildings/roads/crossings) goes through tryPlace directly and is never gated. */
export function tryDecorate(ctx: PlaceCtx, catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): PlacedObject | null {
  if (ctx.clearance.size || ctx.roads.size) {
    const item = getCatalogItem(catalogId);
    if (item) {
      const { w, h } = getRotatedSize(item, rotation);
      const W = ctx.state.template.width;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        const i = yy * W + xx;
        if (ctx.clearance.has(i) || ctx.roads.has(i)) return null;
        if (ctx.roads.size && insideRoad(ctx, xx, yy)) return null;
      }
    }
  }
  return tryPlace(ctx, catalogId, x, y, rotation);
}

/** Build one PlaceObjectCommand for a catalog item at (x,y). Elevation reads the STANDABLE SURFACE
 *  via the kernel (surfaceElevation), same as the manual placer — so an object on a filleted/patched
 *  cell records the surface it actually sits on, not the raw block tier underneath. */
function placeObjectCommand(ctx: PlaceCtx, catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270): PlaceObjectCommand | null {
  const item = getCatalogItem(catalogId);
  if (!item) return null;
  const obj: PlacedObject = {
    id: generateObjectId(),
    catalogId,
    position: { x, y },
    rotation,
    elevation: surfaceElevation(ctx.state.cells[y]?.[x]?.terrain),
  };
  return objectPlacementCommand(obj);
}

/** A HOUSE's gate: the centre of the edge that is the footprint's BOTTOM at rotation 0, rotated
 *  with the house (90 → the door faces -x, 180 → -y, 270 → +x, matching the sprite/mesh rotation).
 *  Returns the gate cell (on the footprint edge), the approach cell just outside it, and the
 *  3-wide × 2-deep clearance strip covering gate + approach. `r` is the already-ROTATED footprint. */
export function buildingGate(r: { x: number; y: number; w: number; h: number }, rotation: 0 | 90 | 180 | 270 = 0): { gate: MacroCoord; approach: MacroCoord; clear: MacroCoord[] } {
  const x0 = Math.floor(r.x), y0 = Math.floor(r.y);
  const x1 = Math.ceil(r.x + r.w) - 1, y1 = Math.ceil(r.y + r.h) - 1;
  const midX = Math.floor(r.x + r.w / 2), midY = Math.floor(r.y + r.h / 2);
  let gate: MacroCoord, f: [number, number];
  if (rotation === 90) { gate = { x: x0, y: midY }; f = [-1, 0]; }
  else if (rotation === 180) { gate = { x: midX, y: y0 }; f = [0, -1]; }
  else if (rotation === 270) { gate = { x: x1, y: midY }; f = [1, 0]; }
  else { gate = { x: midX, y: y1 }; f = [0, 1]; }
  const approach = { x: gate.x + f[0], y: gate.y + f[1] };
  const perp: [number, number] = [f[1], f[0]];
  const clear: MacroCoord[] = [];
  for (const c of [gate, approach]) for (let k = -1; k <= 1; k++) clear.push({ x: c.x + perp[0] * k, y: c.y + perp[1] * k });
  return { gate, approach, clear };
}

/** A real house (not a 1×1 stall): its gate is a REGULATION anchor. */
export const hasGate = (item: { category: ItemCategory; width: number; height: number }): boolean =>
  item.category === ItemCategory.Building && item.width * item.height >= 4;

/** Attempt a placement through the LIVE rules. On success the object is committed; on any rule
 *  rejection nothing changes (reject-and-skip). Returns the placed object (so
 *  callers can mark/roll-back its footprint without rescanning state.objects), or null on rejection.
 *  Two gate REGULATIONS live here so every placement phase inherits them:
 *  - solid structures (anything but a road/bridge/ramp) may not land on reserved clearance, so a
 *    later stall/facility can never wall off an earlier house's gate or a crossing approach;
 *  - a HOUSE reserves its own gate strip the moment it lands (and sweeps any decor already there),
 *    so everything placed after it keeps the doorstep open for the road spur. */
export function tryPlace(ctx: PlaceCtx, catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): PlacedObject | null {
  const cmd = placeObjectCommand(ctx, catalogId, x, y, rotation);
  if (!cmd) return null;
  const item = getCatalogItem(catalogId)!;
  const W = ctx.state.template.width, H = ctx.state.template.height;
  const coating = isCoating(item);
  const crossing = item.category === ItemCategory.Bridge || item.category === ItemCategory.Ramp;
  // Bulk/generated placement AVOIDS reserved clearance (gates/crossing approaches)
  // and paved roads — it places elsewhere rather than paving over the road network
  // it just laid. (Interactive place_object instead STRIPS a covered road and warns;
  // that trick is intentional for a single, deliberate placement, not a scatter.)
  // Coatings (road over road) and crossings (paved ACROSS) are exempt.
  if (!coating && !crossing && (ctx.clearance.size || ctx.roads.size)) {
    const { w, h } = getRotatedSize(item, rotation);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = yy * W + xx;
      if (ctx.clearance.has(i) || ctx.roads.has(i)) return null;
    }
  }
  if (ctx.execute(cmd).success) {
    if (coating) forEachFootprintCell(cmd.object, (xx, yy) => ctx.roads.add(yy * W + xx));
    if (hasGate(item)) {
      const strip = new Set<number>();
      for (const c of buildingGate(objectRect(cmd.object), rotation).clear) {
        if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) { ctx.clearance.add(c.y * W + c.x); strip.add(c.y * W + c.x); }
      }
      if (strip.size && ctx.sweep !== 'refuse') sweepClearanceCells(ctx, strip);
    }
    return cmd.object;
  }
  return null;
}

/** Final navigation sweep: remove any DECORATION (tree or flora) that intrudes on a reserved
 *  clearance zone, sits on a paved road cell, or ends up INSIDE the road (`insideRoad`).
 *  `tryDecorate` prevents this for every decoration placed AFTER clearance/roads exist; this
 *  catches themed decor (hedges/orchards/garden rings) placed BEFORE a crossing's clearance or a
 *  road was laid around it, including a bed a later loop of pavement grows around into a median.
 *  Deterministic (insertion order). */
export function enforceClearance(ctx: PlaceCtx): void {
  if (!ctx.clearance.size && !ctx.roads.size) return;
  const W = ctx.state.template.width;
  const toRemove: PlacedObject[] = [];
  for (const o of ctx.state.objects.values()) {
    if (o.locked || !isDecoration(o)) continue;
    const r = objectRect(o);
    let hit = false;
    for (let y = Math.floor(r.y); y < r.y + r.h && !hit; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
      const i = y * W + x;
      if (ctx.clearance.has(i) || ctx.roads.has(i) || (ctx.roads.size && insideRoad(ctx, x, y))) { hit = true; break; }
    }
    if (hit) toRemove.push(o);
  }
  for (const o of toRemove) removePlaced(ctx, o);
}

/** Remove a placed object via the command path (used to roll back a crossing that didn't connect). */
export function removePlaced(ctx: PlaceCtx, obj: PlacedObject): void {
  ctx.execute(removeObjectCommand(obj));
}

/** Remove every DECORATION (tree/flora) whose footprint touches `cells`, returning what was removed.
 *  Called the moment a gate/crossing clearance is reserved — themed decor placed EARLIER (garden
 *  rings, seam hedges) would otherwise sit in the approach and block the road routing that follows;
 *  the end-of-run enforceClearance sweep would remove it far too late for the roads. Callers also
 *  un-occupy the freed cells so their pathfinding sees the opened corridor. */
export function sweepClearanceCells(ctx: PlaceCtx, cells: Set<number>): PlacedObject[] {
  const W = ctx.state.template.width;
  const removed: PlacedObject[] = [];
  for (const o of ctx.state.objects.values()) {
    if (o.locked || !isDecoration(o)) continue;
    const r = objectRect(o);
    let hit = false;
    for (let y = Math.floor(r.y); y < r.y + r.h && !hit; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
      if (cells.has(y * W + x)) { hit = true; break; }
    }
    if (hit) removed.push(o);
  }
  for (const o of removed) removePlaced(ctx, o);
  return removed;
}

/** Visit every macro cell of an object's footprint (the one shared rasterizer for footprint marking). */
export function forEachFootprintCell(obj: PlacedObject, visit: (x: number, y: number) => void): void {
  const r = objectRect(obj);
  // Integer CELLS covered by the rect, not the rect's own coordinates: the plaza's rect is
  // fractional (sub-block precision), and a fractional visit becomes a fractional grid index —
  // a Set member no integer lookup ever finds. That is how the road router's network seed came
  // to hold cells no route could reach.
  const x0 = Math.floor(r.x), y0 = Math.floor(r.y), x1 = Math.ceil(r.x + r.w), y1 = Math.ceil(r.y + r.h);
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) visit(xx, yy);
}

/** Whether (x,y) is a buildable/open cell in the placement analysis (in-bounds + open mask encodes
 *  the selected-region restriction). The one shared open-cell test for every placement stage. */
export const openAt = (a: PlacementAnalysis, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < a.width && y < a.height && a.open[y * a.width + x] === 1;

/** Record every footprint cell of a just-placed object into a "x,y" set (settled/occupied tracking). */
export const markCells = (obj: PlacedObject, set: Set<string>): void =>
  forEachFootprintCell(obj, (x, y) => set.add(`${x},${y}`));
