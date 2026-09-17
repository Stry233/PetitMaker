/**
 * Materializes planned plates, street flights, water systems, and district treatments as terrain.
 * Water is carved in dependency order: courts, stairs, a connected course, large figures, ambient
 * falls, then accents. Plate spacing satisfies mountain support; water bodies either expose no lower
 * face or terminate each fall with same-tier caps over a uniform receiving row. The module is pure
 * and deterministic; the caller still applies the shared decrease-only repair before commit.
 */
import { distanceField, flatIndex, NEIGHBORS4 } from '../../../../core/model/grid-model';
import { ELEVATION_MAX } from '../../../../core/model/constants';
import { valueNoise01 } from '../../../../core/model/noise';
import { realSurface } from '../../../../core/edge-cut/terrain-silhouette';
import {
  TerrainType,
  type GridState, type MacroCoord, type MapTemplate, type Rect,
} from '../../../../core/model/types';
import { getCatalogItem } from '../../../../state/catalog';
import { getRotatedSize } from '../../../../state/object-geometry';
import { buildingGate } from '../../../placement/object';
import type { TerrainPlan } from '../../core/types';
import type { AnchorPlan } from '../places/anchors';
import { cellTiers, paintableMask, PLATE_STEP_MAX, type CompositionPlan } from '../composition/composition';
import type { KitGround } from '../dressing/types';
import { carveLandmark, landmarkCells, landmarkRegion, type LandmarkPlan } from './landmark';
import type { MovementLine, WaterWant } from '../composition/movement-line';
import type { StreetPlan } from '../streets/streets';
import { eachTerminus } from '../streets/street-ends';
import { carveCascadeStairs, type CascadeStair } from '../water/cascade-stair';
import { carveFountains, type FountainCourt } from '../water/fountain';
import { boundsOfCells, atTier, flood, poolFits, uniform } from '../water/water-cut';
import { cutComposedBodies, type ComposedBody } from '../water/water-forms';
import { carveWaterStory, type WaterStory } from '../water/water-story';
import { type DesignPlan, type Direction } from '../types';

// --- tunables, all measured off the two reference maps ------------------------------------------

/** How much of the planet's land is water at richness 0 and 1. The flat reference reads 15.3% and the
 *  terraced one 25.9%, and the planet kind scales this further. */
const WATER_SHARE = { min: 0.05, max: 0.26 } as const;
/** Below this richness no water is cut at all: a quiet map is a dry one. */
const WATER_FROM = 0.1;
/** How much likelier an accent is on the upper terraces. The references read 13 to 21% water on tiers
 *  0-3 and 31 to 40% on tiers 4-8: the wet half of the style target is its upper half. */
const HIGH_TIER_PULL = 0.35;
/** The ACCENT pools: the style target carries 32 bodies of six cells or fewer holding 2.6% of its
 *  water. They are the only water this module still spends a budget on, and the cap is what keeps one
 *  from growing into a rectangle with a mountain border all the way round it. */
const ACCENT_COUNT = { min: 4, max: 30 } as const;
const ACCENT_SIZES: readonly { w: number; h: number }[] = [
  { w: 2, h: 2 }, { w: 3, h: 2 }, { w: 2, h: 3 }, { w: 2, h: 1 }, { w: 1, h: 2 }, { w: 3, h: 1 },
];
/** How far apart two accents stand, and how much open ground a GROUND-level one leaves beside
 *  itself so the planet stays walkable. */
const ACCENT_GAP = 7;
/** How far ahead of a street's end its own pool is cut. Two cells: a road validates its own cell
 *  plus one right and one below, so the cell immediately in front of a face is reserved ground. */
const END_POOL_AHEAD = 2;
/** The shapes a street's own pool takes, smaller than the profile's accents: what stands
 *  at the end of a walk has to be SEEN rather than to take the ground the place ahead is composed
 *  on, and a bigger one measurably cost the palette-unity reading. */
const END_POOL_SIZES: readonly { w: number; h: number }[] = [
  { w: 2, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 2 },
];
const ACCENT_KEEP = 3;
/** How far a pool stays away from the walk's own last stop.
 *
 * The route ends on the planet's high ground and a pool cut where it arrives lowers the cell the
 * terminus names — measured on `tafa/12345`, where the end-pool pass took the very cell the walk
 * finishes on. The look-out is what the whole climb is for, so the water gives it room.
 */
const ARRIVAL_KEEP = 5;
/** How much of the water still unspent after the courts, the stairs and the story goes into the large
 *  composed figures. The rest is the ambient cascades and the accents, which is the tail the style
 *  target reads at 2.6% of its water over 32 bodies. */
const FIGURE_SHARE = 0.8;
/** The ring profile both references read: a DRY apron round the plaza, the wet band at 30 to 50 cells
 *  out, tapering to nothing at the coast. */
const ACCENT_RING = { dry: 10, from: 30, to: 50, fade: 74 } as const;

/** A fall band's run, at richness 0 and 1, and how deep it may be. The style target's cascade bands
 *  read 2 to 4 rows deep and 30 to 40 cells wide, and 41 of its 83 bodies present a capped face — so
 *  the cascade, not the pond, is the reference's dominant water form, and it is what carries most of a
 *  map's water here. */
const FALL_RUN = { min: 3, max: 30 } as const;
const FALL_DEPTH = { min: 1, max: 3 } as const;
/** Share of the terrace steps that carry a fall, at richness 0 and 1. */
const FALL_SHARE = { low: 0.12, high: 1 } as const;
/** How far apart two falls stand along one step, in cells. */
const FALL_GAP = 4;
/**
 * How many ambient bands of ONE size a map may carry: the cap on congruent shapes, applied to the pass
 * most able to break it.
 *
 * Every minimal terrace step offers exactly one band length, so without this a planet of short steps
 * came back with twenty-five congruent 5x3 bodies — wallpaper rather than water.
 * The cap is about the LOOK rather than about the reading: a band is a dozen cells and the congruence
 * reading counts features of twenty or more, so nothing here would fail a check either way.
 */
const BAND_CLASS_MAX = 3;



/** Share of the places raised onto a terrace of their own, at richness 0 and 1. The flat reference
 *  has none and the terraced one has almost nothing else, so this is the same style axis richness
 *  moves everything else along. */
const PLACE_TERRACE = { low: 0.15, high: 0.6 } as const;

/** How many times a backing strip may be halved looking for ground it can be raised whole. */
const BACKING_SPLITS = 2;
/** The court a bamboo kit sinks, and the ring a shop kit raises. */
const SUNKEN_INSET = 2;
const SUNKEN_MIN = 3;
const RING_W = 1;

/** How far a gorge is cut below the terrace its crossing stands on: V-MTN-03's own window, which is
 *  the deepest a hole may be without the ground around it losing its support. */
const GORGE_DROP = 3;

/** How far a terrace boundary wanders, in cells, for the seeded fields below. */
const NOISE_SPAN = 21;

// --- what a sculpt is ---------------------------------------------------------------------------

/** The composition's own high ground, reported the way the landmark asks for it: where the map's
 *  mass stands, how tall it got. */
export interface WallProfile {
  rect: Rect;
  peak: number;
  /** Rows of the band spent climbing from the foot to the plateau. 0 where there is no wall. */
  climbRows: number;
}

/** One water band cut along a terrace step, pouring onto the terrace below. */
export interface CascadeBand {
  rect: Rect;
  tier: number;
}

/** What a body of water IS, which is a short list: the planet carries one or two cascade STAIRS down
 *  the flanks of its mass, one water STORY carrying on from a stair's foot (its reaches, its falls and
 *  the POND it arrives in), a few large composed FIGURES, the FOUNTAIN courts, the ambient cascades
 *  off the terrace steps, the ACCENT pools beside them, and the CROSSING the walk steps over. Nothing
 *  else cuts water. */
