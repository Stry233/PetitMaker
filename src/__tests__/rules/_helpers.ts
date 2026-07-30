import {
  CellZone,
  CommandType,
  ObjectCategory,
  TerrainType,
  type EraseTerrainCommand,
  type GridState,
  type MacroCoord,
  type MapTemplate,
  type PaintTerrainCommand,
  type PlacedObject,
  type PlaceObjectCommand,
} from '../../core/model/types';
import { createGrid, createDefaultTerrainCell } from '../../core/model/grid-model';

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
    plaza: { x: 0, y: 0, width: 0, height: 0, elevation: 2 },
  };
}

export function makeState(width = 20, height = 20): GridState {
  const template = makeTemplate(width, height);
  return {
    template,
    cells: createGrid(template),
    objects: new Map(),
    lockedLayers: new Set(),
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

export function paintCmd(
  cells: MacroCoord[], terrainType: TerrainType, elevation: number,
): PaintTerrainCommand {
  return {
    type: CommandType.PaintTerrain,
    timestamp: 0,
    cells, terrainType, elevation,
  };
}

export function eraseCmd(cells: MacroCoord[]): EraseTerrainCommand {
  return {
    type: CommandType.EraseTerrain,
    timestamp: 0,
    cells,
  };
}

export function placeCmd(object: PlacedObject, loadValue = 0): PlaceObjectCommand {
  return {
    type: CommandType.PlaceObject,
    timestamp: 0,
    object, loadValue,
  };
}

export function makeObject(
  id: string, x: number, y: number,
  category: ObjectCategory, rotation: 0 | 90 | 180 | 270 = 0,
): PlacedObject {
  return { id, catalogId: id, position: { x, y }, rotation, category, elevation: 0 };
}
