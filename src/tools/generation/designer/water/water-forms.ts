/**
 * THE LARGE COMPOSED BODIES: a few hundred-cell water figures, drawn from a shape vocabulary.
 *
 * WHAT THE REFERENCE'S WATER SAYS is not how much of it there is, it is how it is DISTRIBUTED over
 * shapes: the style target holds 26% of its land under water in 83 bodies, but 7 bodies hold 63% of it
 * and the other 76 are accents. A map drawn the other way reads as wallpaper — 85% to 95% of its bodies
 * solid rectangles with one size class dominating. So a map wants FEW LARGE FIGURES, each a different
 * shape, and the long tail of small pools around them.
 *
 * The vocabulary is the reference's own, the six forms a construction can be named for:
 *  - `basin`: a wide organic body with two or more dry ISLETS standing in it. The figured-field and
 *    pool-with-island classes, which between them hold 68% of the target's water.
 *  - `cove`: the organic one, its outline lobed off-axis and its islets where the seed put them.
 *  - `ring`: a moat around a dry platform, the target's own 14x14 ring.
 *  - `medallion`: the target's one three-layer nesting — moat, platform, basin, island.
 *  - `trough`: the long thin 3:1-to-7:1 channel cut into a terrace, of which the target has five.
 *  - `comb`: a bar with teeth off it, the water garden's own shape.
 * WHICH OF THEM A REAL ISLAND CARRIES IS THE GROUND'S ANSWER, and it is not all six: over twenty
 * measured maps, the basin, the trough and the comb land on most seeds and the ring on some, while
 * the MEDALLION needs a 19x15 room for its three bands and their island and finds one on almost no
 * seed. The vocabulary is kept whole rather than trimmed to what today's terrain offers — a wider
 * summit terrace is one crown change away, and the form that has nowhere to stand costs a map nothing.
 * Every one of them ACCOUNTS FOR ITSELF in the water ledger by construction rather than by exemption:
 * a basin and a medallion enclose two or more islands, a ring encloses one and mirrors about both of
 * its own axes, and a trough is long and thin enough to read as a course. None of them fills its own
 * box the way a dropped rectangle does, so none of them moves the ledger's tofu reading.
 *
 * NON-REPETITION IS THE POINT: the reference's most repeated shape appears 3 times. A form is
 * drawn at most `FORM_REPEAT_MAX` times per map and a second instance is drawn at a different span, so
 * no two composed bodies on one island are congruent.
 *
 * LEGALITY is the same single argument every still body here is cut by: the figure is judged as ONE
 * body on ONE terrace (`cellsFit`), so everything around it — its own islets included, which stand at
 * the terrace's tier — is at its level or above, it shows no face, and V-WTR-02 asks it for no caps.
 * A figure that does not fit is offered a smaller span and then abandoned; nothing is ever trimmed
 * side by side, because a trimmed lozenge comes back a rectangle.
 *
 * Pure over its inputs: a `TerrainPlan` and masks in, cells out, and the same (seed, plan) draws the
 * same figures.
 */
import { flatIndex } from '../../../../core/model/grid-model';
import type { MacroCoord, Rect } from '../../../../core/model/types';
import type { TerrainPlan } from '../../core/types';
import type { MovementLine, WaterWant } from '../composition/movement-line';
import type { DesignPlan } from '../types';
import { boundsOfCells, cellsFit, floodCells, freeAt, surfaceOf } from './water-cut';

// --- tunables, measured off the two reference maps -----------------------------------------------

export type WaterForm = 'basin' | 'cove' | 'ring' | 'medallion' | 'trough' | 'comb';

/** The order the forms are offered in. A map takes them in a seeded rotation of this list, so which
 *  figure an island leads with varies while the vocabulary itself does not. */
const FORMS: readonly WaterForm[] = ['basin', 'cove', 'ring', 'medallion', 'trough', 'comb'];

/**
 * The shortest a figure's LONG axis may be, and the widest it is drawn.
 *
 * The floor is above the widest a FOUNTAIN COURT can be, and that is the reason for the number rather
 * than the size: the eval reads any mirrored body holding an island and spanning 17 cells or less on
 * BOTH axes as a formal court, and the supplement allows one main court per region, so a figure drawn
 * smaller than this would be counted as a second fountain in whatever region it landed in.
 */
