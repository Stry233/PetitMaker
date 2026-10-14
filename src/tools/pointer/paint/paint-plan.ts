import { paintTerrainCommand, placeObjectCommand } from '../../../core/model/command-build';
import { TerrainType } from '../../../core/model/types';
import { CellZone, GRASS_ZONE, SAND_ZONE, groundZone, isBuildableZone, isOpenSeaZone, isSeaZone } from '../../../core/game/zones';
import type { EraseTerrainCommand, MacroCell, MacroCoord, PaintTerrainCommand, PlaceObjectCommand } from '../../../core/model/types';
import type { GroundZone } from '../../../core/game/zones';
import { getCell } from '../../../core/model/grid-model';
import { cellKey } from '../../../core/grid/rect';
import { groundCommand } from '../../placement/ground-command';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { PLANET_PROFILE, ELEVATION_MAX } from '../../../core/game/profile';
import type { ContentType } from '../../../state/editing/edit-mode';
import { getCatalogItem } from '../../../state/catalog';
import { generateObjectId } from '../../../core/model/object-id';
import type { ToolContext } from '../runtime/types';
import { paintBleedsOffBuildable } from '../../../rules/zone-restriction';
import { objectBlocksTerrainCell } from '../../../rules/object-blocks-terrain';
import { getObjectIndex } from '../../../state/object-index';

export type { ContentType };

/** One command a paint click issues. */
type PaintPlanCommand = PaintTerrainCommand | EraseTerrainCommand | PlaceObjectCommand;

interface PaintPlan {
  /** In the order the click issues them. Empty with `refused` false means the click has nothing
   *  to do here (a stack already at its cap, a cell already painted this stroke) — a no-op. */
  commands: PaintPlanCommand[];
  /** The click declines a cell outright rather than running out of work: a tile off the grid, on
   *  water, or with no catalog item behind its material. Distinct from a no-op, because the
   *  cursor badges a refusal and stays silent for a no-op. */
  refused: boolean;
  /** Planet-session ground only: some cells fell beyond the canvas edge, where no ground can go. */
  clipped?: boolean;
}

/** The build floor: the selected layer clamped to [1, ELEVATION_MAX]. Paint, ghost colour and the
 *  layer-panel highlight all key off this one clamp. */
export function buildFloor(ctx: ToolContext): number {
  return Math.min(ELEVATION_MAX, Math.max(1, ctx.arming.floor));
}

/** The highest layer a mountain stroke may raise a cell to: the planet profile's `maxLayer` while a
 *  planet's ground is shaped, the map's top layer otherwise. */
export function mountainCeiling(ctx: ToolContext): number {
  return ctx.arming.groundEditable ? PLANET_PROFILE.maxLayer : ELEVATION_MAX;
}

/**
 * Where one mountain cell ends up after a click. The selected layer is the floor:
 *   - a cell below the floor fills up to it            (target = floor);
 *   - a cell already at/above the floor gets one more  (target = existing + 1),
 *     i.e. painting over a mountain stacks it one layer higher;
 * and neither passes `ceiling`. Raise-only: a target at or under `from` leaves the cell as it is.
 */
export function autoStackTarget(from: number, floor: number, ceiling = ELEVATION_MAX): number {
  return Math.min(ceiling, from < floor ? floor : from + 1);
}

/**
 * The one answer to "what commands would a paint click issue over these cells". The click executes
 * `commands` in order; the cursor's pre-click probe validates the first of them. Nothing else may
 * re-derive this, or the badge and the click drift apart.
 *
 * Pure. It reads `ctx.state` and returns commands: it executes nothing, records nothing in the
 * stroke's cell sets, and strips no overlapping coating (a tile click does that on its way to
 * executing — see `placeTileCell`).
 *
 * `alreadyPainted` is the stroke's cell record (`cellKey`), read-only: a cell this stroke already
 * raised is not raised again. Recording cells is the caller's job.
 */
