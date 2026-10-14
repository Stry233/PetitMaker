/**
 * Materializes planned plates, street flights, water systems, and district treatments as terrain.
 * Water is carved in dependency order: courts, stairs, a connected course, large figures, ambient
 * falls, then accents. Plate spacing satisfies mountain support; water bodies either expose no lower
 * face or terminate each fall with same-tier caps over a uniform receiving row. The module is pure
 * and deterministic; the caller still applies the shared decrease-only repair before commit.
 */
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import type { MapTemplate } from '../../../../core/model/types';
import type { TerrainPlan } from '../../terrain-plan/types';
import type { AnchorPlan } from '../places/anchors';
import type { CompositionPlan } from '../composition/composition';
import { cellTiers, paintableMask } from '../planet';
import type { KitGround } from '../dressing/types';
import { carveLandmark, landmarkCells, landmarkRegion, type LandmarkPlan } from './landmark';
import type { MovementLine } from '../composition/movement-line';
import type { StreetPlan } from '../streets/model';
import { carveCascadeStairs, type CascadeStair } from '../water/cascade-stair';
import { carveFountains, type FountainCourt } from '../water/fountain';
import { boundsOfCells } from '../water/water-cut';
import { cutComposedBodies, type ComposedBody } from '../water/water-forms';
import { carveWaterStory } from '../water/water-story';
import type { WaterStory } from '../water/story-model';
import type { DesignPlan } from '../types';
import { ELEVATION_MAX } from '../../../../core/game/profile';
import { lerpClamped, clamp01 } from '../../../../core/base/math';
import { cutAccents, cutEndPools } from './accents';
import { cascadeRects, cutFalls, openGround, openLineCrossings, pavedMask } from './falls';
import { erodeSeams, flatReservation, raiseBackings, raiseRings, sinkCourts, terracePlaces } from './places-ground';

// --- tunables -----------------------------------------------------------------------------------

/** How much of the planet's land is water at richness 0 and 1: about a sixth on a garden town and a
 *  quarter on a terraced planet, and the planet kind scales this further. */
const WATER_SHARE = { min: 0.05, max: 0.26 } as const;
/** Below this richness no water is cut at all: a quiet map is a dry one. */
const WATER_FROM = 0.1;
/** How much of the water still unspent after the courts, the stairs and the story goes into the large
 *  composed figures. The rest is the ambient cascades and the accents, which is the tail the style
 *  target reads at 2.6% of its water over 32 bodies. */
const FIGURE_SHARE = 0.8;

// --- what a sculpt is ---------------------------------------------------------------------------

/** The composition's own high ground, reported the way the landmark asks for it: where the map's
 *  mass stands, how tall it got. */
interface WallProfile {
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

/** What a body of water is, which is a short list: the planet carries one or two cascade stairs down
 *  the flanks of its mass, one water story carrying on from a stair's foot (its reaches, its falls and
 *  the pond it arrives in), a few large composed figures, the fountain courts, the ambient cascades
 *  off the terrace steps, the accent pools beside them, and the crossing the walk steps over. Nothing
 *  else cuts water. */
type WaterKind =
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

interface SculptInput {
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
   *  passes that add a tier — a place's terrace, a door's backing, a shop's ring — under it too. */
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
  // The ceiling is the one the plan was drawn under, whether or not the caller repeats it. The three
  // passes below add a tier to a place, a door's backing or a shop's ring, and each was gated only on
  // the caller's own cap: a caller that gave the composition a ceiling and not the sculptor got a map
  // taller than it asked for, which is the promise the shelf's Max-Height makes.
  //
  // It is the composition's ask, not the height it spent. A place's terrace standing one tier above
  // the ground it sits on is the quiet end's only relief — the flat garden town's plan peaks at one
  // tier or none — and clamping to what the plates actually used leaves its street ends arriving at
  // nothing. So a map whose plates
  // stopped below the ask can still be scenery all the way up to it, and none of them passes it.
  const ceiling = Math.max(1, Math.min(
    input.maxElevation ?? ELEVATION_MAX, ELEVATION_MAX, composition.peakTier,
  ));
  // Which cells a scenery pass has already lifted, so no second pass lifts one again (see the passes).
  const raised = new Uint8Array(N);
  const wall = wallOf(composition);
  const water: WaterFeature[] = [];
  const falls: CascadeBand[] = [];
  // The walk's own water is cut whatever the planet kind, because a channel the primary trunk was
  // planned to step over is a hole in the walk if it is not there: `streets.ts` already took the gap
  // out of the pavement, and a dry gap is a break rather than a crossing.
  water.push(...openLineCrossings(terrain, grass, flat, streets, waterScale > 0));
  // The landmark goes before every pass that spends open ground — the ornamental terraces as much as
  // the water. It is the map's primary set piece — a phrase or a pattern written at planet scale, which
  // is the one thing on a map that happens once — and what it needs is the largest panel of one tier the
  // planet has. Cut after the water and it finds nowhere to stand at all; cut after the place terraces
  // and it finds the tier field broken into lots, since each of those lifts is a patch of its own tier in
  // the middle of a block: over ten full-richness seeds, cutting it in front of them holds the panel at
  // 312-544 cells rather than the terrace-floor class. Its own cells are locked into the reservation as
  // it lands, so nothing later floods the panel or raises a terrace through it.
  const hub = {
    x: Math.round(plan.hubArea.x + plan.hubArea.w / 2),
    y: Math.round(plan.hubArea.y + plan.hubArea.h / 2),
  };
  // The region is not the gate. From `landmark.ts:SET_PIECE_FROM` up every planet carries a figure,
  // and the region only says where a ground field would rather stand. Gating on it makes the map's one set piece depend on a
  // theme draw: three maps in five draw the region, a roll takes two thirds of those, and the finished
  // figure lands on about one seed in twelve.
  const region = landmarkRegion(plan);
  // A planet asked for no water cannot carry the figure. Both of the landmark's forms write with
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