const SPAN = { min: 19, max: 40 } as const;
/**
 * The floor each form is drawn to, where it is lower than `SPAN.min`.
 *
 * The ground is what limits this pass: measured on real designed islands, rooms 19 cells long are
 * scarce and rooms 13 long are everywhere, so a vocabulary that only drew at 19 left half the map's
 * clear ground unused. What may go below the court span is exactly the forms the eval can never read as
 * a formal court: the trough and the comb hold no island at all, and a COVE's outline is lobed off-axis
 * with its islets where the seed put them, so it does not mirror about its own axes. The basin, the ring
 * and the medallion do mirror and do hold islands, so they stay above the court span.
 */
const LONG_MIN: Readonly<Record<WaterForm, number>> = {
  basin: SPAN.min, cove: 13, ring: SPAN.min, medallion: SPAN.min, trough: 13, comb: 13,
};
/** The narrowest the SHORT axis may be, by form: what each one needs to be itself. A basin has to hold
 *  its islets with water all round them, a ring its platform, a medallion its three bands and its
 *  island, and a trough is three cells across whatever its length. */
const ACROSS_MIN: Readonly<Record<WaterForm, number>> = {
  basin: 7, cove: 7, ring: 9, medallion: 15, trough: 3, comb: 5,
};
/** How much of its room a figure takes across, at most: a body that filled its terrace to the last
 *  cell leaves no bank to stand on and reads as a flooded block rather than as a figure. */
const ACROSS_SHARE = 0.9;
/** The trough's own width, and the width of a ring's moat. */
const TROUGH_W = 3;
/** The comb's bar and its teeth: how wide the spine runs along the long axis, how wide a tooth is, and
 *  how often the teeth stand. The style target's own comb is six 2-wide teeth off a bar with 2-wide dry
 *  ridges between them, each ridge holding one tree. */
const COMB = { bar: 2, tooth: { min: 1, max: 2 }, pitch: { min: 3, max: 5 } } as const;
const RING_W = { min: 2, max: 3 } as const;
/** The medallion's bands, outside in: moat, platform, basin. What is left in the middle is its
 *  island, so the figure encloses two dry components and reads as the target's own nesting. */
const MEDALLION = { moat: 2, platform: 2, basin: 3 } as const;
/**
 * How many enclosed islands each form must actually come out with.
 *
 * This is the pass's own guarantee to the water ledger, checked on the DRAWN cells rather than assumed
 * from the box: a lobed outline can pull in past an islet the box put near its edge, and a figure that
 * lost its islands that way would reach the finished map as water belonging to no story. The trough
 * asks for none because it accounts for itself by being thin.
 */
const ISLANDS_MIN: Readonly<Record<WaterForm, number>> = {
  basin: 2, cove: 2, ring: 1, medallion: 2, trough: 0, comb: 0,
};
/** How many islets a basin stands, and how far off its centre they sit as a share of its own span. */
const ISLETS = { min: 2, max: 3 } as const;
const ISLET_R = 1;
/** How many figures one island carries, at richness 0 and 1, and how many of them may share a form. */
const FORM_COUNT = { min: 1, max: 10 } as const;
/** How many figures may share one form. Three, the cap on congruent shapes — and these are never
 *  congruent anyway, since a form is only drawn again at a box the map has not used for it. */
const FORM_REPEAT_MAX = 3;
/**
 * How much dry ground stands between two figures, in cells.
 *
 * It is read between their BOXES, not between the sites they were grown from: a site is where a room
 * started growing and can be most of a room away from the figure that ended up in it. On `hexia/31337`
 * two parallel troughs grown from sites twenty cells apart land three rows apart, merge into one
 * 190-cell solid rectangle and read as a tofu lake.
 */
const FORM_GAP = 3;
/** How many sites are tried before the pass gives up. Each grows ONE room, and a site inside a room
 *  already grown is skipped, so this is a bound on distinct rooms rather than on cells. */
