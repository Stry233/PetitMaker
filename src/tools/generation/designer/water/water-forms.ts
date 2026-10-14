/**
 * Draws a few large water bodies from basin, cove, ring, medallion, trough, and comb grammars. Forms
 * are seeded, repetition-limited, and resized rather than clipped. Every body occupies one terrace;
 * its dry islets and outer rim stay at the water tier or above, so it exposes no uncapped face.
 * Pure planning only: terrain and masks in, cells out.
 */
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import { NEIGHBORS4 } from '../../../../core/grid/directions';
import { enclosedPieces } from '../../../../core/grid/cell-sets';
import type { MacroCoord } from '../../../../core/model/types';
import type { TerrainPlan } from '../../terrain-plan/types';
import type { MovementLine, WaterWant } from '../composition/movement-line';
import type { DesignPlan } from '../types';
import { boundsOfCells, cellsFit, floodCells, freeAt, surfaceOf } from './water-cut';
import { fieldNoise, ringPull, type RingProfile, WET_BAND } from '../seeded';
import { lerpClamped } from '../../../../core/base/math';
import { FORMS, type WaterForm, fitForm, formCells, key, unkey } from './water-form-shapes';
import { hashInt32 } from '../../../../core/base/hash';

/**
 * How many enclosed islets each form must actually come out with.
 *
 * This is the pass's own guarantee about its water, checked on the drawn cells rather than assumed
 * from the box: a lobed outline can pull in past an islet the box put near its edge, and a figure that
 * lost its islets that way would reach the finished map as water belonging to no story. The trough
 * asks for none because it accounts for itself by being thin.
 */
const ISLANDS_MIN: Readonly<Record<WaterForm, number>> = {
  basin: 2, cove: 2, ring: 1, medallion: 2, trough: 0, comb: 0,
};
/** How many figures one planet carries, at richness 0 and 1, and how many of them may share a form. */
const FORM_COUNT = { min: 1, max: 10 } as const;
/** How many figures may share one form. Three, the cap on congruent shapes — and these are never
 *  congruent anyway, since a form is only drawn again at a box the map has not used for it. */
const FORM_REPEAT_MAX = 3;
/**
 * How much dry ground stands between two figures, in cells.
 *
 * It is read between their boxes, not between the sites they were grown from: a site is where a room
 * started growing and can be most of a room away from the figure that ended up in it, so two troughs
 * grown from distant sites can still land rows apart and merge into one solid rectangle.
 */
const FORM_GAP = 3;
/** The calm band the planet's largest composed figure keeps clear of planting, in cells: the depth its
 *  framing reads over. */
export const FIGURE_CALM = 3;
/** How many sites are tried before the pass gives up. Each grows one room, and a site inside a room
 *  already grown is skipped, so this is a bound on distinct rooms rather than on cells. */
const SITE_TRIES = 1600;
/** How far a room is grown from a site, in cells: past this a figure is not a figure but a district. */
const ROOM_MAX = 44;
/** The fewest cells a body must hold to be a figure rather than an accent that reads as loose water.
 *  Composed classes start at the 10x10 medallion. Exported because a reading of the finished map for
 *  the same class must mean the same thing by the word: what the walk can be said to thread is a
 *  figure this pass would have drawn. */
export const FIGURE_MIN = 45;
/** The figures' ring: the wet band with a 12-cell dry apron round the plaza. */
const RING_PROFILE: RingProfile = { dry: 12, ...WET_BAND };
/** How far apart the seeded field's lattice values stand, in cells, so the figures gather. */
const FIELD_SPAN = 9;
/** How much likelier a figure is on the upper terraces: a terraced planet holds 13 to 21% water on
 *  tiers 0 to 3 against 31 to 40% on tiers 4 to 8. */
const HIGH_TIER_PULL = 1.2;
/** How near the walk a room counts as being on it, in cells. */
const WALK_REACH = 6;

// --- what a composed body is --------------------------------------------------------------------

export interface ComposedBody {
  form: WaterForm;
  rect: Rect;
  tier: number;
  cells: MacroCoord[];
  /** The place this figure was composed for, or '' where the planet's own profile placed it. */
  regionId: string;
  /** Whether the walk was what asked for it: the leg that threads a composed feature. */
  onWalk: boolean;
}

interface FormsInput {
  t: TerrainPlan;
  grass: Uint8Array;
  flat: Uint8Array;
  plan: DesignPlan;
  /** The plaza's centre: the profile's own origin. */
  hub: MacroCoord;
  /** The walk, so one figure stands where a leg of it passes. */
  line?: MovementLine | undefined;
  richness: number;
  seed: number;
  /** Cells of water this pass may spend. */
  budget: number;
}