export function planPaint(
  cells: readonly MacroCoord[],
  ctx: ToolContext,
  contentType: ContentType,
  alreadyPainted: ReadonlySet<string>,
): PaintPlan {
  switch (contentType) {
    case 'road': return planTile(cells, ctx, alreadyPainted);
    case 'water': return planWater(cells, ctx);
    case 'mountain':
      return ctx.arming.groundEditable && ctx.arming.planetMaterial === 'sand'
        ? planSand(cells, ctx, alreadyPainted)
        : planMountain(cells, ctx, alreadyPainted);
  }
}

/** Layer 0 in the planet session: sea and sand, a shore rim over either included, are water at layer 0
 *  for the mountain ladder. */
export function isLowGround(cell: MacroCell, ctx: ToolContext): boolean {
  if (!ctx.arming.groundEditable || cell.terrain) return false;
  return !isBuildableZone(groundZone(cell));
}

/**
 * Where a mountain dab's ladder starts on `cell` and the rung it climbs to, for the plan and the
 * layer highlight alike.
 *
 * The structural surface, never the raw elevation: a Γ patch's elevation is its cosmetic fillet
 * tier, so reading it starts the ladder a tier too high, and every rung above the cell's real
 * support is refused for having no base. Water converts, it is not a floor: mountain on water@N
 * yields mountain@N, so the ladder starts at N-1 and its next rung is the PaintTerrain that
 * overwrites the water. In the planet session sea and sand are layer-0 water, converting at rung 0
 * into grass, which is the whole stroke for the cell.
 */
export function mountainRung(
  cell: MacroCell, ctx: ToolContext, floor = buildFloor(ctx), ceiling = mountainCeiling(ctx),
): { from: number; target: number } {
  if (isLowGround(cell, ctx)) return { from: -1, target: 0 };
  const surface = surfaceElevation(cell.terrain);
  const from = cell.terrain?.type === TerrainType.Water ? surface - 1 : surface;
  return { from, target: autoStackTarget(from, floor, ceiling) };
}

const NOTHING_PAINTED: ReadonlySet<string> = new Set();

/** Planet-session layer 0 as one ground command turning every bare cell whose ground (`groundZone`, so
 *  a shore rim reads as the sand or sea under it) `takes` accepts into `zone`; repeats and
 *  `alreadyPainted` cells are skipped. A stroke that lays land reports the cells it asked
 *  for beyond the canvas edge, the planet's size limit, as `clipped`. */
function planGround(
  cells: readonly MacroCoord[], ctx: ToolContext, zone: GroundZone, takes: (zone: CellZone) => boolean,
  alreadyPainted: ReadonlySet<string> = NOTHING_PAINTED,
): PaintPlan {
  const group: MacroCoord[] = [];
  const seen = new Set<string>();
  let clipped = false;
  for (const c of cells) {
    const key = cellKey(c.x, c.y);
    if (alreadyPainted.has(key) || seen.has(key)) continue;
    seen.add(key);
    const cell = getCell(ctx.state.cells, c.x, c.y);
    if (!cell) { clipped ||= !isOpenSeaZone(zone); continue; }
    if (!cell.terrain && takes(groundZone(cell))) group.push(c);
  }
  return { commands: group.length ? [groundCommand(group, zone)] : [], refused: false, clipped };
}

/** Planet-session sand: one flat layer on bare sea or grass. It never stacks, so sand already there
 *  and any mountain are skipped. */
const planSand = (cells: readonly MacroCoord[], ctx: ToolContext, alreadyPainted: ReadonlySet<string>): PaintPlan =>
  planGround(cells, ctx, SAND_ZONE, (z) => isSeaZone(z) || isBuildableZone(z), alreadyPainted);

/**
 * The layer one water cell is painted at, shared by the click, its cursor probe (`canActAt`) and the
 * layer-panel highlight.
 *
 * Automatic (the default): the cell's own standable surface through the silhouette kernel, so a
 * bevelled Γ corner reads its real support, and a stroke lays water on each terrace it crosses.
 *
 * Pinned (a layer chosen in the panel): that layer wherever the ground supports it (V-WTR-01: water
 * at L needs support at L-1), and the cell's own surface where the pin would float, so a pinned lake
 * runs on as ground water between terraces. A pinned cell refused for another reason (an object, a
 * locked layer) is skipped, not moved.
 */
