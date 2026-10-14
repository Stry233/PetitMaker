/**
 * Garden grammar: what a smart-planting press is beside decides what it lays. Open ground gets the
 * wild stand (`patch.ts` over `habitat.ts`); ground with something built on it gets a designed
 * composition, a bed round a house or a border along a path. The press reads its disc through
 * `state/object-index`, and one grammar wins per press: building, then road, then wild.
 *
 * A composition does not grow: a hold lays it again and the placement rules refuse it cell by cell,
 * so every burst after the first is a no-op. Species are the site's own (`dominantSpecies`, asked
 * for the bed's colour and its accent); the bed's colour is keyed to the building, so two presses
 * beside one house extend one bed, and the accent follows the seed.
 *
 * A house's doorstep strip (`buildingGate`) and every paved cell are reserved before any plant is
 * offered, through the same `PlaceCtx` gates the generator uses (`tryDecorate`).
 */
import { cellKey, type Rect, mapGrid } from '../../../core/grid/rect';
import { fnv1a32 } from '../../../core/base/hash';
import type { GridState, MacroCoord, PlacedObject } from '../../../core/model/types';
import type { CategoryRole } from '../../../core/model/traits';
import { getPlaceableByRole, itemRole } from '../../../state/catalog';
import { objectRect } from '../../../state/object-geometry';
import { entriesNear, getObjectIndex } from '../../../state/object-index';
import { analyzeTerrain } from '../../placement/analysis';
import { buildingGate, forEachFootprintCell, hasGate, makeCtx, tryDecorate, type PlaceCtx } from '../../placement/object';
import type { MacroContext } from '../context';
import { buildHabitatField, dominantSpecies } from './habitat';

/** What the press found beside it. `road` carries the paved cells themselves: the border follows
 *  what is actually under the disc, not a line refitted to it. */
type GrammarSite =
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
 * what it is aimed at is the thing closest to where the hand pointed. A locked object is skipped —
 * a landmark is one, and a flower bed ringing a whole landmark is not a press's business.
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
    if (!e.item || e.obj.locked || itemRole(e.item) !== 'home') continue;
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

interface GrammarInput {
  site: GrammarSite;
  cells: readonly MacroCoord[];
  centre: { x: number; y: number };
  /** The card's lead role: a groundcover press lays a flower bed, a canopy press a frame of trees. */
  lead: CategoryRole;
  seed: number;
}

/** Lay the composition the site calls for. */
export function layGrammar(ctx: MacroContext, input: GrammarInput): void {
  const { state, executor, registry } = ctx;
  const pool = getPlaceableByRole(input.lead).map((i) => i.id);
  if (pool.length === 0) return;

  const field = buildHabitatField(analyzeTerrain(state, [...input.cells]));
  const place = makeCtx(state, (c) => executor.execute(c), registry, input.seed);
  reserveNearbyGates(place, state, input.cells);

  const anchor = input.site.kind === 'building' ? rectCentre(objectRect(input.site.building)) : input.centre;
  const W = state.template.width;
  const at = Math.max(0, Math.min(state.template.height - 1, Math.round(anchor.y))) * W
    + Math.max(0, Math.min(W - 1, Math.round(anchor.x)));
  // A colour belongs to what is being planted around, not to the press: two presses beside one
  // house extend one bed, and a border pressed along a road keeps its colour the length of it
  // (drifting only where the ground itself changes, since the species is still the site's). The
  // accent belongs to the press, so a second press over the same ground is still a second draw.
  const identity = input.site.kind === 'building'
    ? fnv1a32(`${input.site.building.catalogId}@${input.site.building.position.x},${input.site.building.position.y}`)
    : fnv1a32('road');
  const dominant = dominantSpecies(pool, field, at, (identity ^ COLOUR_SALT) >>> 0);
  const rest = pool.filter((id) => id !== dominant);
  const accent = rest.length ? dominantSpecies(rest, field, at, (input.seed ^ ACCENT_SALT) >>> 0) : dominant;

  const palette: Palette = { lead: input.lead, dominant, accent };
  if (input.site.kind === 'building') layBed(place, state, input.site.building, palette);
  else layBorder(place, state, input.site.paved, input.cells, palette);
}

/** What one press plants: its leading role, the site's dominant species and the press's accent. */
interface Palette { lead: CategoryRole; dominant: string; accent: string }

/**
 * The bed around a building: a solid ring of one colour against the walls, an accent scattered
 * through the ring outside it.
 *
 * A tree press keeps the first ring empty and frames the house from the second instead. A tree
 * against the wall is not a garden, it is a hedge nobody can get past, and the doorstep is the one
 * place a house needs open. The frame is laid on alternating cells for the same reason the wild
 * stand's trees are spaced: every tree in the catalog carries `exclusionRadius: 1`.
 */
function layBed(place: PlaceCtx, state: GridState, building: PlacedObject, { lead, dominant, accent }: Palette): void {
  const r = objectRect(building);
  const { W, H, inB, idx } = mapGrid(state.template.width, state.template.height);
  for (const c of buildingGate(r, building.rotation).clear) {
    if (inB(c.x, c.y)) place.clearance.add(idx(c.x, c.y));
  }

  if (lead === 'groundcover') {
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
 * Bounded to the disc, unlike the bed: a road runs the length of the map and a press is a press. A
 * tree press takes every third cell: a line with gaps to walk through, and the spacing every tree's
 * `exclusionRadius` needs anyway.
 */
function layBorder(
  place: PlaceCtx, state: GridState, paved: readonly MacroCoord[], cells: readonly MacroCoord[], { lead, dominant, accent }: Palette,
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
    if (lead === 'canopy' && (c.x + c.y) % 3 !== 0) continue;
    tryDecorate(place, (c.x + c.y) % 4 === 0 ? accent : dominant, c.x, c.y);
  }
}

/** Reserve the gate strip of every house near the disc, target or not: a bed for one house must not
 *  block the door of the next one along. */
function reserveNearbyGates(place: PlaceCtx, state: GridState, cells: readonly MacroCoord[]): void {
  const { inB, idx } = mapGrid(state.template.width, state.template.height);
  const b = bounds(cells);
  const near = entriesNear(getObjectIndex(state), {
    x: b.x - GATE_REACH, y: b.y - GATE_REACH, w: b.w + 2 * GATE_REACH, h: b.h + 2 * GATE_REACH,
  });
  for (const e of near) {
    if (!e.item || !hasGate(e.item)) continue;
    for (const c of buildingGate(e.rect, e.obj.rotation).clear) {
      if (inB(c.x, c.y)) place.clearance.add(idx(c.x, c.y));
    }
  }
}

/** The cells at Chebyshev ring `d` around a footprint — d = 1 is the ring touching it. */
function ringAround(r: Rect, d: number, W: number, H: number): MacroCoord[] {
  const x0 = Math.floor(r.x) - d, x1 = Math.ceil(r.x + r.w) - 1 + d;
  const y0 = Math.floor(r.y) - d, y1 = Math.ceil(r.y + r.h) - 1 + d;
  const out: MacroCoord[] = [];
  const { inB } = mapGrid(W, H);
  const add = (x: number, y: number): void => { if (inB(x, y)) out.push({ x, y }); };
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
