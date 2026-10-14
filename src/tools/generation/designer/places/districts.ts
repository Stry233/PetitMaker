/**
 * Stage C of the designer pipeline: districts take a treatment, and each subdivides into the
 * composed places the kits fill. Every block gets an anchor region with its buildings, one theme, or
 * the quiet treatment, then is cut into places (`PLACE_SIDE`). The district carries the theme, so a
 * block reads as a block from across the map.
 *
 * A block no street reaches or no theme wanted gets the quiet treatment (sparse planting with an
 * edged border) rather than nothing: quiet ground at map scale is a place too, not a gap.
 *
 * The output is a `DesignPlan`, so everything downstream reads one model. A lot is cut out of a
 * district the streets already outlined. Pure and deterministic per (seed, template, composition,
 * streets, richness), with no browser API, so it runs in the worker pool.
 */
import { DIR_OFFSETS, OPPOSITE_DIR } from '../../../../core/grid/directions';
import { flatIndex, inflateRect, rectContains, rectsOverlap } from '../../../../core/grid/rect';
import { clamp01, lerpClamped } from '../../../../core/base/math';
import { fnv1a32 } from '../../../../core/base/hash';
import { makeRng, type Rng, mix } from '../../../../core/base/rng';
import type { MapTemplate } from '../../../../core/model/types';
import type { Rect } from '../../../../core/grid/rect';
import type { CompositionPlan } from '../composition/composition';
import { cellTiers, levelWindows, hubRect } from '../planet';

import type { MovementLine, MovementStop } from '../composition/movement-line';
import { planRegionList } from './region-list';
import { FALLBACK_THEME, isSetPieceTheme, QUIET_THEME, themeRef, WATER_THEMES } from '../themes';
import type { District, StreetPlan } from '../streets/model';
import {
  directionOf,
  type AnchorRegionSpec, type DesignInput, type DesignPlan, type Direction, type RegionPlan, type RegionSpec, type ThemeRegionSpec,
} from '../types';

// --- tunables ------------------------------------------------------------------------------------

/**
 * The composed place's own scale, in cells, set from the run it leaves rather than from the lot.
 * The sculptor raises a place's interior one tier (`terrain/places-ground.ts:terracePlaces`, inset
 * by one), so the planted run is two cells smaller on each axis and cut further by kits, lots and
 * water. Drawn at a smaller lot size the runs come out too small to hold a bed; this band lands them
 * near a terraced planet's run size, and a larger top end would make runs larger than its places.
 */
const PLACE_SIDE = { min: 11, max: 15 } as const;
/** The composed place a set-piece stop on the movement line is drawn at. A planet's places run from
 *  20 cells to almost a thousand, and the big end of that spread is what a walk stops at;
 *  a map cut at one scale everywhere reads as a lattice however well each cell of it is composed.
 *  It is carried a fixed margin above `PLACE_SIDE`, so the scale contrast between a stop and the
 *  ordinary ground around it survives either scale moving. */
const SET_PIECE_SIDE = { min: 17, max: 22 } as const;
/** How far from a stop's own cell its block is looked for. */
const STOP_REACH = 6;
/** What a block on the walk is worth to an anchor looking for somewhere to stand, in cells of
 *  spread. Enough to pull a home onto the line where the two are close, never enough to gather the
 *  homes back into one place: the farthest-point term still decides between two stops. */
const STOP_ANCHOR_BONUS = 12;
/** The smallest rectangle still worth composing on. Under this a place is a verge. */
const PLACE_MIN = { side: 4, cells: 24 } as const;
/** Cells left between two places inside one district, so a block reads as a row of composed places
 *  rather than one carpet. Nothing is drawn in the gap: the kits' own borders edge each place. */
const PLACE_GAP = 1;
/** How far a place looks for pavement before it takes the plaza's direction as its look-out. */
const ENTRY_REACH = 14;
/** Depth of the strip at a place's far end that the sculptor may back with height. */
const BACKING_DEPTH = 3;
/** The fewest cells a district must hold before it is worth a treatment of its own. */
const DISTRICT_MIN_CELLS = 40;

/**
 * Districts given the water treatment, as a share of the treated ones, at richness 0 and 1.
 *
 * A terraced planet spends about a quarter of its land on water and a flat one about a sixth, and
 * neither spreads it evenly: the water is gathered into whole places, such as water gardens, shaped
 * pools and flooded fields. A share of districts rather than a share of cells is what gathers it.
 */
const WATER_DISTRICT_SHARE = { low: 0.1, high: 0.34 } as const;

// --- what a district plan is ---------------------------------------------------------------------