const SITE_TRIES = 1600;
/** How far a room is grown from a site, in cells: past this a figure is not a figure but a district. */
const ROOM_MAX = 44;
/** The fewest cells a body must hold to be a FIGURE rather than an accent the ledger reads as loose
 *  water. The reference's own composed classes start at the 10x10 medallion. Exported because the
 *  evaluation reads a map for the same class and must mean the same thing by the word: what the walk
 *  can be said to THREAD is a figure this pass would have drawn. */
export const FIGURE_MIN = 45;
/** The ring profile both references read: a DRY apron round the plaza, the wet band at 30 to 50 cells
 *  out, tapering to nothing at the coast. The accent pass keeps the same profile off the same reading. */
const RING_PROFILE = { dry: 12, from: 30, to: 50, fade: 74 } as const;
/** How much likelier a figure is on the upper terraces: the references read 13 to 21% water on tiers 0
 *  to 3 against 31 to 40% on tiers 4 to 8. */
const HIGH_TIER_PULL = 1.2;
/** How near the walk a room counts as being on it, in cells. */
const WALK_REACH = 6;

// --- what a composed body is --------------------------------------------------------------------

export interface ComposedBody {
  form: WaterForm;
  rect: Rect;
  tier: number;
  cells: MacroCoord[];
  /** The place this figure was composed for, or '' where the island's own profile placed it. */
  regionId: string;
  /** Whether the walk was what asked for it: the leg that threads a composed feature. */
  onWalk: boolean;
}

export interface FormsInput {
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

// --- the shapes ---------------------------------------------------------------------------------

/**
 * One figure's cells inside its box.
 *
 * Every form is symmetric about both axes of its box, which is what makes a body read as drawn rather
 * than as dropped, and every one leaves dry ground the ledger can see: the islets of a basin, the
 * platform of a ring, the platform and the island of a medallion. The trough is the one exception and
 * it accounts for itself by being long and thin.
 */
export function formCells(form: WaterForm, rect: Rect, seed: number): MacroCoord[] {
  switch (form) {
    case 'trough': return troughCells(rect);
    case 'ring': return ringCells(rect, RING_W.min + (hashInt(seed) % (RING_W.max - RING_W.min + 1)));
    case 'medallion': return medallionCells(rect);
    case 'cove': return coveCells(rect, seed);
    case 'comb': return combCells(rect, seed);
    default: return basinCells(rect, seed);
  }
}

/** The cells of an ellipse inscribed in a box, as a key set. The one primitive every round form here
 *  is built from: a ring is an ellipse minus an inset ellipse, and a basin an ellipse with a lobed
 *  edge and islets taken out of it. */
function disc(
  rect: Rect, lobes = 0, depth = 0,
  free?: { lobes: number; depth: number; phase: number },
): Set<number> {
  const out = new Set<number>();
  if (rect.w < 1 || rect.h < 1) return out;
  const cx = (rect.w - 1) / 2, cy = (rect.h - 1) / 2;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const nx = (x - cx) / Math.max(0.5, cx), ny = (y - cy) / Math.max(0.5, cy);
      const r = Math.hypot(nx, ny);
      // A LOBED EDGE, not a wobble. `cos(2k * theta)` is even in theta and unchanged by theta ->
      // pi - theta, so the outline stays symmetric about BOTH axes of the box however many lobes it
      // is given; a phase offset would break exactly that, and with it the reading the ledger makes.
      // The lobe peaks sit on the axes, so the figure keeps its asked span whatever the depth.
      const limit = free
        ? 1 - free.depth + free.depth * Math.cos(free.lobes * Math.atan2(ny, nx) + free.phase)
        : lobes > 0 ? 1 - depth + depth * Math.cos(2 * lobes * Math.atan2(ny, nx)) : 1;
      if (r <= limit + 1e-9) out.add(key(rect.x + x, rect.y + y));
    }
  }
  return out;
}

const key = (x: number, y: number): number => ((y + 1024) << 12) | (x + 1024);
const unkey = (k: number): MacroCoord => ({ x: (k & 0xfff) - 1024, y: (k >> 12) - 1024 });

