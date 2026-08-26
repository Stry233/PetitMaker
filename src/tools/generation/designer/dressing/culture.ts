/**
 * 文化 / 活动 — library, stage/small theatre, chess garden, music corner.
 *
 * The formal family: these are the places a plan is read in, so their compositions are the most
 * strictly mirrored of the five. The chess garden is the one theme in the whole library that is
 * drawn as a period-2 alternation of two species rather than as a block, a mark the style target
 * carries 47 of.
 */
import type { Rng } from '../../../../core/model/rng';
import type { CultureTheme } from '../types';
import type { KitStyle } from './types';

export function cultureStyle(theme: CultureTheme, rng: Rng): KitStyle {
  switch (theme) {
    // 图书馆 — beds edged with runs, a quiet floor.
    case 'library':
      return {
        tile: { w: 5, h: 5 }, appetite: 0.9,
        mix: [['bed', 3], ['border', 2], ['open', 3], ['orchard', 2]],
      };
    // 舞台 / 小剧场 — open in front (the case builds it high, facing the sky), trees behind.
    case 'stage':
      return {
        tile: { w: 5, h: 6 }, appetite: 0.7, aisle: true,
        mix: [['open', 4], ['grove', 3], ['orchard', 2], ['border', 1]],
      };
    // 棋园 — the board itself.
    case 'chess-garden':
      return {
        tile: { w: 4, h: 4 }, appetite: 1.0,
        mix: [['checker', 5], ['border', 1], ['orchard', 1], ['open', 2]],
      };
    // 音乐角 — small beds, a corner rather than a ground.
    case 'music-corner':
      return {
        tile: { w: 4, h: 4 }, appetite: 0.8,
        mix: [['bed', 3], ['border', 1], ['open', 3], ['grove', rng.int(2) + 2]],
      };
  }
}
