import { TerrainType, type EraseTerrainCommand, type GridState, type MacroCoord, type MapTemplate, type PaintTerrainCommand, type PlacedObject, type PlaceObjectCommand, type Rotation } from '../../core/model/types';
import { CellZone } from '../../core/game/zones';
import { eraseTerrainCommand, paintTerrainCommand, placeObjectCommand } from '../../core/model/command-build';
import { createGrid, createDefaultTerrainCell } from '../../core/model/grid-model';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry, type RuleRegistry } from '../../rules/index';
import { createExecutor } from '../../state/executor';
import { roadLookup } from '../../state/object-index';
import type { StrokeKernel } from '../../core/model/stroke-policy';
import type { RoadLookup } from '../../core/model/road-lookup';

export function makeTemplate(width = 20, height = 20): MapTemplate {
  const zones: CellZone[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => CellZone.Grass),
  );
  return {
    id: 'test',
    name: { en: 'Test', zh: '测试' },
    width,
    height,
    zones,
    landmarks: [],
  };
}

export function makeState(width = 20, height = 20): GridState {
  const template = makeTemplate(width, height);
  return {
    template,
    cells: createGrid(template),
    objects: new Map(),
    objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
  };
}

export function setTerrain(
  state: GridState, x: number, y: number,
  type: TerrainType, elevation: number,
): void {
  const cell = state.cells[y]?.[x];
  if (cell) cell.terrain = createDefaultTerrainCell(type, elevation);
}

export function setZone(state: GridState, x: number, y: number, zone: CellZone): void {
  const cell = state.cells[y]?.[x];
  if (cell) cell.zone = zone;
}

/** The core builders under the names the tests have always used. */
export const paintCmd = (cells: MacroCoord[], terrainType: TerrainType, elevation: number): PaintTerrainCommand =>
  paintTerrainCommand(cells, terrainType, elevation);
export const eraseCmd = (cells: MacroCoord[]): EraseTerrainCommand => eraseTerrainCommand(cells);
export const placeCmd = (object: PlacedObject): PlaceObjectCommand => placeObjectCommand(object);

export function makeObject(
  id: string, x: number, y: number, rotation: Rotation = 0,
): PlacedObject {
  return { id, catalogId: id, position: { x, y }, rotation, elevation: 0 };
}

export function makeExecutor(state: GridState, registry: RuleRegistry = createDefaultRegistry()): CommandExecutor {
  return createExecutor(state, registry);
}

/** `executor` as a stroke kernel over `state`, and the road lookup of `state`: the reconcile
 *  passes' last two arguments. */
export function reconcileArgs(executor: CommandExecutor, state: GridState): [StrokeKernel, RoadLookup] {
  return [{ state, execute: (cmd) => executor.execute(cmd), validatePre: (cmd) => executor.validatePre(cmd) }, roadLookup(state)];
}
