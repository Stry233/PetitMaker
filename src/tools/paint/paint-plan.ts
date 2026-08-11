import { CommandType, TerrainType } from '../../core/model/types';
import type { MacroCoord, PaintTerrainCommand, PlaceObjectCommand } from '../../core/model/types';
import { getCell, cellKey } from '../../core/model/grid-model';
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { ELEVATION_MAX } from '../../core/model/constants';
import type { ContentType } from '../../core/model/edit-mode';
import { getCatalogItem } from '../../state/catalog';
import { generateObjectId } from '../utils';
import type { ToolContext } from '../types';

export type { ContentType };

/** One command a paint click issues. */
export type PaintPlanCommand = PaintTerrainCommand | PlaceObjectCommand;

export interface PaintPlan {
  /** In the order the click issues them. Empty with `refused` false means the click has nothing
   *  to do here (a stack already at its cap, a cell already painted this stroke) — a no-op. */
  commands: PaintPlanCommand[];
  /** The click declines a cell outright rather than running out of work: a tile off the grid, on
   *  water, or with no catalog item behind its material. Distinct from a no-op, because the
   *  cursor badges a refusal and stays silent for a no-op. */
  refused: boolean;
}

/** The build floor: the selected layer clamped to [1, ELEVATION_MAX]. Paint, ghost colour and the
 *  layer-panel highlight all key off this one clamp. */
export function buildFloor(ctx: ToolContext): number {
  return Math.min(ELEVATION_MAX, Math.max(1, ctx.elevation));
}

/**
 * Where one mountain cell ends up after a click. The selected layer is the FLOOR:
 *   - a cell below the floor fills up to it            (target = floor);
 *   - a cell already at/above the floor gets one more  (target = existing + 1),
 *     i.e. painting over a mountain stacks it one layer higher.
 * Raise-only.
 */
export function autoStackTarget(from: number, floor: number): number {
  return from < floor ? floor : Math.min(ELEVATION_MAX, from + 1);
}

/**
 * THE one answer to "what commands would a paint click issue over these cells". The click executes
 * `commands` in order; the cursor's pre-click probe validates the first of them. Nothing else may
 * re-derive this, or the badge and the click drift apart.
 *
 * Pure. It reads `ctx.gridState` and returns commands: it executes nothing, records nothing in the
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
    case 'tile': return planTile(cells, ctx, alreadyPainted);
    case 'water': return planWater(cells, ctx);
    case 'mountain': return planMountain(cells, ctx, alreadyPainted);
  }
}

/**
 * The layer ONE water cell is painted at.
 *
 * AUTOMATIC (the default): the cell's OWN standable surface, so a stroke lays water on each terrace
 * it crosses. Read through the silhouette kernel, not raw `terrain.elevation`, so a bevelled Γ
 * corner reads its real support rather than its cosmetic full block.
 *
 * PINNED (a hand chose a layer in the panel): that layer wherever the GROUND REACHES IT, and the
 * cell's own surface where it does not. So one stroke lays the pinned lake across every terrace
 * that can hold it and keeps running as ground water over the low ground between them, instead of
 * breaking into puddles wherever the pin cannot land.
 *
 * The fallback set is exactly V-WTR-01's: water at L needs support at L-1, so a cell below that
 * would FLOAT and could never have taken the pinned layer anyway. A cell that could — including a
 * terrace at L-1, which is where a pinned lake actually sits — keeps the pin, so nothing legal is
 * ever relocated to a layer nobody asked for. A pinned cell the rules refuse for some OTHER reason
 * (an object standing on it, a locked layer) is still skipped rather than moved: the pin is not the
 * problem there, and moving the water would answer a question the user did not ask.
 *
 * Exported so the click, its cursor probe (`canActAt`) and the layer-panel highlight resolve the
 * SAME layer.
 */
export function waterLayerAt(coord: MacroCoord, ctx: ToolContext): number {
  const surface = surfaceElevation(getCell(ctx.gridState.cells, coord.x, coord.y)?.terrain);
  if (!ctx.layerPinned) return surface;
  return surface >= ctx.elevation - 1 ? ctx.elevation : surface;
}

/** Water paints at `waterLayerAt` per cell — ONE command per layer the footprint crosses, so a dab
 *  spanning a cliff lays water on both sides at their own heights instead of losing the whole
 *  footprint to the one elevation that fits neither. A pinned layer resolves most cells to it, but
 *  cells where the pin would float fall back to their own surface, so a pinned footprint can still
 *  split into one command per layer. No stacking, and no per-cell skipping (re-painting a cell
 *  water is idempotent).
 *
 *  A cell outside the grid is dropped first: `getCell` returns null for it, so it can never carry
 *  the water and only ever poisons the batch (V-WTR-01 flags it once its elevation > 1). Left in,
 *  a shape straddling the edge loses the WHOLE command to a refusal that only the off-map cells
 *  earned. */