const insetBy = (rect: Rect, k: number): Rect =>
  ({ x: rect.x + k, y: rect.y + k, w: rect.w - 2 * k, h: rect.h - 2 * k });

/** A basin: a lobed ellipse with two or three dry islets standing in it, mirrored about its long
 *  axis so the whole figure still reads as composed. */
function basinCells(rect: Rect, seed: number): MacroCoord[] {
  const h = hashInt(seed);
  const lobes = 1 + (h % 2);
  const cells = disc(rect, lobes, 0.08 + 0.04 * ((h >> 3) % 3));
  const count = ISLETS.min + (Math.abs(seed >> 3) % (ISLETS.max - ISLETS.min + 1));
  const alongX = rect.w >= rect.h;
  const cx = rect.x + (rect.w - 1) / 2, cy = rect.y + (rect.h - 1) / 2;
  // The offset is rounded BEFORE it is applied to either side, so the two islets of a pair land the
  // same distance out: rounding `centre - 6.5` and `centre + 6.5` separately puts them 13 apart on one
  // axis and 12 on the other, and the figure loses the symmetry its accounting reads.
  const spread = Math.round((alongX ? rect.w : rect.h) * 0.24);
  // A PAIR IS TAKEN OR NEITHER OF IT IS. An islet is only cut where the water closes all round it, so
  // one that would open onto the outline is dropped — and dropping half a mirrored pair would cost the
  // figure the symmetry its accounting reads, so the pair is judged together.
  const pair = (a: MacroCoord, b: MacroCoord): void => {
    if (!islandFits(cells, a) || !islandFits(cells, b)) return;
    cutIsland(cells, a);
    cutIsland(cells, b);
  };
  for (let k = 0; k < count; k += 2) {
    if (k === 2) {
      const mid = { x: cx | 0, y: cy | 0 };
      if (islandFits(cells, mid)) cutIsland(cells, mid);
      continue;
    }
    const step = spread;
    pair(
      { x: (alongX ? cx - step : cx) | 0, y: (alongX ? cy : cy - step) | 0 },
      { x: (alongX ? cx + step : cx) | 0, y: (alongX ? cy : cy + step) | 0 },
    );
  }
  return [...cells].map(unkey);
}

/** Whether an island may be cut at a cell: the water closes all round it, so the dry ground it leaves
 *  is enclosed rather than a bite out of the figure's own outline. */
function islandFits(cells: ReadonlySet<number>, at: MacroCoord): boolean {
  for (let dy = -ISLET_R - 1; dy <= ISLET_R + 1; dy++) {
    for (let dx = -ISLET_R - 1; dx <= ISLET_R + 1; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > ISLET_R + 1) continue;
      if (!cells.has(key(at.x + dx, at.y + dy))) return false;
    }
  }
  return true;
}

/** Take an island out of the body at a cell. */
function cutIsland(cells: Set<number>, at: MacroCoord): void {
  for (let dy = -ISLET_R; dy <= ISLET_R; dy++) {
    for (let dx = -ISLET_R; dx <= ISLET_R; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > ISLET_R) continue;
      cells.delete(key(at.x + dx, at.y + dy));
    }
  }
}

/**
 * A cove: an organic pool with islands, NOT symmetric.
 *
 * The outline is a disc with an ODD lobe count and a seeded phase, which is exactly the pair of
 * choices `disc` documents as breaking the mirror; the islets are then placed off both axes. So a cove
 * reads as a natural pool rather than as a composition, and the eval can never mistake it for a formal
 * court — which is what lets it be drawn smaller than the court span.
 */
