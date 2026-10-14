/**
 * Roads follow the surface they coat (the game's Road Auto-Elevation rule).
 *
 * A road is a decal, not a block: when the terrain under its footprint changes, a footprint that
 * is uniform again at some level carries the road to that level — up under a mountain paint, down
 * under an erase — and a footprint left mixed (a cliff edge) or wet removes the road, because a
 * deck half on layer n and half on n+1 would float. The terrain stroke policy (`stroke-policy.ts`)
 * runs this pass over whatever a stroke changed, so every path that edits terrain — brush, eraser, macros, agent tools — keeps
 * the invariant without knowing about it.
 *
 * The paved-cell question arrives as an injected `RoadLookup`, the same move as `RuleDispatcher`:
 * the answer lives above `core`.
 */
import { placeObjectCommand, removeObjectCommand } from '../../model/command-build';
import { TerrainType } from '../../model/types';
import type { GridState, MacroCoord, PlacedObject, PlaceObjectCommand } from '../../model/types';
import { clonePlacedObject, getCell } from '../../model/grid-model';
import { cellKey } from '../../grid/rect';
import { cellSet } from '../../grid/grids';
import { cellsCovering } from '../../grid/grid-convert';
import { terrainCellsUnder } from '../../grid/footprint';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../game/profile';
import { surfaceElevation } from '../terrain/terrain-surface';
import type { RoadLookup } from '../../model/road-lookup';
import type { StrokeKernel } from '../../model/stroke-policy';

/** The terrain cells a road at (x, y) coats: the cells its one-cell footprint rests on, the same
 *  cells the flat trait checks. */
function footprint(x: number, y: number): MacroCoord[] {
  return terrainCellsUnder({ x, y, w: 1, h: 1 });
}

/** The road anchors whose footprint rests on terrain cell `c`. */
function anchorsOver(c: MacroCoord): MacroCoord[] {
  return cellsCovering([cellSet(TERRAIN_GRID, [c])], PLACEMENT_GRID);
}

/** The single dry level the footprint stands at, or null where it is mixed or wet. Read through
 *  the structural surface, not raw `terrain.elevation`: a neighbouring paint can fillet a footprint
 *  corner into a Γ patch without changing what it structurally rests on, and a raw read would see
 *  that cosmetic tier as a real change and re-place the road a tier too high. */
function footprintLevel(state: GridState, road: PlacedObject): number | null {
  let level: number | null = null;
  for (const c of footprint(road.position.x, road.position.y)) {
    const cell = getCell(state.cells, c.x, c.y);
    if (cell?.terrain?.type === TerrainType.Water) return null;
    const e = surfaceElevation(cell?.terrain);
    if (level === null) level = e;
    else if (e !== level) return null;
  }
  return level;
}

/** The PlaceObject that re-seats `road`, every field kept, at its anchor's current surface. */
function reseatCommand(state: GridState, road: PlacedObject): PlaceObjectCommand {
  const cell = getCell(state.cells, road.position.x, road.position.y);
  return placeObjectCommand({ ...clonePlacedObject(road), elevation: surfaceElevation(cell?.terrain) });
}

/**
 * Re-seat every road whose footprint a change touched: unsettled roads are removed and re-placed at
 * their anchor cell's new surface, which the pre-command rules accept (the road rides to the new
 * level) or refuse (mixed or wet ground; it stays removed).
 *
 * `settleOnly` runs per command mid-stroke, judging each intermediate state as if the stroke ended
 * there against the pre-stroke road. A settle removal parks the road in `removedPool`, and either
 * pass re-seats it once its footprint is uniform again, so a cleared slab shows the road drop while
 * the stroke travels. The caller empties the pool at commit, making a parked road's removal final.
 */
export function reconcileRoads(
  changedCells: readonly MacroCoord[], kernel: StrokeKernel, roadAt: RoadLookup,
  opts: { settleOnly?: boolean; removedPool?: Map<string, PlacedObject> } = {},
): void {
  const state = kernel.state;
  // Re-placement validates against every layer, preserving an independent coating at the same cell.
  if (opts.removedPool) {
    for (const [id, parked] of [...opts.removedPool]) {
      if (state.objects.has(id)) { opts.removedPool.delete(id); continue; } // restored by an undo/rollback
      if (footprintLevel(state, parked) === null) continue;
      const place = reseatCommand(state, parked);
      if (kernel.validatePre(place).length === 0 && kernel.execute(place).success) {
        opts.removedPool.delete(id);
      }
    }
  }

  // Roads are collected fully before any mutation: execute() rewrites state.objects in place.
  const seen = new Set<string>();
  const affected: PlacedObject[] = [];
  for (const c of changedCells) {
    for (const { x: ax, y: ay } of anchorsOver(c)) {
      const roads = roadAt.coatingsAt?.(ax, ay) ?? [roadAt(ax, ay)];
      for (const road of roads) {
        if (!road || seen.has(road.id)) continue;
        const key = cellKey(road.position.x, road.position.y);
        if (key !== cellKey(ax, ay)) continue; // covers the queried cell from another anchor; its own turn comes
        seen.add(road.id);
        affected.push(road);
      }
    }
  }

  for (const road of affected) {
    const level = footprintLevel(state, road);
    if (level === road.elevation) continue;

    // Probed with the old road still standing (a coating never blocks a coating), so a swap that
    // cannot land removes cleanly instead of half-moving.
    const place = reseatCommand(state, road);
    const placeable = level !== null && kernel.validatePre(place).length === 0;

    if (!kernel.execute(removeObjectCommand(road)).success) continue; // a locked road is not this pass's to move
    if (placeable) kernel.execute(place);
    else if (opts.settleOnly) opts.removedPool?.set(road.id, road);
    // else: the road stays removed (a cliff edge or water — the no-floating rule).
  }
}
