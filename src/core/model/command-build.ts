/**
 * The one builder of each command kind. A command carries only what applying it reads; the
 * executor records its pre-images and authorship on the history entry, not on the command.
 */
import {
  CommandType,
  type EraseTerrainCommand,
  type MacroCoord,
  type PaintTerrainCommand,
  type PlaceObjectCommand,
  type PlacedObject,
  type RemoveObjectCommand,
  type Corners,
  type MaterialisePatchCommand,
  type Rotation,
  TerrainType,
  type TrimRoadCommand,
  type TrimTerrainCommand,
} from './types';
import type { GroundZone } from '../game/zones';

/** Paint `cells` with `terrainType` at `elevation`; `ground` turns their zone first. */
export function paintTerrainCommand(
  cells: MacroCoord[], terrainType: TerrainType, elevation: number, ground?: GroundZone,
): PaintTerrainCommand {
  return { type: CommandType.PaintTerrain, cells, terrainType, elevation, ...(ground === undefined ? {} : { ground }) };
}

/** The mountain layers that raise each of `items` from its base to its top, lowest first, each
 *  layer carrying every cell still below it: every layer stands on the one beneath (V-MTN-02 by
 *  construction). A base of 0 is bare ground. */
export function mountainLadder<T>(
  items: Iterable<T>, cellOf: (item: T) => MacroCoord, baseOf: (item: T) => number, topOf: (item: T) => number,
): PaintTerrainCommand[] {
  const list = [...items];
  let low = Infinity, high = -Infinity;
  for (const item of list) {
    low = Math.min(low, baseOf(item) + 1);
    high = Math.max(high, topOf(item));
  }
  const commands: PaintTerrainCommand[] = [];
  for (let level = Math.max(1, low); level <= high; level++) {
    const cells = list.filter((item) => baseOf(item) < level && topOf(item) >= level).map(cellOf);
    if (cells.length > 0) commands.push(paintTerrainCommand(cells, TerrainType.Mountain, level));
  }
  return commands;
}

/** Clear the terrain on `cells`; `ground` turns their zone first. */
export function eraseTerrainCommand(cells: MacroCoord[], ground?: GroundZone): EraseTerrainCommand {
  return { type: CommandType.EraseTerrain, cells, ...(ground === undefined ? {} : { ground }) };
}

/** Place `object` as it stands; the placement traits may snap a copy of it as it resolves. */
export function placeObjectCommand(object: PlacedObject): PlaceObjectCommand {
  return { type: CommandType.PlaceObject, object };
}

/** Remove `object` from the map; its history entry records it for undo. */
export function removeObjectCommand(object: Pick<PlacedObject, 'id'>): RemoveObjectCommand {
  return { type: CommandType.RemoveObject, objectId: object.id };
}

/** Recut the corners of the terrain cell at (x, y). */
export function trimTerrainCommand(x: number, y: number, afterCorners: Corners): TrimTerrainCommand {
  return { type: CommandType.TrimCorners, x, y, layer: 'terrain', afterCorners };
}

/** Lay a cosmetic patch of `terrainType` with `afterCorners` at `elevation` on the cell at (x, y),
 *  over the real support tier `patchBase` when given. */
export function materialisePatchCommand(
  x: number, y: number, afterCorners: Corners,
  patch: { terrainType: TerrainType; elevation: number; patchBase?: number | undefined },
): MaterialisePatchCommand {
  return {
    type: CommandType.TrimCorners, x, y, layer: 'terrain', afterCorners, patchOnly: true,
    terrainType: patch.terrainType, elevation: patch.elevation, ...(patch.patchBase === undefined ? {} : { patchBase: patch.patchBase }),
  };
}

/** Recut `road`, standing at (x, y), turning it to `afterRotation` when given. */
export function trimRoadCommand(
  road: Pick<PlacedObject, 'id'>, x: number, y: number, afterCorners: Corners, afterRotation?: Rotation,
): TrimRoadCommand {
  return { type: CommandType.TrimCorners, x, y, layer: 'road', objectId: road.id, afterCorners, ...(afterRotation === undefined ? {} : { afterRotation }) };
}