function coveCells(rect: Rect, seed: number): MacroCoord[] {
  const h = hashInt(seed);
  const cells = disc(rect, 0, 0, { lobes: 3 + 2 * (h % 2), depth: 0.12, phase: 0.7 + (h % 5) * 0.5 });
  const want = ISLETS.min + (h >> 5) % (ISLETS.max - ISLETS.min + 1);
  // The islets are drawn from the cells the OUTLINE actually kept, in a seeded order, and only where
  // the water closes round them: a cove's outline is lobed, so a position picked off the box alone can
  // land outside the body and leave the figure with no enclosed island at all.
  const taken: MacroCoord[] = [];
  const room = [...cells].map(unkey)
    .sort((a, b) => hash01(seed ^ 0x2f19, key(a.x, a.y)) - hash01(seed ^ 0x2f19, key(b.x, b.y)));
  for (const at of room) {
    if (taken.length >= want) break;
    if (taken.some((o) => Math.abs(o.x - at.x) + Math.abs(o.y - at.y) < 2 * ISLET_R + 3)) continue;
    if (!islandFits(cells, at)) continue;
    cutIsland(cells, at);
    taken.push(at);
  }
  return [...cells].map(unkey);
}

/** A ring: a moat `width` cells across around a dry platform. */
function ringCells(rect: Rect, width: number): MacroCoord[] {
  const outer = disc(rect);
  const inner = disc(insetBy(rect, width));
  for (const k of inner) outer.delete(k);
  return [...outer].map(unkey);
}

/** A medallion: moat, platform, basin, island — the reference's one three-layer nesting. */
function medallionCells(rect: Rect): MacroCoord[] {
  const { moat, platform, basin } = MEDALLION;
  const cells = disc(rect);
  for (const k of disc(insetBy(rect, moat))) cells.delete(k);
  const pool = disc(insetBy(rect, moat + platform));
  for (const k of disc(insetBy(rect, moat + platform + basin))) pool.delete(k);
  for (const k of pool) cells.add(k);
  return [...cells].map(unkey);
}

/**
 * A comb: a bar down one side of the box with teeth hanging off it.
 *
 * The dry ridges between the teeth are what the reference plants — one tree to a ridge — so the figure
 * is a planting composition as much as a water one. It accounts for itself the way the trough does, by
 * being long and thin over its own extent, and its teeth are what the eval reads as band flips.
 */
function combCells(rect: Rect, seed: number): MacroCoord[] {
  const h = hashInt(seed);
  const alongX = rect.w >= rect.h;
  const long = alongX ? rect.w : rect.h, across = alongX ? rect.h : rect.w;
  const tooth = COMB.tooth.min + (h % (COMB.tooth.max - COMB.tooth.min + 1));
  const pitch = COMB.pitch.min + ((h >> 4) % (COMB.pitch.max - COMB.pitch.min + 1)) + tooth;
  const out: MacroCoord[] = [];
  const put = (a: number, b: number): void => {
    out.push(alongX ? { x: rect.x + a, y: rect.y + b } : { x: rect.x + b, y: rect.y + a });
  };
  for (let a = 0; a < long; a++) {
    for (let b = 0; b < COMB.bar; b++) put(a, b);
    // The teeth stand from the bar to a cell short of the far side, so the ridges between them are open
    // ground a plant can be laid on rather than a dead end of water.
    if (a % pitch >= tooth) continue;
    for (let b = COMB.bar; b < across - 1; b++) put(a, b);
  }
  return out;
}

/** A trough: a channel `TROUGH_W` across with a one-cell taper at each end, the 3:1-to-7:1 shape the
 *  style target carries five of. */
function troughCells(rect: Rect): MacroCoord[] {
  const alongX = rect.w >= rect.h;
  const length = alongX ? rect.w : rect.h;
  const out: MacroCoord[] = [];
  for (let a = 0; a < length; a++) {
    const thin = a === 0 || a === length - 1;
    const across = thin ? 1 : TROUGH_W;
    const lo = (TROUGH_W - across) >> 1;
    for (let b = lo; b < lo + across; b++) {
      out.push(alongX ? { x: rect.x + a, y: rect.y + b } : { x: rect.x + b, y: rect.y + a });
    }
  }
  return out;
}

/** A box of `long` by `across` centred at a cell, laid along the given axis. What `fitForm` hands to
 *  the draw, and what a test names a figure's size with. */
export function formBox(at: MacroCoord, long: number, across: number, alongX = true): Rect {
  const w = alongX ? long : across, h = alongX ? across : long;
  return { x: at.x - (w >> 1), y: at.y - (h >> 1), w, h };
}