export function waterLayerAt(coord: MacroCoord, ctx: ToolContext): number {
  const surface = surfaceElevation(getCell(ctx.state.cells, coord.x, coord.y)?.terrain);
  if (!ctx.arming.layerPinned) return surface;
  // A pin never lifts water past the ceiling a planet session holds its ground to.
  const pinned = Math.min(ctx.arming.floor, Math.max(surface, mountainCeiling(ctx)));
  return surface >= pinned - 1 ? pinned : surface;
}

/** Water paints at `waterLayerAt` per cell, one command per layer the footprint crosses, so a dab
 *  across a cliff lays water on both sides at their own heights. No stacking and no per-cell
 *  skipping (repainting water is idempotent). Off-grid cells are dropped first: `getCell` returns
 *  null for them and V-WTR-01 would refuse the whole command for them. In the planet session water
 *  is a ground pond, and cells it cannot take (`pondCells`) are left out without a refusal. */
function planWater(cells: readonly MacroCoord[], ctx: ToolContext): PaintPlan {
  const byLayer = new Map<number, MacroCoord[]>();
  const candidates = cells.filter((c) => getCell(ctx.state.cells, c.x, c.y) !== null);
  for (const c of ctx.arming.groundEditable ? pondCells(candidates, ctx) : candidates) {
    const layer = waterLayerAt(c, ctx);
    const group = byLayer.get(layer);
    if (group) group.push(c);
    else byLayer.set(layer, [c]);
  }
  return {
    commands: [...byLayer].map(([elevation, group]) => paintTerrainCommand(group, TerrainType.Water, elevation)),
    refused: false,
  };
}

/** A single-cell water paint at the layer the planner would give `c`. */
const waterAt = (c: MacroCoord, ctx: ToolContext): PaintTerrainCommand => paintTerrainCommand([c], TerrainType.Water, waterLayerAt(c, ctx));

const refusals = (cmd: PaintTerrainCommand, ctx: ToolContext) => ctx.registry.validatePreCommand(cmd, ctx.state);

/** Whether a planet-session pond can take `cell`: bare grass at layer 0 or a pond already there,
 *  never sand, a shore rim, sea or raised ground. */
const layerZeroGrass = (cell: MacroCell): boolean =>
  isBuildableZone(cell.zone) && (!cell.terrain || (cell.terrain.type === TerrainType.Water && surfaceElevation(cell.terrain) === 0));

/** Refinement rounds before the per-cell fallback; each round removes the refused cells its errors name. */
const POND_ROUNDS = 3;

/**
 * The cells of a planet-session water stroke a pond can take: layer-0 grass (`layerZeroGrass`) that the
 * pre-command rules accept water on, which keeps it off the landmark and away from the coast its
 * half-cell bleed would reach.
 *
 * The two refusals a coast or the landmark causes are decided per cell first, by the rules' own
 * tests (`paintBleedsOffBuildable`, `objectBlocksTerrainCell`), so the whole stroke is then asked
 * once. Should the rules still refuse it, a refusal names the cells behind it: a refused cell
 * itself, or the body of the object in its way, which a refused cell lies within one cell of. Only
 * the stroke's cells that close to an error are asked one by one before the rest is asked again,
 * and a refusal that names nothing near the stroke falls back to asking every cell.
 */
function pondCells(cells: readonly MacroCoord[], ctx: ToolContext): MacroCoord[] {
  const state = ctx.state;
  const index = getObjectIndex(state);
  let keep = cells.filter((c) => layerZeroGrass(getCell(state.cells, c.x, c.y)!)
    && !paintBleedsOffBuildable(state, c) && !objectBlocksTerrainCell(index, c.x, c.y, false));
  const first = keep[0];
  if (!first) return keep;
  const layer = waterLayerAt(first, ctx);
  const single = (c: MacroCoord) => refusals(waterAt(c, ctx), ctx).length === 0;
  if (!keep.every((c) => waterLayerAt(c, ctx) === layer)) return keep.filter(single);
  for (let round = 0; round < POND_ROUNDS; round++) {
    const errors = refusals({ ...waterAt(first, ctx), cells: keep }, ctx);
    if (errors.length === 0) return keep;
    const near = new Set<string>();
    for (const e of errors) for (const c of e.cells) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near.add(cellKey(Math.floor(c.x) + dx, Math.floor(c.y) + dy));
    }
    const refused = new Set(keep.filter((c) => near.has(cellKey(c.x, c.y)) && !single(c)).map((c) => cellKey(c.x, c.y)));
    if (refused.size === 0) break;
    keep = keep.filter((c) => !refused.has(cellKey(c.x, c.y)));
    if (keep.length === 0) return keep;
  }
  return keep.filter(single);
}

