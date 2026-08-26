/**
 * THE DECKS AND THE FLIGHTS: the objects that carry the walk over a gap or up a step.
 *
 * A crossing is ANCHORED, never positioned. The `heightDrop` and `waterSpan` traits read the cliff
 * or the gap beside the anchor and snap the object's own position, rotation and span, so every
 * function here names a cell, lets the rules answer with the crossing that fits it, and reads back
 * what landed (`placeAndRead`) rather than assuming the plan's footprint.
 *
 * Where a deck's bank is bare it is paved out to the network first (`paving.ts`), because a bridge
 * the streets do not reach is an ornament standing over the water.
 */
import { flatIndex } from '../../../../core/model/grid-model';
import type { Rng } from '../../../../core/model/rng';
import {
  ItemCategory, TerrainType, type GridState, type MacroCoord, type PlacedObject,
} from '../../../../core/model/types';
import { getPlaceableByCategory } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';
import { removePlaced, tryPlace, type PlaceCtx } from '../../../placement/object';
import type { RampSpec, StreetPlan } from '../streets/streets';
import { connector } from './paving';
import { spanInScope, type Scope } from './scope';

/**
 * The street plan's flights, laid as ramps.
 *
 * A ramp is anchored, never positioned: the `heightDrop` trait reads the cliff under the anchor and
 * snaps the object's position and rotation itself, so the only way to know where one landed is to
 * look afterwards. `misplaced` counts the ramps whose stored footprint is not the one stage B drew,
 * which is what the no-pavement-under-a-ramp promise rests on — the plan cleared the corridor it
 * drew, not the one the engine might have chosen.
 */
export function layFlights(
  place: PlaceCtx, streets: StreetPlan, scope: Scope,
): { placed: number; misplaced: number } {
  let placed = 0, misplaced = 0;
  for (const ramp of streets.ramps) {
    if (!scope.rect(ramp.footprint.x, ramp.footprint.y, ramp.footprint.w, ramp.footprint.h)) continue;
    let landed: PlacedObject | null = null;
    // BOTH ends of the step are offered, because the trait takes the first cliff it meets around the
    // anchor and a flight's own high cell has two: the step it is descending and the step it just
    // came down. The plan's footprint is the arbiter — a ramp that resolved to another cliff is taken
    // back rather than left standing, since its corridor is somewhere else and it would be a
    // staircase across a terrace nobody cleared.
    for (const anchor of anchorsOf(ramp)) {
      const at = placeAndRead(place, scope, ramp.catalogId, anchor.x, anchor.y);
      if (!at) continue;
      const r = objectRect(at);
      if (r.x === ramp.footprint.x && r.y === ramp.footprint.y
        && r.w === ramp.footprint.w && r.h === ramp.footprint.h) { landed = at; break; }
      removePlaced(place, at);
    }
    if (landed) placed++;
    else misplaced++;
  }
  return { placed, misplaced };
}

/**
 * The two cells a ramp may be ANCHORED at: the high cell of the step it climbs, and the first cell of
 * the run below it.
 *
 * The `heightDrop` trait resolves the ramp from a cliff beside the anchor and then stores the
 * footprint at one of two offsets — a ramp facing +y or +x stores it FROM the high cell, one facing
 * -y or -x stores it four cells back. So the stored position is not itself an anchor the trait can
 * resolve from: at the far end of the run there is no cliff to read. The high cell is where the
 * footprint says it is in both facings, and the run's first cell is the same step read from below.
 */
function anchorsOf(ramp: RampSpec): MacroCoord[] {
  const f = ramp.footprint;
  switch (ramp.rotation) {
    case 180: return [{ x: f.x, y: f.y + f.h }, { x: f.x, y: f.y + f.h - 1 }];
    case 270: return [{ x: f.x + f.w, y: f.y }, { x: f.x + f.w - 1, y: f.y }];
    case 90: return [{ x: f.x, y: f.y }, { x: f.x + 1, y: f.y }];
    default: return [{ x: f.x, y: f.y }, { x: f.x, y: f.y + 1 }];
  }
}