/**
 * The largest box of this form that fits the ROOM a site offers, or null where the room is too small
 * for the form to be itself.
 *
 * The figure is sized to the ground rather than to a tunable, which is the whole difference between a
 * pass that lands figures and one that does not: measured on real designed maps, the largest square of
 * unreserved one-tier ground anywhere on an island is about thirteen cells, while long rooms of 20 to
 * 39 cells are common. So the vocabulary is drawn into ELONGATED boxes, and the aspect comes out of
 * the terrace the figure stands on.
 */
export function fitForm(form: WaterForm, room: Rect): Rect | null {
  const alongX = room.w >= room.h;
  // ODD ON BOTH AXES, so the box has a centre CELL: every form is drawn about its own centre, and an
  // even span leaves the centre on a half cell where the draw cannot mirror exactly.
  const odd = (v: number): number => (v % 2 === 0 ? v - 1 : v);
  const long = odd(Math.min(SPAN.max, alongX ? room.w : room.h));
  const room2 = odd(Math.min(alongX ? room.h : room.w, Math.round(long * ACROSS_SHARE)));
  if (long < LONG_MIN[form]) return null;
  const across = form === 'trough' ? TROUGH_W : room2;
  if (across < ACROSS_MIN[form]) return null;
  const centre = { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) };
  return formBox(centre, long, across, alongX);
}

// --- cutting them -------------------------------------------------------------------------------

/**
 * The island's composed figures, cut into the sculpt.
 *
 * The walk's own water wants come first, so at least one leg of the route passes a large figure — the
 * compression and release a map of uniformly open streets never gives a visitor. What is left is placed
 * on the references' own profile: nothing on the plaza's apron, most of it in the 30-to-50-cell band,
 * none at the coast, and twice as likely above the working platforms as on them.
 */
