/**
 * What a theme kit is (region type versus element): a region type says what kind of place to build,
 * and the kit is the box of elements it is built out of. An element is never a region — a bed, an
 * orchard lattice, a border run, a water bed are the blocks, and the kit is the recipe that says
 * which blocks this kind of place is made of.
 *
 * A kit declares a style, not a drawing: the block it tiles its ground with, the mix of elements
 * over those blocks, how hungry it is for ground, and the ground treatment it wants cut before
 * anything is planted. Each family file declares its kits as a table keyed by theme (or anchor kind);
 * `elements.ts` turns a style plus a canvas into marks, and `index.ts` reads a region's kit off the
 * tables and plants the result.
 */
import type { Rect } from '../../../../core/grid/rect';
import type { Rng } from '../../../../core/base/rng';
import type { RegionPalette } from './palette';
import type { DesignPlan, Direction } from '../types';
import type { PlaceCtx } from '../../../placement/object';
import type { AnchorPlan } from '../places/anchors';

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
 * The elements a kit tiles its ground with. There are two planting grammars: a flower is planted as
 * a STEP-1 solid block (a 5x6 bed of 30), a tree as a STEP-2 lattice (an orchard of 18 to 48).
 */
export type TileKind =
  | 'bed'      // a solid single-species flower block
  | 'orchard'  // a step-2 tree lattice
  | 'grove'    // a step-2 tree lattice on the orchard's phase, planted in the accent species
  | 'border'   // the block's perimeter only: a same-species run along an edge
  | 'rows'     // every other row solid: a striped field
  | 'checker'  // two species alternating, the period-2 mark
  | 'open';    // left bare, which is what keeps a composition from reading as a carpet

export interface KitStyle {
  /** The block the composition is tiled by. A flower bed is 5x6. */
  tile: { w: number; h: number };
  /** The element mix over the tiles, as draw weights. */
  mix: readonly (readonly [TileKind, number])[];
  /** How much ground this theme wants planted, relative to the map's mean. The orchestrator scales
   *  every region by one factor so the map lands in the decoration-density band, and this is what
   *  makes a flower field denser than a lookout inside that budget. */
  appetite: number;
  /** Leave the canvas's middle open: a walk, or the view line a lookout is built around. */
  aisle?: boolean;
  /** Water beds cut into the region's own platform, framed by its terrace: a parterre pool is a
   *  rectangle cut into a terrace, not a pool with a flower ring. */
  pools?: number;
  /** A court dropped one tier below the region's platform (the sunken bamboo courtyard). */
  sunken?: boolean;
  /** A one-layer terrace ring inside the lot's border, open at the entry side: the shop complex
   *  (a one-layer mountain ring around the shops). */
  ring?: boolean;
}

/** A kit field fixed in its table, or drawn from the region's rng when the style is read. */
export type Drawn<T> = T | ((rng: Rng) => T);

/** A kit as its table declares it. A kit draws at most one field, so the region's rng advances the
 *  same whichever field draws. */
export type KitSpec = { [K in keyof KitStyle]: Drawn<KitStyle[K]> };

const draw = <T>(field: Drawn<T>, rng: Rng): T =>
  typeof field === 'function' ? (field as (rng: Rng) => T)(rng) : field;

/** The style a kit table entry resolves to for one region. */
export function drawStyle(spec: KitSpec, rng: Rng): KitStyle {
  const style: KitStyle = { tile: draw(spec.tile, rng), mix: draw(spec.mix, rng), appetite: draw(spec.appetite, rng) };
  if (spec.aisle !== undefined) style.aisle = draw(spec.aisle, rng);
  if (spec.pools !== undefined) style.pools = draw(spec.pools, rng);
  if (spec.sunken !== undefined) style.sunken = draw(spec.sunken, rng);
  if (spec.ring !== undefined) style.ring = draw(spec.ring, rng);
  return style;
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
   * Share of what it plants that should be trees.
   *
   * The built-in planets differ on this more than on anything else: the terraced one plants one
   * tree per 1.12 flowers, the flat garden town one per 6.6. So it is a
   * style axis, not an average — and it cannot be reached by planting denser, since every tree
   * carries an exclusion radius and a lattice therefore covers a quarter of its block against a
   * bed's whole. More trees means more ground under them, which is what this moves.
   */
  treeShare: number;
  /** The region's look-out: a border runs along it, an aisle points down it. */
  orientation: Direction;
  palette: RegionPalette;
  rng: Rng;
}

export const inCanvas = (c: KitCanvas, x: number, y: number): boolean =>
  x >= 0 && x < c.W && c.cells.has(y * c.W + x);

/** What the dressing pass reads: the finished map's placement context and the plans it composes. */
export interface DressInput {
  place: PlaceCtx;
  plan: DesignPlan;
  anchors: AnchorPlan;
  seed: number;
  richness: number;
  /** The network's dominant material, for the forecourts an arrival building takes. */
  material: string;
  /** Cells no composition may plant on, as flat indices. The landmark's panel is the one caller:
   *  a stroke two cells wide carries plantable ground down its middle, and a plant standing there
   *  is a letter that cannot be read. */
  avoid?: ReadonlySet<number>;
  /** The painted region a scoped run is confined to. It gates the ground rather than the marks, so
   *  a composition is built on the ground the region actually offers — a mark filter applied
   *  afterwards would cut mirrored pairs in half and leave the region reading as a torn edge of a
   *  composition made for somewhere else. */
  within?: (x: number, y: number) => boolean;
}