/** How far apart two scanned bridges stand, so a channel is not decked twice at the same crossing. */
const BRIDGE_GAP = 10;
/** How many bridges one map carries at richness 0 and 1. The target island has five. */
export const BRIDGE_COUNT = { min: 1, max: 5 } as const;

/**
 * The decks that carry the movement line over its own gaps.
 *
 * The `waterSpan` trait resolves a bridge's position, rotation and span from the gap it finds beside
 * the anchor, so the pipeline names a cell in the gap and reads back what landed. Every cell along
 * the gap's middle is offered, because which one the trait can resolve from depends on where the
 * two flat ends fall, and the styles are offered widest-first: a stone deck is two macro cells wide
 * and reads as a road crossing, a plank deck as a garden path.
 */
export function layLineDecks(place: PlaceCtx, streets: StreetPlan, scope: Scope): number {
  const pool = getPlaceableByCategory(ItemCategory.Bridge);
  if (!pool.length) return 0;
  const styles = [...pool].sort((a, b) => b.width * b.height - a.width * a.height);
  let placed = 0;
  for (const crossing of streets.crossings) {
    const r = crossing.open;
    const cells: MacroCoord[] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push({ x, y });
    // Nearest the middle of the gap first: a deck resolved from a corner cell lands askew of the
    // street it is carrying.
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    cells.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    // THE CROSSING NAMES ITS OWN AXIS, and the rect does not: the gap lies ACROSS the street, so its
    // long side is perpendicular to the walk the deck has to carry. Derived from the rect instead,
    // every line deck was asked for the wrong axis and came back turned across the trunk it was
    // planned into (measured: two of `hexia/7`'s three decks, and one on eight of the twenty maps).
    const axis: readonly [number, number] = crossing.axis === 'x' ? [1, 0] : [0, 1];
    let landed = false;
    for (const style of styles) {
      for (const at of cells) {
        if (placeAndRead(place, scope, style.id, at.x, at.y, axis)) { landed = true; break; }
      }
      if (landed) break;
    }
    if (landed) placed++;
  }
  return placed;
}

/**
 * A bridge wherever the channel runs between two paved banks.
 *
 * The scan reads the water rather than the roads: a cell of ground-level water whose run across is
 * within the span the catalog's bridges carry, with pavement within reach on both banks, is a place
 * a walker wants a crossing. Where a bank is bare the short connector to the nearest pavement is
 * paved as well, so the deck is part of the network instead of an ornament over the water.
 */
