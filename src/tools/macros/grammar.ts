/**
 * Garden grammar: what a smart-planting press is BESIDE decides what it lays.
 *
 * Open ground gets the wild stand (`patch.ts` over `habitat.ts`). Ground with something BUILT on it
 * gets a designed composition instead, because that is what a person plants next to a house: a bed
 * around it, a border along the path. The press reads its own disc through `state/object-index`, the
 * one place that answers "what is here", and ONE grammar wins per press — building before road
 * before wild, since a house standing on a paved street is still a house.
 *
 * A COMPOSITION DOES NOT GROW. The wild stand ages under a held press (`succession.ts`); a bed does
 * not, because a bed is a design and a design that matured into a wood would be a different one. A
 * hold over a grammar site lays the same composition again and the placement rules refuse it cell by
 * cell once it stands, so every burst after the first is a no-op rather than a second bed.
 *
 * THE SPECIES ARE THE SITE'S OWN. `dominantSpecies` is the habitat's own answer (the plant this ground
 * would grow), asked once for the bed's colour and once for its accent, rather than a palette of this
 * module's own — a bed beside a pond should be the bed that shore would carry. What the grammar adds
 * is the ARRANGEMENT. The bed's colour is keyed to the BUILDING rather than to the press seed, so
 * pressing twice beside one house extends one bed instead of laying two; the accent follows the
 * seed, so a second press still varies.
 *
 * GATE CLEARANCE IS A REGULATION, not this module's manners: a house's doorstep strip
 * (`buildingGate`) and every paved cell are reserved before a single plant is offered, through the
 * same `PlaceCtx` gates the generator plants behind (`tryDecorate`).
 */
import { cellKey, type Rect } from '../../core/model/grid-model';
import { fnv1a } from '../../core/model/hash';
import { ItemCategory, type GridState, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { getPlaceableByCategory } from '../../state/catalog';
import { objectRect } from '../../state/object-geometry';
import { entriesNear, getObjectIndex } from '../../state/object-index';
import { analyzeTerrain } from '../placement/analysis';
import { buildingGate, forEachFootprintCell, hasGate, makeCtx, tryDecorate, type PlaceCtx } from '../placement/object';
import type { MacroContext } from './context';
import { buildHabitatField, dominantSpecies } from './habitat';

/** What the press found beside it. `road` carries the paved cells themselves: the border follows
 *  what is actually under the disc, not a line refitted to it. */
export type GrammarSite =
  | { kind: 'building'; building: PlacedObject }
  | { kind: 'road'; paved: MacroCoord[] };

/** How far past the disc a gate strip is still reserved: a house just outside the press can still
 *  have its doorstep inside it, and the strip reaches two cells out from a wall. */
const GATE_REACH = 3;

/** Separates the bed's colour draw from its accent draw, and both from anything else seeded here. */
const COLOUR_SALT = 0x6c8e9cf5;
const ACCENT_SALT = 0x2545f491;

/**
 * The grammar this press falls under, or null for open ground.
 *
 * Buildings win over roads, and the nearest building wins among buildings: a press is aimed, and
 * what it is aimed AT is the thing closest to where the hand pointed. A LOCKED object is skipped —
 * the plaza is one, and a flower bed ringing the whole plaza is not a press's business.
 */
export function readGrammar(
  state: GridState, cells: readonly MacroCoord[], centre: { x: number; y: number },
): GrammarSite | null {
  if (cells.length === 0) return null;
  const W = state.template.width;
  const disc = new Set(cells.map((c) => c.y * W + c.x));
  const index = getObjectIndex(state);

  let building: PlacedObject | null = null;
  let nearest = Infinity;
  for (const e of entriesNear(index, bounds(cells))) {
    if (!e.item || e.obj.locked || e.item.category !== ItemCategory.Building) continue;
    let touches = false;
    forEachFootprintCell(e.obj, (x, y) => { if (disc.has(y * W + x)) touches = true; });
    if (!touches) continue;
    const d = Math.hypot(e.rect.x + e.rect.w / 2 - centre.x, e.rect.y + e.rect.h / 2 - centre.y);
    // Strictly nearer, so an exact tie keeps the older building: `entriesNear` is insertion-ordered.
    if (d < nearest) { nearest = d; building = e.obj; }
  }
  if (building) return { kind: 'building', building };

  const paved = cells.filter((c) => index.roadByCell.has(cellKey(c.x, c.y)));
  return paved.length ? { kind: 'road', paved } : null;
}

export interface GrammarInput {
  site: GrammarSite;
  cells: readonly MacroCoord[];
  centre: { x: number; y: number };
  /** The card's own category: a flora press lays a flower bed, a tree press a frame of trees. */
  lead: ItemCategory;
  seed: number;
}

/** Lay the composition the site calls for. */
export function layGrammar(ctx: MacroContext, input: GrammarInput): void {
  const { state, executor, registry } = ctx;
  const pool = getPlaceableByCategory(input.lead).map((i) => i.id);
  if (pool.length === 0) return;

  const field = buildHabitatField(analyzeTerrain(state, [...input.cells]));
  const place = makeCtx(state, (c) => executor.execute(c), registry, input.seed);
  reserveNearbyGates(place, state, input.cells);

  const anchor = input.site.kind === 'building' ? rectCentre(objectRect(input.site.building)) : input.centre;
  const W = state.template.width;
  const at = Math.max(0, Math.min(state.template.height - 1, Math.round(anchor.y))) * W
    + Math.max(0, Math.min(W - 1, Math.round(anchor.x)));
  // A COLOUR BELONGS TO WHAT IS BEING PLANTED AROUND, not to the press: two presses beside one
  // house extend one bed, and a border pressed along a road keeps its colour the length of it
  // (drifting only where the ground itself changes, since the species is still the site's). The
  // ACCENT belongs to the press, so a second press over the same ground is still a second draw.
  const identity = input.site.kind === 'building'
    ? salt(`${input.site.building.catalogId}@${input.site.building.position.x},${input.site.building.position.y}`)
    : salt('road');
  const dominant = dominantSpecies(pool, field, at, (identity ^ COLOUR_SALT) >>> 0);
  const rest = pool.filter((id) => id !== dominant);
  const accent = rest.length ? dominantSpecies(rest, field, at, (input.seed ^ ACCENT_SALT) >>> 0) : dominant;

  if (input.site.kind === 'building') layBed(place, state, input.site.building, input.lead, dominant, accent);
  else layBorder(place, state, input.site.paved, input.cells, input.lead, dominant, accent);
}

/**
 * The bed around a building: a solid ring of one colour against the walls, an accent scattered
 * through the ring outside it.
 *
 * A TREE press keeps the first ring EMPTY and frames the house from the second instead. A tree
 * against the wall is not a garden, it is a hedge nobody can get past, and the doorstep is the one
 * place a house needs open. The frame is laid on alternating cells for the same reason the wild
 * stand's trees are spaced: every tree in the catalog carries `exclusionRadius: 1`.
 */
function layBed(
  place: PlaceCtx, state: GridState, building: PlacedObject,
  lead: ItemCategory, dominant: string, accent: string,
): void {
  const r = objectRect(building);
  const { width: W, height: H } = state.template;
  for (const c of buildingGate(r, building.rotation).clear) {
    if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) place.clearance.add(c.y * W + c.x);
  }

  if (lead === ItemCategory.Flora) {
    for (const c of ringAround(r, 1, W, H)) tryDecorate(place, dominant, c.x, c.y);
    for (const c of ringAround(r, 2, W, H)) if ((c.x + c.y) % 2 === 0) tryDecorate(place, accent, c.x, c.y);
    return;
  }
  for (const c of ringAround(r, 2, W, H)) {
    if ((c.x + c.y) % 2 !== 0) continue;
    tryDecorate(place, (c.x * 3 + c.y) % 5 === 0 ? accent : dominant, c.x, c.y);
  }
}

