/**
 * The clearing a generation stands on: every unlocked object and every terrain cell in scope, the
 * map's own landmarks and whatever a caller spares left standing. Clear and Generate share it, so
 * the two buttons under one region control take back exactly the same ground.
 */
import { eraseTerrainCommand, removeObjectCommand, trimTerrainCommand } from '../../../core/model/command-build';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';
import type { MapWriter } from './types';
import { getCell } from '../../../core/model/grid-model';
import { isBuildableZone } from '../../../core/game/zones';
import { buildObjectOccupancy, objectRect } from '../../../state/object-geometry';
import { EMPTY_CORNERS } from '../../../core/model/corners';
import { cellKey } from '../../../core/grid/rect';
import { footprintCells } from '../../../core/grid/footprint';

/** Where a clear reaches, and what it leaves standing there. */
export interface ClearOptions<Spare> {
  /** Restrict to these cells. Absent or null is the whole map, which is what Generate does when no
   *  region is painted. */
  region?: readonly MacroCoord[] | null;
  /** What to leave standing. Clear passes the map's own authorship here, so taking back a
   *  generation never takes what the person made alongside it. */
  spare?: Spare;
}

/**
 * Erase the terrain in scope.
 *
 * Two commands, because two kinds of cell. An erase is refused outside the buildable zone
 * (V-ZONE-01) — nothing may be built on the boundary ring, so nothing there needs erasing — but an
 * auto edge-cut writes cosmetic Γ patches wherever the planet's silhouette turns a corner, and a
 * corner of the planet can sit on a boundary cell. Those patches are terrain a plain erase cannot take,
 * and left behind they survive every clear: a blank map plus a scatter of quarter blocks along the rim,
 * so the next generation starts from ground that still remembers the last one. A patch is cycled off
 * through the door it came in by, a corner edit, which the zone rule does not gate because it adds no
 * mass.
 */
export function clearAllTerrain(
  { state, execute: executeCommand }: MapWriter,
  { region, spare }: ClearOptions<(x: number, y: number) => boolean> = {},
): number {
  const { width, height } = state.template;
  const cells: MacroCoord[] = [];
  const patches: MacroCoord[] = [];
  const occ = buildObjectOccupancy(state);
  const scope = region ?? (function* all() {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) yield { x, y };
  })();

  for (const { x, y } of scope) {
    const cell = getCell(state.cells, x, y);
    if (!cell?.terrain) continue;
    if (occ.has(cellKey(x, y))) continue;
    if (spare?.(x, y)) continue;
    if (isBuildableZone(cell.zone)) cells.push({ x, y });
    else if (cell.terrain.patchOnly) patches.push({ x, y });
  }

  if (cells.length === 0 && patches.length === 0) return 0;

  if (cells.length) {
    executeCommand(eraseTerrainCommand(cells));
  }
  for (const { x, y } of patches) {
    executeCommand(trimTerrainCommand(x, y, [...EMPTY_CORNERS]));
  }
  return cells.length + patches.length;
}

/**
 * Remove every placed object — tiles/road surfaces and placements (buildings,
 * trees, bridges, ramps, …). One RemoveObject command per object (snapshotted
 * first, since executing mutates state.objects). Returns the count removed.
 */
export function clearAllObjects(
  { state, execute: executeCommand }: MapWriter,
  { region, spare }: ClearOptions<(obj: PlacedObject) => boolean> = {},
): number {
  const inRegion = region ? new Set(region.map((c) => cellKey(c.x, c.y))) : null;
  // Footprint intersection, the same membership the marquee and the agent's region lock use: an
  // object whose footprint reaches into the region blocks every terrain paint on those cells
  // (V-PLACE-BLOCK), so a region that regenerates must take it with it, wherever its anchor sits.
  const touchesRegion = (obj: PlacedObject): boolean => {
    if (!inRegion) return true;
    const r = objectRect(obj);
    return footprintCells(r.x, r.y, r.w, r.h).some((c) => inRegion.has(cellKey(c.x, c.y)));
  };
  let count = 0;
  for (const obj of [...state.objects.values()]) {
    if (obj.locked) continue;   // never dissolve immutable structures (the central plaza); V-LOCK-02 also guards this
    if (!touchesRegion(obj)) continue;
    if (spare?.(obj)) continue;
    const res = executeCommand(removeObjectCommand(obj));
    if (res.success) count++;
  }
  return count;
}