export type WaterKind =
  | 'stair' | 'story' | 'pond' | 'figure' | 'fall' | 'fountain' | 'accent' | 'crossing';

/** One body of water the sculpt cut, with the place it belongs to where it has one. */
export interface WaterFeature {
  kind: WaterKind;
  /** The place this body composes, or '' for the planet-wide passes. */
  regionId: string;
  rect: Rect;
  tier: number;
}

export interface TerrainSculpt {
  terrain: TerrainPlan;
  /** The tier every cell was raised to, before the water was cut into it. */
  tiers: Int8Array;
  /** The composition's mass, for the callers that ask a plan where its high ground is. */
  wall: WallProfile;
  /** Every body of water, in the order it was cut. */
  water: WaterFeature[];
  /** The fall bands, which are also in `water`: kept apart because a caller counting the map's
   *  waterfalls should not have to filter. */
  falls: CascadeBand[];
  /** The planet's water story, or null where the ground carried none: the one course a reader
   *  follows from its spring to its arrival, and what a contact sheet draws the spine of. */
  story: WaterStory | null;
  /** The cascade stairs down the mass's flanks: the map's stacked water figures. */
  stairs: CascadeStair[];
  /** The large composed bodies, in the order they were drawn. */
  figures: ComposedBody[];
  /** The fountain courts standing on the map. */
  fountains: FountainCourt[];
  /** The places raised a tier above their district's floor: what cuts a block into the composed
   *  places a reader can tell apart. */
  terraces: Rect[];
  /** The strips raised behind an anchor building's door. */
  backings: Rect[];
  sunken: Rect[];
  rings: Rect[];
  /** The map's text/pattern set piece, on the maps whose region list drew one and whose ground
   *  carried it. */
  landmark: LandmarkPlan | null;
}

export interface SculptInput {
  template: MapTemplate;
  /** Stage A: the plates and the tier each cell stands at. */
  composition: CompositionPlan;
  /** Stage B: the pavement to reserve and the flights whose landings must be carved. */
  streets: StreetPlan;
  /** Stage C: the places, so a kit's ground treatment lands on its own place. */
  plan: DesignPlan;
  /** The anchor placements, so the ground under a building and its doorstep stays level. */
  anchors: AnchorPlan;
  seed: number;
  richness: number;
  /** The map's own ceiling. The composition already drew its plates under it; this is what keeps the
   *  passes that ADD a tier — a place's terrace, a door's backing, a shop's ring — under it too. */
  maxElevation?: number;
  /** What each place's kit wants of its ground. Absent leaves the sculpt as terrain and water. */
  ground?: readonly KitGround[];
  /** The walk, so its water is cut before the planet's own passes spend the budget elsewhere. */
  line?: MovementLine;
  /**
   * How much of the water the richness knob asks for this planet actually takes: 0 for dry land, 1
   * for the mixed planet, more for a map that is mostly sea. The shelf's three planet kinds are
   * named after exactly this difference.
   */
  waterScale?: number;
}

// --- the sculpt ---------------------------------------------------------------------------------

