/**
 * V-PLACE-DOOR: a house's door faces level ground (pre-command).
 *
 * In front of a door (`state/object-geometry.ts:doorGroundRect`, depths from
 * `core/game/profile.ts:DOOR`) the ground keeps the house's layer on land to the drop depth, and
 * neither rises above it nor holds water nearer than the rise depth. Placing or turning a house is refused where
 * that fails; a terrain or ground edit is refused where it leaves a standing house's doorstep
 * broken.
 */
import {
  CommandType,
  TerrainType,
  type GridState,
  type MacroCell,
  type PaintTerrainCommand,
  type EraseTerrainCommand,
  type Rotation,
} from '../core/model/types';
import { clearsTerrain, createDefaultTerrainCell, getCell } from '../core/model/grid-model';
import { cellKey, type Rect } from '../core/grid/rect';
import { bodyEvidence, footprintCells, terrainCellsUnder } from '../core/grid/footprint';
import { realSurface } from '../core/domain/terrain/terrain-surface';
import { groundZone, isLandZone } from '../core/game/zones';
import { DOOR } from '../core/game/profile';
import { getCatalogItem } from '../state/catalog';
import { doorGroundRect, hasGate, objectElevation, objectRect } from '../state/object-geometry';
import { entriesNear, getObjectIndex } from '../state/object-index';
import { definePreRule } from './define';
import type { RuleMessageKey } from './messages';

/** A map cell by its index, or null off the map. */
type CellAt = (x: number, y: number) => MacroCell | null;

/** What is wrong with the ground along a house's door side, or null when it holds: a `drop` (ground
 *  below `level`, sea or the map edge) within `DOOR.dropDepth`, or a `rise` (ground above `level`, or
 *  water) within `DOOR.riseDepth`. `rect` is the turned footprint. */
function doorFault(cellAt: CellAt, rect: Rect, rotation: Rotation, level: number): DoorFault | null {
  const near = doorGroundRect(rect, rotation, DOOR.dropDepth);
  for (const c of footprintCells(near.x, near.y, near.w, near.h)) {
    const cell = cellAt(c.x, c.y);
    if (!cell || !isLandZone(groundZone(cell))) return 'drop';
  }
  // The map's edge is the placement cells' to report: a terrain cell past it only half overlaps
  // the strip, over ground the map does not hold.
  for (const c of terrainCellsUnder(near)) {
    const cell = cellAt(c.x, c.y);
    if (cell && (realSurface(cell.terrain)?.elevation ?? 0) < level) return 'drop';
  }
  for (const c of terrainCellsUnder(doorGroundRect(rect, rotation, DOOR.riseDepth))) {
    const surface = realSurface(cellAt(c.x, c.y)?.terrain);
    if (surface?.type === TerrainType.Water || (surface?.elevation ?? 0) > level) return 'rise';
  }
  return null;
}

type DoorFault = 'drop' | 'rise';

/** The refusal for each fault: its message, the depth it names and the strip it marks. */
const FAULTS = {
  drop: { message: 'error.door_near_drop', depth: DOOR.dropDepth },
  rise: { message: 'error.door_near_rise', depth: DOOR.riseDepth },
} as const satisfies Record<DoorFault, { message: RuleMessageKey; depth: number }>;

/** The map as it reads once `cmd` has applied, for the cells it names. */
function afterTerrain(state: GridState, cmd: PaintTerrainCommand | EraseTerrainCommand): CellAt {
  const touched = new Set(cmd.cells.map((c) => cellKey(c.x, c.y)));
  const terrain = cmd.type === CommandType.EraseTerrain || clearsTerrain(cmd) ? null : createDefaultTerrainCell(cmd.terrainType, cmd.elevation);
  return (x, y) => {
    const cell = getCell(state.cells, x, y);
    if (!cell || !touched.has(cellKey(x, y))) return cell;
    return cmd.ground === undefined ? { ...cell, terrain } : { zone: cmd.ground, terrain };
  };
}

/** How far past a footprint a door's strip reaches, in whole cells, with the half-cell terrain offset. */
const STRIP_REACH = Math.ceil(Math.max(DOOR.dropDepth, DOOR.riseDepth)) + 1;

export const doorGroundRule = definePreRule({
  id: 'V-PLACE-DOOR',
  appliesTo: [CommandType.PlaceObject, CommandType.PaintTerrain, CommandType.EraseTerrain],

  validate(cmd, state, fail) {
    const now: CellAt = (x, y) => getCell(state.cells, x, y);
    const refuse = (fault: DoorFault, rects: Rect[]) =>
      [fail(FAULTS[fault].message, bodyEvidence(rects), { messageParams: { n: FAULTS[fault].depth } })];
    if (cmd.type === CommandType.PlaceObject) {
      const item = getCatalogItem(cmd.object.catalogId);
      if (!item || !hasGate(item)) return [];
      const rect = objectRect(cmd.object, item);
      const fault = doorFault(now, rect, cmd.object.rotation, objectElevation(state, cmd.object));
      return fault ? refuse(fault, [doorGroundRect(rect, cmd.object.rotation, FAULTS[fault].depth)]) : [];
    }

    if (cmd.cells.length === 0) return [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cmd.cells) {
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y);
    }
    const near = entriesNear(getObjectIndex(state), {
      x: x0 - STRIP_REACH, y: y0 - STRIP_REACH, w: x1 - x0 + 2 * STRIP_REACH + 1, h: y1 - y0 + 2 * STRIP_REACH + 1,
    });
    const after = afterTerrain(state, cmd);
    const broken = new Map<DoorFault, Rect[]>();
    for (const e of near) {
      if (!e.item || !hasGate(e.item)) continue;
      const rect = objectRect(e.obj, e.item);
      const level = objectElevation(state, e.obj);
      const fault = doorFault(after, rect, e.obj.rotation, level);
      if (fault) broken.set(fault, [...(broken.get(fault) ?? []), doorGroundRect(rect, e.obj.rotation, FAULTS[fault].depth)]);
    }
    return [...broken].flatMap(([fault, rects]) => refuse(fault, rects));
  },
});
