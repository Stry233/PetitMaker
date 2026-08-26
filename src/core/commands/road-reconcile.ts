/**
 * Roads follow the surface they coat (the game's Road Auto-Elevation rule).
 *
 * A road is a decal, not a block: when the terrain under its footprint changes, a footprint that
 * is uniform again at some level carries the road to that level — up under a mountain paint, down
 * under an erase — and a footprint left mixed (a cliff edge) or wet removes the road, because a
 * deck half on layer n and half on n+1 would float. `commitStroke` runs this pass over whatever a
 * stroke changed, so every path that edits terrain — brush, eraser, macros, agent tools — keeps
 * the invariant without knowing about it.
 *
 * The catalog questions arrive as injected lookups (`RoadLookup`, `LoadValueLookup`), the same
 * move as `RuleDispatcher`: the answers live above `core`.
 */
import { CommandType, TerrainType } from '../model/types';
import type {
  Command,
  Corners,
  GridState,
  MacroCoord,
  PlacedObject,
  PlaceObjectCommand,
  RemoveObjectCommand,
  ValidationError,
  ValidationResult,
} from '../model/types';
import { getCell, cellKey } from '../model/grid-model';
import { surfaceElevation } from '../edge-cut/terrain-silhouette';
import type { LoadValueLookup, RoadLookup } from '../model/road-lookup';

/** Command sink + the two catalog answers the pass needs — satisfied by CommandExecutor. */
export interface RoadReconcileTarget {
  execute(cmd: Command): ValidationResult;
  /** Pre-command validation WITHOUT executing or emitting: a refused re-place is this pass's
   *  ordinary removal branch, not an error anyone should be toasted about. */
  validatePre(cmd: Command): ValidationError[];
  roadAt: RoadLookup;
  loadValueOf: LoadValueLookup;
}

/** The 2x2 terrain footprint a road at (x, y) coats — the same cells the flat trait checks
 *  (the dual-grid −0.5 shift makes a 1x1 macro road overlap four terrain cells). */
function footprint(x: number, y: number): MacroCoord[] {
  return [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
}

/** The single dry level the footprint stands at, or null where it is mixed or wet. Read through
 *  the STRUCTURAL surface, not raw `terrain.elevation`: a neighbouring paint can fillet a footprint
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

/** The PlaceObject that re-seats `road` at its anchor's current surface. */
function reseatCommand(state: GridState, road: PlacedObject, target: RoadReconcileTarget): PlaceObjectCommand {
  const cell = getCell(state.cells, road.position.x, road.position.y);
  const candidate: PlacedObject = {
    id: road.id,
    catalogId: road.catalogId,
    position: { x: road.position.x, y: road.position.y },
    rotation: road.rotation,
    elevation: surfaceElevation(cell?.terrain),
    ...(road.corners ? { corners: [...road.corners] as Corners } : {}),
  };
  return {
    type: CommandType.PlaceObject, timestamp: Date.now(),
    object: candidate, loadValue: target.loadValueOf(road.catalogId),
  };
}

/**
 * Re-seat every road whose footprint a change touched: settled roads are left alone; the rest are
 * removed and re-placed at their anchor cell's new surface, which the pre-command rules accept
 * (the road rides to the new level) or refuse (mixed or wet ground — the road stays removed).
 *
 * `settleOnly` is the PER-COMMAND variant, run while a stroke is still travelling so both the ride
 * and the removal are seen in real time. Every mid-stroke state is judged as if the stroke ended
 * there, against the pre-stroke road as the base: a road standing illegally NOW is removed now,
 * and it returns the moment the evolving ground makes it legal again — the intra-stroke sequence
 * is not a real sequence of steps.
 *
 * `removedPool` is that base memory: a settle removal parks the road there, and either pass
 * re-seats a parked road the moment its footprint stands uniform again — so a stroke that clears
 * a whole slab shows the road drop to the new ground while still travelling. The caller owns the
 * pool and empties it when the stroke commits, which is when a still-parked road's removal
 * becomes final.
 */
export function reconcileRoads(
  changedCells: readonly MacroCoord[], state: GridState, target: RoadReconcileTarget,
  opts: { settleOnly?: boolean; removedPool?: Map<string, PlacedObject> } = {},
): void {
  // Parked roads first: the ground under one may just have settled back to uniform. A parked
  // road whose cell has been COATED since is superseded — the stroke paved something new there,
  // and re-seating the old road under it would stack two coatings on one cell.
  if (opts.removedPool) {
    for (const [id, parked] of [...opts.removedPool]) {
      if (state.objects.has(id)) { opts.removedPool.delete(id); continue; } // restored by an undo/rollback
      if (target.roadAt(parked.position.x, parked.position.y)) { opts.removedPool.delete(id); continue; }
      if (footprintLevel(state, parked) === null) continue;
      const place = reseatCommand(state, parked, target);
      if (target.validatePre(place).length === 0 && (target.execute(place) as ValidationResult).success) {
        opts.removedPool.delete(id);
      }
    }
  }

  // A changed terrain cell (x, y) sits in the footprint of at most four road anchors. Roads are
  // collected fully before any mutation: execute() rewrites state.objects in place.
  const seen = new Set<string>();
  const affected: PlacedObject[] = [];
  for (const c of changedCells) {
    for (const [ax, ay] of [[c.x, c.y], [c.x - 1, c.y], [c.x, c.y - 1], [c.x - 1, c.y - 1]] as const) {
      const road = target.roadAt(ax, ay);
      if (!road || seen.has(road.id)) continue;
      const key = cellKey(road.position.x, road.position.y);
      if (key !== cellKey(ax, ay)) continue; // covers the queried cell from another anchor; its own turn comes
      seen.add(road.id);
      affected.push(road);
    }
  }

  for (const road of affected) {
    const level = footprintLevel(state, road);
    if (level === road.elevation) continue;

    // Probed with the old road still standing (a coating never blocks a coating), so a swap that
    // cannot land removes cleanly instead of half-moving.
    const place = reseatCommand(state, road, target);
    const placeable = level !== null && target.validatePre(place).length === 0;

    const remove: RemoveObjectCommand = {
      type: CommandType.RemoveObject, timestamp: Date.now(),
      objectId: road.id, removedObject: road,
    };
    if (!target.execute(remove).success) continue; // a locked road is not this pass's to move
    if (placeable) target.execute(place);
    else if (opts.settleOnly) opts.removedPool?.set(road.id, road);
    // else: the road stays removed (a cliff edge or water — the no-floating rule).
  }
}