export function sculptTerrain(input: SculptInput): TerrainSculpt {
  const { template, composition, streets, plan, anchors } = input;
  const W = template.width, H = template.height, N = W * H;
  const richness = clamp01(input.richness);
  const waterScale = Math.max(0, input.waterScale ?? 1);

  const grass = paintableMask(template);
  const flat = flatReservation(template, plan, anchors, streets, grass);
  const tiers = cellTiers(template, composition);

  const terrain: TerrainPlan = {
    width: W, height: H, tier: new Int8Array(N), water: new Int8Array(N).fill(-1),
  };
  for (let i = 0; i < N; i++) if (grass[i]) terrain.tier[i] = tiers[i]!;
  carveLandings(terrain, grass, streets);

  const ground = new Map((input.ground ?? []).map((g) => [g.regionId, g] as const));
  // THE CEILING IS THE ONE THE PLAN WAS DRAWN UNDER, whether or not the caller repeats it. The three
  // passes below add a tier to a place, a door's backing or a shop's ring, and each was gated only on
  // the CALLER's own cap: a caller that gave the composition a ceiling and not the sculptor got a map
  // taller than it asked for, which is the promise the shelf's Max-Height makes.
  //
  // IT IS THE COMPOSITION'S ASK, NOT THE HEIGHT IT SPENT. A place's terrace standing one tier above
  // the ground it sits on is the quiet end's only relief — the flat garden town's plan peaks at one
  // tier or none — and clamping to what the plates actually used cost richness 0 a quarter of its
  // street arrivals (measured: 9 of 34 ends arriving at nothing, against none). So a map whose plates
  // stopped below the ask can still be scenery all the way up to it, and none of them passes it.
  const ceiling = Math.max(1, Math.min(
    input.maxElevation ?? ELEVATION_MAX, ELEVATION_MAX, composition.peakTier,
  ));
  // Which cells a scenery pass has already lifted, so no second pass lifts one again (see the passes).
  const raised = new Uint8Array(N);
  const wall = wallOf(composition);
  const water: WaterFeature[] = [];
  const falls: CascadeBand[] = [];
  // THE WALK'S OWN WATER IS CUT WHATEVER THE PLANET KIND, because a channel the primary trunk was
  // planned to step over is a hole in the walk if it is not there: `streets.ts` already took the gap
  // out of the pavement, and a dry gap is a break rather than a crossing.
  water.push(...openLineCrossings(terrain, grass, flat, streets, waterScale > 0));
  // THE LANDMARK GOES BEFORE EVERY PASS THAT SPENDS OPEN GROUND — the ornamental terraces as much as
  // the water. It is the map's PRIMARY set piece — a phrase or a pattern written at planet scale, which
  // is the one thing on a map that happens once — and what it needs is the largest panel of ONE tier the
  // planet has. Cut after the water and it finds nowhere to stand at all; cut after the place terraces
  // and it finds the tier field broken into lots, since each of those lifts is a patch of its own tier in
  // the middle of a block: over ten full-richness seeds, cutting it in front of them holds the panel at
  // 312-544 cells rather than the terrace-floor class. Its own cells are locked into the reservation as
  // it lands, so nothing later floods the panel or raises a terrace through it.
  const hub = {
    x: Math.round(plan.plazaHub.x + plan.plazaHub.w / 2),
    y: Math.round(plan.plazaHub.y + plan.plazaHub.h / 2),
  };
  // THE REGION IS NOT THE GATE. From `FIGURE_FROM` up every planet carries a figure, and the region only
  // says where a ground field would rather stand. Gating on it makes the map's one set piece depend on a
  // theme draw: three maps in five draw the region, a roll takes two thirds of those, and the finished
  // figure lands on about one seed in twelve.
  const region = landmarkRegion(plan);
  // A PLANET ASKED FOR NO WATER CANNOT CARRY THE FIGURE. Both of the landmark's forms write with
  // water — the wall banner floods a panel and leaves the glyph standing in it, the ground field
  // floods the glyph's background — so there is no dry version of it to draw. `waterScale` 0 is the
  // `earth` kind saying it holds none, and the figure is skipped rather than made the one pass that
  // ignores the answer: cut before this gate, it puts a hundred-odd water cells on an earth planet.
  const landmark = waterScale > 0 ? carveLandmark({
    terrain, grass, flat, clearance: openGround(flat, plan, W, H, terrain),
    wall, hub, seed: input.seed, richness, ...(region ? { region } : {}),
  }) : null;
  if (landmark) {
    for (const i of landmarkCells(landmark, W, H)) flat[i] = 1;
  }

  // ONE PASS MAY RAISE A CELL, and only one. The three scenery passes below each read the tier under
  // them and add one, so where two of them claim the same lot the ground climbs twice: measured at
  // richness 0.2, `tafa/1024` and `tafa/8675309` planned one tier and built three, and a place standing
  // two tiers above its own ground is scenery nobody composed.
  const terraces = terracePlaces(terrain, grass, flat, raised, plan, richness, input.seed, ceiling);
  const backings = raiseBackings(terrain, grass, flat, raised, plan, ceiling);
  const rings = raiseRings(terrain, grass, flat, raised, plan, ground, ceiling);
  const sunken = sinkCourts(terrain, grass, flat, plan, ground);
  // AND THE TERRACE EDGES ARE EATEN INTO, wherever nothing is built against them.
  erodeSeams(terrain, grass, flat, raised, input.seed);

  let story: WaterStory | null = null;
  let fountains: FountainCourt[] = [];
  let stairs: CascadeStair[] = [];
  let figures: ComposedBody[] = [];
  const endPoolsCut: WaterFeature[] = [];
  if (waterScale > 0 && richness > WATER_FROM) {
    const budget = Math.round(waterScale * countLand(grass)
      * lerp(WATER_SHARE.min, WATER_SHARE.max, (richness - WATER_FROM) / (1 - WATER_FROM)));
    // THE COURTS FIRST, because they are ANCHORED — at the plaza, at the middle of a place, against a
    // street — and the course is not: a court that lost its ground to a stream has nowhere else to
    // stand, while a stream routes around a reserved court without noticing it.
    fountains = carveFountains({
      t: terrain, grass, flat, plan, paved: pavedMask(streets, W, H), richness, seed: input.seed,
      ceiling,
    });
    for (const court of fountains) {
      water.push({ kind: 'fountain', regionId: court.regionId, rect: court.rect, tier: court.tier });
    }
    // THE POOLS AT THE STREET ENDS COME NEXT, and before anything that spends ground. A walk that stops
    // in open ground has arrived at nothing — which the hard ledger reads and a visitor feels — and a
    // pool is four cells at most. Cut after the figures, the ground in front of an end is taken by one and
    // the planting that would otherwise mark the end has nowhere to stand: at richness 0.2, `tafa/4242`
    // leaves four of its twenty-five ends arriving at nothing instead of all twenty-five arriving.
    endPoolsCut.push(...cutEndPools({
      t: terrain, grass, flat, streets, seed: input.seed,
      budget: budget - countWater(terrain),
      ...(input.line ? { arrival: input.line.terminus } : {}),
    }));
    water.push(...endPoolsCut);
    // THEN THE STAIRS, before anything else takes the flanks. A stair needs a run of terrace steps
    // free of everything, which is the scarcest ground on the map and the one thing the accents and
    // the ambient falls will happily spend a cell of; and it is the planet's own biggest water figure,
    // so it is worth the whole flank it stands on.
    stairs = carveCascadeStairs({
      t: terrain, grass, flat, richness, ...(input.line ? { line: input.line } : {}),
    });
    for (const stair of stairs) {
      water.push({ kind: 'stair', regionId: '', rect: boundsOfCells(stair.cells), tier: stair.bands[0]!.tier });
      for (const band of stair.bands) falls.push({ rect: band.rect, tier: band.tier });
    }
    // THEN THE STORY, which carries on from the LOWEST stair's own foot where there is one: the two
    // are the same system told on a slope and then across the planet, and a course that started a
    // spring of its own somewhere else would leave the map with two. The lowest, because water runs
    // down: a course leaving the higher of two feet would have to climb past the other one.
    const lowest = stairs.reduce<CascadeStair | null>(
      (best, s) => (best === null || s.footTier < best.footTier ? s : best), null);
    const mouth = lowest ? { at: lowest.foot, tier: lowest.footTier } : undefined;
    story = carveWaterStory({
      t: terrain, grass, flat, plan, richness, seed: input.seed,
      ...(input.line ? { line: input.line } : {}), ...(mouth ? { mouth } : {}),
    });
    if (story) {
      for (const reach of story.reaches) {
        water.push({ kind: 'story', regionId: '', rect: boundsOfCells(reach.cells), tier: reach.tier });
      }
      for (const fall of story.falls) {
        falls.push({ rect: fall.rect, tier: fall.tier });
        water.push({ kind: 'fall', regionId: '', rect: fall.rect, tier: fall.tier });
      }
      if (story.pond) {
        water.push({ kind: 'pond', regionId: '', rect: story.pond.rect, tier: story.pond.tier });
      }
    }
    // THEN THE LARGE FIGURES, which is where most of a map's water goes. 7 of the style target's 83
    // bodies hold 63% of its water: few large composed forms and a tail of accents, which is the
    // distribution the accent pass on its own could never produce.
    figures = cutComposedBodies({
      t: terrain, grass, flat, plan, hub, richness, seed: input.seed,
      ...(input.line ? { line: input.line } : {}),
      budget: Math.round(FIGURE_SHARE * (budget - countWater(terrain))),
    });
    for (const body of figures) {
      water.push({ kind: 'figure', regionId: body.regionId, rect: body.rect, tier: body.tier });
    }
    // The ambient cascades: the steps the walk asked for by name, plus a seeded share of the rest.
    const ambient = cutFalls(terrain, grass, flat, richness, input.seed, cascadeRects(input.line));
    falls.push(...ambient);
    for (const band of ambient) water.push({ kind: 'fall', regionId: '', rect: band.rect, tier: band.tier });
    // WHAT IS LEFT GOES IN AS ACCENTS, never as beds. 32 of the style target's bodies are six cells or
    // fewer and hold 2.6% of its water: a landscape pool is a thing beside a path, and the moment it is
    // allowed to grow it becomes a rectangle with a mountain border round it.
    water.push(...cutAccents({
      t: terrain, grass, flat, room: openGround(flat, plan, W, H, terrain),
      hub, taken: endPoolsCut.map((f) => ({ x: f.rect.x, y: f.rect.y })),
      budget: budget - countWater(terrain), richness, seed: input.seed,
    }));
  }

  return {
    terrain, tiers, wall, water, falls, story, stairs, figures, fountains, terraces, backings,
    sunken, rings, landmark,
  };
}

/** The composition's mass as a wall profile: the box its top plates stand in, and how tall they are.
 *  The landmark asks a plan where its high ground is, and this is the answer wherever the mass ended
 *  up — a wall on any side, a corner, or a massif. */
function wallOf(composition: CompositionPlan): WallProfile {
  const peak = composition.plates.reduce((m, p) => Math.max(m, p.tier), 0);
  if (peak <= 0) return { rect: { x: 0, y: 0, w: 0, h: 0 }, peak: 0, climbRows: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const plate of composition.plates) {
    if (plate.tier < peak) continue;
    x0 = Math.min(x0, plate.rect.x); y0 = Math.min(y0, plate.rect.y);
    x1 = Math.max(x1, plate.rect.x + plate.rect.w); y1 = Math.max(y1, plate.rect.y + plate.rect.h);
  }
  const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return { rect, peak, climbRows: Math.max(1, Math.round(rect.h / 3)) };
}

/** The terraces a flight steps down. Every ramp but the last lands on one, and the sculptor is the
 *  only thing that can put it there: stage B declared the rect and the tier, having already cleared
 *  the pavement out of the corridor and reserved it. */
function carveLandings(t: TerrainPlan, grass: Uint8Array, streets: StreetPlan): void {
  for (const flight of streets.flights) {
    for (const landing of flight.landings) {
      for (let y = landing.rect.y; y < landing.rect.y + landing.rect.h; y++) {
        for (let x = landing.rect.x; x < landing.rect.x + landing.rect.w; x++) {
          if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
          const i = flatIndex(x, y, t.width);
          if (!grass[i]) continue;
          t.tier[i] = landing.tier;
          t.water[i] = -1;
        }
      }
    }
  }
}

// --- what may never be touched ------------------------------------------------------------------

