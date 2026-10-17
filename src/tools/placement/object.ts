import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';
import type { Command, GridState, MacroCoord, PlaceObjectCommand, PlacedObject, ValidationResult, Rotation } from '../../core/model/types';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import type { CommandSink } from '../../core/model/command-sink';
import { NEIGHBORS4 } from '../../core/grid/directions';
import { rectsOverlap, cellKey, mapGrid } from '../../core/grid/rect';
import { getCatalogItem, isDecoration } from '../../state/catalog';
import { doorOf, hasGate, objectRect } from '../../state/object-geometry';
import { getRotatedSize } from '../../core/grid/footprint';
import { entriesNear, getObjectIndex } from '../../state/object-index';
import { surfaceElevation } from '../../core/domain/terrain/terrain-surface';
import { hasTrait, isCoating, isSurfacePrint, isCrossing } from '../../core/model/traits';
import type { PlacementAnalysis } from './analysis';
import { generateObjectId } from '../../core/model/object-id';
import { CLEARANCE } from '../../core/game/profile';

/** Context threaded through every placement stage. */
export interface PlaceCtx extends CommandSink {
  registry: RuleDispatcher;
  seed: number;
  /** How winding a road laid in this context may be: 0 rectilinear, 1 organic (the default a bare
   *  map routes at). Read off the map's own pavement by `road-style.ts:readRoadStyle` and turned into
   *  an A* turn cost by `turnPenaltyFor`. Not the shelf's richness knob. */
  naturalness: number;
  /** Cells reserved as navigation clearance around building gates and ramp/bridge ends. All
   *  decorations (trees, flora, facilities) are rejected here — gates and crossing approaches
   *  stay visibly open. Populated by connectRoadNetwork; consumed via `tryDecorate`. */
  clearance: Set<number>;
  /** Cells covered by a surface-coating road, which `tryDecorate` keeps generated decoration off.
   *  Seeded from any roads already on the map; `tryPlace` records every road it lays. */
  roads: Set<number>;
  /** What a clearance-reserving placement does with a decoration already sitting where it just
   *  reserved: a house's own gate strip (`tryPlace`'s `hasGate` branch below), or `road-link.ts`'s
   *  own crossing-end sweep (`realizeCrossings`), which reads this field directly since it never
   *  goes through `tryPlace` for the sweep itself. `remove` (generation's, and the default when
   *  absent) sweeps it — the populator plants before it knows where a door or a crossing will
   *  land, so that is its own mistake to clear. `refuse` (every live-map gesture's) leaves it
   *  standing; the cells are still reserved, so nothing new lands there, but nothing already there
   *  is taken. */
  sweep?: 'remove' | 'refuse';
}

export function makeCtx(
  state: GridState, execute: (c: Command) => ValidationResult, registry: RuleDispatcher, seed: number,
  { naturalness = 1, sweep }: Partial<Pick<PlaceCtx, 'naturalness' | 'sweep'>> = {},
): PlaceCtx {
  const roads = new Set<number>();
  const W = state.template.width;
  for (const o of state.objects.values()) {
    const item = getCatalogItem(o.catalogId);
    if (item && isCoating(item) && !isSurfacePrint(item)) forEachFootprintCell(o, (x, y) => roads.add(y * W + x));
  }
  return { state, execute, registry, seed, naturalness, clearance: new Set(), roads, sweep };
}

/** True when (x, y) reads as part of the street rather than beside it: 2 or more of its four edge
 *  neighbours are paved (`ctx.roads`). One paved side is a curb, which is where the macro grammar's
 *  road border plants — but two or more means the cell sits in a
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

/** Place a decoration through the rules, first refusing any whose footprint meets a reserved
 *  clearance cell (gates and crossing approaches stay open), a paved cell, or a pocket inside the
 *  road (`insideRoad`). The paved test is generator policy and stricter than the rules:
 *  V-PLACE-COATED lets flora stand on a plantable coating (`standsOnCoating`), and generated
 *  decoration still keeps off every road. Infrastructure goes through `tryPlace` and is never gated. */