/** What one block of the partition was made into. */
export interface DistrictAssignment {
  districtId: number;
  /** `anchor` holds a building region, `theme` one theme, `quiet` the edged ground a block takes
   *  where nothing claimed it — including every block no street reaches. */
  treatment: 'anchor' | 'theme' | 'quiet';
  /** The places cut out of it, as ids into `DesignPlan.regions`. */
  regionIds: string[];
  tier: number;
  served: boolean;
  /** Does this block carry the water treatment: a floor of shallow water with its planting standing
   *  on the ground the water leaves, rather than a bed cut into a corner of it. */
  water: boolean;
}

export interface DistrictPlan {
  /** The plan every later stage reads: the places as regions, the plaza, and the high ground. */
  design: DesignPlan;
  assignments: DistrictAssignment[];
}

// --- entry point -----------------------------------------------------------------------------

/** Hands every district a treatment and cuts it into places, meeting the walk's stops first. The
 *  anchor regions cover the live catalog's placeable Buildings and Facilities. */
export function planDistricts(
  { seed, template, composition, streets, richness, line }:
    DesignInput & { composition: CompositionPlan; streets: StreetPlan; line: MovementLine },
): DistrictPlan {
  const r = clamp01(richness);
  const stage = openStage(seed, template, composition, streets);

  const specs = planRegionList(seed, r);
  // Biggest lot first. The shop's complex and the museum's forecourt are the roomiest anchors on the
  // map and the fewest blocks can hold them; asked for after nine homes have taken the large blocks,
  // the shop goes unplaced, which breaks the hard rule that every building is placed.
  const anchorSpecs = specs.filter((s): s is AnchorRegionSpec => s.kind !== 'theme')
    .sort((a, b) => b.size.w * b.size.h - a.size.w * a.size.h || a.id.localeCompare(b.id));
  const themeSpecs = specs.filter((s): s is ThemeRegionSpec => s.kind === 'theme');

  const blocks = treatableBlocks(stage, streets.districts, line);
  const { picks, spent, unplaced } = pickAnchorLots(stage, blocks, anchorSpecs, composition, template);
  cutAnchorBlocks(stage, picks, themeSpecs);
  treatRemainingBlocks(stage, blocks, spent, themeSpecs, r);

  return {
    design: {
      seedInfo: { seed, richness: r, templateId: template.id },
      hubArea: stage.hub,
      backingBand: highGround(composition),
      regions: stage.regions,
      unplaced,
    },
    assignments: stage.assignments,
  };
}

/** What every step of the stage reads and writes: the map readings it judges lots on, the cells the
 *  lots have claimed, and the regions and assignments it has made so far. */
interface DistrictStage {
  rng: Rng;
  W: number;
  H: number;
  hub: Rect;
  centre: { x: number; y: number };
  /** The street plan's pavement, 1 per paved cell. */
  paved: Uint8Array;
  tiers: Int8Array;
  pavable: Uint8Array;
  /** Cells a lot or a place already claimed. */
  taken: Set<number>;
  regions: RegionPlan[];
  assignments: DistrictAssignment[];
}

function openStage(
  seed: number, template: MapTemplate, composition: CompositionPlan, streets: StreetPlan,
): DistrictStage {
  const rng = makeRng(mix(seed, 0x1d15721c));
  const W = template.width, H = template.height;
  const hub = hubRect(template);
  const centre = { x: hub.x + hub.w / 2, y: hub.y + hub.h / 2 };
  const paved = new Uint8Array(W * H);
  for (const c of streets.cells) paved[flatIndex(c.x, c.y, W)] = 1;
  // One tier field for the stage: `cellTiers` walks a distance field over the whole map, and the
  // pavable mask and the last-resort lot both need it.
  const tiers = cellTiers(template, composition);
  const pavable = levelWindows(template, tiers);
  return { rng, W, H, hub, centre, paved, tiers, pavable, taken: new Set(), regions: [], assignments: [] };
}

/** The districts large enough for a treatment, each with the walk's stop it holds. The walk's stops
 *  claim their blocks first, so a visitor meets the districts in the order the movement line planned
 *  them. Let another treatment take a stop's block and the map reads as an unordered field of places
 *  rather than as a sequence. */
function treatableBlocks(stage: DistrictStage, districts: readonly District[], line: MovementLine): Block[] {
  const onLine = stopBlocks(districts, line, stage.W, stage.H);
  return districts
    .filter((d) => d.cells.length >= DISTRICT_MIN_CELLS)
    .map((d) => ({
      d, cells: new Set(d.cells), dist: distanceTo(stage.centre, d.rect),
      ...(onLine.get(d.id) ? { stop: onLine.get(d.id)! } : {}),
    }));
}

interface AnchorPick { spec: AnchorRegionSpec; block: Block | null; lot: Rect; entry: Direction }