export function layBridges(
  place: PlaceCtx, pavable: Uint8Array, surface: Int8Array, rng: Rng, material: string, budget: number,
  refused: { crossings: number }, scope: Scope,
): number {
  const pool = getPlaceableByCategory(ItemCategory.Bridge);
  if (!pool.length || budget <= 0) return 0;
  const { state } = place;
  const W = state.template.width, H = state.template.height;
  const sites: { at: MacroCoord; cost: number }[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isGroundWater(state, x, y)) continue;
      const crossing = crossingAt(place, pavable, surface, x, y);
      if (crossing) sites.push({ at: { x, y }, cost: crossing.connect.length });
    }
  }
  // Shortest way to the streets first: the crossing a walker would actually have wanted, rather
  // than the first one the scan met.
  sites.sort((a, b) => a.cost - b.cost || (a.at.y - b.at.y) || (a.at.x - b.at.x));

  const taken: MacroCoord[] = [];
  let placed = 0;
  for (const site of sites) {
    if (placed >= budget) break;
    if (taken.some((t) => Math.abs(t.x - site.at.x) + Math.abs(t.y - site.at.y) < BRIDGE_GAP)) continue;
    // THE WAY TO THE CROSSING IS PAVED BEFORE THE DECK LANDS, and the course is routed again here
    // rather than taken from the scan: every site was ranked against the same network, and an
    // earlier crossing's approach has since taken ground this one was planned over. A site that no
    // longer reaches the streets is passed over — a deck laid first and found unreachable after is a
    // bridge standing in the water as an ornament, which the scan cannot take back. Laying the
    // pavement first cannot strand anything: the course joins the network at its far end, and a deck
    // is a coating's legal neighbour, so it may land on the bank cells the course just paved.
    const crossing = crossingAt(place, pavable, surface, site.at.x, site.at.y);
    if (!crossing) continue;
    // A DECK IS ONE OBJECT SPANNING TWO BANKS, so the whole span is what a scope has to hold: a
    // bridge whose far end lands outside the painted region is a stray however well it reads.
    if (!spanInScope(scope, crossing.banks)) continue;
    for (const c of crossing.connect) {
      if (!scope.cell(c.x, c.y)) continue;
      if (!tryPlace(place, material, c.x, c.y)) refused.crossings++;
    }
    // A DECK IS A LINK OR IT IS NOTHING, and the course alone does not make it one: it is routed in
    // 2x2 stamps, so it stops wherever a whole stamp last fitted, which on a bank narrowed by the
    // channel can be two cells short of the water. The landing fills that gap a cell at a time, and
    // a deck whose banks are still not reached is passed over. The paving already laid stays either
    // way: it is a stretch of street joined to the network at its far end, which is all it ever was.
    for (const b of crossing.banks) landBank(place, material, b, scope);
    if (!crossing.banks.every((b) => pavementNear(place, b.x, b.y, 1))) continue;
    const id = pool[rng.int(pool.length)]!.id;
    if (!placeAndRead(place, scope, id, site.at.x, site.at.y, crossing.axis)) continue;
    taken.push(site.at);
    placed++;
  }
  return placed;
}

/** The connector cells a crossing at (x, y) needs paved and the two banks it would rest on, or null
 *  when neither axis offers two banks the network reaches. An empty `connect` means both banks are
 *  paved already. */
function crossingAt(
  place: PlaceCtx, pavable: Uint8Array, surface: Int8Array, x: number, y: number,
): { connect: MacroCoord[]; banks: MacroCoord[]; axis: readonly [number, number] } | null {
  const axes: readonly (readonly [number, number])[] = [[1, 0], [0, 1]];
  for (const [dx, dy] of axes) {
    const a = bank(place.state, x, y, -dx, -dy);
    const b = bank(place.state, x, y, dx, dy);
    if (!a || !b) continue;
    const connectA = connector(place, pavable, surface, a, -dx, -dy);
    const connectB = connector(place, pavable, surface, b, dx, dy);
    if (!connectA || !connectB) continue;
    // The two banks are searched independently and against the same network, so a course that loops
    // round the water's end can name a cell the other already named; each cell is asked for once.
    const seen = new Set<number>();
    return {
      banks: [a, b],
      axis: [dx, dy] as const,
      connect: [...connectA, ...connectB].filter((c) => {
        const k = flatIndex(c.x, c.y, place.state.template.width);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
    };
  }
  return null;
}

/** The first dry cell walking (dx, dy) off the water, or null where the run leaves the map or the
 *  water goes on further than a deck could. */
function bank(state: GridState, x: number, y: number, dx: number, dy: number): MacroCoord | null {
  const W = state.template.width, H = state.template.height;
  for (let k = 1; k <= 6; k++) {
    const nx = x + dx * k, ny = y + dy * k;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return null;
    if (isGroundWater(state, nx, ny)) continue;
    return surfaceAt(state, nx, ny) === 0 ? { x: nx, y: ny } : null;
  }
  return null;
}

/** Surface elevation of a cell for the crossing scans: -1 for water and for anything off the map, so
 *  a caller testing for level ground can ask one question. */
function surfaceAt(state: GridState, x: number, y: number): number {
  const cell = state.cells[y]?.[x];
  if (!cell) return -1;
  const t = cell.terrain;
  if (!t || t.type === TerrainType.None) return 0;
  return t.type === TerrainType.Water ? -1 : t.elevation;
}

const isGroundWater = (state: GridState, x: number, y: number): boolean => {
  const t = state.cells[y]?.[x]?.terrain;
  return !!t && t.type === TerrainType.Water && t.elevation === 0;
};

/** Pavement laid right at a bridge's bank, where the rules take it: single cells rather than a
 *  stamp, since what is left there is by definition too narrow for one. A refusal costs nothing and
 *  is not counted — this is the crossing reaching for the street, not the plan being denied. */
function landBank(place: PlaceCtx, material: string, bank: MacroCoord, scope: Scope): void {
  for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [1, 0], [0, 1]] as const) {
    if (scope.cell(bank.x + dx, bank.y + dy)) tryPlace(place, material, bank.x + dx, bank.y + dy);
  }
}