export function tryDecorate(ctx: PlaceCtx, catalogId: string, x: number, y: number, rotation: Rotation = 0): PlacedObject | null {
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

/** Build one PlaceObjectCommand for a catalog item at (x,y). Elevation reads the standable surface
 *  via the kernel (surfaceElevation), same as the manual placer — so an object on a filleted/patched
 *  cell records the surface it actually sits on, not the raw block tier underneath. */
function placeCommandFor(ctx: Pick<PlaceCtx, 'state'>, catalogId: string, x: number, y: number, rotation: Rotation): PlaceObjectCommand | null {
  const item = getCatalogItem(catalogId);
  if (!item) return null;
  const obj: PlacedObject = {
    id: generateObjectId(),
    catalogId,
    position: { x, y },
    rotation,
    elevation: surfaceElevation(ctx.state.cells[y]?.[x]?.terrain),
  };
  return placeObjectCommand(obj);
}

/** Validate and read snapped command geometry without applying it or reserving navigation space. */
export function probePlacement(ctx: Pick<PlaceCtx, 'state' | 'registry'>, catalogId: string, x: number, y: number): PlacedObject | null {
  const cmd = placeCommandFor(ctx, catalogId, x, y, 0);
  if (!cmd) return null;
  const landed = ctx.registry.resolve(cmd, ctx.state);
  return ctx.registry.validatePreCommand(landed, ctx.state).length === 0 ? landed.object : null;
}

/** A house's gate (`state/object-geometry.ts:doorOf`): the door cell on the footprint edge, the
 *  approach cell just outside it, and the gate strip (`CLEARANCE`) running out from the door. `r` is
 *  the already-ROTATED footprint. */
export function buildingGate(
  r: { x: number; y: number; w: number; h: number }, rotation: Rotation = 0,
): { gate: MacroCoord; approach: MacroCoord; clear: MacroCoord[] } {
  const { gate, facing } = doorOf(r, rotation);
  const f: [number, number] = [facing.x, facing.y];
  const approach = { x: gate.x + f[0], y: gate.y + f[1] };
  const perp: [number, number] = [f[1], f[0]];
  const clear: MacroCoord[] = [];
  const half = (CLEARANCE.gateStripWidth - 1) / 2;
  for (let d = 0; d < CLEARANCE.gateStripDepth; d++) {
    const c = { x: gate.x + f[0] * d, y: gate.y + f[1] * d };
    for (let k = -half; k <= half; k++) clear.push({ x: c.x + perp[0] * k, y: c.y + perp[1] * k });
  }
  return { gate, approach, clear };
}

/** Attempt a placement through the live rules. On success the object is committed; on any rule
 *  rejection nothing changes (reject-and-skip). Returns the placed object (so
 *  callers can mark/roll-back its footprint without rescanning state.objects), or null on rejection.
 *  Two gate regulations live here so every placement phase inherits them:
 *  - solid structures (anything but a road/bridge/ramp) may not land on reserved clearance, so a
 *    later stall/facility can never wall off an earlier house's gate or a crossing approach;
 *  - a house reserves its own gate strip the moment it lands (and sweeps any decor already there),
 *    so everything placed after it keeps the doorstep open for the road spur. */
export function tryPlace(ctx: PlaceCtx, catalogId: string, x: number, y: number, rotation: Rotation = 0): PlacedObject | null {
  const cmd = placeCommandFor(ctx, catalogId, x, y, rotation);
  if (!cmd) return null;
  const item = getCatalogItem(catalogId)!;
  const W = ctx.state.template.width;
  const { inB, idx } = mapGrid(W, ctx.state.template.height);
  const coating = isCoating(item);
  const crossing = isCrossing(item);
  // Bulk/generated placement avoids reserved clearance (gates/crossing approaches)
  // and paved roads — it places elsewhere rather than paving over the road network
  // it just laid. (Interactive place_object instead strips a covered road and warns;
  // that trick is intentional for a single, deliberate placement, not a scatter.)
  // Coatings (road over road) and crossings (paved across) are exempt.
  if (!coating && !crossing && (ctx.clearance.size || ctx.roads.size)) {
    const { w, h } = getRotatedSize(item, rotation);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = yy * W + xx;
      if (ctx.clearance.has(i) || ctx.roads.has(i)) return null;
    }
  }
  // Bulk paving keeps out of flower beds: a plantable road may stand under flora (the editor's
  // rule for a deliberate hand placement), but a generated network that runs through the beds it
  // just planted reads as an accident, so the generator refuses the cell and routes as if the
  // exemption did not exist.
  if (coating && hasTrait(item, 'plantable')) {
    const rect = { x, y, w: item.width, h: item.height };
    for (const e of entriesNear(getObjectIndex(ctx.state), rect)) {
      if (!e.coating && rectsOverlap(rect, e.rect)) return null;
    }
  }
  if (ctx.execute(cmd).success) {
    // What landed: a bridge or ramp resolves its own footprint.
    const landed = ctx.state.objects.get(cmd.object.id)!;
    if (coating && !isSurfacePrint(item)) forEachFootprintCell(landed, (xx, yy) => ctx.roads.add(yy * W + xx));
    if (hasGate(item)) {
      const strip = new Set<number>();
      for (const c of buildingGate(objectRect(landed), rotation).clear) {
        if (inB(c.x, c.y)) { ctx.clearance.add(idx(c.x, c.y)); strip.add(idx(c.x, c.y)); }
      }
      if (strip.size && ctx.sweep !== 'refuse') sweepClearanceCells(ctx, strip);
    }
    return landed;
  }
  return null;
}

