import type { CatalogItem } from '../../../core/model/types';
import path_overgrown_dirt from './path-overgrown-dirt.json';
import path_blue_board from './path-blue-board.json';
import path_classic_basketweave_brick from './path-classic-basketweave-brick.json';
import path_classic_mosaic_brick from './path-classic-mosaic-brick.json';
import path_cobblestone from './path-cobblestone.json';
import path_diamond_mosaic_brick from './path-diamond-mosaic-brick.json';
import path_fan_shaped_brick from './path-fan-shaped-brick.json';
import path_green_board from './path-green-board.json';
import path_herringbone_clay_brick from './path-herringbone-clay-brick.json';
import path_park_stone from './path-park-stone.json';
import path_pink_board from './path-pink-board.json';
import path_yellow_board from './path-yellow-board.json';
import path_floral_brick from './path-floral-brick.json';
import path_garden_stone from './path-garden-stone.json';
import path_geometric_terracotta from './path-geometric-terracotta.json';
import path_lattice_red_brick from './path-lattice-red-brick.json';
import path_patterned_tile from './path-patterned-tile.json';
import path_radiant_star_stone from './path-radiant-star-stone.json';
import path_retro_block from './path-retro-block.json';
import path_seaside_wave from './path-seaside-wave.json';
import path_simple_brick from './path-simple-brick.json';
import path_simple_flowerbed from './path-simple-flowerbed.json';
import path_square_brick from './path-square-brick.json';
import path_urban_asphalt from './path-urban-asphalt.json';
import path_wavy_terracotta from './path-wavy-terracotta.json';

// The dirt path LEADS, and the position is load-bearing: the tile brush arms the category's first
// road when nobody has picked one (`state/slices/edit.ts`), and the road macros fall back to it.
// A plain dirt track is what an unplanned lane should be; the boardwalks and patterned tiling are
// choices a hand makes for one courtyard.
export const road: CatalogItem[] = [
  path_overgrown_dirt,
  path_blue_board,
  path_classic_basketweave_brick,
  path_classic_mosaic_brick,
  path_cobblestone,
  path_diamond_mosaic_brick,
  path_fan_shaped_brick,
  path_green_board,
  path_herringbone_clay_brick,
  path_park_stone,
  path_pink_board,
  path_yellow_board,
  path_floral_brick,
  path_garden_stone,
  path_geometric_terracotta,
  path_lattice_red_brick,
  path_patterned_tile,
  path_radiant_star_stone,
  path_retro_block,
  path_seaside_wave,
  path_simple_brick,
  path_simple_flowerbed,
  path_square_brick,
  path_urban_asphalt,
  path_wavy_terracotta,
] as CatalogItem[];
