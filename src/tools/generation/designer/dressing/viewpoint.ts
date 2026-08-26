/**
 * 观景 / 打卡 — lookout, panorama platform, waterside deck, text/pattern landmark.
 *
 * A viewing place is defined by what it does NOT hold: the game's viewing relation asks for an open
 * line in front of where a person stands, so every theme here keeps its middle bare and its planting
 * at the rim. The landmark region is the sparsest of all — the phrase or figure written across it is
 * the composition, and it is laid by its own stage rather than by this kit.
 */
import type { Rng } from '../../../../core/model/rng';
import type { ViewpointTheme } from '../types';
import type { KitStyle } from './types';

export function viewpointStyle(theme: ViewpointTheme, rng: Rng): KitStyle {
  switch (theme) {
    // 观景台 — a rim of trees around the standing ground.
    case 'lookout':
      return {
        tile: { w: 5, h: 5 }, appetite: 0.6, aisle: true,
        mix: [['border', 2], ['orchard', 3], ['open', 4]],
      };
    // 全景平台 — the same, planted lower so nothing blocks the view.
    case 'panorama-deck':
      return {
        tile: { w: 5, h: 5 }, appetite: 0.6, aisle: true,
        mix: [['border', 2], ['bed', 2], ['orchard', 1], ['open', 4]],
      };
    // 亲水平台 / 湖边步道 — the walk is the subject and the water beside it is what it is for.
    case 'waterside-deck':
      return {
        tile: { w: 5, h: 5 }, appetite: 0.7, pools: 1 + rng.int(2),
        mix: [['border', 3], ['bed', 2], ['orchard', 1], ['open', 3]],
      };
    // 文字 / 图案景观 — left almost bare: the glyph is the region.
    case 'landmark-text':
      return {
        tile: { w: 6, h: 6 }, appetite: 0.3,
        mix: [['open', 6], ['border', 2]],
      };
  }
}