  // One pass may raise a cell, and only one. The three scenery passes below each read the tier under
  // them and add one, so where two of them claim the same lot the ground climbs twice, and a place
  // standing two tiers above its own ground is scenery nobody composed.
  const raising = { t: terrain, grass, flat, raised };
  const terraces = terracePlaces(raising, plan, { richness, seed: input.seed, ceiling });
  const backings = raiseBackings(raising, plan, ceiling);
  const rings = raiseRings(raising, plan, ground, ceiling);
  const sunken = sinkCourts(terrain, grass, flat, plan, ground);
  // And the terrace edges are eaten into, wherever nothing is built against them.
  erodeSeams(raising, input.seed);

  let story: WaterStory | null = null;
  let fountains: FountainCourt[] = [];
  let stairs: CascadeStair[] = [];
  let figures: ComposedBody[] = [];
  const endPoolsCut: WaterFeature[] = [];
  if (waterScale > 0 && richness > WATER_FROM) {
    const budget = Math.round(waterScale * countLand(grass)
      * lerpClamped(WATER_SHARE.min, WATER_SHARE.max, (richness - WATER_FROM) / (1 - WATER_FROM)));
    // The courts first, because they are anchored — at the plaza, at the middle of a place, against a
    // street — and the course is not: a court that lost its ground to a stream has nowhere else to
    // stand, while a stream routes around a reserved court without noticing it.
    fountains = carveFountains({
      t: terrain, grass, flat, plan, paved: pavedMask(streets, W, H), richness, seed: input.seed,
      ceiling,
    });
    for (const court of fountains) {
      water.push({ kind: 'fountain', regionId: court.regionId, rect: court.rect, tier: court.tier });
    }
    // The pools at the street ends come next, and before anything that spends ground. A walk that stops
    // in open ground has arrived at nothing — which the hard ledger reads and a visitor feels — and a
    // pool is four cells at most. Cut after the figures, the ground in front of an end is taken by one and
    // the planting that would otherwise mark the end has nowhere to stand.
    endPoolsCut.push(...cutEndPools({
      t: terrain, grass, flat, streets, seed: input.seed,
      budget: budget - countWater(terrain),
      ...(input.line ? { arrival: input.line.terminus } : {}),
    }));
    water.push(...endPoolsCut);
    // Then the stairs, before anything else takes the flanks. A stair needs a run of terrace steps
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
    // Then the story, which carries on from the lowest stair's own foot where there is one: the two
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
    // Then the large figures, which is where most of a map's water goes. A few large composed forms
    // hold most of it and a long tail of accents the rest, which is the distribution the accent pass
    // on its own could never produce.
    figures = cutComposedBodies({
      t: terrain, grass, flat, plan, hub, richness, seed: input.seed,
      ...(input.line ? { line: input.line } : {}),
      budget: Math.round(FIGURE_SHARE * (budget - countWater(terrain))),
    });
    for (const body of figures) {
      water.push({ kind: 'figure', regionId: body.regionId, rect: body.rect, tier: body.tier });
    }
    // The ambient cascades: the steps the walk asked for by name, plus a seeded share of the rest.
    const ambient = cutFalls({ t: terrain, grass, flat }, richness, input.seed, cascadeRects(input.line));
    falls.push(...ambient);
    for (const band of ambient) water.push({ kind: 'fall', regionId: '', rect: band.rect, tier: band.tier });
    // What is left goes in as accents, never as beds. A landscape pool is six cells or fewer, a thing
    // beside a path, and the moment it is allowed to grow it becomes a rectangle with a mountain
    // border round it.
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
