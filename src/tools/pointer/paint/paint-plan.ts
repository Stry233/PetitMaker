import { mountainLadder, paintTerrainCommand, placeObjectCommand } from '../../../core/model/command-build';
import { TerrainType } from '../../../core/model/types';
import { CellZone, GRASS_ZONE, SAND_ZONE, groundZone, isBuildableZone, isOpenSeaZone, isSeaZone } from '../../../core/game/zones';
import type { EraseTerrainCommand, MacroCell, MacroCoord, PaintTerrainCommand, PlaceObjectCommand } from '../../../core/model/types';
import type { GroundZone } from '../../../core/game/zones';
import { getCell } from '../../../core/model/grid-model';
import { cellKey } from '../../../core/grid/rect';
import { groundCommand } from '../../placement/ground-command';
import { surfaceAt } from '../../macros/terrain/terrain';
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

/** The highest layer a mountain stroke may raise a cell to: the planet profile's `maxLayer` while a
 *  planet's ground is shaped, the map's top layer otherwise. */
function mountainCeiling(ctx: ToolContext): number {
  return ctx.arming.groundEditable ? PLANET_PROFILE.maxLayer : ELEVATION_MAX;
}

/** How many layers one mountain stroke builds or takes: the armed thickness, and one in the planet
 *  session, whose ground is one layer and which offers no thickness. */
export function strokeThickness(ctx: ToolContext): number {
  return ctx.arming.groundEditable ? 1 : ctx.arming.terrainThickness;
}

/** The layer a mountain stroke starting on `start` raises its cells to: `start` plus the stroke's
 *  thickness, never past the ceiling. */
