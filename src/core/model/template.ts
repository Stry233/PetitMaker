/* What a map template lays on a fresh grid: its terrain, water and landmarks. */
import { ELEVATION_MAX } from '../game/profile';
import { OFF_MAP_ZONE, isBuildableZone, type CellZone } from '../game/zones';
import { createGrid } from './grid-model';
import { templateLandmarkObjects } from './landmarks';
import { TerrainType, type GridState, type MacroCell, type MapTemplate, type TerrainCell } from './types';

/** A template array worth storing: one that holds any nonzero cell. */
export const anySet = (a: Uint8Array | undefined): a is Uint8Array => !!a?.some((e) => e > 0);

/** Whether a template lays any terrain, mountain or water, on a fresh state. */
export function templateHasTerrain(t: Pick<MapTemplate, 'terrain' | 'water'>): boolean {
  return anySet(t.terrain) || anySet(t.water);
}

/** The template's water on cells that can hold it, the only water `seedPlanetTerrain` lays; undefined
 *  when none is left. Readers store this, so a planet's water and id are what loads. */
export function loadableWater(t: Pick<MapTemplate, 'width' | 'zones' | 'water'>): Uint8Array | undefined {
  if (!anySet(t.water)) return undefined;
  const water = t.water.map((v, i) => (v && isBuildableZone(t.zones[Math.floor(i / t.width)]?.[i % t.width] ?? OFF_MAP_ZONE) ? v : 0));
  return anySet(water) ? water : undefined;
}

/** The terrain `template` lays on cell (x, y) of zone `zone` on a fresh grid: water where `water`
 *  marks the cell, at the elevation `terrain` gives it, mountain elsewhere above layer 0, and none off
 *  grass. */
export function templateTerrainAt(template: MapTemplate, x: number, y: number, zone: CellZone): TerrainCell | null {
  if (x < 0 || y < 0 || x >= template.width || y >= template.height || !isBuildableZone(zone)) return null;
  const i = y * template.width + x;
  const e = template.terrain?.[i] ?? 0;
  if (e > ELEVATION_MAX) return null;
  if (template.water?.[i]) return { type: TerrainType.Water, elevation: e };
  return e > 0 ? { type: TerrainType.Mountain, elevation: e } : null;
}

/** Whether `cell`, at (x, y), holds exactly the terrain `template` lays there (`templateTerrainAt`),
 *  none included: a cell no edit has touched. */
export function holdsTemplateTerrain(template: MapTemplate, x: number, y: number, cell: MacroCell): boolean {
  const laid = templateTerrainAt(template, x, y, cell.zone);
  const t = cell.terrain;
  if (!t || !laid) return !t && !laid;
  return t.type === laid.type && t.elevation === laid.elevation && !t.corners && !t.patchOnly;
}

/** Lays the template's terrain (`templateTerrainAt`) onto a freshly built grid. */
export function seedPlanetTerrain(template: MapTemplate, cells: MacroCell[][]): void {
  if (!template.terrain && !template.water) return;
  for (let y = 0; y < template.height; y++) for (let x = 0; x < template.width; x++) {
    const cell = cells[y]?.[x];
    if (!cell) continue;
    const t = templateTerrainAt(template, x, y, cell.zone);
    if (t) cell.terrain = t;
  }
}

/** A fresh map of `template` as a new map opens: its zones, its seeded terrain and its landmark, with
 *  no edits, no locked layers and no provenance. */
export function createGridState(template: MapTemplate): GridState {
  const state = bareGridState(template);
  seedPlanetTerrain(template, state.cells);
  for (const o of templateLandmarkObjects(template)) state.objects.set(o.id, o);
  return state;
}

/** `template`'s zones alone: no seeded terrain, no landmark and no locked layers. */
export function bareGridState(template: MapTemplate): GridState {
  return { template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}