function planWater(cells: readonly MacroCoord[], ctx: ToolContext): PaintPlan {
  const byLayer = new Map<number, MacroCoord[]>();
  for (const c of cells) {
    if (getCell(ctx.gridState.cells, c.x, c.y) === null) continue;
    const layer = waterLayerAt(c, ctx);
    const group = byLayer.get(layer);
    if (group) group.push(c);
    else byLayer.set(layer, [c]);
  }
  return {
    commands: [...byLayer].map(([elevation, group]) => ({
      type: CommandType.PaintTerrain,
      timestamp: Date.now(),
      cells: group,
      terrainType: TerrainType.Water,
      elevation,
    })),
    refused: false,
  };
}

/**
 * Mountain auto-stacks, and it WALKS there: one PaintTerrain per level from 1 up to the tallest
 * target, each carrying the cells that pass through that level. The no-floating rule (V-MTN-02)
 * forbids skipping layers, so every step finds its cells at lvl-1 before setting them to lvl; the
 * post-stroke 3x3 rule (V-MTN-03) caps an unsupported N>=4 result and reverts the excess.
 *
 * The probe must therefore ask about the FIRST command, never the final target: on fresh ground
 * under a floor of 2 or more the target alone is a floating block, which the click never asks for.
 */
function planMountain(
  cells: readonly MacroCoord[], ctx: ToolContext, alreadyPainted: ReadonlySet<string>,
): PaintPlan {
  const floor = buildFloor(ctx);
  const seen = new Set<string>();
  const toRaise: { c: MacroCoord; from: number; target: number }[] = [];
  let maxTarget = 0;
  for (const c of cells) {
    const key = cellKey(c.x, c.y);
    if (alreadyPainted.has(key) || seen.has(key)) continue;
    seen.add(key);
    const cell = getCell(ctx.gridState.cells, c.x, c.y);
    // Off the grid: `getCell` returns null, and no rule will ever let this cell stand. Left in, it
    // rides into whatever level command reaches elevation > 1 and V-MTN-02 refuses the WHOLE batch
    // for it — the in-bounds cells lose to a neighbour they never touched, and (since a brush dab
    // never retries per cell) a brush stroke along the border would silently paint nothing above
    // layer 1. Dropping it here keeps a batch's cost, and its fate, tied to what could ever legally
    // land on the map.
    if (!cell) continue;
    // The STRUCTURAL surface, never the raw elevation: a Γ patch's elevation is its cosmetic
    // fillet tier, so reading it starts the ladder a tier too high. Every rung above the cell's
    // real support is then refused for having no base — the paint leaves that cell behind, and the
    // patch it could not replace is dropped later, leaving a hole in the middle of the new mass.
    const terrain = cell.terrain;
    const surface = surfaceElevation(terrain);
    // WATER CONVERTS, IT IS NOT A FLOOR: painting mountain on water@N yields mountain@N — the
    // water becomes this layer's terrain — never a block stacked above it. Planning the cell as
    // if its mountain progress were N-1 makes the ladder's next rung N itself, which is the
    // PaintTerrain that overwrites the water; a higher build floor converts and keeps filling.
    const from = terrain?.type === TerrainType.Water ? surface - 1 : surface;
    const target = autoStackTarget(from, floor);
    if (from < target) {
      toRaise.push({ c, from, target });
      if (target > maxTarget) maxTarget = target;
    }
  }
  const commands: PaintPlanCommand[] = [];
  for (let lvl = 1; lvl <= maxTarget; lvl++) {
    const group = toRaise.filter((r) => r.from < lvl && lvl <= r.target).map((r) => r.c);
    if (group.length > 0) {
      commands.push({
        type: CommandType.PaintTerrain,
        timestamp: Date.now(),
        cells: group, terrainType: TerrainType.Mountain, elevation: lvl,
      });
    }
  }
  return { commands, refused: false };
}

/** A tile is an OBJECT placement, one per cell, standing on the cell's own surface. */
function planTile(
  cells: readonly MacroCoord[], ctx: ToolContext, alreadyPainted: ReadonlySet<string>,
): PaintPlan {
  const item = getCatalogItem(ctx.tileMaterial);
  const commands: PaintPlanCommand[] = [];
  const seen = new Set<string>();
  let refused = false;
  for (const c of cells) {
    const key = cellKey(c.x, c.y);
    if (alreadyPainted.has(key) || seen.has(key)) continue;
    seen.add(key);
    const cell = getCell(ctx.gridState.cells, c.x, c.y);
    if (!item || !cell || cell.terrain?.type === TerrainType.Water) {
      refused = true;
      continue;
    }
    commands.push({
      type: CommandType.PlaceObject,
      timestamp: Date.now(),
      object: {
        id: generateObjectId(),
        catalogId: item.id,
        position: c,
        rotation: 0,
        // The STRUCTURAL surface, never the raw elevation: a Γ patch's cosmetic tier is one
        // higher than what it actually rests on, so a tile coated over a fillet corner would
        // otherwise record itself standing on the fillet's tier rather than the surface it coats.
        elevation: surfaceElevation(cell.terrain),
      },
      loadValue: item.loadValue,
    });
  }
  return { commands, refused };
}
