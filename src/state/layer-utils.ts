/**
 * The layer panel's per-layer cell/object counts, read from `state/map-stats`.
 * `core/model/layer-utils` cannot import `state/` (a lower layer), so the derivation lives
 * here and that module keeps only the LayerInfo type.
 */
import { ELEVATION_MAX } from '../core/model/constants';
import type { GridState } from '../core/model/types';
import type { LayerInfo } from '../core/model/layer-utils';
import { getMapStats } from './map-stats';

export function getActiveLayers(state: GridState, activeLayer = 1): LayerInfo[] {
  const stats = getMapStats(state);

  // A CONTIGUOUS range Ground..top, where top is the highest of the selected layer or any
  // occupied layer (min 1). Keeping the range contiguous means an added (empty) intermediate
  // layer stays listed when a higher layer becomes active — every layer 0..top is listed
  // (count 0 if empty). No min-1 floor: an empty map with Ground selected (activeLayer 0)
  // shows ONLY Ground.
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
      visible: true,
      locked: false,
      name: e === 0 ? 'layer.ground' : `layer.${e}`,
    });
  }
  return layers;
}