/**
 * The anchors first, spread over the planet. A planet's buildings stand 13 to 70 cells from the
 * plaza, near and far, so the choice is farthest-point over the blocks that can hold the
 * lot rather than the nearest ones that fit.
 *
 * Every lot is chosen before any block is cut up, so only the lot itself is claimed here and the
 * places around it are cut once every anchor has landed. Cutting a block into places as each
 * anchor takes it marks the whole block as spoken for, which stops two anchors ever sharing one
 * and starves the last homes on the list, breaking the hard rule that every building is placed.
 */
function pickAnchorLots(
  stage: DistrictStage, blocks: readonly Block[], anchorSpecs: readonly AnchorRegionSpec[],
  composition: CompositionPlan, template: MapTemplate,
): { picks: AnchorPick[]; spent: Set<number>; unplaced: string[] } {
  const { W, taken } = stage;
  const open = blocks.filter((b) => b.d.served).sort((a, b) => a.dist - b.dist || a.d.id - b.d.id);
  const anchorBlocks = new Map<string, Block>();
  const picks: AnchorPick[] = [];
  const unplaced: string[] = [];
  for (const spec of anchorSpecs) {
    // Loosening in the order that costs the least: a block of its own among the ones a street
    // reaches, then a block already spoken for, then any block at all, and finally the plaza's own
    // plate — ground the composition guarantees is level, buildable and beside the hub, so the last
    // fallback cannot itself be refused.
    const pick = pickAnchorBlock(stage, open, anchorBlocks, spec)
      ?? pickAnchorBlock(stage, open, new Map(), spec)
      ?? pickAnchorBlock(stage, blocks, new Map(), spec);
    const found = pick ?? hubLot(stage, spec, composition, template);
    if (!found) { unplaced.push(spec.id); continue; }
    if (found.block) anchorBlocks.set(spec.id, found.block);
    picks.push({ spec, block: found.block, lot: found.lot, entry: found.entry });
    for (const i of rectCells(found.lot, W)) taken.add(i);
  }
  return { picks, spent: new Set([...anchorBlocks.values()].map((b) => b.d.id)), unplaced };
}

/** Now the ground around the anchors. A block holding two anchors is cut once, so its places are the
 *  ones left between both lots rather than two overlapping readings of the same block. */
function cutAnchorBlocks(
  stage: DistrictStage, picks: readonly AnchorPick[], themeSpecs: readonly ThemeRegionSpec[],
): void {
  const { rng, paved, centre, W, H, taken, regions, assignments } = stage;
  const cutFor = new Set<number>();
  for (const { spec, block, lot, entry } of picks) {
    const region = anchorRegion(spec, lot, entry);
    regions.push(region);
    const rest = block && !cutFor.has(block.d.id)
      ? cutPlaces(block.cells, block.d, { taken, rng, W })
      : [];
    if (block) cutFor.add(block.d.id);
    const ids = [region.id, ...rest.map((p, k) => {
      const themed = themeRegion(
        `${region.id}-p${k}`, themeFor(themeSpecs, rng, spec.id, k), p,
        lookOut(p, paved, centre, W, H),
      );
      regions.push(themed);
      return themed.id;
    })];
    if (!block) continue;
    const at = assignments.find((a) => a.districtId === block.d.id);
    if (at) at.regionIds.push(...ids);
    else {
      assignments.push({
        districtId: block.d.id, treatment: 'anchor', regionIds: ids,
        tier: block.d.tier, served: true, water: false,
      });
    }
  }
}

/** Then a theme per remaining served block, and the quiet treatment for what is left. Both are cut
 *  into places the same way: a block is one theme so its places compose in one style. */
