/**
 * The places' own ground: the reservation no later pass may change, terraced place interiors, door
 * backings, eroded and chamfered seams, cleared ground, and the rings and sunken courts the theme
 * kits ask for.
 */
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import { NEIGHBORS4 } from '../../../../core/grid/directions';
import { valueNoise01 } from '../../../../core/base/noise';
import type { MacroCoord, MapTemplate } from '../../../../core/model/types';
import { getCatalogItem } from '../../../../state/catalog';
import { getRotatedSize } from '../../../../core/grid/footprint';
import { buildingGate } from '../../../placement/object';
import type { TerrainPlan } from '../../terrain-plan/types';
import type { AnchorPlan } from '../places/anchors';
import { PLATE_STEP_MAX } from '../composition/composition';
import type { KitGround } from '../dressing/types';
import type { StreetPlan } from '../streets/model';
import type { DesignPlan, Direction } from '../types';
import { seedHash01 } from '../../../../core/base/hash';
import { lerpClamped } from '../../../../core/base/math';
import { fnv1a32 } from '../../../../core/base/hash';

/** Share of the places raised onto a terrace of their own, at richness 0 and 1. A garden town has
 *  none and a terraced planet almost nothing else, so this is the same style axis richness
 *  moves everything else along. */
const PLACE_TERRACE = { low: 0.15, high: 0.6 } as const;

/** How many times a backing strip may be halved looking for ground it can be raised whole. */
const BACKING_SPLITS = 2;
/** The court a bamboo kit sinks, and the ring a shop kit raises. */
const SUNKEN_INSET = 2;
const SUNKEN_MIN = 3;
const RING_W = 1;

// --- what may never be touched ------------------------------------------------------------------

/**
 * The cells no later pass may change: the pavement and everything placed on the ground. The `flat`
 * trait needs a footprint plus one column right and one row below at one level, so a road cell
 * claims exactly the four cells of its sweep. Anything with extent (the plaza, a building, a lane, a
 * flight's corridor) keeps a full ring, since its placement search may shift it a cell. Tiers are not
 * reserved: the streets were planned on the plates and ride them.
 */
