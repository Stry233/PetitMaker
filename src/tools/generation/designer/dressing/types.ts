/**
 * What a THEME KIT is (区域类型 vs 元素): a region type says what kind of place to build,
 * and the kit is the box of elements it is built out of. An element is never a region — a bed, an
 * orchard lattice, a border run, a water bed are the blocks, and the kit is the recipe that says
 * which blocks this kind of place is made of.
 *
 * A kit declares a STYLE, not a drawing: the block it tiles its ground with, the mix of elements
 * over those blocks, how hungry it is for ground, and the ground treatment it wants cut before
 * anything is planted. `elements.ts` turns a style plus a canvas into marks; `index.ts` dispatches a
 * region to its family's style and plants the result.
 */
import type { Rect } from '../../../../core/model/types';
import type { Rng } from '../../../../core/model/rng';
import type { RegionPalette } from './palette';
import type { Direction } from '../types';

/** One planted cell. */
export interface PlantMark { x: number; y: number; catalogId: string }

/** The ground treatment a region's kit asks for, decided at plan time so the terrain sculpt can cut
 *  it: terrain must be down before a road or a plant is. `pools` are water beds framed by the
 *  region's own terrace, `sunken` drops a court a tier below its platform, `ring` raises a one-layer
 *  terrace inside the lot's border. */
export interface KitGround {
  regionId: string;
  pools: number;
  sunken: boolean;
  ring: boolean;
}

/**
 * The elements a kit tiles its ground with. The two planting grammars are the style target's own: a
 * flower is planted as a STEP-1 SOLID block (its 5x6 beds of 30), a tree as a STEP-2 LATTICE (its
 * orchards of 18 to 48).
 */
export type TileKind =
  | 'bed'      // a solid single-species flower block
  | 'orchard'  // a step-2 tree lattice
  | 'grove'    // a step-2 tree lattice on the offset phase, so two groves interleave
  | 'border'   // the block's perimeter only: a same-species run along an edge
  | 'rows'     // every other row solid: a striped field
  | 'checker'  // two species alternating, the period-2 mark the style target carries 47 of
  | 'open';    // left bare, which is what keeps a composition from reading as a carpet

export interface KitStyle {
  /** The block the composition is tiled by. The style target's flower beds are 5x6. */
  tile: { w: number; h: number };
  /** The element mix over the tiles, as draw weights. */
  mix: readonly (readonly [TileKind, number])[];
  /** How much ground this theme wants planted, relative to the map's mean. The orchestrator scales
   *  every region by one factor so the map lands in the decoration-density band, and this is what
   *  makes a flower field denser than a lookout inside that budget. */
  appetite: number;
  /** Leave the canvas's middle open: a walk, or the view line a lookout is built around. */
  aisle?: boolean;
  /** Water beds cut into the region's own platform, framed by its terrace: the reference's parterre
   *  pools are rectangles cut into a terrace, not pools with flower rings. */
  pools?: number;
  /** A court dropped one tier below the region's platform (竹林下沉庭院). */
  sunken?: boolean;
  /** A one-layer terrace ring inside the lot's border, open at the entry side: the shop complex
   *  (商店周围一圈一层山体). */
  ring?: boolean;
}

/** One composable place: a run of plantable ground at one elevation, with the region's palette and
 *  the share of it the composition should cover. */
export interface KitCanvas {
  regionId: string;
  /** Plantable cells as flat indices, all at `elevation`. */
  cells: ReadonlySet<number>;
  /** Bounding box of `cells`. */
  box: Rect;
  elevation: number;
  /** Grid width, so a flat index can be read back as (x, y). */
  W: number;
  /** Share of `cells` the composition aims to plant. */
  cover: number;
  /**
   * Share of what it plants that should be TREES.
   *
   * The two references disagree on this more than on anything else they are both examples of: the
   * terraced target plants one tree per 1.12 flowers, the flat garden town one per 6.6. So it is a
   * style axis, not an average — and it cannot be reached by planting denser, since every tree
   * carries an exclusion radius and a lattice therefore covers a quarter of its block against a
   * bed's whole. More trees means more GROUND under them, which is what this moves.
   */
  treeShare: number;
  /** The region's look-out: a border runs along it, an aisle points down it. */
  orientation: Direction;
  palette: RegionPalette;
  rng: Rng;
}

/** A theme family's kit: the style each of its themes is built in. */
export type KitStyleFor<T extends string> = (theme: T, rng: Rng) => KitStyle;

export const inCanvas = (c: KitCanvas, x: number, y: number): boolean => c.cells.has(y * c.W + x);