/**
 * The cells no later pass may change: the pavement and everything placed on the ground.
 *
 * What the `flat` placement trait asks for is that an object's footprint PLUS one column right and
 * one row bottom all stand at one level (the dual-grid margin), so water cut at (x, y) is what
 * refuses a coating at (x-1, y), (x, y-1) and the corner between them. A road cell therefore claims
 * exactly the four cells of its own sweep. Everything with an EXTENT — the plaza, a building, a
 * lane, a flight's corridor — keeps a full ring instead: those are placed by a search that may shift
 * them a cell, and a reservation cut to one anchor would not cover where they land.
 *
 * The tiers themselves are not the reservation's business: the streets were planned ON the plates
 * and ride them, which is what puts the town on terraces instead of on a plain.
 */
function flatReservation(
  template: MapTemplate, plan: DesignPlan, anchors: AnchorPlan, streets: StreetPlan, grass: Uint8Array,
): Uint8Array {
  const W = template.width, H = template.height;
  const core = new Uint8Array(W * H);
  const mark = (rect: Rect): void => {
    for (let y = Math.max(0, rect.y); y < Math.min(H, rect.y + rect.h); y++) {
      for (let x = Math.max(0, rect.x); x < Math.min(W, rect.x + rect.w); x++) core[flatIndex(x, y, W)] = 1;
    }
  };
  const markCell = (c: MacroCoord): void => {
    if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) core[flatIndex(c.x, c.y, W)] = 1;
  };

  mark(plan.plazaHub);
  for (const flight of streets.flights) mark(flight.corridor);
  for (const lane of anchors.lanes) for (const c of lane.cells) markCell(c);
  for (const p of anchors.placements) {
    const item = getCatalogItem(p.catalogId);
    if (!item) continue;
    const size = getRotatedSize(item, p.rotation);
    const rect = { x: p.position.x, y: p.position.y, w: size.w, h: size.h };
    mark(rect);
    const door = buildingGate(rect, p.rotation);
    markCell(door.approach);
    for (const c of door.clear) markCell(c);
  }

  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!core[flatIndex(x, y, W)]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[flatIndex(nx, ny, W)] = 1;
        }
      }
    }
  }
  for (const c of streets.cells) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const x = c.x + dx, y = c.y + dy;
      if (x >= 0 && y >= 0 && x < W && y < H) out[flatIndex(x, y, W)] = 1;
    }
  }
  // Nothing off the buildable planet is touched either, so a later pass can read one mask.
  for (let i = 0; i < out.length; i++) if (!grass[i]) out[i] = 1;
  return out;
}

// --- the places' own ground ---------------------------------------------------------------------

/**
 * A PLACE STANDS ON ITS OWN TERRACE, one tier above the block's floor.
 *
 * This is what makes a composed place read as a place, and the reference's own segmentation is the
 * argument: roads alone leave the style target as one 8514-cell blob, and it is the TERRACE STEP
 * that cuts it into its 69 places of median 48 cells. A block whose places all
 * stand at the block's own tier reads as one field with several plantings on it, whatever the kits
 * do inside it.
 *
 * The raise takes the lot's INTERIOR, one cell in from its edge, so the step is drawn inside the
 * block and never against a street: the reservation already holds every cell a coating validates,
 * and a place that would take one of them is left flat rather than raised in part. One tier, so
 * V-MTN-03 has nothing to say — the support a cell needs is the ground beside it.
 */
function terracePlaces(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, raised: Uint8Array, plan: DesignPlan,
  richness: number, seed: number, ceiling: number,
): Rect[] {
  const share = lerp(PLACE_TERRACE.low, PLACE_TERRACE.high, richness);
  const out: Rect[] = [];
  for (const region of plan.regions) {
    const lot = region.lot[0];
    if (!lot || lot.w < 5 || lot.h < 5) continue;
    if (region.kind !== 'theme') continue;
    if (hash01(seed ^ 0x71e2, hashId(region.id)) >= share) continue;
    const rect = inset(lot, 1);
    if (!clearGround(t, grass, flat, raised, rect)) continue;
    const tier = t.tier[flatIndex(rect.x, rect.y, t.width)]!;
    if (tier >= ceiling) continue;
    liftRect(t, raised, rect, tier + 1, hashId(region.id) ^ seed);
    out.push(rect);
  }
  return out;
}

/**
 * The BACKING behind a building's door (the game's own 背后有靠山): the strip at the far end of an
 * anchor's lot, raised a tier, with the front left open.
 *
 * The composition decides where the map's mass is; this is the region-scale half of the same rule,
 * and it is the half a building can be given wherever it stands. 5 of the style target's 12 buildings
 * stand with higher ground behind the door.
 */
function raiseBackings(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, raised: Uint8Array, plan: DesignPlan,
  ceiling: number,
): Rect[] {
  const out: Rect[] = [];
  for (const region of plan.regions) {
    if (region.kind === 'theme' || !region.backing) continue;
    out.push(...raiseStrip(t, grass, flat, raised, region.backing, ceiling, 0));
  }
  return out;
}

/**
 * A backing strip raised a tier, SPLIT where the ground under it is not all one surface.
 *
 * `largestClear` trims a strip from its ends, which answers a strip with something standing in one end
 * and nothing at all for a strip that straddles a terrace step — and on a terraced planet that is most
 * of them, since a lot's deep end is where the block's own step falls. So a strip that cannot be raised
 * whole is halved and each half offered the same test, twice down. The backing behind a door is the
 * half the door faces as much as the whole width of the lot.
 */
function raiseStrip(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, raised: Uint8Array, rect: Rect, ceiling: number,
  depth: number,
): Rect[] {
  const whole = largestClear(t, grass, flat, raised, rect);
  if (whole) {
    const tier = t.tier[flatIndex(whole.x, whole.y, t.width)]!;
    if (tier >= ceiling) return [];
    // TWO TIERS WHERE THE GROUND CARRIES THEM. The score this pass exists for reads the mean surface of
    // the 7x7 sector two to eight cells behind the door against the sector in front of it, and asks for
    // a quarter of a tier between them: a strip of a dozen cells raised ONE tier moves that mean by
    // about a third of a tier, which clears the bar only where the strip is nearly the width of the
    // sector. The second tier is what makes a backing read as a backing from the doorstep — and it is
    // V-MTN-03 that says when it may be taken, since a cell at N wants its whole 3x3 at N-3 or above.
    //
    // THE CHEAPER VARIANT IS RULED OUT BY MEASUREMENT. Lifting two tiers only where the strip is smaller
    // than a quarter of that sector — the arithmetic says one tier over 13 of its 49 cells already moves
    // the mean far enough — reads backing coverage at 0.51 and 0.47 over twenty maps, no better than a
    // one-tier lift everywhere, and buys no symmetry back (the worst hexia seed falls from 0.20 to 0.13).
    // The strips that carry the reading are the long ones, and they are the ones that test spares.
    const lift = tier + 2 <= ceiling && clearGround(t, grass, flat, raised, whole, 2) ? 2 : 1;
    liftRect(t, raised, whole, tier + lift, whole.x * 131 + whole.y);
    return [whole];
  }
  if (depth >= BACKING_SPLITS || Math.max(rect.w, rect.h) < 4) return [];
  const alongX = rect.w >= rect.h;
  const half = Math.floor((alongX ? rect.w : rect.h) / 2);
  const a: Rect = alongX ? { ...rect, w: half } : { ...rect, h: half };
  const b: Rect = alongX
    ? { ...rect, x: rect.x + half, w: rect.w - half }
    : { ...rect, y: rect.y + half, h: rect.h - half };
  return [
    ...raiseStrip(t, grass, flat, raised, a, ceiling, depth + 1),
    ...raiseStrip(t, grass, flat, raised, b, ceiling, depth + 1),
  ];
}

/** Raise a rectangle with seeded corner chamfers and reserve its cells from later lifts. */
function liftRect(t: TerrainPlan, raised: Uint8Array, rect: Rect, tier: number, salt?: number): void {
  const cut = salt === undefined ? null : chamfers(rect, salt);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (cut && cut(x, y)) continue;
      const i = flatIndex(x, y, t.width);
      t.tier[i] = tier;
      raised[i] = 1;
    }
  }
}