export function flatReservation(
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

  mark(plan.hubArea);
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

/** The terrain plan a scenery pass raises, and the masks it reads: the land, the cells kept flat
 *  for streets and lots, and the cells an earlier pass already raised. */
export interface RaiseGround {
  t: TerrainPlan;
  grass: Uint8Array;
  flat: Uint8Array;
  raised: Uint8Array;
}

/**
 * A place stands on its own terrace, one tier above the block's floor: on a terraced planet it is
 * the terrace step, not the roads, that cuts the ground into places. The raise takes the lot's
 * interior one cell in, so the step stays inside the block; a place that would take a cell the
 * reservation holds is left flat. One tier, so V-MTN-03 needs only the ground beside each cell.
 */
export function terracePlaces(
  g: RaiseGround, plan: DesignPlan, { richness, seed, ceiling }: { richness: number; seed: number; ceiling: number },
): Rect[] {
  const { t, raised } = g;
  const share = lerpClamped(PLACE_TERRACE.low, PLACE_TERRACE.high, richness);
  const out: Rect[] = [];
  for (const region of plan.regions) {
    const lot = region.lot[0];
    if (!lot || lot.w < 5 || lot.h < 5) continue;
    if (region.kind !== 'theme') continue;
    if (seedHash01(seed ^ 0x71e2, fnv1a32(region.id)) >= share) continue;
    const rect = inset(lot, 1);
    if (!clearGround(g, rect)) continue;
    const tier = t.tier[flatIndex(rect.x, rect.y, t.width)]!;
    if (tier >= ceiling) continue;
    liftRect(t, raised, rect, tier + 1, fnv1a32(region.id) ^ seed);
    out.push(rect);
  }
  return out;
}

/**
 * The backing behind a building's door (the game's own advice to keep a hill at a building's back): the strip at the far end of an
 * anchor's lot, raised a tier, with the front left open.
 *
 * The composition decides where the map's mass is; this is the region-scale half of the same rule,
 * and it is the half a building can be given wherever it stands: about half of a planet's buildings
 * stand with higher ground behind the door.
 */
export function raiseBackings(g: RaiseGround, plan: DesignPlan, ceiling: number): Rect[] {
  const out: Rect[] = [];
  for (const region of plan.regions) {
    if (region.kind === 'theme' || !region.backing) continue;
    out.push(...raiseStrip(g, region.backing, ceiling, 0));
  }
  return out;
}

/**
 * A backing strip raised a tier, split where the ground under it is not all one surface.
 *
 * `largestClear` trims a strip from its ends, which answers a strip with something standing in one end
 * and nothing at all for a strip that straddles a terrace step — and on a terraced planet that is most
 * of them, since a lot's deep end is where the block's own step falls. So a strip that cannot be raised
 * whole is halved and each half offered the same test, twice down. The backing behind a door is the
 * half the door faces as much as the whole width of the lot.
 */
function raiseStrip(
  g: RaiseGround, rect: Rect, ceiling: number, depth: number,
): Rect[] {
  const { t, raised } = g;
  const whole = largestClear(g, rect);
  if (whole) {
    const tier = t.tier[flatIndex(whole.x, whole.y, t.width)]!;
    if (tier >= ceiling) return [];
    // Two tiers where the ground carries them. The score this pass exists for reads the mean surface of
    // the 7x7 sector two to eight cells behind the door against the sector in front of it, and asks for
    // a quarter of a tier between them: a strip of a dozen cells raised one tier moves that mean by
    // about a third of a tier, which clears the bar only where the strip is nearly the width of the
    // sector. The second tier is what makes a backing read as a backing from the doorstep — and it is
    // V-MTN-03 that says when it may be taken, since a cell at N wants its whole 3x3 at N-3 or above.
    // The strips that carry the reading are the long ones, so the second tier goes wherever V-MTN-03
    // allows it rather than only on short strips.
    const lift = tier + 2 <= ceiling && clearGround(g, whole, 2) ? 2 : 1;
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
    ...raiseStrip(g, a, ceiling, depth + 1),
    ...raiseStrip(g, b, ceiling, depth + 1),
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
export function erodeSeams(g: RaiseGround, seed: number): void {
  const { t, grass, flat, raised } = g;
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
 * one pass takes the median component's box fill to 0.86 and two to 0.78, against 0.58 on a
 * hand-built terraced planet and 1.00 with no bite taken. The span is a scallop of about a dozen
 * cells, the scale a terrace edge wanders at; the threshold rises per pass so the second bite is
 * taken out of the middle of the first rather than along its whole length.
 */
const SEAM_BITE_MAX = 2;
const SEAM_NOISE_SPAN = 12;
const SEAM_BITE_FROM = 0.5;
const SEAM_BITE_STEP = 0.12;

/**
 * The corner chamfers of one lift: a predicate saying whether a cell is cut off the rect. One depth
 * for all four corners, seeded per lift, so the shape is an octagon that keeps both mirror axes: a
 * place reads as mirrored over the region the step cuts, and an asymmetric outline cannot. The depth is capped below the short side, so the shape stays 4-connected.
 */
function chamfers(rect: Rect, salt: number): (x: number, y: number) => boolean {
  const short = Math.min(rect.w, rect.h);
  const cap = Math.min(CHAMFER_MAX, Math.max(0, Math.floor(short * CHAMFER_SHARE)), short - 2);
  if (cap <= 0) return () => false;
  const depth = 1 + Math.round(seedHash01(salt ^ 0xc4a3, 1) * (cap - 1));
  return (x: number, y: number): boolean => {
    const dx = x - rect.x, dy = y - rect.y;
    const rx = rect.w - 1 - dx, ry = rect.h - 1 - dy;
    return Math.min(dx, rx) + Math.min(dy, ry) < depth;
  };
}

/** How much of a lift's short side a corner may take, and the deepest chamfer whatever the size. A
 *  third is what moved the median box fill of the map's terrace components from 1.00 to a
 *  hand-built planet's; the cap keeps a long backing strip from losing its ends. */
const CHAMFER_SHARE = 0.34;
const CHAMFER_MAX = 4;

/** The largest sub-rect of `rect` that is clear ground at one tier, trimmed from whichever side
 *  carries something, or null when nothing of it is left. */
function largestClear(g: RaiseGround, rect: Rect): Rect | null {
  const out = { ...rect };
  for (let guard = 0; guard < rect.w + rect.h; guard++) {
    if (out.w < 2 || out.h < 1) return null;
    if (clearGround(g, out)) return out;
    // Trim the longer axis first, so a strip keeps its length against the door.
    if (out.w >= out.h) {
      out.x++; out.w--;
      if (clearGround(g, out)) return out;
      out.w--;
    } else {
      out.y++; out.h--;
      if (clearGround(g, out)) return out;
      out.h--;
    }
  }
  return null;
}

/**
 * Whether a rect is untouched planet ground at one tier that no other pass has claimed, and whether
 * a tier may be added to it.
 *
 * The second half is V-MTN-03 read forward: a cell standing at N needs its whole 3x3 at N-3 or above,
 * so a rect may only be raised by `lift` where everything around it already stands within
 * `PLATE_STEP_MAX - lift` tiers of its own. Its neighbours are plates a step below it as often as not,
 * and a place raised beside one of those is the difference between a terrace and a repaired-away hole.
 */
function clearGround(g: RaiseGround, rect: Rect, lift = 1): boolean {
  const { t, grass, flat, raised } = g;
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

/** The one-layer terrace ring a shop complex stands inside, raised around the
 *  place's border and left open on its entry side. */
export function raiseRings(
  g: RaiseGround, plan: DesignPlan, ground: ReadonlyMap<string, KitGround>, ceiling: number,
): Rect[] {
  const { t, grass, flat, raised } = g;
  const out: Rect[] = [];
  for (const region of plan.regions) {
    if (!ground.get(region.id)?.ring) continue;
    const lot = region.lot[0];
    if (!lot || lot.w < 6 || lot.h < 6) continue;
    // A ring is raised whole or not at all. Skipping the cells another pass already raised would leave
    // a border standing at two levels, and the ground the shop's own doorstep needs level would not be,
    // so the facility the ring was cut for could not be placed.
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

/** The sunken court (a Chinese-style sunken courtyard in a bamboo grove): the middle of a place dropped one tier. */
export function sinkCourts(
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
    const cut = chamfers(rect, fnv1a32(region.id));
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

const inset = (rect: Rect, k: number): Rect =>
  ({ x: rect.x + k, y: rect.y + k, w: Math.max(0, rect.w - 2 * k), h: Math.max(0, rect.h - 2 * k) });
