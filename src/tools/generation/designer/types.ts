/**
 * The methodology generator's PLAN model: what a map is going to be, before a single command exists.
 *
 * The vocabulary is the expert methodology's own core model, so a reader can hold the two side by side:
 *  - a REGION is the unit of thought, in two kinds: a BUILDING-ANCHOR region (a building comes
 *    first and the place is composed around it) and a PURE THEME region (no building; one theme
 *    from the library holds it up). `RegionKind` is exactly that split.
 *  - a region has an ORIENTATION, never 360°: with a building the door faces the look-out and the
 *    door's opposite carries the BACKING; without one, the road's entry direction is the look-out
 *    and the region's depth carries the backing. So `orientation` and `entrySide` name the same
 *    plaza-ward direction here, derived differently, and `backing` is always the far end.
 *  - an ELEMENT (tree, bridge, water, furniture) is never a region and never appears in this model:
 *    the dressing kits fill a lot, they do not plan one.
 *
 * Everything here is DATA — no state, no commands, no randomness. `region-list.ts` decides WHICH
 * regions a map holds and `districts.ts` decides WHERE, and both produce values of these types.
 *
 * Geometry is macro-grid and axis-aligned: the references are rectilinear maps, so a lot is a Rect.
 * `RegionPlan.lot` is a LIST of rects to leave the door open for an L-shaped lot later; v1 always
 * writes exactly one.
 */
import type { Rect } from '../../../core/model/types';
// The tree's one cardinal-direction type. It lives beside the waterfall reader because that is
// where it was first needed; a second copy here would be a second source for one fact.
import type { Direction } from '../../../core/model/waterfall-geometry';

export type { Direction };

// --- region kinds ------------------------------------------------------------------------------

/** The building-anchor regions (建筑锚点区): every placeable Building and
 *  Facility belongs to exactly one of these. `region-list.ts:ANCHOR_ROLES` is the mapping. */
export type AnchorKind = 'residential' | 'own-house' | 'museum' | 'shop';

/** The five theme families (主题库), in the methodology's own order. */
export type ThemeFamily = 'food-leisure' | 'nature' | 'viewpoint' | 'culture' | 'production';

/** 吃喝休闲 — cafe, teahouse, picnic area, gathering/banquet area, seaside light dining. */
export type FoodLeisureTheme = 'cafe' | 'teahouse' | 'picnic' | 'banquet' | 'seaside-dining';
/** 自然景观 — park/central garden, garden/flower plot, flower field, bamboo sunken courtyard,
 *  lake/fountain, tree avenue/grove array, pure mountain-water-waterfall scenery, canyon/valley. */
export type NatureTheme =
  | 'park' | 'garden' | 'flower-field' | 'bamboo-court'
  | 'lake-fountain' | 'tree-avenue' | 'mountain-water' | 'canyon';
/** 观景 / 打卡 — lookout, panorama platform, waterside deck/lakeside walk, text/pattern landmark. */
export type ViewpointTheme = 'lookout' | 'panorama-deck' | 'waterside-deck' | 'landmark-text';
/** 文化 / 活动 — library, stage/small theatre, chess garden, music corner. */
export type CultureTheme = 'library' | 'stage' | 'chess-garden' | 'music-corner';
/** 生产 / 生活 — planting/crop area, orchard, small-animal run. */
export type ProductionTheme = 'crop-field' | 'orchard' | 'animal-run';

export type ThemeId =
  | FoodLeisureTheme | NatureTheme | ViewpointTheme | CultureTheme | ProductionTheme;

/** A region is one of the four anchor kinds, or a pure theme region (its `themeId` says which). */
export type RegionKind = AnchorKind | 'theme';

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

/** What `region-list.ts` decides: which regions the map holds, and how big each wants to be.
 *  No position yet — that is `districts.ts`. */
export interface RegionSpec {
  /** Stable within one plan (`res-0`, `theme-3`), so a plan diffs and a test names a region. */
  id: string;
  kind: RegionKind;
  /** Set exactly when `kind === 'theme'`. */
  themeId?: ThemeId;
  /** The theme's family; anchors leave it undefined. */
  family?: ThemeFamily;
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

/** A region with a place on the map: `region-list.ts`'s spec plus everything `districts.ts` decided. */
export interface RegionPlan extends RegionSpec {
  /** The lot, as 1 or 2 axis-aligned rects. v1 always writes exactly one. */
  lot: Rect[];
  /** The side the road reaches this region on, always the plaza-ward one. */
  entrySide: Direction;
  /** The look-out direction: a building's door faces it, a theme region opens to it. Equal to
   *  `entrySide` by derivation, kept separate because the sculptor, the kits and the anchor placement
   *  ask different questions of the two, and the methodology derives them differently. */
  orientation: Direction;
  /** The strip at the far end of the lot, opposite `orientation`, where the sculptor raises this region's
   *  own mountain/waterfall backing. Absent only where the lot is too shallow to hold one. */
  backing?: Rect;
  /** The QUIET treatment: a place in a block nothing claimed — no theme behind it, planted sparsely
   *  and edged. Every block gets a treatment, so there is no ground on a finished map that nobody
   *  decided about; this is what a block gets when the decision was to leave it alone. */
  quiet?: boolean;
  /** This place stands in a block given the WATER treatment: its ground is composed with water as
   *  the material rather than decorated around a bed cut into a corner of it. */
  water?: boolean;
}

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
  plazaHub: Rect;
  /** The map-scale high ground the composition raised: object-free, terrain-only, and the landmark
   *  figure's home. No place overlaps it. */
  backingBand: Rect;
  regions: RegionPlan[];
  /** Ids from the region list that found no block to stand in. Anchors never appear here (a district
   *  gives up a theme's block before an anchor's); a theme region can. */
  unplaced: string[];
}

// --- the ramp, as every planner has to read it --------------------------------------------------

/**
 * Cells of run one ramp takes: the catalog's ramp items are all four deep.
 *
 * Two stages need this same fact and neither may read it off the other. `streets.ts` builds its
 * flights out of runs this long, and `composition.ts` sizes the summit's terraces by it — a terrace
 * whose ring is shorter than a ramp's run is high ground with no way up onto it.
 */
export const RAMP_RUN = 4;

// --- orientation helpers -----------------------------------------------------------------------

/** The object rotation that makes a building's DOOR face `dir`. Mirrors the gate convention in
 *  `placement/object.ts:buildingGate`: at rotation 0 the door is the footprint's bottom
 *  edge, so it faces +y (south). The anchor placement turns buildings with this. */
export const DOOR_ROTATION: Readonly<Record<Direction, 0 | 90 | 180 | 270>> = {
  south: 0, west: 90, north: 180, east: 270,
};

/** The direction facing `dir`. */
export const OPPOSITE: Readonly<Record<Direction, Direction>> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
};

/** Unit step of a direction on the macro grid (y grows south). */
export const STEP: Readonly<Record<Direction, { dx: number; dy: number }>> = {
  north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 }, east: { dx: 1, dy: 0 },
};

/** The cardinal an offset points at, or null when it is shorter than `deadband` on both axes — the
 *  offset says nothing then, and a caller that names a direction anyway is inventing one. The
 *  dominant axis wins, x on a tie (a diagonal answers with one of its two sides either way). */
export function directionOf(dx: number, dy: number, deadband = 0): Direction | null {
  if (Math.hypot(dx, dy) < deadband) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}