/**
 * Mountain auto-stacks, and it walks there: one PaintTerrain per level from 1 up to the tallest
 * target, each carrying the cells that pass through that level. The no-floating rule (V-MTN-02)
 * forbids skipping layers, so every step finds its cells at lvl-1 before setting them to lvl; the
 * post-stroke 3x3 rule (V-MTN-03) caps an unsupported N>=4 result and reverts the excess.
 *
 * The probe must therefore ask about the first command, never the final target: on fresh ground
 * under a floor of 2 or more the target alone is a floating block, which the click never asks for.
 */
function planMountain(
  cells: readonly MacroCoord[], ctx: ToolContext, alreadyPainted: ReadonlySet<string>,
): PaintPlan {
  const floor = buildFloor(ctx);
  const ceiling = mountainCeiling(ctx);
  const seen = new Set<string>();
  const toRaise: { c: MacroCoord; from: number; target: number }[] = [];
  let maxTarget = 0;
  let clipped = false;
  for (const c of cells) {
    const key = cellKey(c.x, c.y);
    if (alreadyPainted.has(key) || seen.has(key)) continue;
    seen.add(key);
    const cell = getCell(ctx.state.cells, c.x, c.y);
    // Off the grid: `getCell` returns null, and no rule will ever let this cell stand. Left in, it
    // rides into whatever level command reaches elevation > 1 and V-MTN-02 refuses the whole batch
    // for it — the in-bounds cells lose to a neighbour they never touched, and (since a brush dab
    // never retries per cell) a brush stroke along the border would silently paint nothing above
    // layer 1. Dropping it here keeps a batch's cost, and its fate, tied to what could ever legally
    // land on the map.
    if (!cell) { clipped ||= ctx.arming.groundEditable; continue; }
    const { from, target } = mountainRung(cell, ctx, floor, ceiling);
    if (from < target) {
      toRaise.push({ c, from, target });
      if (target > maxTarget) maxTarget = target;
    }
  }
  const commands: PaintPlanCommand[] = [];
  const first = ctx.arming.groundEditable ? 0 : 1;
  for (let lvl = first; lvl <= maxTarget; lvl++) {
    const group = toRaise.filter((r) => r.from < lvl && lvl <= r.target).map((r) => r.c);
    if (group.length === 0) continue;
    commands.push(lvl === 0 ? groundCommand(group, GRASS_ZONE) : paintTerrainCommand(group, TerrainType.Mountain, lvl));
  }
  return { commands, refused: false, clipped };
}

/** A tile is an object placement, one per cell, standing on the cell's own surface. */
function planTile(
  cells: readonly MacroCoord[], ctx: ToolContext, alreadyPainted: ReadonlySet<string>,
): PaintPlan {
  const item = getCatalogItem(ctx.arming.tileMaterial);
  const commands: PaintPlanCommand[] = [];
  const seen = new Set<string>();
  let refused = false;
  for (const c of cells) {
    const key = cellKey(c.x, c.y);
    if (alreadyPainted.has(key) || seen.has(key)) continue;
    seen.add(key);
    const cell = getCell(ctx.state.cells, c.x, c.y);
    if (!item || !cell || cell.terrain?.type === TerrainType.Water) {
      refused = true;
      continue;
    }
    commands.push(placeObjectCommand({
        id: generateObjectId(),
        catalogId: item.id,
        position: c,
        rotation: item.rotatable ? ctx.arming.placementRotation : 0,
        // The structural surface, never the raw elevation: a Γ patch's cosmetic tier is one
        // higher than what it actually rests on, so a tile coated over a fillet corner would
        // otherwise record itself standing on the fillet's tier rather than the surface it coats.
        elevation: surfaceElevation(cell.terrain),
      }));
  }
  return { commands, refused };
}