function treatRemainingBlocks(
  stage: DistrictStage, blocks: readonly Block[], spent: ReadonlySet<number>,
  themeSpecs: readonly ThemeRegionSpec[], r: number,
): void {
  const { rng, paved, centre, W, H, taken, regions, assignments } = stage;
  const waterQuota = Math.round(lerpClamped(WATER_DISTRICT_SHARE.low, WATER_DISTRICT_SHARE.high, r)
    * Math.max(0, blocks.length - spent.size));
  let watered = 0;
  let themeAt = 0;
  // The landmark goes to the biggest block left. Its phrase wants a panel of about 21x15, and a
  // block drawn at random is as likely as not to be a strip half that wide — the set piece then
  // never appears, which is a theme the map cannot draw rather than a taste choice.
  const landmark = themeSpecs.find((t) => isSetPieceTheme(t.themeId));
  const landmarkBlock = landmark
    ? blocks.filter((b) => !spent.has(b.d.id) && b.d.served)
      .reduce<Block | null>((big, b) => (!big || b.d.cells.length > big.d.cells.length ? b : big), null)
    : null;
  for (const block of blocks) {
    if (spent.has(block.d.id)) continue;
    const themed = block.d.served && themeSpecs.length > 0;
    const spec = block.stop
      ? stopSpec(block.stop)
      : block === landmarkBlock && landmark
        ? landmark
        : themed ? nextTheme(themeSpecs, themeAt++, landmark) : null;
    // A waterside stop is wet whatever the quota says. The walk asked for water there and the
    // sculptor cut the lake it skirts; a dry block around it would read as a lake nobody built for.
    const water = block.stop?.role === 'waterside'
      || (spec !== null && watered < waterQuota
        && (WATER_THEMES.has(spec.themeId) || rng.float() < 0.35));
    if (water) watered++;
    // A landmark is a set piece at district scale. Its phrase wants a panel of about 21x15 and a
    // composed place is 7x7 to 10x10, so the block that draws it is kept whole rather than cut into
    // places that could each hold two letters.
    const places = isSetPieceTheme(spec?.themeId)
      ? ([shrinkToFit({ ...block.d.rect }, block.cells, taken, W)].filter((r): r is Rect => !!r))
      : cutPlaces(block.cells, block.d, { taken, rng, W, setPiece: block.stop?.setPiece === true });
    const ids: string[] = [];
    for (const [k, place] of places.entries()) {
      const id = `d${block.d.id}-p${k}`;
      const entry = lookOut(place, paved, centre, W, H);
      const region = spec ? themeRegion(id, spec, place, entry) : quietRegion(id, place, entry);
      if (water) region.water = true;
      regions.push(region);
      ids.push(id);
    }
    assignments.push({
      districtId: block.d.id, treatment: themed ? 'theme' : 'quiet', regionIds: ids,
      tier: block.d.tier, served: block.d.served, water,
    });
  }
}

// --- the anchor's lot ------------------------------------------------------------------------

interface Block { d: District; cells: Set<number>; dist: number; stop?: MovementStop }

/** Which block each of the walk's stops stands in. A stop that fell on pavement or on a block too
 *  small to compose in claims nothing, and the walk simply passes through it. */
function stopBlocks(
  districts: readonly District[], line: MovementLine, W: number, H: number,
): Map<number, MovementStop> {
  const out = new Map<number, MovementStop>();
  const owner = new Map<number, number>();
  for (const d of districts) for (const i of d.cells) owner.set(i, d.id);
  for (const stop of line.stops) {
    // The stop's own cell, then a short spiral out of it: an anchor sits at a plate's middle, which
    // a street can run straight through.
    for (let r = 0; r <= STOP_REACH; r++) {
      let found = -1;
      for (let dy = -r; dy <= r && found < 0; dy++) {
        for (let dx = -r; dx <= r && found < 0; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = stop.at.x + dx, y = stop.at.y + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const id = owner.get(flatIndex(x, y, W));
          if (id !== undefined && !out.has(id)) found = id;
        }
      }
      if (found >= 0) { out.set(found, stop); break; }
    }
  }
  return out;
}

/**
 * The block one anchor region takes, and the lot inside it.
 *
 * A lot must stand with its entry edge against pavement, because that is what makes every door open
 * onto a street: `anchors.ts` stands the buildings flush along that edge and reads their doorstep
 * one cell beyond it. So the search is over the four ways a lot can face, and a lot that cannot find
 * a paved edge anywhere is not placed on that block at all.
 */
function pickAnchorBlock(
  stage: DistrictStage, blocks: readonly Block[], used: ReadonlyMap<string, Block>, spec: RegionSpec,
): { block: Block; lot: Rect; entry: Direction } | null {
  const spent = new Set([...used.values()].map((b) => b.d.id));
  let best: { block: Block; lot: Rect; entry: Direction; score: number } | null = null;
  for (const block of blocks) {
    if (spent.has(block.d.id)) continue;
    const lot = frontedLot(stage, block, spec);
    if (!lot) continue;
    // Farthest from the blocks already spoken for, so the buildings spread coast to coast rather
    // than crowding the plaza's own ring. A block the walk stops at is worth a bonus: a home met on
    // the movement line is a home the map introduces: a house per place, each with its own garden,
    // rather than a housing estate.
    let spread = Infinity;
    for (const other of used.values()) {
      spread = Math.min(spread, distanceTo(
        { x: other.d.rect.x + other.d.rect.w / 2, y: other.d.rect.y + other.d.rect.h / 2 }, block.d.rect,
      ));
    }
    const onWalk = block.stop ? STOP_ANCHOR_BONUS : 0;
    const score = (Number.isFinite(spread) ? spread : -block.dist) + onWalk;
    if (!best || score > best.score) best = { block, lot: lot.rect, entry: lot.entry, score };
  }
  return best ? { block: best.block, lot: best.lot, entry: best.entry } : null;
}

