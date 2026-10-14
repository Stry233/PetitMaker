/**
 * Cuts the small pools: the end pools a street arrives at and the accent pools beside the terrace
 * falls.
 */
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import type { MacroCoord } from '../../../../core/model/types';
import type { TerrainPlan } from '../../terrain-plan/types';
import type { StreetPlan } from '../streets/model';
import { eachTerminus } from '../../../reading/street-ends';
import { flood, poolFits, type WaterGround } from '../water/water-cut';
import { ELEVATION_MAX } from '../../../../core/game/profile';
import { seedHash01 } from '../../../../core/base/hash';
import { fieldNoise, ringPull, type RingProfile, WET_BAND } from '../seeded';
import { lerpClamped } from '../../../../core/base/math';
import type { WaterFeature } from './terrain-sculpt';

/** How much likelier an accent is on the upper terraces. A terraced planet holds 13 to 21% water on
 *  tiers 0-3 and 31 to 40% on tiers 4-8: its wet half is its upper half. */
const HIGH_TIER_PULL = 0.35;
/** The accent pools: many bodies of six cells or fewer, holding a few percent of a planet's water.
 *  They are the only water this module still spends a budget on, and the cap is what keeps one
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
 *  at the end of a walk has to be seen rather than to take the ground the place ahead is composed
 *  on, and a bigger one measurably cost the palette-unity reading. */
const END_POOL_SIZES: readonly { w: number; h: number }[] = [
  { w: 2, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 2 },
];
const ACCENT_KEEP = 3;
/** How far a pool stays away from the walk's own last stop.
 *
 * The route ends on the planet's high ground and a pool cut where it arrives lowers the cell the
 * terminus names. The look-out is what the whole climb is for, so the water gives it room.
 */
const ARRIVAL_KEEP = 5;
/** The accents' ring: the wet band with a 10-cell dry apron round the plaza. */
const ACCENT_RING: RingProfile = { dry: 10, ...WET_BAND };

/** How far a terrace boundary wanders, in cells, for the seeded fields below. */
const NOISE_SPAN = 21;

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
 * The end of a walk is water: a street that stops short of a shore arrives there. The ends are read
 * off the street plan, since no road
 * tile exists yet when the ground is being shaped, and the walk's own last stop is left dry — the
 * look-out is what the climb was for, and a pool cut where the route arrives lowers the cell the
 * terminus names.
 */
export function cutEndPools(input: EndPoolInput): WaterFeature[] {
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
    const laid = cutAccentAt({ t, grass, flat }, site, seed, END_POOL_SIZES);
    if (!laid) continue;
    out.push(laid);
    taken.push(site);
    budget -= laid.rect.w * laid.rect.h;
  }
  return out;
}

/**
 * The landscape pools: small, few, and placed where a planet's water stands.
 *
 * The size cap is the whole of it. A pool allowed to grow to the room its terrace offers comes out a
 * rectangle framed by mountain on every side; an accent is at most six cells and reads as a thing
 * beside a path. Where they go is a planet's ring and tier profile: nothing
 * inside the plaza's apron, most of them in the 30-to-50-cell band, none at the coast, and twice as
 * likely above the working platforms as on them — gathered by a smooth seeded field so they come in
 * groups rather than speckling every terrace.
 */
export function cutAccents(input: AccentInput): WaterFeature[] {
  const { t, grass, flat, room, hub, richness, seed } = input;
  let budget = Math.max(0, input.budget);
  const count = Math.round(lerpClamped(ACCENT_COUNT.min, ACCENT_COUNT.max, richness));
  if (budget <= 0 || count <= 0) return [];

  const anchors: number[] = [];
  for (let y = 1; y < t.height - 1; y += 2) {
    for (let x = 1; x < t.width - 1; x += 2) anchors.push(flatIndex(x, y, t.width));
  }
  const score = (i: number): number => {
    const x = i % t.width, y = (i / t.width) | 0;
    return fieldNoise(seed ^ 0x6c0f1e, x / 3, y / 3, NOISE_SPAN)
      + HIGH_TIER_PULL * (t.tier[i]! / ELEVATION_MAX)
      + ringPull(Math.max(Math.abs(x - hub.x), Math.abs(y - hub.y)), ACCENT_RING);
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
    const laid = cutAccentAt({ t, grass, flat }, { x, y }, seed);
    if (!laid) continue;
    out.push(laid);
    taken.push({ x, y });
    budget -= laid.rect.w * laid.rect.h;
  }
  return out;
}

/** One accent at a cell, in the first of the accent shapes the ground carries there. */
function cutAccentAt(
  ground: WaterGround, at: MacroCoord, seed: number, sizes: readonly { w: number; h: number }[] = ACCENT_SIZES,
): WaterFeature | null {
  const { t, grass, flat } = ground;
  if (at.x < 1 || at.y < 1 || at.x >= t.width - 1 || at.y >= t.height - 1) return null;
  const tier = t.tier[flatIndex(at.x, at.y, t.width)]!;
  const first = Math.floor(seedHash01(seed ^ 0x4ac1, flatIndex(at.x, at.y, t.width)) * sizes.length);
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