/** Lay one pavement tile beneath a standing building, through the live rules. Unlike `tryPlace`, it
 *  may lay a plantable surface under the building: a floor is not a bed. */
export function placeFloorTile(ctx: PlaceCtx, catalogId: string, x: number, y: number): PlacedObject | null {
  const cmd = placeCommandFor(ctx, catalogId, x, y, 0);
  if (!cmd || !ctx.execute(cmd).success) return null;
  ctx.roads.add(y * ctx.state.template.width + x);
  return ctx.state.objects.get(cmd.object.id)!;
}

/** The unlocked decorations whose footprint covers a cell `hit` accepts, in insertion order. */
function decorationsOn(ctx: PlaceCtx, hit: (x: number, y: number) => boolean): PlacedObject[] {
  const out: PlacedObject[] = [];
  for (const o of ctx.state.objects.values()) {
    if (o.locked || !isDecoration(o)) continue;
    const r = objectRect(o);
    scan: for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
      if (hit(x, y)) { out.push(o); break scan; }
    }
  }
  return out;
}

/** Remove a placed object via the command path, as when rolling back a crossing that did not connect. */
export function removePlaced(ctx: PlaceCtx, obj: PlacedObject): void {
  ctx.execute(removeObjectCommand(obj));
}

/** Remove every decoration (tree/flora) whose footprint touches `cells`, returning what was removed.
 *  Called the moment a gate/crossing clearance is reserved — themed decor placed earlier (garden
 *  rings, seam hedges) would otherwise sit in the approach and block the road routing that follows.
 *  Callers also un-occupy the freed cells so their pathfinding sees the opened corridor. */
export function sweepClearanceCells(ctx: PlaceCtx, cells: Set<number>): PlacedObject[] {
  const W = ctx.state.template.width;
  const removed = decorationsOn(ctx, (x, y) => cells.has(y * W + x));
  for (const o of removed) removePlaced(ctx, o);
  return removed;
}

/** Visit every macro cell of an object's footprint (the one shared rasterizer for footprint marking). */
export function forEachFootprintCell(obj: PlacedObject, visit: (x: number, y: number) => void): void {
  const r = objectRect(obj);
  // Integer cells covered by the rect, not the rect's own coordinates: a landmark's rect is
  // fractional (sub-block precision), and a fractional visit becomes a fractional grid index, a Set
  // member no integer lookup ever finds.
  const x0 = Math.floor(r.x), y0 = Math.floor(r.y), x1 = Math.ceil(r.x + r.w), y1 = Math.ceil(r.y + r.h);
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) visit(xx, yy);
}

/** Whether (x,y) is a buildable/open cell in the placement analysis (in-bounds + open mask encodes
 *  the selected-region restriction). The one shared open-cell test for every placement stage. */
export const openAt = (a: PlacementAnalysis, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < a.width && y < a.height && a.open[y * a.width + x] === 1;

/** Record every footprint cell of a just-placed object into a "x,y" set (settled/occupied tracking). */
export const markCells = (obj: PlacedObject, set: Set<string>): void =>
  forEachFootprintCell(obj, (x, y) => set.add(cellKey(x, y)));