/**
 * The largest lot up to `spec.size` that fits inside the block, entered from a side a street reaches.
 *
 * Three passes, loosening in the order that costs the least: a whole edge against pavement (every
 * door then opens straight onto the street), then any part of an edge against it, then anywhere
 * inside the block with the entry facing the nearest pavement. The pipeline paves the approach of
 * any door the third pass leaves short, which is what keeps the loosening honest — the rule is that
 * every door opens on a road, not that every lot happens to find a paved edge.
 */
function frontedLot(stage: DistrictStage, block: Block, spec: RegionSpec): { rect: Rect; entry: Direction } | null {
  const floor = spec.minSize ?? spec.size;
  const free = freeArea(block, stage.taken, stage.W);
  for (const need of ['edge', 'touch', 'any'] as const) {
    // The shrink ladder's rounding repeats sizes (every step, for a fixed-size spec), and a size
    // already scanned under this need answers the same for the same block.
    const tried = new Set<number>();
    for (let step = 0; step <= 4; step++) {
      const t = step / 4;
      const w = Math.round(spec.size.w - t * (spec.size.w - floor.w));
      const h = Math.round(spec.size.h - t * (spec.size.h - floor.h));
      const size = w * 4096 + h;
      if (tried.has(size)) continue;
      tried.add(size);
      for (const entry of ['south', 'north', 'east', 'west'] as const) {
        const found = lotAgainstPavement(stage, block, { w, h, entry, need }, free);
        if (found) return { rect: found, entry };
      }
    }
  }
  return null;
}

/**
 * A w x h lot inside the block whose `entry` edge meets pavement to the degree `need` asks. `free`
 * (`freeArea`) answers inside-the-block and taken-ground in one subtraction each, and the doorstep
 * run comes whole out of `frontageSums`, so a candidate costs three subtractions. A doorstep must be
 * pavable: its dual-grid window at one tier, which the column just west or north of a terrace step
 * never is. That is the `open` run's test, with paved cells counting as open.
 */
function lotAgainstPavement(
  stage: DistrictStage, block: Block,
  { w, h, entry, need }: { w: number; h: number; entry: Direction; need: 'edge' | 'touch' | 'any' }, free: FreeArea,
): Rect | null {
  const { paved, pavable, W, H } = stage;
  const { rect } = block.d;
  const sums = frontageSums(paved, pavable, W, H);
  const horizontal = entry === 'north' || entry === 'south';
  for (let y = rect.y; y + h <= rect.y + rect.h; y++) {
    for (let x = rect.x; x + w <= rect.x + rect.w; x++) {
      // The margin is the dual grid: an object validates its footprint plus one column right and one
      // row below, so a building flush against the block's east or south edge is judged partly on the
      // next terrace down and the placement is refused.
      if (free.count(x, y, w + 1, h + 1) !== (w + 1) * (h + 1)) continue;
      let fronted: number;
      let cells: number;
      if (horizontal) {
        const ny = entry === 'north' ? y - 1 : y + h;
        if (ny < 0 || ny >= H) continue;
        cells = w;
        const row = ny * (W + 1);
        if (sums.openRow[row + x + w]! - sums.openRow[row + x]! !== cells) continue;
        fronted = sums.pavedRow[row + x + w]! - sums.pavedRow[row + x]!;
      } else {
        const nx = entry === 'west' ? x - 1 : x + w;
        if (nx < 0 || nx >= W) continue;
        cells = h;
        const col = nx * (H + 1);
        if (sums.openCol[col + y + h]! - sums.openCol[col + y]! !== cells) continue;
        fronted = sums.pavedCol[col + y + h]! - sums.pavedCol[col + y]!;
      }
      if (need === 'any' || (need === 'edge' ? fronted === cells : fronted > 0)) return { x, y, w, h };
    }
  }
  return null;
}

/**
 * Row and column prefix sums over `paved` and over paved-or-`pavable` ground, memoized on the paved
 * mask's identity: both masks are fixed for a whole planning pass (the streets are painted into
 * `paved` before the first lot is asked for), and the anchor search reads thousands of candidate
 * frontages from them.
 */
interface FrontageSums { pavedRow: Int32Array; openRow: Int32Array; pavedCol: Int32Array; openCol: Int32Array }

const frontageCache = new WeakMap<Uint8Array, FrontageSums>();

function frontageSums(paved: Uint8Array, pavable: Uint8Array, W: number, H: number): FrontageSums {
  const hit = frontageCache.get(paved);
  if (hit) return hit;
  const pavedRow = new Int32Array((W + 1) * H);
  const openRow = new Int32Array((W + 1) * H);
  const pavedCol = new Int32Array((H + 1) * W);
  const openCol = new Int32Array((H + 1) * W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = flatIndex(x, y, W);
      const p = paved[i] ? 1 : 0;
      const o = p === 1 || pavable[i] ? 1 : 0;
      pavedRow[y * (W + 1) + x + 1] = pavedRow[y * (W + 1) + x]! + p;
      openRow[y * (W + 1) + x + 1] = openRow[y * (W + 1) + x]! + o;
      pavedCol[x * (H + 1) + y + 1] = pavedCol[x * (H + 1) + y]! + p;
      openCol[x * (H + 1) + y + 1] = openCol[x * (H + 1) + y]! + o;
    }
  }
  const sums = { pavedRow, openRow, pavedCol, openCol };
  frontageCache.set(paved, sums);
  return sums;
}