// --- cutting them -------------------------------------------------------------------------------

/**
 * The planet's composed figures, cut into the sculpt.
 *
 * The walk's own water wants come first, so at least one leg of the route passes a large figure — the
 * compression and release a map of uniformly open streets never gives a visitor. What is left is placed
 * on a planet's water profile: nothing on the plaza's apron, most of it in the 30-to-50-cell band,
 * none at the coast, and twice as likely above the working platforms as on them.
 */
export function cutComposedBodies(input: FormsInput): ComposedBody[] {
  const { t, richness, seed } = input;
  let budget = Math.max(0, input.budget);
  const count = Math.round(lerpClamped(FORM_COUNT.min, FORM_COUNT.max, richness));
  if (budget <= 0 || count <= 0) return [];

  const out: ComposedBody[] = [];
  const drawn = new Map<WaterForm, Rect[]>();
  const first = Math.abs(hashInt32(seed ^ 0x1f7b)) % FORMS.length;
  /** The next form worth trying, offered from the seed's own rotation and skipping the ones this map
   *  has already drawn its share of. */
  const forms = (): WaterForm[] => FORMS
    .map((_, k) => FORMS[(first + out.length + k) % FORMS.length]!)
    .filter((f) => (drawn.get(f) ?? []).length < FORM_REPEAT_MAX);

  // The rooms are gathered before any of them is drawn in, and taken largest first.
  //
  // A site inside a room already offered is the same room again, so each is grown once. And the order
  // matters as much as the set: a form may only be drawn a few times and never twice at one box, so
  // whichever rooms are offered first spend the vocabulary. Ranking by room area weighted by the profile
  // lands the figures where there is room for one; the profile alone spends the vocabulary on small rooms
  // near the plaza and leaves the long terraces further out empty.
  const tried = new Uint8Array(t.width * t.height);
  // How near the walk each room stands, so the route threads a figure rather than passing all of them at
  // a distance: compression and release, which a map of uniformly open streets never gives a visitor.
  const walk = new Set((input.line?.trace ?? []).map((c) => key(c.x, c.y)));
  const nearWalk = (room: Rect): boolean => {
    for (let y = room.y - WALK_REACH; y <= room.y + room.h + WALK_REACH; y++) {
      for (let x = room.x - WALK_REACH; x <= room.x + room.w + WALK_REACH; x++) {
        if (walk.has(key(x, y))) return true;
      }
    }
    return false;
  };
  const rooms: { site: Site; room: Rect; rank: number }[] = [];
  for (const site of sites(input)) {
    if (tried[flatIndex(site.at.x, site.at.y, t.width)]) continue;
    const room = growRoom(input, site.at, t.tier[flatIndex(site.at.x, site.at.y, t.width)]!);
    const box = room ?? { x: site.at.x, y: site.at.y, w: 1, h: 1 };
    for (let y = Math.max(0, box.y); y < Math.min(t.height, box.y + box.h); y++) {
      for (let x = Math.max(0, box.x); x < Math.min(t.width, box.x + box.w); x++) {
        tried[flatIndex(x, y, t.width)] = 1;
      }
    }
    if (!room) continue;
    const pull = site.onWalk ? 1 : nearWalk(room) ? 0.5 : 0;
    rooms.push({ site, room, rank: room.w * room.h * (1 + pull) });
  }
  rooms.sort((a, b) => b.rank - a.rank || (a.room.y - b.room.y) || (a.room.x - b.room.x));

  const placed: Rect[] = [];
  for (const { site, room } of rooms) {
    if (out.length >= count || budget <= 0) break;
    // The first figure is the map's primary one — the top rung of the size ladder, the one thing that
    // happens once — so it is drawn by whichever form uses the biggest room best rather than by the seed's
    // rotation — the rotation would answer the planet's largest terrace with a 3-cell-wide trough as
    // readily as with a basin, and the map would have no dominant water figure at all.
    const body = cutOne(input, site, room, { forms: forms(), drawn, placed, budget, primary: out.length === 0 });
    if (!body) continue;
    out.push(body);
    placed.push(body.rect);
    drawn.set(body.form, [...(drawn.get(body.form) ?? []), body.rect]);
    budget -= body.cells.length;
    // The whole box is locked, islets and platform included: a later pass flooding one of those would
    // take the figure's own dry ground and with it the reading that accounts for it.
    for (let y = body.rect.y; y < body.rect.y + body.rect.h; y++) {
      for (let x = body.rect.x; x < body.rect.x + body.rect.w; x++) {
        if (x >= 0 && y >= 0 && x < t.width && y < t.height) input.flat[flatIndex(x, y, t.width)] = 1;
      }
    }
  }
  return out;
}

