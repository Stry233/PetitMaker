/**
 * 生产 / 生活 — planting area, orchard, small-animal run.
 *
 * The most regular family, and the one the garden-town reference is built almost entirely out of:
 * its ten tree blocks are eight lattices of exactly 18 at 11x5, and its flower fields are step-1
 * solids up to 31x66. A crop area is striped, an orchard is a lattice, and a run is the open ground
 * a fence encloses.
 */
import type { Rng } from '../../../../core/model/rng';
import type { ProductionTheme } from '../types';
import type { KitStyle } from './types';

export function productionStyle(theme: ProductionTheme, rng: Rng): KitStyle {
  switch (theme) {
    // 种植区 — crop rows.
    case 'crop-field':
      return {
        tile: { w: 7, h: 6 }, appetite: 1.3,
        mix: [['rows', 5], ['bed', 2], ['orchard', 1], ['open', 2]],
      };
    // 果园 — the step-2 lattice, at the scale the references plant it.
    case 'orchard':
      return {
        tile: { w: 7, h: 6 }, appetite: 1.2,
        mix: [['orchard', 6], ['grove', 3], ['open', 2]],
      };
    // 小动物活动区 — open ground with a planted rail round it.
    case 'animal-run':
      return {
        tile: { w: 6, h: 6 }, appetite: 0.5,
        mix: [['open', 5], ['border', 2], ['grove', 2 + rng.int(2)]],
      };
  }
}
