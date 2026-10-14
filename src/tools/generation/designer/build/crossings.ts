/**
 * The decks and the flights: the objects that carry the walk over a gap or up a step.
 *
 * A crossing is anchored, never positioned. The `heightDrop` and `waterSpan` traits read the cliff
 * or the gap beside the anchor and snap the object's own position, rotation and span, so every
 * function here names a cell, lets the rules answer with the crossing that fits it, and reads back
 * what landed (`placeAndRead`) rather than assuming the plan's footprint.
 *
 * Where a deck's bank is bare it is paved out to the network first (`paving.ts`), because a bridge
 * the streets do not reach is an ornament standing over the water.
 */
import { flatIndex } from '../../../../core/grid/rect';
import { surfaceElevation } from '../../../../core/domain/terrain/terrain-surface';
import type { Rng } from '../../../../core/base/rng';
import {
  TerrainType, type GridState, type MacroCoord, type PlacedObject,
} from '../../../../core/model/types';
import { rampOrientation } from '../../../../core/domain/terrain/ramp-span';
import { findTrait } from '../../../../core/model/traits';
import { crossingRunsAlongX, objectRect } from '../../../../state/object-geometry';
import { crossingPool } from '../../../placement/crossings';
import { removePlaced, tryPlace, type PlaceCtx } from '../../../placement/object';
import type { RampSpec, StreetPlan } from '../streets/model';
import { connector, type PaveGround, type Paving } from './paving';
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
    // Both ends of the step are offered, because the trait takes the first cliff it meets around the
    // anchor and a flight's own high cell has two: the step it is descending and the step it just
    // came down. The plan's footprint is the arbiter — a ramp that resolved to another cliff is taken
    // back rather than left standing, since its corridor is somewhere else and it would be a
    // staircase across a terrace nobody cleared.
    for (const anchor of anchorsOf(ramp)) {
      const at = placeAndRead(place, scope, ramp.catalogId, { x: anchor.x, y: anchor.y });
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
 * The two cells a ramp may be anchored at: the high cell of the step it climbs, and the first cell of
 * the run below it.
 *
 * The `heightDrop` trait resolves the ramp from a cliff beside the anchor and then stores the
 * footprint at one of two offsets — a ramp facing +y or +x stores it from the high cell, one facing
 * -y or -x stores it one footprint length back. So the stored position is not itself an anchor the trait can
 * resolve from: at the far end of the run there is no cliff to read. The high cell is where the
 * footprint says it is in both facings, and the run's first cell is the same step read from below.
 */
function anchorsOf(ramp: RampSpec): MacroCoord[] {
  const f = ramp.footprint;
  const { spanAxis, highAtStart } = rampOrientation(ramp.rotation);
  const [dx, dy] = spanAxis === 'y' ? [0, 1] : [1, 0];
  const len = spanAxis === 'y' ? f.h : f.w;
  const at = (k: number): MacroCoord => ({ x: f.x + dx * k, y: f.y + dy * k });
  return highAtStart ? [at(0), at(1)] : [at(len), at(len - 1)];
}

/** How far apart two scanned bridges stand, so a channel is not decked twice at the same crossing. */
const BRIDGE_GAP = 10;
/** How many bridges one map carries at richness 0 and 1. */
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
  const pool = crossingPool('bridge');
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
    // The crossing names its own axis, and the rect does not: the gap lies across the street, so its
    // long side is perpendicular to the walk the deck has to carry, and an axis derived from the rect
    // turns a line deck across the trunk it was planned into.
    const axis: readonly [number, number] = crossing.axis === 'x' ? [1, 0] : [0, 1];
    let landed = false;
    for (const style of styles) {
      for (const at of cells) {
        if (placeAndRead(place, scope, style.id, { x: at.x, y: at.y }, axis)) { landed = true; break; }
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
  paving: Paving, { rng, budget, refused }: { rng: Rng; budget: number; refused: { crossings: number } },
): number {
  const { place, material, scope } = paving;
  const pool = crossingPool('bridge');
  if (!pool.length || budget <= 0) return 0;
  const { state } = place;
  const W = state.template.width, H = state.template.height;
  // The widest water any offered deck spans.
  const span = Math.max(0, ...pool.map((item) => findTrait(item, 'waterSpan')?.max ?? 0));
  const sites: { at: MacroCoord; cost: number }[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isGroundWater(state, x, y)) continue;
      const crossing = crossingAt(paving, x, y, span);
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
    // The way to the crossing is paved before the deck lands, and the course is routed again here
    // rather than taken from the scan: every site was ranked against the same network, and an
    // earlier crossing's approach has since taken ground this one was planned over. A site that no
    // longer reaches the streets is passed over — a deck laid first and found unreachable after is a
    // bridge standing in the water as an ornament, which the scan cannot take back. Laying the
    // pavement first cannot strand anything: the course joins the network at its far end, and a deck
    // is a coating's legal neighbour, so it may land on the bank cells the course just paved.
    const crossing = crossingAt(paving, site.at.x, site.at.y, span);
    if (!crossing) continue;
    // A deck is one object spanning two banks, so the whole span is what a scope has to hold: a
    // bridge whose far end lands outside the painted region is a stray however well it reads.
    if (!spanInScope(scope, crossing.banks)) continue;
    for (const c of crossing.connect) {
      if (!scope.cell(c.x, c.y)) continue;
      if (!tryPlace(place, material, c.x, c.y)) refused.crossings++;
    }
    // A deck is a link or it is nothing, and the course alone does not make it one: it is routed in
    // 2x2 stamps, so it stops wherever a whole stamp last fitted, which on a bank narrowed by the
    // channel can be two cells short of the water. The landing fills that gap a cell at a time, and
    // a deck whose banks are still not reached is passed over. The paving already laid stays either
    // way: it is a stretch of street joined to the network at its far end, which is all it ever was.
    for (const b of crossing.banks) landBank(place, material, b, scope);
    if (!crossing.banks.every((b) => pavementNear(place, b.x, b.y, 1))) continue;
    const id = pool[rng.int(pool.length)]!.id;
    if (!placeAndRead(place, scope, id, { x: site.at.x, y: site.at.y }, crossing.axis)) continue;
    taken.push(site.at);
    placed++;
  }
  return placed;
}

/** The connector cells a crossing at (x, y) needs paved and the two banks it would rest on, or null
 *  when neither axis offers two banks the network reaches. An empty `connect` means both banks are
 *  paved already. */
function crossingAt(
  ground: PaveGround, x: number, y: number, span: number,
): { connect: MacroCoord[]; banks: MacroCoord[]; axis: readonly [number, number] } | null {
  const { place } = ground;
  const axes: readonly (readonly [number, number])[] = [[1, 0], [0, 1]];
  for (const [dx, dy] of axes) {
    const a = bank(place.state, x, y, { dx: -dx, dy: -dy }, span);
    const b = bank(place.state, x, y, { dx, dy }, span);
    if (!a || !b) continue;
    // One bank at a time: the search is pure, and most sites fail on their first bank, so the
    // second course is only routed for a crossing that still can exist.
    const connectA = connector(ground, a, -dx, -dy);
    if (!connectA) continue;
    const connectB = connector(ground, b, dx, dy);
    if (!connectB) continue;
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
 *  water goes on further than `span`, the widest deck, could cross. */
function bank(state: GridState, x: number, y: number, step: { dx: number; dy: number }, span: number): MacroCoord | null {
  const { dx, dy } = step;
  const W = state.template.width, H = state.template.height;
  for (let k = 1; k <= span; k++) {
    const nx = x + dx * k, ny = y + dy * k;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return null;
    if (isGroundWater(state, nx, ny)) continue;
    return surfaceAt(state, nx, ny) === 0 ? { x: nx, y: ny } : null;
  }
  return null;
}

/** The standable surface of a cell (`surfaceElevation`, the tier placement reads, so a corner patch
 *  reads as its base) for the crossing scans: -1 for water and for anything off the map, so a caller
 *  testing for level ground can ask one question. */
function surfaceAt(state: GridState, x: number, y: number): number {
  const cell = state.cells[y]?.[x];
  if (!cell) return -1;
  return cell.terrain?.type === TerrainType.Water ? -1 : surfaceElevation(cell.terrain);
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
 * Place a crossing, keep it only where all of it landed in scope on the axis asked for, and hand
 * back what landed. The `heightDrop` and `waterSpan` traits snap position, rotation and span, so
 * where a crossing stands is known only afterwards (a snapped ramp can cover the row above its
 * anchor); the check reads the footprint the map holds, as the agent's region lock does.
 *
 * `waterSpan` resolves from any below-deck gap beside the anchor, so a deck sited on a north-south
 * channel can come back spanning an unrelated dip east-west. A deck that came back turned against
 * the axis the walk needs is removed: it costs bridges where the trait cannot resolve that axis,
 * and a bridge nobody crosses is worth less than the count.
 */
function placeAndRead(
  place: PlaceCtx, scope: Scope, catalogId: string, at: MacroCoord,
  axis?: readonly [number, number],
): PlacedObject | null {
  const landed = tryPlace(place, catalogId, at.x, at.y);
  if (!landed) return null;
  const r = objectRect(landed);
  if (axis && (axis[0] !== 0) !== crossingRunsAlongX(landed)) { removePlaced(place, landed); return null; }
  if (!scope.bounded) return landed;
  if (scope.rect(r.x, r.y, r.w, r.h)) return landed;
  removePlaced(place, landed);
  return null;
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