interface Site { at: MacroCoord; regionId: string; onWalk: boolean }

/**
 * The figure is set into the terrace, as a terraced planet's water is cut into its terraces. `fitForm`
 * centres the box, so it is pushed against the room's risers: a pool in a step, a basin at a foot.
 * Never against a drop, where the body would show an uncomposed waterfall face. The room is already
 * inset a cell, so the flush figure keeps that bank. With risers on both sides of an axis it stays
 * centred on that axis.
 */
function setIntoStep(t: TerrainPlan, rect: Rect, room: Rect, tier: number): Rect {
  /**
   * Whether the ground that ended the room's growth on one side is a riser the figure may be laid
   * against: Every cell of that line stands at the water's own level or above, and most of it stands
   * strictly above.
   *
   * The first half is `cellsFit`'s own test and it is asked of the whole line rather than of a
   * majority, because the figure is judged as one body and a single lower cell refuses all of it. The
   * line is read one cell past each end, since a body's corner reads its diagonal neighbour too.
   */
  const riser = (side: 'west' | 'east' | 'north' | 'south'): boolean => {
    const across = side === 'west' || side === 'east';
    const at = across
      ? (side === 'west' ? room.x - STEP_BEYOND : room.x + room.w - 1 + STEP_BEYOND)
      : (side === 'north' ? room.y - STEP_BEYOND : room.y + room.h - 1 + STEP_BEYOND);
    const lo = (across ? room.y : room.x) - 1;
    const hi = (across ? room.y + room.h : room.x + room.w);
    let up = 0, seen = 0;
    for (let k = lo; k <= hi; k++) {
      const x = across ? at : k, y = across ? k : at;
      if (surfaceOf(t, x, y) < tier) return false;
      seen++;
      if (x >= 0 && y >= 0 && x < t.width && y < t.height
        && t.tier[flatIndex(x, y, t.width)]! > tier) up++;
    }
    return seen > 0 && up * 2 >= seen;
  };
  const west = riser('west'), east = riser('east');
  const north = riser('north'), south = riser('south');
  // Flush against the riser, which is one cell past the room: the room is the grown rect inset by a
  // cell, and that cell is the bank a figure keeps where the ground beyond it drops. Against a riser
  // there is nothing to keep it from — the step is the frame.
  const x = west === east ? rect.x
    : west ? room.x - 1 : room.x + room.w + 1 - rect.w;
  const y = north === south ? rect.y
    : north ? room.y - 1 : room.y + room.h + 1 - rect.h;
  return { ...rect, x, y };
}

/** How far past a room's own edge the ground that ended its growth stands. The room is the grown rect
 *  inset by one, so the blocker is two cells out. */
const STEP_BEYOND = 2;

/**
 * One figure at one site: the room grown from the site, then the forms offered in turn until one is
 * drawn that the terrace carries.
 *
 * The room is inset a cell before a form is fitted into it, because `cellsFit` reads the ring around a
 * body and the ring around a maximal free room is the terrace edge that ended it. A repeat of a form
 * already drawn is only kept where its box differs from the first, so no two figures on one planet are
 * congruent.
 */
function cutOne(
  input: FormsInput, site: Site, room: Rect,
  { forms, drawn, placed, budget, primary }: {
    forms: readonly WaterForm[];
    /** The boxes each form has already drawn, and every body placed so far. */
    drawn: ReadonlyMap<WaterForm, Rect[]>; placed: readonly Rect[];
    budget: number;
    /** The map's first figure, drawn by whichever form uses the room best. */
    primary: boolean;
  },
): ComposedBody | null {
  const { t, grass, flat, seed } = input;
  const tier = t.tier[flatIndex(site.at.x, site.at.y, t.width)]!;
  const order = primary
    ? [...forms].sort((a, b) => boxArea(fitForm(b, room)) - boxArea(fitForm(a, room))
      || (a < b ? -1 : 1))
    : forms;
  for (const form of order) {
    const fitted = fitForm(form, room);
    if (!fitted) continue;
    const rect = setIntoStep(t, fitted, room, tier);
    if (placed.some((r) => touches(r, rect, FORM_GAP))) continue;
    // One 4-CONNECTED body, which is the unit every reading downstream is taken in. A lobed outline can
    // leave a corner cell attached only diagonally, and that cell then reads as a body of its own — and
    // worse, its absence from the figure can open an islet onto the outline, which is how a figure the
    // draw checked came back one hole short on the finished map.
    const cells = mainComponent(
      formCells(form, rect, seed ^ hashInt32(flatIndex(site.at.x, site.at.y, t.width))),
    );
    if (cells.length < FIGURE_MIN || cells.length > budget) continue;
    const box = boundsOfCells(cells);
    if (box.x < 1 || box.y < 1 || box.x + box.w >= t.width || box.y + box.h >= t.height) continue;
    // The congruence test is made on the box the figure came out at, not the one it was fitted to: a
    // lobed outline can pull in a cell short of its box, and two figures fitted to different boxes then
    // came out the same shape.
    if ((drawn.get(form) ?? []).some((r) => r.w === box.w && r.h === box.h)) continue;
    if (islandsIn(cells, box) < ISLANDS_MIN[form]) continue;
    if (!cellsFit(t, grass, flat, cells, tier)) continue;
    floodCells(t, cells, tier);
    return { form, rect: box, tier, cells, regionId: site.regionId, onWalk: site.onWalk };
  }
  return null;
}