/**
 * Erode unused upper seam cells with smooth noise after street planning. Each cell drops only to the
 * highest lower edge-neighbor tier, subject to the 3x3 mountain-support window. Water and its 3x3
 * neighborhood are excluded so erosion cannot create an uncapped water face.
 */
function erodeSeams(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, raised: Uint8Array, seed: number,
): void {
  const noise = valueNoise01((seed ^ 0x5ea3) >>> 0);
  const W = t.width, H = t.height;
  for (let pass = 0; pass < SEAM_BITE_MAX; pass++) {
    const bite: { i: number; tier: number }[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = flatIndex(x, y, W);
        if (!grass[i] || flat[i] || raised[i] || t.water[i]! >= 0) continue;
        const here = t.tier[i]!;
        if (here <= 0) continue;
        if (noise(x / SEAM_NOISE_SPAN, y / SEAM_NOISE_SPAN) < SEAM_BITE_FROM + pass * SEAM_BITE_STEP) continue;
        // The highest tier below this one among the cells it shares an edge with: a seam is eroded by
        // one rung of the staircase, never down to the floor of the planet.
        let target = -1;
        for (const [dx, dy] of NEIGHBORS4) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = flatIndex(nx, ny, W);
          if (!grass[j] || t.water[j]! >= 0) continue;
          const there = t.tier[j]!;
          if (there < here && there > target) target = there;
        }
        if (target < 0) continue;
        let legal = true;
        for (let dy = -1; dy <= 1 && legal; dy++) {
          for (let dx = -1; dx <= 1 && legal; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = flatIndex(nx, ny, W);
            if (t.water[j]! >= 0) legal = false;
            else if (t.tier[j]! - target > PLATE_STEP_MAX) legal = false;
          }
        }
        if (!legal) continue;
        bite.push({ i, tier: target });
      }
    }
    // Applied after the sweep, so one pass reads one surface: eroding as it goes would let a bite eat
    // its way inland across a whole terrace in a single pass.
    for (const { i, tier } of bite) t.tier[i] = tier;
    if (!bite.length) break;
  }
}

/**
 * How deep a bite may go, how wide the scallops are, and where the noise has to stand for a cell to
 * go.
 *
 * Two cells is the depth at which the reading moves and a terrace still reads as the surface it is:
 * one pass takes the median component's box fill to 0.86 and two to 0.78, against 0.58 on the
 * reference and 1.00 with no bite taken. The span is a scallop of about a dozen cells, which is the
 * scale the reference's own terrace edges wander at; the threshold rises per pass so the second bite is
 * taken out of the middle of the first rather than along its whole length.
 */
const SEAM_BITE_MAX = 2;
const SEAM_NOISE_SPAN = 12;
const SEAM_BITE_FROM = 0.5;
const SEAM_BITE_STEP = 0.12;

/**
 * The corner chamfers of one lift: a predicate saying whether a cell is cut off the rect.
 *
 * ONE DEPTH FOR ALL FOUR CORNERS, seeded per lift, so the shape is an octagon and not a box — and so
 * it keeps BOTH MIRROR AXES, which is the whole reason the depths are not drawn per corner. The
 * evaluation reads a place's planting for a mirror match over the region the terrace step cuts, and a
 * region whose own outline is asymmetric cannot answer it: over six full-richness seeds, scalloping
 * these edges takes the region-symmetry share from 0.67-0.83 to 0.25-0.50, and `local-symmetry` is
 * already one of the scorecard's three weakest dimensions. An octagon costs it nothing.
 *
 * The shape stays 4-connected because a chamfer only ever eats a corner: the depth is capped below the
 * short side, so the two cuts at either end of a side cannot meet.
 */
function chamfers(rect: Rect, salt: number): (x: number, y: number) => boolean {
  const short = Math.min(rect.w, rect.h);
  const cap = Math.min(CHAMFER_MAX, Math.max(0, Math.floor(short * CHAMFER_SHARE)), short - 2);
  if (cap <= 0) return () => false;
  const depth = 1 + Math.round(hash01(salt ^ 0xc4a3, 1) * (cap - 1));
  return (x: number, y: number): boolean => {
    const dx = x - rect.x, dy = y - rect.y;
    const rx = rect.w - 1 - dx, ry = rect.h - 1 - dy;
    return Math.min(dx, rx) + Math.min(dy, ry) < depth;
  };
}

/** How much of a lift's short side a corner may take, and the deepest chamfer whatever the size. A
 *  third is what moved the median box fill of the map's terrace components from 1.00 to the
 *  reference's own class; the cap keeps a long backing strip from losing its ends. */
const CHAMFER_SHARE = 0.34;
const CHAMFER_MAX = 4;

/** The largest sub-rect of `rect` that is clear ground at one tier, trimmed from whichever side
 *  carries something, or null when nothing of it is left. */
function largestClear(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, raised: Uint8Array, rect: Rect,
): Rect | null {
  const out = { ...rect };
  for (let guard = 0; guard < rect.w + rect.h; guard++) {
    if (out.w < 2 || out.h < 1) return null;
    if (clearGround(t, grass, flat, raised, out)) return out;
    // Trim the longer axis first, so a strip keeps its length against the door.
    if (out.w >= out.h) {
      out.x++; out.w--;
      if (clearGround(t, grass, flat, raised, out)) return out;
      out.w--;
    } else {
      out.y++; out.h--;
      if (clearGround(t, grass, flat, raised, out)) return out;
      out.h--;
    }
  }
  return null;
}

/**
 * Whether a rect is untouched planet ground at ONE tier that no other pass has claimed, AND whether
 * a tier may be added to it.
 *
 * The second half is V-MTN-03 read forward: a cell standing at N needs its whole 3x3 at N-3 or above,
 * so a rect may only be raised by `lift` where everything around it already stands within
 * `PLATE_STEP_MAX - lift` tiers of its own. Its neighbours are plates a step below it as often as not,
 * and a place raised beside one of those is the difference between a terrace and a repaired-away hole.
 */
function clearGround(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, raised: Uint8Array, rect: Rect, lift = 1,
): boolean {
  if (rect.w < 1 || rect.h < 1) return false;
  const tier = t.tier[flatIndex(rect.x, rect.y, t.width)]!;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 0 || y < 0 || x >= t.width || y >= t.height) return false;
      const i = flatIndex(x, y, t.width);
      if (!grass[i] || flat[i] || raised[i] || t.water[i]! >= 0 || t.tier[i] !== tier) return false;
    }
  }
  for (let y = rect.y - 1; y <= rect.y + rect.h; y++) {
    for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
      if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
      const i = flatIndex(x, y, t.width);
      const level = t.water[i]! >= 0 ? t.water[i]! : t.tier[i]!;
      if (level < tier + lift - PLATE_STEP_MAX) return false;
    }
  }
  return true;
}

// --- the kits' own ground -----------------------------------------------------------------------

/** The one-layer terrace ring a shop complex stands inside (商店周围一圈一层山体), raised around the
 *  place's border and left open on its entry side. */