/**
 * The border along a road: the unpaved cells the pavement touches, planted in the press's own
 * colour with the accent every fourth step.
 *
 * Bounded to the DISC, unlike the bed: a road runs the length of the map and a press is a press. A
 * TREE press takes every third cell: a line with gaps to walk through, and the spacing every tree's
 * `exclusionRadius` needs anyway.
 */
function layBorder(
  place: PlaceCtx, state: GridState, paved: readonly MacroCoord[], cells: readonly MacroCoord[],
  lead: ItemCategory, dominant: string, accent: string,
): void {
  const W = state.template.width;
  const road = new Set(paved.map((c) => c.y * W + c.x));
  const border = cells
    .filter((c) => !road.has(c.y * W + c.x) && (
      road.has(c.y * W + c.x - 1) || road.has(c.y * W + c.x + 1)
      || road.has((c.y - 1) * W + c.x) || road.has((c.y + 1) * W + c.x)
    ))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  for (const c of border) {
    if (lead === ItemCategory.Tree && (c.x + c.y) % 3 !== 0) continue;
    tryDecorate(place, (c.x + c.y) % 4 === 0 ? accent : dominant, c.x, c.y);
  }
}

/** Reserve the gate strip of every house near the disc, target or not: a bed for one house must not
 *  block the door of the next one along. */
function reserveNearbyGates(place: PlaceCtx, state: GridState, cells: readonly MacroCoord[]): void {
  const { width: W, height: H } = state.template;
  const b = bounds(cells);
  const near = entriesNear(getObjectIndex(state), {
    x: b.x - GATE_REACH, y: b.y - GATE_REACH, w: b.w + 2 * GATE_REACH, h: b.h + 2 * GATE_REACH,
  });
  for (const e of near) {
    if (!e.item || !hasGate(e.item)) continue;
    for (const c of buildingGate(e.rect, e.obj.rotation).clear) {
      if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) place.clearance.add(c.y * W + c.x);
    }
  }
}

/** The cells at Chebyshev ring `d` around a footprint — d = 1 is the ring touching it. */
function ringAround(r: Rect, d: number, W: number, H: number): MacroCoord[] {
  const x0 = Math.floor(r.x) - d, x1 = Math.ceil(r.x + r.w) - 1 + d;
  const y0 = Math.floor(r.y) - d, y1 = Math.ceil(r.y + r.h) - 1 + d;
  const out: MacroCoord[] = [];
  const add = (x: number, y: number): void => { if (x >= 0 && y >= 0 && x < W && y < H) out.push({ x, y }); };
  for (let x = x0; x <= x1; x++) { add(x, y0); add(x, y1); }
  for (let y = y0 + 1; y <= y1 - 1; y++) { add(x0, y); add(x1, y); }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The cells' bounding rect — what the spatial index is asked over. */
function bounds(cells: readonly MacroCoord[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    if (c.x < x0) x0 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.x > x1) x1 = c.x;
    if (c.y > y1) y1 = c.y;
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const rectCentre = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** A stable integer from a string — the identity a bed's colour hangs on. */
const salt = (s: string): number => parseInt(fnv1a(s), 16);