function mountainTop(start: number, ctx: ToolContext): number {
  return Math.min(start + strokeThickness(ctx), mountainCeiling(ctx));
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
 * raised is not raised again. Recording cells is the caller's job. `start` is the surface the stroke
 * started on (`strokeStartAt` of its press); absent, the cells are a fresh press on the first of them.
 */
export function planPaint(
  cells: readonly MacroCoord[],
  ctx: ToolContext,
  contentType: ContentType,
  alreadyPainted: ReadonlySet<string>,
  start?: number,
): PaintPlan {
  const at = (): number => start ?? (cells[0] ? strokeStartAt(cells[0], ctx, contentType) : 0);
  switch (contentType) {
    case 'road': return planTile(cells, ctx, alreadyPainted);
    case 'water': return planWater(cells, ctx, at());
    case 'mountain':
      return ctx.arming.groundEditable && ctx.arming.planetMaterial === 'sand'
        ? planSand(cells, ctx, alreadyPainted)
        : planMountain(cells, ctx, alreadyPainted, at());
  }
}

/** Layer 0 in the planet session: sea and sand, a shore rim over either included, are water at layer 0
 *  for the mountain ladder. */
export function isLowGround(cell: MacroCell, ctx: ToolContext): boolean {
  if (!ctx.arming.groundEditable || cell.terrain) return false;
  return !isBuildableZone(groundZone(cell));
}

/**
 * The layer a mountain on `cell` stands on, which a mountain stroke compares with the surface it
 * started on. The structural surface, never the raw elevation: a Γ patch's elevation is its cosmetic
 * fillet tier, one above what it rests on. Water converts, it is not a floor: mountain on water@N
 * yields mountain@N, so its base is N-1. In the planet session sea and sand stand at -1, so the
 * ground rung (layer 0) turns them into grass.
 */
function mountainBase(cell: MacroCell, ctx: ToolContext): number {
  if (isLowGround(cell, ctx)) return -1;
  const surface = surfaceElevation(cell.terrain);
  return cell.terrain?.type === TerrainType.Water ? surface - 1 : surface;
}

/** The height of the top of the cell at `coord` (its structural surface, 0 for open ground or off
 *  the map): the layer a water stroke or an eraser pressed there works on. */
export function surfaceLayerAt(coord: MacroCoord, ctx: ToolContext): number {
  return Math.max(0, surfaceAt(ctx.state, coord.x, coord.y));
}

/**
 * The surface a stroke pressed at `coord` starts on, which fixes what the whole stroke does, for the
 * plan, its ghost and the layer panel alike: the mountain brush raises the cells standing from it up
 * to `mountainTop`, and the water brush lies at it. The planet editor's ground is its one layer up to
 * the profile's ceiling, so a stroke there always starts below it.
 */
export function strokeStartAt(coord: MacroCoord, ctx: ToolContext, contentType: ContentType = ctx.arming.contentType): number {
  if (contentType !== 'mountain') return surfaceLayerAt(coord, ctx);
  const cell = getCell(ctx.state.cells, coord.x, coord.y);
  const start = cell ? mountainBase(cell, ctx) : 0;
  return ctx.arming.groundEditable ? Math.min(start, mountainCeiling(ctx) - 1) : start;
}

/** The layer the layer panel shows for a stroke started on `start`: the top a mountain stroke builds,
 *  the height water lies at. */
export function strokeShownLayer(start: number, ctx: ToolContext): number {
  return ctx.arming.contentType === 'mountain' ? mountainTop(start, ctx) : start;
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

/** Water lies at the stroke's `layer` on the cells whose surface stands at it, one command for the
 *  footprint; every other cell is left as it is, never refused. Off-grid cells are dropped first:
 *  `getCell` returns null for them and V-WTR-01 would refuse the whole command for them. In the
 *  planet session water is a ground pond, and cells it cannot take (`pondCells`) are left out. */
function planWater(cells: readonly MacroCoord[], ctx: ToolContext, layer: number): PaintPlan {
  const level = cells.filter((c) => getCell(ctx.state.cells, c.x, c.y) !== null && surfaceLayerAt(c, ctx) === layer);
  const group = ctx.arming.groundEditable ? pondCells(level, ctx, layer) : level;
  return { commands: group.length ? [paintTerrainCommand(group, TerrainType.Water, layer)] : [], refused: false };
}

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
function pondCells(cells: readonly MacroCoord[], ctx: ToolContext, layer: number): MacroCoord[] {
  const state = ctx.state;
  const index = getObjectIndex(state);
  let keep = cells.filter((c) => layerZeroGrass(getCell(state.cells, c.x, c.y)!)
    && !paintBleedsOffBuildable(state, c) && !objectBlocksTerrainCell(index, c.x, c.y, false));
  if (keep.length === 0) return keep;
  const waterOn = (on: MacroCoord[]) => paintTerrainCommand(on, TerrainType.Water, layer);
  const single = (c: MacroCoord) => refusals(waterOn([c]), ctx).length === 0;
  for (let round = 0; round < POND_ROUNDS; round++) {
    const errors = refusals(waterOn(keep), ctx);
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
 * Mountain raises every cell whose base (`mountainBase`) stands from the stroke's `start` up to below
 * its top (`mountainTop`) to that top; a cell lower than `start`, or already at the top or higher, is
 * left as it is, so a stroke never stacks and never fills a column under a lower cell. It walks there:
 * one command per level, each carrying the cells that pass through it, since the no-floating rule
 * (V-MTN-02) forbids skipping layers and the post-stroke support rule (V-MTN-03) reverts the highest
 * levels first. The planet session's layer 0 is a ground command turning sea and sand into grass.
 */
function planMountain(
  cells: readonly MacroCoord[], ctx: ToolContext, alreadyPainted: ReadonlySet<string>, start: number,
): PaintPlan {
  const top = mountainTop(start, ctx);
  const seen = new Set<string>();
  const raised: { c: MacroCoord; base: number }[] = [];
  let clipped = false;
  for (const c of cells) {
    const key = cellKey(c.x, c.y);
    if (alreadyPainted.has(key) || seen.has(key)) continue;
    seen.add(key);
    const cell = getCell(ctx.state.cells, c.x, c.y);
    // Off the grid no rule will ever let this cell stand: left in, V-MTN-02 would refuse the whole
    // batch for it, and a freehand dab along the border, which never retries per cell, would lay nothing.
    if (!cell) { clipped ||= ctx.arming.groundEditable; continue; }
    const base = mountainBase(cell, ctx);
    if (base >= start && base < top) raised.push({ c, base });
  }
  const commands: PaintPlanCommand[] = [];
  const ground = start < 0 && top >= 0 ? raised.filter((r) => r.base < 0).map((r) => r.c) : [];
  if (ground.length > 0) commands.push(groundCommand(ground, GRASS_ZONE));
  commands.push(...mountainLadder(raised, (r) => r.c, (r) => r.base, () => top));
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