/** The lot's cells along one side. */
function edgeCells(lot: Rect, side: Direction): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (side === 'north' || side === 'south') {
    const y = side === 'north' ? lot.y : lot.y + lot.h - 1;
    for (let x = lot.x; x < lot.x + lot.w; x++) out.push({ x, y });
  } else {
    const x = side === 'west' ? lot.x : lot.x + lot.w - 1;
    for (let y = lot.y; y < lot.y + lot.h; y++) out.push({ x, y });
  }
  return out;
}

/**
 * The last resort: a lot on the plaza's own plate. On a terraced seed every block can be claimed or
 * too small, which would break the rule that every building is placed. The plaza's plate stands at
 * the anchor's tier by construction (`assignTiers`), so any rectangle of its pavable ground is level
 * and buildable. The lot has no block, and the pipeline paves the approach to its door. The scan
 * walks outward from the plaza, so the home lands beside the hub.
 */
function hubLot(
  stage: DistrictStage, spec: RegionSpec, composition: CompositionPlan, template: MapTemplate,
): { block: null; lot: Rect; entry: Direction } | null {
  const { tiers, pavable, taken, centre, W, H } = stage;
  const plate = composition.plates[composition.hubPlateId];
  if (!plate) return null;
  const hubArea = hubRect(template);
  const own = new Set(plate.cells);
  const floor = spec.minSize ?? spec.size;
  const cells = [...plate.cells].sort((a, b) =>
    Math.hypot(a % W - centre.x, ((a / W) | 0) - centre.y)
    - Math.hypot(b % W - centre.x, ((b / W) | 0) - centre.y));
  for (const start of cells) {
    const x = start % W, y = (start / W) | 0;
    const lot = { x, y, w: floor.w, h: floor.h };
    if (x + lot.w + 1 >= W || y + lot.h + 1 >= H) continue;
    if (rectContains(hubArea, x, y) || rectsMeet(hubArea, lot)) continue;
    // The lot plus its dual-grid margin, all on the plate at one tier and unclaimed.
    let ok = true;
    const level = tiers[start]!;
    for (let cy = y; cy <= y + lot.h && ok; cy++) {
      for (let cx = x; cx <= x + lot.w && ok; cx++) {
        const i = flatIndex(cx, cy, W);
        ok = own.has(i) && tiers[i] === level && !taken.has(i);
      }
    }
    if (!ok) continue;
    // The doorstep: a cell a road may be laid on, so the pipeline's approach can reach the door.
    for (const entry of ['south', 'north', 'east', 'west'] as const) {
      const step = DIR_OFFSETS[entry];
      const door = edgeCells(lot, entry)
        .map((c) => ({ x: c.x + step.dx, y: c.y + step.dy }))
        .every((c) => c.x >= 0 && c.y >= 0 && c.x < W && c.y < H && !!pavable[flatIndex(c.x, c.y, W)]);
      if (door) return { block: null, lot, entry };
    }
  }
  return null;
}

const rectsMeet = (a: Rect, b: Rect): boolean => rectsOverlap(inflateRect(a, 1), b);

/**
 * The block's own unclaimed ground, as a summed-area table over its box plus the dual-grid margin.
 *
 * `count` answers how many cells of a rect belong to the block and are unspoken for, in one
 * subtraction. The lot search asks that question sixty times per block per anchor and a map has twelve
 * anchors, so walking the lot each time costs a designed plan seconds rather than tens of milliseconds.
 */
interface FreeArea { count(x: number, y: number, w: number, h: number): number }

function freeArea(block: Block, taken: ReadonlySet<number>, W: number): FreeArea {
  const r = block.d.rect;
  const x0 = r.x, y0 = r.y, bw = r.w + 2, bh = r.h + 2;
  const stride = bw + 1;
  const sum = new Int32Array(stride * (bh + 1));
  for (let y = 0; y < bh; y++) {
    let row = 0;
    for (let x = 0; x < bw; x++) {
      const i = flatIndex(x0 + x, y0 + y, W);
      row += block.cells.has(i) && !taken.has(i) ? 1 : 0;
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1]! + row;
    }
  }
  const clampX = (v: number): number => Math.max(0, Math.min(bw, v - x0));
  const clampY = (v: number): number => Math.max(0, Math.min(bh, v - y0));
  return {
    count(x, y, w, h) {
      const ax = clampX(x), ay = clampY(y), bx = clampX(x + w), by = clampY(y + h);
      return sum[by * stride + bx]! - sum[ay * stride + bx]!
        - sum[by * stride + ax]! + sum[ay * stride + ax]!;
    },
  };
}