export function cutComposedBodies(input: FormsInput): ComposedBody[] {
  const { t, richness, seed } = input;
  let budget = Math.max(0, input.budget);
  const count = Math.round(lerp(FORM_COUNT.min, FORM_COUNT.max, richness));
  if (budget <= 0 || count <= 0) return [];

  const out: ComposedBody[] = [];
  const drawn = new Map<WaterForm, Rect[]>();
  const first = Math.abs(hashInt(seed ^ 0x1f7b)) % FORMS.length;
  /** The next form worth trying, offered from the seed's own rotation and skipping the ones this map
   *  has already drawn its share of. */
  const forms = (): WaterForm[] => FORMS
    .map((_, k) => FORMS[(first + out.length + k) % FORMS.length]!)
    .filter((f) => (drawn.get(f) ?? []).length < FORM_REPEAT_MAX);

  // THE ROOMS ARE GATHERED BEFORE ANY OF THEM IS DRAWN IN, and taken largest first.
  //
  // A site inside a room already offered is the same room again, so each is grown once. And the order
  // matters as much as the set: a form may only be drawn a few times and never twice at one box, so
  // whichever rooms are offered first spend the vocabulary. Ranked by the profile alone, that was a
  // handful of small rooms near the plaza, and the long terraces further out came back empty; ranked by
  // room AREA weighted by the profile, the figures land where there is room for a figure.
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
    // THE FIRST FIGURE IS THE MAP'S PRIMARY ONE — the top rung of the size ladder, the one thing that
    // happens once — so it is drawn by whichever form uses the biggest room best rather than by the seed's
    // rotation — the rotation would answer the island's largest terrace with a 3-cell-wide trough as
    // readily as with a basin, and the map would have no dominant water figure at all.
    const body = cutOne(input, site, room, forms(), drawn, placed, budget, out.length === 0);
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
 * THE FIGURE IS SET INTO THE TERRACE, not floated in the middle of it.
 *
 * The reference's water is CUT INTO its terraces and framed by the terrace edge: rectangles cut into a
 * terrace, U-moats round a platform, the terrace itself being the frame.
 * `fitForm` centres its box in the room, which leaves a figure standing in the middle of an open
 * terrace with a bank all round it — the same shape, and none of the relation.
 *
 * So the box is pushed against the room's own RISERS: a pool sits in a step, a basin at the foot of
 * one. Only a riser, never a drop — a body flush against LOWER ground shows a face, which is a
 * waterfall the plan did not compose and a cap the rules would demand. The room is already inset a
 * cell from whatever ended its growth, so a figure pushed flush keeps that cell as its bank and the
 * ring `cellsFit` reads is unchanged.
 *
 * A room with risers on BOTH sides of an axis is a shelf cut into the hill, and the figure stays
 * centred on that axis: there is no edge to prefer.
 */
function setIntoStep(t: TerrainPlan, rect: Rect, room: Rect, tier: number): Rect {
  /**
   * Whether the ground that ended the room's growth on one side is a RISER the figure may be laid
   * against: EVERY cell of that line stands at the water's own level or above, and most of it stands
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
  // Flush against the riser, which is one cell PAST the room: the room is the grown rect inset by a
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
 * The room is INSET a cell before a form is fitted into it, because `cellsFit` reads the ring around a
 * body and the ring around a maximal free room is the terrace edge that ended it. A repeat of a form
 * already drawn is only kept where its box differs from the first, so no two figures on one island are
 * congruent.
 */
function cutOne(
  input: FormsInput, site: Site, room: Rect, forms: readonly WaterForm[],
  drawn: ReadonlyMap<WaterForm, Rect[]>, placed: readonly Rect[], budget: number, primary = false,
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
    // ONE 4-CONNECTED BODY, which is the unit every reading downstream is taken in. A lobed outline can
    // leave a corner cell attached only diagonally, and that cell then reads as a body of its own — and
    // worse, its absence from the figure can open an island onto the outline, which is how a figure the
    // draw checked came back one hole short on the finished map.
    const cells = mainComponent(
      formCells(form, rect, seed ^ hashInt(flatIndex(site.at.x, site.at.y, t.width))),
    );
    if (cells.length < FIGURE_MIN || cells.length > budget) continue;
    const box = boundsOfCells(cells);
    if (box.x < 1 || box.y < 1 || box.x + box.w >= t.width || box.y + box.h >= t.height) continue;
    // The congruence test is made on the box the figure CAME OUT at, not the one it was fitted to: a
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
 * Grown side by side rather than searched, because what is wanted is the room AROUND THIS SITE — a
 * maximal-rectangle scan of the whole map would answer with the same few rooms for every site the
 * profile ranked, and the profile is what decides where the water goes.
 */
function growRoom(input: FormsInput, at: MacroCoord, tier: number): Rect | null {
  const { t, grass, flat } = input;
  const free = (x: number, y: number): boolean => freeAt(t, grass, flat, x, y, tier);
  /** Only the row or column a growth step ADDS is read, since the rect it grows from is already
   *  known clear: re-reading the whole rect per step makes the pass quadratic in the room's own area,
   *  and the pass grows one room per site over a whole island. */
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
      // The cap is per AXIS, not on the longer side: capping the longer one let a room grow to the full
      // `ROOM_MAX` along the first axis and then refuse to grow at all across it, which on open ground
      // answered every site with a room one cell deep.
      for (let guard = 0; guard < ROOM_MAX; guard++) {
        if ((side <= 1 ? room.w : room.h) >= ROOM_MAX || !edgeFree(room, side)) break;
        room = step(room, side);
      }
    }
    return room;
  };
  // TWO ORDERS, LONGEST WINS. The growth is greedy, so which side opens first decides the shape: a room
  // taken up and down first comes back as tall as the terrace and as narrow as its notches allow, and
  // the same ground taken left and right first comes back long. Measured on real maps, the sideways
  // order finds the 20-to-39-cell rooms a figure needs and the other order does not.
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
 * puts the wet half of the map on its upper half. A site inside a place given the WATER treatment is
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
      const ring = ringPull(Math.max(Math.abs(x - hub.x), Math.abs(y - hub.y)));
      if (ring <= 0) continue;
      // ORDINARY PLACES ARE NOT SITES AT ALL. A kit composes its ground about a mirror axis and a figure
      // cut through one costs that region the whole reading (on `tafa/4242`, symmetry 0.23 against the
      // ledger's floor). The reference says the same thing from the other side: a district floored in
      // water is a whole small terrace given over to it, not a pool inserted into a place. A
      // place that ASKED for water is the exception, and it is scored up rather than merely allowed.
      if (region[i] === 1) continue;
      const score = ring + HIGH_TIER_PULL * (t.tier[i]! / 8) + (region[i] === 2 ? 0.8 : 0)
        + 0.5 * fieldNoise(seed ^ 0x51ce, x / 4, y / 4);
      found.push({ at: { x, y }, score, key: i });
    }
  }
  found.sort((a, b) => b.score - a.score || a.key - b.key);
  for (const f of found.slice(0, SITE_TRIES)) {
    out.push({ at: f.at, regionId: '', onWalk: false });
  }
  return out;
}

