/**
 * The terrain stroke policy: roads follow the surface they coat, and edge cuts stay valid, as a
 * stroke lands and when it commits.
 */
import { CommandType, type PlacedObject } from '../../model/types';
import type { RoadLookup } from '../../model/road-lookup';
import type { StrokePolicy } from '../../model/stroke-policy';
import { reconcileCuts } from './cut-reconcile';
import { reconcileRoads } from './road-reconcile';
import { cellsCovering } from '../../grid/grid-convert';
import { TERRAIN_GRID } from '../../game/profile';

/** The terrain policy, with the road lookup it answers paved cells by. */
export interface TerrainStrokePolicy extends StrokePolicy {
  readonly roadAt: RoadLookup;
}

/**
 * A policy over the map `roadAt` answers for. The reconcile passes read terrain from the kernel's
 * map and coatings from the lookup and treat them as one map, so bind both to the same grid.
 *
 * It holds the stroke's parked roads: a road a terrain command lifts mid-stroke waits there and is
 * re-seated the moment its footprint stands uniform again. The pool empties when the stroke ends,
 * which is when a still-parked road's removal becomes final.
 */
export function terrainStrokePolicy(roadAt: RoadLookup): TerrainStrokePolicy {
  const parked = new Map<string, PlacedObject>();
  return {
    roadAt,
    // A road rides the terrain change under it as it happens: the settle-only pass carries a road
    // whose footprint stands uniform at a new level and leaves a mixed one for the commit's full
    // pass (mid-stroke, mixed usually means the stroke has not finished covering the footprint).
    // Edge cuts repair on the same beat, so the map is right under the moving pointer.
    afterCommand(kernel, cmd) {
      if (cmd.type !== CommandType.PaintTerrain && cmd.type !== CommandType.EraseTerrain) return;
      reconcileRoads(cmd.cells, kernel, roadAt, { settleOnly: true, removedPool: parked });
      reconcileCuts(cmd.cells, kernel, roadAt);
    },
    pending: () => parked.size > 0,
    // Road re-places are validated, and revertable, with the stroke.
    beforeValidate(kernel, changed) {
      reconcileRoads(cellsCovering(changed, TERRAIN_GRID), kernel, roadAt, { removedPool: parked });
    },
    endStroke() {
      parked.clear();
    },
    // Cut repairs are legal by construction, so they run after the post-stroke rules, over what
    // the stroke still changed after any revert.
    afterValidate(kernel, changed) {
      reconcileCuts(cellsCovering(changed, TERRAIN_GRID), kernel, roadAt);
    },
  };
}
