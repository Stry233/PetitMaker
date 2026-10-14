/**
 * The map as parallel masks: one pass over a `GridState`, and every reading in this module and in the
 * designer's evaluation is taken over the result rather than over the map. A reading that walked the
 * cells itself would answer a slightly different question about what land, pavement or a plant is.
 *
 * The definitions: land = buildable zone cells; surface elevation is the cell's own
 * `terrain.elevation` (0 where null); paved = a road-category coating no building or facility stands
 * on.
 */
import { TerrainType, type GridState } from '../../core/model/types';
import { getCatalogItem, itemRole } from '../../state/catalog';
import { objectRect } from '../../state/object-geometry';
import { isCoatingItem, isSurfacePrint, isCrossing, isPlantRole, isStructureRole } from '../../core/model/traits';
import { isBuildableZone } from '../../core/game/zones';
import { landmarkSpec } from '../../core/game/profile';

export interface MapMasks {
  W: number; H: number;
  /** Buildable-zone cells: the buildable planet, the denominator of every share. */
  land: Uint8Array;
  elev: Int8Array;
  mountain: Uint8Array;
  water: Uint8Array;
  paved: Uint8Array;
  /** Bridge and ramp footprints — the links that join two paved levels into one network. */
  crossing: Uint8Array;
  /** Building and facility footprints: a place a street can arrive at. */
  structure: Uint8Array;
  /** The anchor landmark's footprint. */
  anchor: Uint8Array;
  /** Any object footprint (object cover). */
  covered: Uint8Array;
  /** catalogId of the tree/flora standing on the cell, first placement wins. */
  plantAt: (string | undefined)[];
  landCells: number;
}

/** Whether the map's cell (x, y) is buildable land now. Ground edits change a cell's zone, so a
 *  reading of a built map asks the cell; a plan asks the template (`tools/generation/designer/planet.ts`). */
export function landAt(state: GridState, x: number, y: number): boolean {
  return isBuildableZone(state.cells[y]?.[x]?.zone);
}

export function readMap(state: GridState): MapMasks {
  const W = state.template.width, H = state.template.height, N = W * H;
  const g: MapMasks = {
    W, H,
    land: new Uint8Array(N), elev: new Int8Array(N), mountain: new Uint8Array(N),
    water: new Uint8Array(N), paved: new Uint8Array(N), crossing: new Uint8Array(N),
    structure: new Uint8Array(N), anchor: new Uint8Array(N), covered: new Uint8Array(N),
    plantAt: new Array<string | undefined>(N).fill(undefined), landCells: 0,
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = state.cells[y]![x]!;
      const i = y * W + x;
      if (landAt(state, x, y)) { g.land[i] = 1; g.landCells++; }
      const t = cell.terrain;
      if (!t) continue;
      g.elev[i] = t.elevation;
      if (t.type === TerrainType.Mountain) g.mountain[i] = 1;
      else if (t.type === TerrainType.Water) g.water[i] = 1;
    }
  }
  for (const o of state.objects.values()) {
    const item = getCatalogItem(o.catalogId);
    if (isSurfacePrint(item)) continue;
    const role = itemRole(item);
    const coating = isCoatingItem(item), crossing = isCrossing(item);
    const r = objectRect(o);
    const plant = isPlantRole(role);
    const anchor = o.locked && landmarkSpec(o.catalogId)?.anchor === true;
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        g.covered[i] = 1;
        if (anchor) g.anchor[i] = 1;
        if (coating) g.paved[i] = 1;
        else if (crossing) g.crossing[i] = 1;
        else if (plant && g.plantAt[i] === undefined) g.plantAt[i] = o.catalogId;
        else if (isStructureRole(role)) g.structure[i] = 1;
      }
    }
  }
  // Pavement under a building or facility is its floor, not a walk.
  for (let i = 0; i < N; i++) if (g.structure[i]) g.paved[i] = 0;
  return g;
}
