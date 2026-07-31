import { CommandType, TerrainType } from '../../core/model/types';
import type { MacroCoord, PaintTerrainCommand, PlaceObjectCommand } from '../../core/model/types';
import { getCell, cellKey } from '../../core/model/grid-model';
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { ELEVATION_MAX } from '../../core/model/constants';
import { getCatalogItem } from '../../state/catalog';
import { useEditorStore } from '../../state/store';
import { generateObjectId } from '../utils';
import type { ToolContext } from '../types';

/** The surface a paint click lays down. Terrain for mountain/water, a coating OBJECT for tile. */
export type ContentType = 'mountain' | 'water' | 'tile';

export type TileMaterial = 'dirt' | 'stone';

const MATERIAL_ITEM: Record<TileMaterial, string> = {
  dirt: 'road-dirt',
  stone: 'road-stone',
};

/** Catalog id for a tile material. `tile-coating` re-exports it for the UI. */
export function tileCatalogId(material: TileMaterial): string {
  return MATERIAL_ITEM[material];
}

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

/** The layer a water click lands on: the CLICKED cell's own standable surface. Read through the
 *  silhouette kernel, not raw `terrain.elevation`, so a bevelled Γ corner reads its real support
 *  rather than its cosmetic full block. Exported so the click (`DrawingTool.onPointerDown`) and its
 *  cursor probe (`canActAt`) resolve the SAME layer. */
export function waterLayerAt(coord: MacroCoord, ctx: ToolContext): number {
  return surfaceElevation(getCell(ctx.gridState.cells, coord.x, coord.y)?.terrain);
}

/** Water paints the whole footprint at the selected layer in one command: no stacking, and no
 *  per-cell skipping (re-painting a cell water is idempotent). */
function planWater(cells: readonly MacroCoord[], ctx: ToolContext): PaintPlan {
  return {
    commands: [{
      type: CommandType.PaintTerrain,
      timestamp: Date.now(),
      cells: cells.slice(),
      terrainType: TerrainType.Water,
      elevation: ctx.elevation,
    }],
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
    const from = getCell(ctx.gridState.cells, c.x, c.y)?.terrain?.elevation ?? 0;
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
  const item = getCatalogItem(tileCatalogId(useEditorStore.getState().tileMaterial));
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
        elevation: cell.terrain?.elevation ?? 0,
      },
      loadValue: item.loadValue,
    });
  }
  return { commands, refused };
}