function raiseRings(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, raised: Uint8Array, plan: DesignPlan,
  ground: ReadonlyMap<string, KitGround>, ceiling: number,
): Rect[] {
  const out: Rect[] = [];
  for (const region of plan.regions) {
    if (!ground.get(region.id)?.ring) continue;
    const lot = region.lot[0];
    if (!lot || lot.w < 6 || lot.h < 6) continue;
    // A RING IS RAISED WHOLE OR NOT AT ALL. Skipping the cells another pass already raised would leave
    // a border standing at two levels, and the ground the shop's own doorstep needs level would not be:
    // measured on `hexia/39596`, the facility the ring was cut for could not be placed at all.
    const border: number[] = [];
    let clear = true;
    for (let y = lot.y; y < lot.y + lot.h && clear; y++) {
      for (let x = lot.x; x < lot.x + lot.w && clear; x++) {
        const onBorder = x < lot.x + RING_W || x >= lot.x + lot.w - RING_W
          || y < lot.y + RING_W || y >= lot.y + lot.h - RING_W;
        if (!onBorder || onEntrySide(lot, region.orientation, x, y)) continue;
        const i = flatIndex(x, y, t.width);
        if (!grass[i] || flat[i] || t.water[i]! >= 0) continue;
        if (raised[i] || t.tier[i]! >= ceiling) clear = false;
        else border.push(i);
      }
    }
    if (!clear || border.length === 0) continue;
    for (const i of border) {
      t.tier[i] = t.tier[i]! + 1;
      raised[i] = 1;
    }
    out.push(lot);
  }
  return out;
}

/** Whether a cell sits in the place's entry-side strip, which a ring leaves open. */
function onEntrySide(lot: Rect, entry: Direction, x: number, y: number): boolean {
  switch (entry) {
    case 'north': return y < lot.y + RING_W;
    case 'south': return y >= lot.y + lot.h - RING_W;
    case 'west': return x < lot.x + RING_W;
    default: return x >= lot.x + lot.w - RING_W;
  }
}

/** The sunken court (竹林的中式下沉庭院): the middle of a place dropped one tier. */
function sinkCourts(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, plan: DesignPlan,
  ground: ReadonlyMap<string, KitGround>,
): Rect[] {
  const out: Rect[] = [];
  for (const region of plan.regions) {
    if (!ground.get(region.id)?.sunken) continue;
    const lot = region.lot[0];
    if (!lot) continue;
    const rect: Rect = {
      x: lot.x + SUNKEN_INSET, y: lot.y + SUNKEN_INSET,
      w: lot.w - 2 * SUNKEN_INSET, h: lot.h - 2 * SUNKEN_INSET,
    };
    if (rect.w < SUNKEN_MIN || rect.h < SUNKEN_MIN) continue;
    const cut = chamfers(rect, hashId(region.id));
    let sunk = 0;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (cut(x, y)) continue;
        const i = flatIndex(x, y, t.width);
        if (!grass[i] || flat[i] || t.tier[i]! < 1 || t.water[i]! >= 0) continue;
        t.tier[i] = t.tier[i]! - 1;
        sunk++;
      }
    }
    if (sunk > 0) out.push(rect);
  }
  return out;
}

// --- the water compositions ---------------------------------------------------------------------

/**
 * The gap the movement line steps over, opened in the stretch `streets.ts` left unpaved.
 *
 * A stretch at elevation 0 is FLOODED: nothing is lower than 0, so ground water shows no face and
 * needs no caps. A raised stretch is cut DOWN into a gorge instead, which is what a terraced planet
 * can actually offer a bridge — a deck spans any below-deck gap between two flat ends of equal
 * height, and on a map whose ground is nowhere at sea level a channel is not one of the options.
 *
 * The drop is exactly V-MTN-03's own window, so the cut is legal by construction: the banks standing
 * at the gap's tier have the floor of the gorge inside their 3x3 at that tier minus three, which is
 * the support the rule asks for. The opened cells are then locked into the reservation, so no later
 * pass floods or raises the gap the deck was planned for.
 */
function openLineCrossings(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, streets: StreetPlan, wet: boolean,
): WaterFeature[] {
  const out: WaterFeature[] = [];
  for (const crossing of streets.crossings) {
    const rect = crossing.open;
    const floor = Math.max(0, crossing.tier - GORGE_DROP);
    let opened = 0;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (x < 1 || y < 1 || x >= t.width - 1 || y >= t.height - 1) continue;
        const i = flatIndex(x, y, t.width);
        if (!grass[i] || flat[i] || t.water[i]! >= 0) continue;
        // AN EARTH PLANET FLOODS NOTHING, its crossings included. The `earth` kind's whole meaning
        // is that the map holds no water (`waterScale` 0), and a flooded channel is water however it
        // was planned: seed 7 came back with twelve wet cells on a map whose kind promises none.
        // What it gets instead is the gorge every terraced crossing gets, which a deck spans just
        // the same.
        if (crossing.kind === 'water' && wet) {
          t.tier[i] = 0;
          t.water[i] = 0;
        } else {
          t.tier[i] = floor;
        }
        flat[i] = 1;
        opened++;
      }
    }
    if (opened > 0) {
      out.push({ kind: 'crossing', regionId: '', rect, tier: crossing.tier });
    }
  }
  return out;
}

/** Where the walk asked for a cascade: the bands beside its climbs, which `cutFalls` takes as the
 *  steps worth cutting whatever the seeded share would otherwise have said. */
function cascadeRects(line: MovementLine | undefined): Rect[] {
  return (line?.waterWants ?? [])
    .filter((w): w is WaterWant => w.kind === 'cascade')
    .map((w) => w.rect);
}

/**
 * The falls: a band of water cut along a terrace step, pouring onto the terrace below.
 *
 * A step is where a cell stands exactly one tier above its neighbour, and a run of such cells is one
 * lip. The band takes the middle of the run and leaves a cell of standing terrace at each end, which
 * are the caps V-WTR-02 asks for; the row it pours onto is the plate below, uniform by construction,
 * which is V-WTR-03. Depth 2 is taken only where the row behind the lip stands at the lip's own tier
 * with its own caps, so the second row shows no face of its own.
 */
