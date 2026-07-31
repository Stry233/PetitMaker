import { TerrainType } from '../../core/model/types';
import type { Corners, GridState, MacroCoord, PlacedObject } from '../../core/model/types';
import type { ToolContext } from '../types';
import { getCell } from '../../core/model/grid-model';
import { getCatalogItem } from '../../state/catalog';
import { isCoating } from '../../core/model/traits';
import { objectPlacementCommand, removeObjectCommand } from '../objects/object-placer';

function isRoad(obj: PlacedObject): boolean {
  const item = getCatalogItem(obj.catalogId);
  return !!item && isCoating(item);
}

// The 2x2 footprint a road at (x,y) sits on (same as the flat trait checks).
function footprint(x: number, y: number): MacroCoord[] {
  return [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
}

function footprintUnchanged(state: GridState, road: PlacedObject): boolean {
  // True if the footprint is uniform at the road's current elevation, no water.
  for (const c of footprint(road.position.x, road.position.y)) {
    const cell = getCell(state.cells, c.x, c.y);
    if (cell?.terrain?.type === TerrainType.Water) return false;
    const elev = cell?.terrain?.elevation ?? 0;
    if (elev !== road.elevation) return false;
  }
  return true;
}

export function reconcileRoadsAfterMountainPaint(paintedCells: MacroCoord[], ctx: ToolContext): void {
  const painted = new Set(paintedCells.map(c => `${c.x},${c.y}`));

  const affected: PlacedObject[] = [];
  for (const [, obj] of ctx.gridState.objects) {
    if (!isRoad(obj)) continue;
    if (footprint(obj.position.x, obj.position.y).some(c => painted.has(`${c.x},${c.y}`))) {
      affected.push(obj);
    }
  }

  // The affected-road list is fully collected before this loop because executeCommand
  // mutates gridState.objects in place; merging collection and mutation into one pass
  // would cause roads inserted/removed mid-iteration to corrupt the traversal.
  for (const road of affected) {
    if (footprintUnchanged(ctx.gridState, road)) continue;

    ctx.executeCommand(removeObjectCommand(road));

    const cell = getCell(ctx.gridState.cells, road.position.x, road.position.y);
    const newElevation = cell?.terrain?.elevation ?? 0;
    const candidate: PlacedObject = {
      id: road.id,
      catalogId: road.catalogId,
      position: { x: road.position.x, y: road.position.y },
      rotation: road.rotation,
      elevation: newElevation,
      ...(road.corners ? { corners: [...road.corners] as Corners } : {}),
    };
    const placeCmd = objectPlacementCommand(candidate);

    const errors = ctx.validateCommand(placeCmd);
    if (errors.length === 0) {
      ctx.executeCommand(placeCmd);
    }
    // else: road stays removed (cliff edge or water).
  }
}
