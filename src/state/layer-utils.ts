/** The layer panel's per-layer cell/object counts, read from `state/map-stats`, and whether the map numbers its layers. */
import type { GridState } from '../core/model/types';
import { getMapStats } from './map-stats';
import { ELEVATION_MAX, PLANET_PROFILE } from '../core/game/profile';
import type { PlanetSession } from './slices/planet-session';

interface LayerInfo {
  elevation: number;
  cellCount: number;
}

function activeLayers(state: GridState, activeLayer: number): LayerInfo[] {
  const stats = getMapStats(state);

  // A contiguous range Ground..top, where top is the highest of the selected layer or any
  // occupied layer (min 1). Keeping the range contiguous means an added (empty) intermediate
  // layer stays listed when a higher layer becomes active — every layer 0..top is listed
  // (count 0 if empty). No min-1 floor: an empty map with Ground selected (activeLayer 0)
  // shows only Ground.
  const top = Math.min(ELEVATION_MAX, Math.max(0, activeLayer, stats.maxElevation));
  const layers: LayerInfo[] = [];
  for (let e = 0; e <= top; e++) {
    layers.push({
      elevation: e,
      // Terrain counts cumulatively (a cell at elevation 3 counts in layers 1-3); an
      // object counts only at its own elevation, Ground (0) included, so the panel shows
      // objects on flat ground and that row's eye toggle (which fades those objects) is
      // discoverable.
      cellCount: (stats.cellsByLayer[e] ?? 0) + (stats.objectsByLayer[e] ?? 0),
    });
  }
  return layers;
}

/** Every floor the panel lists, Ground up to the highest of `activeLayer` and any occupied floor,
 *  with its count and how much of the map's buildable ground it covers. A floor's count includes the
 *  objects on it, so a share can pass the map's cells; it stops at full. */
export function layerRows(state: GridState, activeLayer = ELEVATION_MAX): { elevation: number; count: number; share: number }[] {
  const capacity = getMapStats(state).buildableCells;
  return activeLayers(state, activeLayer).map((l) => ({
    elevation: l.elevation, count: l.cellCount, share: Math.min(1, l.cellCount / capacity),
  }));
}

/** Whether the map shows its layer numbers: as toggled, except in a planet session whose ground
 *  stays flat (`PLANET_PROFILE.maxLayer` 0), where there are no layers to number. */
export function layerNumbersShown(s: { showLayerNumbers: boolean; planetSession: PlanetSession | null }): boolean {
  return s.showLayerNumbers && !(s.planetSession && PLANET_PROFILE.maxLayer === 0);
}
