/** How a corner trim lands on the map: the game's meaning of each trim, injected into the kernel's
 *  apply step as its `TrimApplier`. */
import type { TrimApplier } from '../../commands/command-apply';
import { bumpCellsVersion, bumpObjectsVersion, getCell } from '../../model/grid-model';
import { isEmptyCorners, isSquareCorners, copyCorners } from '../../model/corners';
import { TerrainType, type GridState, type MaterialisePatchCommand, type TrimRoadCommand, type TrimTerrainCommand } from '../../model/types';

/**
 * A terrain cell cycled to all-empty corners clears; a patch replaces whatever stood on the cell;
 * a plain cut recuts the terrain there, and a bare ground cell taking a cut becomes a `None` cell
 * that carries the corners. A road cycled to all-empty corners is deleted.
 */
export const applyTrim: TrimApplier = (cmd, state, objectsChanged) => {
  if (cmd.layer === 'road') applyRoadTrim(cmd, state, objectsChanged);
  else if (cmd.patchOnly) applyPatch(cmd, state);
  else applyTerrainTrim(cmd, state);
};

function applyTerrainTrim(cmd: TrimTerrainCommand, state: GridState): void {
  const cell = getCell(state.cells, cmd.x, cmd.y);
  if (!cell) return;
  const square = isSquareCorners(cmd.afterCorners);
  if (isEmptyCorners(cmd.afterCorners)) {
    cell.terrain = null;
  } else if (cell.terrain) {
    // A ground islet cut cycled back to square is plain ground again.
    if (square && cell.terrain.type === TerrainType.None) cell.terrain = null;
    else cell.terrain.corners = square ? undefined : copyCorners(cmd.afterCorners);
  } else if (!square) {
    // A `None` cell reads as ground (realSurface null) but draws rounded grass and the water behind it.
    cell.terrain = { type: TerrainType.None, elevation: 0, corners: copyCorners(cmd.afterCorners) };
  }
  bumpCellsVersion(state);
}

/** The patch's real support is `patchBase` (0 = a fillet straight on the ground, N-1 = it rounds a
 *  real lower block): the trim sets only the corners and this cosmetic column, never a base. */
function applyPatch(cmd: MaterialisePatchCommand, state: GridState): void {
  const cell = getCell(state.cells, cmd.x, cmd.y);
  if (!cell) return;
  if (isEmptyCorners(cmd.afterCorners)) cell.terrain = null;
  else {
    cell.terrain = {
      type: cmd.terrainType, elevation: cmd.elevation, patchOnly: true, corners: copyCorners(cmd.afterCorners),
      ...(cmd.patchBase !== undefined ? { patchBase: cmd.patchBase } : {}),
    };
  }
  bumpCellsVersion(state);
}

function applyRoadTrim(cmd: TrimRoadCommand, state: GridState, objectsChanged: Parameters<TrimApplier>[2]): void {
  const obj = state.objects.get(cmd.objectId);
  if (isEmptyCorners(cmd.afterCorners)) {
    state.objects.delete(cmd.objectId);
    bumpObjectsVersion(state, obj ? { removed: [obj] } : undefined);
    objectsChanged({ removed: [cmd.objectId] });
  } else if (obj) {
    obj.corners = isSquareCorners(cmd.afterCorners) ? undefined : copyCorners(cmd.afterCorners);
    if (cmd.afterRotation !== undefined) obj.rotation = cmd.afterRotation;
    // Edited in place: re-indexed so the entry's rect and coating match the new rotation.
    bumpObjectsVersion(state, { added: [obj] });
    objectsChanged({ removed: [cmd.objectId], added: [obj] });
  }
}