/**
 * The room a site offers: the largest rect of untouched terrace at one tier it can be grown to, inset
 * a cell so a figure drawn inside it never touches the edge that ended it.
 *
 * Grown side by side rather than searched, because what is wanted is the room around this site — a
 * maximal-rectangle scan of the whole map would answer with the same few rooms for every site the
 * profile ranked, and the profile is what decides where the water goes.
 */
function growRoom(input: FormsInput, at: MacroCoord, tier: number): Rect | null {
  const { t, grass, flat } = input;
  const free = (x: number, y: number): boolean => freeAt({ t, grass, flat }, x, y, tier);
  /** Only the row or column a growth step adds is read, since the rect it grows from is already
   *  known clear: re-reading the whole rect per step makes the pass quadratic in the room's own area,
   *  and the pass grows one room per site over a whole planet. */
  const edgeFree = (rect: Rect, side: number): boolean => {
    if (side === 0) {
      if (rect.x - 1 < 1) return false;
      for (let y = rect.y; y < rect.y + rect.h; y++) if (!free(rect.x - 1, y)) return false;
    } else if (side === 1) {
      if (rect.x + rect.w >= t.width - 1) return false;
      for (let y = rect.y; y < rect.y + rect.h; y++) if (!free(rect.x + rect.w, y)) return false;
    } else if (side === 2) {
      if (rect.y - 1 < 1) return false;
      for (let x = rect.x; x < rect.x + rect.w; x++) if (!free(x, rect.y - 1)) return false;
    } else {
      if (rect.y + rect.h >= t.height - 1) return false;
      for (let x = rect.x; x < rect.x + rect.w; x++) if (!free(x, rect.y + rect.h)) return false;
    }
    return true;
  };
  if (!free(at.x, at.y)) return null;
  const step = (room: Rect, side: number): Rect => (side === 0 ? { ...room, x: room.x - 1, w: room.w + 1 }
    : side === 1 ? { ...room, w: room.w + 1 }
      : side === 2 ? { ...room, y: room.y - 1, h: room.h + 1 }
        : { ...room, h: room.h + 1 });
  /** One growth: the two sides of `first` opened as far as they go, then the other two. */
  const grow = (order: readonly number[]): Rect => {
    let room: Rect = { x: at.x, y: at.y, w: 1, h: 1 };
    for (const side of order) {
      // The cap is per axis, not on the longer side: capping the longer one let a room grow to the full
      // `ROOM_MAX` along the first axis and then refuse to grow at all across it, which on open ground
      // answered every site with a room one cell deep.
      for (let guard = 0; guard < ROOM_MAX; guard++) {
        if ((side <= 1 ? room.w : room.h) >= ROOM_MAX || !edgeFree(room, side)) break;
        room = step(room, side);
      }
    }
    return room;
  };
  // Two orders, longest wins. The growth is greedy, so which side opens first decides the shape: a room
  // taken up and down first comes back as tall as the terrace and as narrow as its notches allow, and
  // the same ground taken left and right first comes back long. The sideways order finds the
  // 20-to-39-cell rooms a figure needs.
  const wide = grow([0, 1, 2, 3]);
  const tall = grow([2, 3, 0, 1]);
  const room = Math.max(wide.w, wide.h) >= Math.max(tall.w, tall.h) ? wide : tall;
  const inner = { x: room.x + 1, y: room.y + 1, w: room.w - 2, h: room.h - 2 };
  return inner.w >= 3 && inner.h >= 3 ? inner : null;
}