// --- the places ----------------------------------------------------------------------------------

/**
 * Cuts a district into composed places: a lattice of `PLACE_SIDE` boxes, each one shrunk to the
 * largest rectangle actually inside the block.
 *
 * A place is a rectangle because a composition needs an axis to be mirrored about and a border to
 * be edged along, and because a planet's places are rectangles cut by streets and terrace steps. What the lattice cannot square off — a coastline eating a corner, the ground an anchor lot
 * took — is left between the places, which is where the district's own ground shows through.
 */
function cutPlaces(
  cells: ReadonlySet<number>, district: District,
  { taken, rng, W, setPiece = false }: { taken: Set<number>; rng: Rng; W: number; setPiece?: boolean },
): Rect[] {
  // A set piece is drawn at district scale. The walk alternates its stops between a big composed
  // place and a quieter block of ordinary ones, which is a scale contrast a uniform lattice of places
  // cannot carry.
  const side = setPiece
    ? SET_PIECE_SIDE.min + rng.int(SET_PIECE_SIDE.max - SET_PIECE_SIDE.min + 1)
    : PLACE_SIDE.min + rng.int(PLACE_SIDE.max - PLACE_SIDE.min + 1);
  const pitch = side + PLACE_GAP;
  const out: Rect[] = [];
  const { rect } = district;
  for (let y = rect.y; y < rect.y + rect.h; y += pitch) {
    for (let x = rect.x; x < rect.x + rect.w; x += pitch) {
      const box = {
        x, y,
        w: Math.min(side, rect.x + rect.w - x),
        h: Math.min(side, rect.y + rect.h - y),
      };
      const place = shrinkToFit(box, cells, taken, W);
      if (!place) continue;
      out.push(place);
      for (const i of rectCells(place, W)) taken.add(i);
    }
  }
  // Ordered by how a walker meets them, so the ids a plan hands out are stable.
  out.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return out;
}

/** The largest rectangle inside `box` whose every cell belongs to the block and is unclaimed, found
 *  by trimming whichever side carries the most missing cells until none is left. */
function shrinkToFit(
  box: Rect, cells: ReadonlySet<number>, taken: ReadonlySet<number>, W: number,
): Rect | null {
  const rect = { ...box };
  const missingOn = (side: Direction): number => {
    let n = 0;
    for (const c of edgeCells(rect, side)) {
      const i = flatIndex(c.x, c.y, W);
      if (!cells.has(i) || taken.has(i)) n++;
    }
    return n;
  };
  for (let guard = 0; guard < box.w + box.h; guard++) {
    if (rect.w < PLACE_MIN.side || rect.h < PLACE_MIN.side) return null;
    const sides: { side: Direction; miss: number }[] = (['north', 'south', 'west', 'east'] as const)
      .map((side) => ({ side, miss: missingOn(side) }));
    const worst = sides.reduce((a, b) => (b.miss > a.miss ? b : a));
    if (worst.miss === 0) break;
    if (worst.side === 'north') { rect.y++; rect.h--; }
    else if (worst.side === 'south') { rect.h--; }
    else if (worst.side === 'west') { rect.x++; rect.w--; }
    else { rect.w--; }
  }
  if (rect.w < PLACE_MIN.side || rect.h < PLACE_MIN.side) return null;
  return rect.w * rect.h >= PLACE_MIN.cells ? rect : null;
}

// --- regions ---------------------------------------------------------------------------------

function anchorRegion(spec: AnchorRegionSpec, lot: Rect, entry: Direction): RegionPlan {
  return {
    ...spec,
    lot: [lot],
    entrySide: entry,
    orientation: entry,
    ...(backingOf(lot, entry) ? { backing: backingOf(lot, entry)! } : {}),
  };
}

function themeRegion(id: string, spec: ThemeRegionSpec, lot: Rect, entry: Direction): RegionPlan {
  return {
    id,
    kind: 'theme',
    ...themeRef(spec.themeId),
    anchors: [],
    size: { w: lot.w, h: lot.h },
    tags: spec.tags,
    lot: [lot],
    entrySide: entry,
    orientation: entry,
    ...(backingOf(lot, entry) ? { backing: backingOf(lot, entry)! } : {}),
  };
}

/** The quiet treatment: a place with no theme behind it, planted sparsely and edged, which is what a
 *  block gets where nothing else claimed it. */