/** The largest 4-connected component of a drawn figure: the body a reader and the eval both see. */
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
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
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
 * The water ledger's own hole test, run here on the draw, so what this pass promises is what the
 * grader will read rather than what the geometry was meant to produce.
 */
function islandsIn(cells: readonly MacroCoord[], box: Rect): number {
  const body = new Set(cells.map((c) => key(c.x, c.y)));
  const seen = new Set<number>();
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < box.x || y < box.y || x >= box.x + box.w || y >= box.y + box.h) return;
    const k = key(x, y);
    if (body.has(k) || seen.has(k)) return;
    seen.add(k);
    stack.push(k);
  };
  for (let x = box.x; x < box.x + box.w; x++) { push(x, box.y); push(x, box.y + box.h - 1); }
  for (let y = box.y; y < box.y + box.h; y++) { push(box.x, y); push(box.x + box.w - 1, y); }
  const outside = new Set<number>();
  while (stack.length) {
    const k = stack.pop()!;
    outside.add(k);
    const { x, y } = unkey(k);
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  let islands = 0;
  const done = new Set<number>();
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const k = key(x, y);
      if (body.has(k) || outside.has(k) || done.has(k)) continue;
      islands++;
      const fill = [k];
      done.add(k);
      while (fill.length) {
        const at = unkey(fill.pop()!);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = at.x + dx, ny = at.y + dy;
          if (nx < box.x || ny < box.y || nx >= box.x + box.w || ny >= box.y + box.h) continue;
          const nk = key(nx, ny);
          if (body.has(nk) || outside.has(nk) || done.has(nk)) continue;
          done.add(nk);
          fill.push(nk);
        }
      }
    }
  }
  return islands;
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

/** How much this pass wants a cell at `ring` cells from the plaza: nothing on the apron, everything
 *  in the wet band, nothing at the coast. */
function ringPull(ring: number): number {
  if (ring <= RING_PROFILE.dry) return -1;
  if (ring < RING_PROFILE.from) return (ring - RING_PROFILE.dry) / (RING_PROFILE.from - RING_PROFILE.dry);
  if (ring <= RING_PROFILE.to) return 1;
  return Math.max(0, 1 - (ring - RING_PROFILE.to) / (RING_PROFILE.fade - RING_PROFILE.to));
}

/** Whether two boxes come within `gap` cells of each other, so the bodies inside them would read as
 *  one. */
function touches(a: Rect, b: Rect, gap: number): boolean {
  return a.x - gap < b.x + b.w && b.x - gap < a.x + a.w
    && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h;
}

/** The area a fitted box covers, 0 where the form does not fit the room at all. */
const boxArea = (rect: Rect | null): number => (rect ? rect.w * rect.h : 0);

/** A smooth -1..1 field over the map, so the figures gather instead of speckling. */
function fieldNoise(seed: number, x: number, y: number): number {
  const span = 9;
  const cx = Math.floor(x / span), cy = Math.floor(y / span);
  const tx = x / span - cx, ty = y / span - cy;
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

const hashInt = (v: number): number => {
  let h = Math.imul(v ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

const lerp = (a: number, b: number, v: number): number => a + (b - a) * (v < 0 ? 0 : v > 1 ? 1 : v);