/**
 * The sites worth trying, best first.
 *
 * The walk's own lake wants lead, then the profile: the seeded field gathers figures rather than
 * speckling them, the ring pull keeps the plaza's apron dry and the coast clear, and the tier pull
 * puts the wet half of the map on its upper half. A site inside a place given the water treatment is
 * worth more than open ground: a district floored with water is a whole place given over to it.
 */
function sites(input: FormsInput): Site[] {
  const { t, grass, flat, hub, line, seed } = input;
  const out: Site[] = [];
  for (const want of line?.waterWants ?? []) {
    if ((want as WaterWant).kind !== 'lake') continue;
    const at = { x: Math.round(want.rect.x + want.rect.w / 2), y: Math.round(want.rect.y + want.rect.h / 2) };
    out.push({ at, regionId: '', onWalk: true });
  }
  const region = regionField(input.plan, t.width, t.height);
  const found: { at: MacroCoord; score: number; key: number }[] = [];
  for (let y = 2; y < t.height - 2; y += 2) {
    for (let x = 2; x < t.width - 2; x += 2) {
      const i = flatIndex(x, y, t.width);
      if (!grass[i] || flat[i] || t.water[i]! >= 0) continue;
      const ring = ringPull(Math.max(Math.abs(x - hub.x), Math.abs(y - hub.y)), RING_PROFILE);
      if (ring <= 0) continue;
      // Ordinary places are not sites at all. A kit composes its ground about a mirror axis and a figure
      // cut through one breaks that region's symmetry. Seen from the other side, a district floored in
      // water is a whole small terrace given over to it, not a pool inserted into a place. A
      // place that asked for water is the exception, and it is scored up rather than merely allowed.
      if (region[i] === 1) continue;
      const score = ring + HIGH_TIER_PULL * (t.tier[i]! / 8) + (region[i] === 2 ? 0.8 : 0)
        + 0.5 * fieldNoise(seed ^ 0x51ce, x / 4, y / 4, FIELD_SPAN);
      found.push({ at: { x, y }, score, key: i });
    }
  }
  found.sort((a, b) => b.score - a.score || a.key - b.key);
  for (const f of found.slice(0, SITE_TRIES)) {
    out.push({ at: f.at, regionId: '', onWalk: false });
  }
  return out;
}

/** The largest 4-connected component of a drawn figure: the body a reader sees. */
function mainComponent(cells: readonly MacroCoord[]): MacroCoord[] {
  const all = new Set(cells.map((c) => key(c.x, c.y)));
  let best: MacroCoord[] = [];
  const seen = new Set<number>();
  for (const start of all) {
    if (seen.has(start)) continue;
    const part: MacroCoord[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      const at = unkey(k);
      part.push(at);
      for (const [dx, dy] of NEIGHBORS4) {
        const nk = key(at.x + dx, at.y + dy);
        if (!all.has(nk) || seen.has(nk)) continue;
        seen.add(nk);
        stack.push(nk);
      }
    }
    if (part.length > best.length) best = part;
  }
  return best;
}

/**
 * How many dry components the figure encloses: ground inside its box that cannot reach the box border
 * without crossing the body.
 *
 * The hole test run on the draw, so what this pass promises is what the finished body holds rather
 * than what the geometry was meant to produce.
 */
function islandsIn(cells: readonly MacroCoord[], box: Rect): number {
  const body = new Uint8Array(box.w * box.h);
  for (const c of cells) {
    if (c.x >= box.x && c.y >= box.y && c.x < box.x + box.w && c.y < box.y + box.h) body[(c.y - box.y) * box.w + c.x - box.x] = 1;
  }
  return enclosedPieces(body, box.w, box.h);
}

/** 2 where a place asked for the water treatment, 1 inside any other lot, 0 on open ground. */
function regionField(plan: DesignPlan, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (const region of plan.regions) {
    const mark = region.water === true ? 2 : 1;
    for (const lot of region.lot) {
      for (let y = Math.max(0, lot.y); y < Math.min(H, lot.y + lot.h); y++) {
        for (let x = Math.max(0, lot.x); x < Math.min(W, lot.x + lot.w); x++) {
          out[flatIndex(x, y, W)] = mark;
        }
      }
    }
  }
  return out;
}

/** Whether two boxes come within `gap` cells of each other, so the bodies inside them would read as
 *  one. */
function touches(a: Rect, b: Rect, gap: number): boolean {
  return a.x - gap < b.x + b.w && b.x - gap < a.x + a.w
    && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h;
}

/** The area a fitted box covers, 0 where the form does not fit the room at all. */
const boxArea = (rect: Rect | null): number => (rect ? rect.w * rect.h : 0);
