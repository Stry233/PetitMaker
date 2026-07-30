import { TerrainType } from './types';
import type { GridState } from './types';
import { ELEVATION_MAX } from './constants';


export interface LayerInfo {
  elevation: number;
  cellCount: number;
  visible: boolean;
  locked: boolean;
  name: string;
}

export function getActiveLayers(state: GridState, activeLayer = 1): LayerInfo[] {
  const counts = new Map<number, number>();
  let maxElev = 0;
  for (let y = 0; y < state.template.height; y++) {
    const row = state.cells[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell?.terrain && cell.terrain.type !== TerrainType.None) {
        const e = cell.terrain.elevation;
        if (e > maxElev) maxElev = e;
        for (let layer = 1; layer <= e; layer++) {
          counts.set(layer, (counts.get(layer) ?? 0) + 1);
        }
      }
    }
  }
  // Count placed objects at their elevation layer — including Ground (0), so the
  // panel shows objects on flat ground and that row's eye toggle (which fades
  // those objects) is discoverable.
  for (const [, obj] of state.objects) {
    if (obj.locked) continue; // immutable structures (the plaza) aren't a layer
    counts.set(obj.elevation, (counts.get(obj.elevation) ?? 0) + 1);
    if (obj.elevation > maxElev) maxElev = obj.elevation;
  }

  // Show a CONTIGUOUS range Ground..top, where top is the highest of the
  // selected layer or any occupied layer (min 1). Keeping the range contiguous
  // means an added (empty) intermediate layer stays listed when a higher
  // layer becomes active — every layer 0..top is listed (count 0 if empty).
  // No min-1 floor: an empty map with Ground selected (activeLayer 0) shows ONLY Ground.
  const top = Math.min(ELEVATION_MAX, Math.max(0, activeLayer, maxElev));
  const layers: LayerInfo[] = [];
  for (let e = 0; e <= top; e++) {
    layers.push({
      elevation: e,
      cellCount: counts.get(e) ?? 0,
      visible: true,
      locked: false,
      name: e === 0 ? 'layer.ground' : `layer.${e}`,
    });
  }
  return layers;
}

