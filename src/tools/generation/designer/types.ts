/**
 * The designer generator's plan model: what a map is going to be, before any command exists.
 *
 *  - A region is the unit of thought: a building-anchor region (the place is composed around a
 *    building) or a pure theme region (`RegionKind`).
 *  - A region has an orientation: with a building the door faces the look-out and its opposite
 *    carries the backing; without one the road's entry direction is the look-out. `orientation` and
 *    `entrySide` name the same plaza-ward direction, derived differently; `backing` is the far end.
 *  - An element (tree, bridge, water, furniture) is never a region: the kits fill a lot.
 *
 * Data only: no state, commands or randomness. `region-list.ts` decides which regions a map holds
 * and `districts.ts` where. Geometry is macro-grid and axis-aligned; `RegionPlan.lot` is a list of
 * rects, always one today.
 */
import { ROTATIONS, type MapTemplate, type Rotation } from '../../../core/model/types';
import type { Rect } from '../../../core/grid/rect';
import { ROTATION_FACING, type Direction } from '../../../core/grid/directions';
import type { AnchorKind } from '../../../config/generation-style';

export type { AnchorKind, Direction };

// --- region kinds ------------------------------------------------------------------------------

// The theme vocabulary is read off the theme library (`themes.ts`).
export type {
  ThemeFamily, ThemeId, FoodLeisureTheme, NatureTheme, ViewpointTheme, CultureTheme, ProductionTheme,
} from './themes';
import type { ThemeRef } from './themes';

/** What a design is planned from, and what every pure stage reads first; a stage takes it together
 *  with the plans of the stages before it, as one object. */
export interface DesignInput {
  seed: number;
  template: MapTemplate;
  richness: number;
  /** The map's height ceiling; the composition's own default when absent. */
  maxElevation?: number;
}

// --- affinity (the taste cases) -----------------------------------------------------------------

/** The vocabulary the six taste cases are written in. A region carries the tags its kind or theme
 *  implies, and `region-list.ts` pairs them when it draws the theme set, so the cases stay
 *  recombinable data rather than templates. */
export type AffinityTag =
  | 'drink'      // a place people sit and drink: cafe, teahouse, seaside dining
  | 'greenery'   // park, garden, flower field, tree avenue: the low view a drink place looks at
  | 'stage'      // stage / small theatre: wants height and open sky in front
  | 'dwelling'   // residential + own house: wants a mountain at its back
  | 'bamboo'     // the bamboo sunken courtyard
  | 'quiet'      // library, chess garden, music corner, teahouse: the calm neighbours
  | 'seaside'    // the seaside light-dining case
  | 'waterside'  // any region whose kit needs water beside it
  | 'shop'       // the shop complex's core
  | 'library';   // the shop complex's upper deck

// --- regions -----------------------------------------------------------------------------------

/** What every region spec carries, anchor or theme. */
interface RegionBase {
  /** Stable within one plan (`res-0`, `theme-3`), so a plan diffs and a test names a region. */
  id: string;
  /** Catalog ids this region is responsible for placing, in the order it should place them.
   *  Empty for theme regions; every placeable Building/Facility appears in exactly one list. */
  anchors: string[];
  /** The lot this region wants, in macro cells. `districts.ts` may shrink it to fit. */
  size: { w: number; h: number };
  /** The smallest lot this region can still do its job in — for an anchor, the one that still holds
   *  its buildings and their gate strips. A shrinking district never goes below it. */
  minSize?: { w: number; h: number };
  tags: readonly AffinityTag[];
}

/** A building-anchor region: no theme. */
export interface AnchorRegionSpec extends RegionBase {
  kind: AnchorKind;
  themeId?: never;
  family?: never;
}

/** A pure theme region, its theme and family correlated so a switch on `family` narrows `themeId`. */
export type ThemeRegionSpec = RegionBase & { kind: 'theme' } & ThemeRef;

/** What `region-list.ts` decides: which regions the map holds, and how big each wants to be.
 *  No position yet — that is `districts.ts`. */
export type RegionSpec = AnchorRegionSpec | ThemeRegionSpec;

/** Where `districts.ts` put a region and how it faces. */
interface RegionPlacement {
  /** The lot, as 1 or 2 axis-aligned rects. v1 always writes exactly one. */
  lot: Rect[];
  /** The side the road reaches this region on, always the plaza-ward one. */
  entrySide: Direction;
  /** The look-out direction: a building's door faces it, a theme region opens to it. Equal to
   *  `entrySide` by derivation, kept separate because the sculptor, the kits and the anchor placement
   *  ask different questions of the two, and the two are derived differently. */
  orientation: Direction;
  /** The strip at the far end of the lot, opposite `orientation`, where the sculptor raises this region's
   *  own mountain/waterfall backing. Absent only where the lot is too shallow to hold one. */
  backing?: Rect;
  /** The quiet treatment: a place in a block nothing claimed — no theme behind it, planted sparsely
   *  and edged. Every block gets a treatment, so there is no ground on a finished map that nobody
   *  decided about; this is what a block gets when the decision was to leave it alone. */
  quiet?: boolean;
  /** This place stands in a block given the water treatment: its ground is composed with water as
   *  the material rather than decorated around a bed cut into a corner of it. */
  water?: boolean;
}

/** A region with a place on the map: `region-list.ts`'s spec plus everything `districts.ts` decided. */
export type RegionPlan = RegionSpec & RegionPlacement;

// --- the finished plan --------------------------------------------------------------------------

/** What the plan was made from, so a plan is reproducible and a log entry can name it. */
export interface SeedInfo {
  seed: number;
  richness: number;
  templateId: string;
}

/** The finished plan of a map: every region with its lot, the map-scale high ground, and the plaza
 *  hub everything is measured from. */
export interface DesignPlan {
  seedInfo: SeedInfo;
  /** The template's plaza, as macro cells: the hub the plan radiates from. */
  hubArea: Rect;
  /** The map-scale high ground the composition raised: object-free, terrain-only, and the landmark
   *  figure's home. No place overlaps it. */
  backingBand: Rect;
  regions: RegionPlan[];
  /** Ids from the region list that found no block to stand in. Anchors never appear here (a district
   *  gives up a theme's block before an anchor's); a theme region can. */
  unplaced: string[];
}

// --- road widths -------------------------------------------------------------------------------

/** The game's own two rank widths: a trunk is 3 cells wide, a branch 2, and nothing is 1. */
export const TRUNK_W = 3;
export const BRANCH_W = 2;

// --- orientation helpers -----------------------------------------------------------------------

/** The object rotation that makes a building's door face `dir`: `ROTATION_FACING` read backwards.
 *  The anchor placement turns buildings with this. */
export const DOOR_ROTATION = Object.fromEntries(
  ROTATIONS.map((rotation) => [ROTATION_FACING[rotation], rotation]),
) as Readonly<Record<Direction, Rotation>>;

/** The cardinal an offset points at, or null when it is shorter than `deadband` on both axes — the
 *  offset says nothing then, and a caller that names a direction anyway is inventing one. The
 *  dominant axis wins, x on a tie (a diagonal answers with one of its two sides either way). */
export function directionOf(dx: number, dy: number, deadband = 0): Direction | null {
  if (Math.hypot(dx, dy) < deadband) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}