function cutFalls(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, richness: number, seed: number,
  wanted: readonly Rect[] = [],
): CascadeBand[] {
  const W = t.width, H = t.height;
  const run = Math.round(lerp(FALL_RUN.min, FALL_RUN.max, richness));
  const depth = Math.round(lerp(FALL_DEPTH.min, FALL_DEPTH.max, richness));
  const share = lerp(FALL_SHARE.low, FALL_SHARE.high, richness);
  const out: CascadeBand[] = [];
  const taken: MacroCoord[] = [];
  // How many bands of each size the map has cut, so no size is repeated past the congruence cap.
  const sized = new Map<string, number>();
  // Both axes: a step faces south or east as readily as it faces the way the mass leans.
  for (const axis of ['y', 'x'] as const) {
    const along = axis === 'y' ? W : H;
    const down = axis === 'y' ? H : W;
    for (let d = 1; d < down - 1; d++) {
      let a = 1;
      while (a < along - 1) {
        const at = (k: number): { x: number; y: number } => (axis === 'y' ? { x: k, y: d } : { x: d, y: k });
        const step = (k: number): boolean => {
          const c = at(k), n = axis === 'y' ? { x: k, y: d + 1 } : { x: d + 1, y: k };
          if (c.x < 1 || c.y < 1 || c.x >= W - 1 || c.y >= H - 1) return false;
          const i = flatIndex(c.x, c.y, W), j = flatIndex(n.x, n.y, W);
          return !!grass[i] && !flat[i] && !!grass[j] && !flat[j]
            && t.water[i]! < 0 && t.water[j]! < 0
            && t.tier[i]! >= 1 && t.tier[i]! === t.tier[j]! + 1;
        };
        if (!step(a)) { a++; continue; }
        let end = a;
        while (end + 1 < along - 1 && step(end + 1) && end - a + 1 < run + 2) end++;
        const length = end - a + 1;
        // The two end cells are the caps; what is left between them is the band.
        // A step the WALK asked for is always worth cutting: the cascade beside a climb is the
        // companion the movement line named, not one of the map's ambient falls.
        const asked = wanted.some((r) => rectHolds(r, at(a)) || rectHolds(r, at(end)));
        if (length >= FALL_RUN.min + 2 && (asked || hash01(seed ^ 0xfa11, a * 131 + d) < share)) {
          // NO TWO BANDS THE SAME SIZE, the congruence cap read on this pass's own output: a band taking
          // the whole of its run comes out `FALL_RUN.min` by `depth` at every minimal step on the map,
          // which is how one seed drops twenty-five congruent 5x3 bodies — wallpaper rather than water.
          // The length and the depth are drawn per site instead, and every
          // sub-band of a step run has the same caps the whole run would: the run's cells all stand at
          // one tier with lower ground ahead, so a shorter band's own end cells are caps too.
          const room = length - 2;
          const rows = 1 + Math.floor(hash01(seed ^ 0x5b09, a * 311 + d) * depth);
          // The drawn length, then the next one whose SIZE CLASS this map has not used up: a run only
          // `FALL_RUN.min` long can be cut one way, so on a planet of short steps the draw alone still
          // answers the same size every time.
          const draw = FALL_RUN.min
            + Math.floor(hash01(seed ^ 0x2c1f, a * 131 + d) * (room - FALL_RUN.min + 1));
          let want = 0;
          for (let k = 0; k <= room - FALL_RUN.min; k++) {
            const size = FALL_RUN.min + ((draw - FALL_RUN.min + k) % (room - FALL_RUN.min + 1));
            if ((sized.get(`${size}x${rows}`) ?? 0) < BAND_CLASS_MAX) { want = size; break; }
          }
          if (want === 0) { a = end + 1; continue; }
          const off = Math.floor(hash01(seed ^ 0x71a3, a * 197 + d) * (room - want + 1));
          const lo = a + 1 + off, hi = lo + want - 1;
          const c0 = at(lo);
          const tier = t.tier[flatIndex(c0.x, c0.y, W)]!;
          const near = taken.some((p) => Math.abs(p.x - c0.x) + Math.abs(p.y - c0.y) < FALL_GAP);
          // A BAND POURS ONE WAY, and both rules read the other three sides. V-WTR-02 wants a cap of
          // standing terrace at each perpendicular end, which the run's own end cells are; the back
          // of the band must stand at the band's own tier, or the water faces a drop there too and
          // its own apron is somebody else's terrace; and V-WTR-03 wants the row it pours onto,
          // caps included, at ONE elevation. The apron is then LOCKED, since a bed cut into it later
          // would break a fall already standing.
          const strip = (from: number, to: number, lo2: number, hi2: number): Rect => (axis === 'y'
            ? { x: lo2, y: from, w: hi2 - lo2 + 1, h: to - from + 1 }
            : { x: from, y: lo2, w: to - from + 1, h: hi2 - lo2 + 1 });
          const apron = strip(d + 1, d + 1, lo - 1, hi + 1);
          let deep = rows;
          while (deep > 0 && !atTier(t, grass, flat, strip(d - deep, d - deep, lo - 1, hi + 1), tier)) deep--;
          // THE CAP IS CHECKED ON THE SIZE THE BAND ACTUALLY COMES OUT AT. The depth is drawn before
          // the ground is read and then SHRINKS where the row behind the lip is not standing, so a band
          // asked for at one class lands in another: checking the asked class alone let five congruent
          // bodies through on one seed while the tally said three.
          const cls = `${want}x${deep}`;
          if (!near && deep > 0 && (sized.get(cls) ?? 0) < BAND_CLASS_MAX && uniform(t, grass, apron)) {
            sized.set(cls, (sized.get(cls) ?? 0) + 1);
            for (let k = 0; k < deep; k++) {
              const rect = strip(d - k, d - k, lo, hi);
              if (k > 0 && !atTier(t, grass, flat, strip(d - k, d - k, lo - 1, hi + 1), tier)) break;
              flood(t, rect, tier);
              out.push({ rect, tier });
            }
            taken.push(c0);
            for (let ay = apron.y; ay < apron.y + apron.h; ay++) {
              for (let ax = apron.x; ax < apron.x + apron.w; ax++) {
                if (ax >= 0 && ay >= 0 && ax < W && ay < H) flat[flatIndex(ax, ay, W)] = 1;
              }
            }
          }
        }
        a = end + 1;
      }
    }
  }
  return out;
}

/** Chebyshev distance from every cell to the nearest one a body of water must keep clear of: the
 *  sea, a place's own lot, the plaza, the reserved road space, and — where a `TerrainPlan` is
 *  passed — the water already cut. */
function openGround(
  flat: Uint8Array, plan: DesignPlan, W: number, H: number, cut?: TerrainPlan,
): Int16Array {
  const seeds: number[] = [];
  const near = new Uint8Array(flat);
  if (cut) for (let i = 0; i < near.length; i++) if (cut.water[i]! >= 0) near[i] = 1;
  for (const region of plan.regions) {
    for (const lot of region.lot) {
      for (let y = Math.max(0, lot.y); y < Math.min(H, lot.y + lot.h); y++) {
        for (let x = Math.max(0, lot.x); x < Math.min(W, lot.x + lot.w); x++) near[flatIndex(x, y, W)] = 1;
      }
    }
  }
  for (let i = 0; i < near.length; i++) if (near[i]) seeds.push(i);
  return distanceField(seeds, W, H, true);
}

/** Where the street plan is going to lay pavement: what a fountain court is composed against. */
function pavedMask(streets: StreetPlan, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (const c of streets.cells) {
    if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) out[flatIndex(c.x, c.y, W)] = 1;
  }
  return out;
}

interface AccentInput {
  t: TerrainPlan;
  grass: Uint8Array;
  flat: Uint8Array;
  room: Int16Array;
  hub: MacroCoord;
  /** Where a pool already stands, so the profile keeps its distance from the street ends. */
  taken: MacroCoord[];
  budget: number;
  richness: number;
  seed: number;
}

/** What a street-end pool needs: the plan's own street ends, and the walk's last stop to leave alone. */
interface EndPoolInput {
  t: TerrainPlan;
  grass: Uint8Array;
  flat: Uint8Array;
  streets: StreetPlan;
  /** Where the walk ends, which is the one street end that gets no pool: see `ARRIVAL_KEEP`. */
  arrival?: MacroCoord;
  /** Water cells this pass may spend. It runs before the figures and the accents, so what it takes
   *  they do not get, and a map with forty street ends would otherwise pour its whole budget into the
   *  doorsteps before the planet's own figures were drawn. */
  budget: number;
  seed: number;
}

/**
 * A pool at each planned street end.
 *
 * What the references put at the end of a walk is water: the style target's own two dead ends are a
 * street that stops six cells short of its shore. The ends are read off the street PLAN, since no road
 * tile exists yet when the ground is being shaped, and the walk's OWN last stop is left dry — the
 * look-out is what the climb was for, and a pool cut where the route arrives lowers the cell the
 * terminus names (measured on `tafa/12345`).
 */
function cutEndPools(input: EndPoolInput): WaterFeature[] {
  const { t, grass, flat, streets, seed, arrival } = input;
  const out: WaterFeature[] = [];
  const taken: MacroCoord[] = [];
  let budget = Math.max(0, input.budget);
  for (const site of endPools(streets, t.width, t.height)) {
    if (budget <= 0) break;
    if (arrival
      && Math.max(Math.abs(site.x - arrival.x), Math.abs(site.y - arrival.y)) <= ARRIVAL_KEEP) continue;
    // The same spacing the profile keeps: two pools that touch are one body, and a body over the accent
    // size has to account for itself to the water ledger.
    if (taken.some((c) => Math.abs(c.x - site.x) + Math.abs(c.y - site.y) < ACCENT_GAP)) continue;
    const laid = cutAccentAt(t, grass, flat, site, seed, END_POOL_SIZES);
    if (!laid) continue;
    out.push(laid);
    taken.push(site);
    budget -= laid.rect.w * laid.rect.h;
  }
  return out;
}