function quietRegion(id: string, lot: Rect, entry: Direction): RegionPlan {
  return {
    id,
    kind: 'theme',
    ...themeRef(QUIET_THEME),
    anchors: [],
    size: { w: lot.w, h: lot.h },
    tags: [],
    lot: [lot],
    entrySide: entry,
    orientation: entry,
    quiet: true,
  };
}

/** The theme a stop on the walk is met as, as a spec the rest of this stage reads like any other.
 *  The movement line drew it against the stop's place in the sequence; nothing here second-guesses
 *  that, since the sequence is the story. */
function stopSpec(stop: MovementStop): ThemeRegionSpec {
  return {
    id: `stop-${stop.index}`,
    kind: 'theme',
    ...themeRef(stop.themeId),
    anchors: [],
    size: { w: SET_PIECE_SIDE.max, h: SET_PIECE_SIDE.max },
    tags: [],
  };
}

/** The next theme in the cycle, skipping the landmark: it holds the biggest block already, and a
 *  second block drawing it would write the phrase twice. */
function nextTheme(
  themes: readonly ThemeRegionSpec[], at: number, landmark: ThemeRegionSpec | undefined,
): ThemeRegionSpec | null {
  const pool = landmark ? themes.filter((t) => t !== landmark) : themes;
  return pool.length ? pool[at % pool.length]! : null;
}

/** A theme for one place of an anchor district: the specs are cycled by the anchor's own id, so two
 *  residential blocks are not dressed identically. */
function themeFor(themes: readonly ThemeRegionSpec[], rng: Rng, anchorId: string, k: number): ThemeRegionSpec {
  if (themes.length === 0) {
    return { id: anchorId, kind: 'theme', ...themeRef(FALLBACK_THEME), anchors: [], size: { w: 8, h: 8 }, tags: [] };
  }
  return themes[(fnv1a32(anchorId) + k + rng.int(2)) % themes.length]!;
}

function backingOf(lot: Rect, entry: Direction): Rect | null {
  const back = OPPOSITE_DIR[entry];
  const depth = Math.min(BACKING_DEPTH, Math.floor((back === 'north' || back === 'south' ? lot.h : lot.w) / 2));
  if (depth < 1) return null;
  switch (back) {
    case 'north': return { x: lot.x, y: lot.y, w: lot.w, h: depth };
    case 'south': return { x: lot.x, y: lot.y + lot.h - depth, w: lot.w, h: depth };
    case 'west': return { x: lot.x, y: lot.y, w: depth, h: lot.h };
    default: return { x: lot.x + lot.w - depth, y: lot.y, w: depth, h: lot.h };
  }
}

/** Every place's look-out: the direction the nearest pavement lies in, or the plaza's where no
 *  street runs within reach. A region is entered from there and backed at its far end. */
function lookOut(
  lot: Rect, paved: Uint8Array, centre: { x: number; y: number }, W: number, H: number,
): Direction {
  const cx = lot.x + lot.w / 2, cy = lot.y + lot.h / 2;
  let best: { dir: Direction; d: number } | null = null;
  for (const dir of ['north', 'south', 'east', 'west'] as const) {
    const step = DIR_OFFSETS[dir];
    for (let k = 1; k <= ENTRY_REACH; k++) {
      const x = Math.round(cx + step.dx * (k + (dir === 'east' || dir === 'west' ? lot.w / 2 : 0)));
      const y = Math.round(cy + step.dy * (k + (dir === 'north' || dir === 'south' ? lot.h / 2 : 0)));
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      if (!paved[flatIndex(x, y, W)]) continue;
      if (!best || k < best.d) best = { dir, d: k };
      break;
    }
  }
  if (best) return best.dir;
  return directionOf(centre.x - cx, centre.y - cy)!;
}

// --- the high ground --------------------------------------------------------------------------

/** The bounding rect of the composition's own high ground: the plates standing within one tier of its
 *  peak. The landmark asks a plan for one, and the composition is what decides where the mass sits, so
 *  this reports the mass rather than dictating it. A planet with no relief reports an empty rect. */
function highGround(composition: CompositionPlan): Rect {
  const peak = composition.plates.reduce((m, p) => Math.max(m, p.tier), 0);
  if (peak <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const plate of composition.plates) {
    if (plate.tier < peak) continue;
    x0 = Math.min(x0, plate.rect.x); y0 = Math.min(y0, plate.rect.y);
    x1 = Math.max(x1, plate.rect.x + plate.rect.w); y1 = Math.max(y1, plate.rect.y + plate.rect.h);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// --- arithmetic --------------------------------------------------------------------------------

function* rectCells(rect: Rect, W: number): Generator<number> {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) yield flatIndex(x, y, W);
  }
}

/** Distance from a point to a rect's centre. */
const distanceTo = (from: { x: number; y: number }, rect: Rect): number =>
  Math.hypot(rect.x + rect.w / 2 - from.x, rect.y + rect.h / 2 - from.y);