/**
 * Place a CROSSING, keep it only where the whole of it landed in scope, and hand back what landed.
 *
 * The `heightDrop` and `waterSpan` traits SNAP a ramp's or a deck's position, rotation and span
 * themselves — that is the whole reason the pipeline names a cell and lets the rules answer with the
 * crossing that fits it — so where one finally stands is only knowable once it has run. Measured: a
 * ramp asked for at row 96 came back covering row 95, half a cell above the anchor, and no box drawn
 * around the anchor beforehand can be both tight enough to be useful and wide enough to be right.
 * So the check is made afterwards, on the footprint the map actually holds, and a crossing that
 * strayed is taken back. The same reading the agent's own region lock makes, for the same reason.
 */
/**
 * Place a deck at a cell and read back what the engine actually stored, taking it away again where
 * that is not what was asked for.
 *
 * THE AXIS IS PART OF THE ASK: a deck carries the street it was sited for, never lies across it. The
 * `waterSpan` trait resolves position, rotation and span from a gap it DETECTS beside the anchor
 * cell, and a gap is any below-deck run — water, off-map void, or merely lower terrain. So a deck
 * sited on a channel running north-south can come back spanning an unrelated dip east-west, two
 * cells off the water it was asked about and at right angles to the street it was meant to carry.
 * MEASURED as a controlled swap, twenty maps at full richness: with the check the batch stands 45 of its
 * 48 decks carrying a street on at both ends and NONE lying across one; without it,
 * 6 of 48 and thirteen crossways. The deck COUNT is identical either way — the trait can resolve the
 * axis the walk asked for almost everywhere, it simply had no reason to prefer it.
 *
 * The caller knows which axis the walk needs carried, so the landing is measured against it and a
 * deck that came back turned is removed rather than left standing. It costs bridges on the seeds
 * where the trait cannot resolve the axis asked for, and a bridge nobody crosses is worth less than
 * the count.
 */
function placeAndRead(
  place: PlaceCtx, scope: Scope, catalogId: string, x: number, y: number,
  axis?: readonly [number, number],
): PlacedObject | null {
  const landed = tryPlace(place, catalogId, x, y);
  if (!landed) return null;
  const r = objectRect(landed);
  if (axis && !spansAlong(r, axis)) { removePlaced(place, landed); return null; }
  if (!scope.bounded) return landed;
  if (scope.rect(r.x, r.y, r.w, r.h)) return landed;
  removePlaced(place, landed);
  return null;
}

/** Whether a landed deck's own long side runs along `axis`. A deck is longer across the gap it spans
 *  than it is wide, so its footprint names its axis. */
function spansAlong(r: { w: number; h: number }, axis: readonly [number, number]): boolean {
  return axis[0] !== 0 ? r.w >= r.h : r.h >= r.w;
}

/** Whether pavement stands within `reach` cells of (x, y). */
function pavementNear(place: PlaceCtx, x: number, y: number, reach: number): boolean {
  const W = place.state.template.width, H = place.state.template.height;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (place.roads.has(flatIndex(nx, ny, W))) return true;
    }
  }
  return false;
}