/**
 * The landscape pools: small, few, and placed where the references put their water.
 *
 * THE SIZE CAP IS THE WHOLE OF IT. A pool allowed to grow to the room its terrace offers comes out a
 * rectangle framed by mountain on every side; an accent is at most six cells and reads as a thing
 * beside a path. Where they go is the references' own ring and tier profile — nothing
 * inside the plaza's apron, most of them in the 30-to-50-cell band, none at the coast, and twice as
 * likely above the working platforms as on them — gathered by a smooth seeded field so they come in
 * groups rather than speckling every terrace.
 */
function cutAccents(input: AccentInput): WaterFeature[] {
  const { t, grass, flat, room, hub, richness, seed } = input;
  let budget = Math.max(0, input.budget);
  const count = Math.round(lerp(ACCENT_COUNT.min, ACCENT_COUNT.max, richness));
  if (budget <= 0 || count <= 0) return [];

  const anchors: number[] = [];
  for (let y = 1; y < t.height - 1; y += 2) {
    for (let x = 1; x < t.width - 1; x += 2) anchors.push(flatIndex(x, y, t.width));
  }
  const score = (i: number): number => {
    const x = i % t.width, y = (i / t.width) | 0;
    return fieldNoise(seed ^ 0x6c0f1e, x / 3, y / 3)
      + HIGH_TIER_PULL * (t.tier[i]! / ELEVATION_MAX)
      + ringPull(Math.max(Math.abs(x - hub.x), Math.abs(y - hub.y)));
  };
  anchors.sort((a, b) => score(b) - score(a) || a - b);

  const out: WaterFeature[] = [];
  const taken: MacroCoord[] = [...input.taken];
  for (const anchor of anchors) {
    if (out.length >= count || budget <= 0) break;
    const x = anchor % t.width, y = (anchor / t.width) | 0;
    if (taken.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) < ACCENT_GAP)) continue;
    const tier = t.tier[anchor]!;
    if (tier === 0 && room[anchor]! < ACCENT_KEEP) continue;
    const laid = cutAccentAt(t, grass, flat, { x, y }, seed);
    if (!laid) continue;
    out.push(laid);
    taken.push({ x, y });
    budget -= laid.rect.w * laid.rect.h;
  }
  return out;
}

/** One accent at a cell, in the first of the accent shapes the ground carries there. */
function cutAccentAt(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, at: MacroCoord, seed: number,
  sizes: readonly { w: number; h: number }[] = ACCENT_SIZES,
): WaterFeature | null {
  if (at.x < 1 || at.y < 1 || at.x >= t.width - 1 || at.y >= t.height - 1) return null;
  const tier = t.tier[flatIndex(at.x, at.y, t.width)]!;
  const first = Math.floor(hash01(seed ^ 0x4ac1, flatIndex(at.x, at.y, t.width)) * sizes.length);
  for (let k = 0; k < sizes.length; k++) {
    const size = sizes[(first + k) % sizes.length]!;
    const rect: Rect = { x: at.x, y: at.y, w: size.w, h: size.h };
    if (!poolFits(t, grass, flat, rect, tier)) continue;
    flood(t, rect, tier);
    return { kind: 'accent', regionId: '', rect, tier };
  }
  return null;
}

/** The cell a pool would stand in at each planned street end: the middle of the face, two cells
 *  ahead of it, which is where a walker coming down the street is looking. */
function endPools(streets: StreetPlan, W: number, H: number): MacroCoord[] {
  const paved = new Uint8Array(W * H);
  for (const c of streets.cells) {
    if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) paved[flatIndex(c.x, c.y, W)] = 1;
  }
  const out: MacroCoord[] = [];
  eachTerminus(paved, W, H, (face, dx, dy) => {
    const mid = face[face.length >> 1]!;
    out.push({ x: (mid % W) + dx * END_POOL_AHEAD, y: ((mid / W) | 0) + dy * END_POOL_AHEAD });
  });
  return out;
}

/** How much the accent pass wants a cell at `ring` cells from the plaza, 0 to 1: nothing on the
 *  apron, everything in the wet band, nothing at the coast. */
function ringPull(ring: number): number {
  if (ring <= ACCENT_RING.dry) return -1;
  if (ring < ACCENT_RING.from) return (ring - ACCENT_RING.dry) / (ACCENT_RING.from - ACCENT_RING.dry);
  if (ring <= ACCENT_RING.to) return 1;
  return Math.max(0, 1 - (ring - ACCENT_RING.to) / (ACCENT_RING.fade - ACCENT_RING.to));
}

// --- reading the sculpted surface back ----------------------------------------------------------

/**
 * Where a 1x1 `flat` object may stand on the finished terrain, and at what elevation.
 *
 * A plant validates its own cell plus one column right and one row bottom (the dual-grid margin), so
 * a cell one step north or west of a terrace step or a pool cannot carry one however level it is
 * itself. -1 says the cell is unplantable; anything else is the elevation the whole sweep stands at,
 * which is what cuts the map into the runs a place is composed on — and what makes a bed between two
 * water bars come out inset from the water on exactly the two sides the reference insets it.
 */
export function plantableSurface(state: GridState): Int8Array {
  const W = state.template.width, H = state.template.height;
  const out = new Int8Array(W * H).fill(-1);
  const level = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    const surf = realSurface(state.cells[y]?.[x]?.terrain);
    if (!surf) return 0;
    return surf.type === TerrainType.Water ? -1 : surf.elevation;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const e = level(x, y);
      if (e >= 0 && level(x + 1, y) === e && level(x, y + 1) === e && level(x + 1, y + 1) === e) {
        out[flatIndex(x, y, W)] = e;
      }
    }
  }
  return out;
}

/**
 * Where a road tile may be laid on the finished terrain: the cells whose whole `flat` sweep stands
 * on dry ground at ONE level, whatever that level is.
 *
 * A road coating asks exactly what a plant asks, so the two read one answer. It is not asking for
 * elevation 0: the streets ride the terraces they were planned on, which is what puts the town on
 * the composition instead of on a plain.
 */
export function pavableMask(state: GridState): Uint8Array {
  const surface = plantableSurface(state);
  const out = new Uint8Array(surface.length);
  for (let i = 0; i < surface.length; i++) if (surface[i]! >= 0) out[i] = 1;
  return out;
}

// --- small helpers ------------------------------------------------------------------------------

const countLand = (grass: Uint8Array): number => {
  let n = 0;
  for (let i = 0; i < grass.length; i++) if (grass[i]) n++;
  return n;
};

const countWater = (t: TerrainPlan): number => {
  let n = 0;
  for (let i = 0; i < t.water.length; i++) if (t.water[i]! >= 0) n++;
  return n;
};

const rectHolds = (r: Rect, c: MacroCoord): boolean =>
  c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;

const inset = (rect: Rect, k: number): Rect =>
  ({ x: rect.x + k, y: rect.y + k, w: Math.max(0, rect.w - 2 * k), h: Math.max(0, rect.h - 2 * k) });

/** A smooth -1..1 field over the map, so a basin gathers instead of speckling. Interpolated over
 *  `NOISE_SPAN` cells on both axes. */
function fieldNoise(seed: number, x: number, y: number): number {
  const cx = Math.floor(x / NOISE_SPAN), cy = Math.floor(y / NOISE_SPAN);
  const tx = x / NOISE_SPAN - cx, ty = y / NOISE_SPAN - cy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const at = (ix: number, iy: number): number => hash01(seed, ix * 73856093 ^ iy * 19349663) * 2 - 1;
  const top = at(cx, cy) + (at(cx + 1, cy) - at(cx, cy)) * sx;
  const bottom = at(cx, cy + 1) + (at(cx + 1, cy + 1) - at(cx, cy + 1)) * sx;
  return top + (bottom - top) * sy;
}

/** A stable value in [0,1) per (seed, index). */
function hash01(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (i + 0x165667b1), 0xc2b2ae35);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

const lerp = (a: number, b: number, v: number): number => a + (b - a) * clamp01(v);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
