import type { GridState } from '../../core/model/types';
import { getMapStats } from '../../state/map-stats';
import type { I18nKey } from '../../i18n/keys';

/** One step of the construction sequence: the map built up to `level`. */
export interface LayerStep {
  level: number;
  labelKey: I18nKey;
}

/** The per-layer construction sequence: ground (0) up to the map's highest terrain
 *  (`MapStats.terrainTop`). Each step is one thumbnail showing the map built up to that
 *  level. Always returns at least `[{ level: 0, ... }]` (a bare-ground map). */
export function layersFor(state: GridState): LayerStep[] {
  const top = getMapStats(state).terrainTop;
  const steps: LayerStep[] = [];
  for (let level = 0; level <= top; level++) {
    steps.push({ level, labelKey: level === 0 ? 'export.layer_ground' : 'export.layer_level' });
  }
  return steps;
}
