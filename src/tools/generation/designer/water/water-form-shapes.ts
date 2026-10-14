/**
 * The shapes a composed water body takes: each form's cells inside its box, the box a form needs,
 * and the islands a basin keeps.
 */
import type { MacroCoord } from '../../../../core/model/types';
import type { Rect } from '../../../../core/grid/rect';
import { hashInt32, seedHash01 } from '../../../../core/base/hash';

// --- tunables -----------------------------------------------------------------------------------

export type WaterForm = 'basin' | 'cove' | 'ring' | 'medallion' | 'trough' | 'comb';

/** The order the forms are offered in. A map takes them in a seeded rotation of this list, so which
 *  figure a planet leads with varies while the vocabulary itself does not. */
export const FORMS: readonly WaterForm[] = ['basin', 'cove', 'ring', 'medallion', 'trough', 'comb'];

/**
 * The shortest a figure's long axis may be, and the widest it is drawn.
 *
 * The floor is above the widest a fountain court can be, and that is the reason for the number rather
 * than the size: any mirrored body holding an islet and spanning 17 cells or less on both axes reads as
 * a formal court, and a region holds one main court, so a figure drawn smaller than this would read as a
 * second fountain in whatever region it landed in.
 */
const SPAN = { min: 19, max: 40 } as const;
/**
 * The floor each form is drawn to, where it is lower than `SPAN.min`.
 *
 * The ground is what limits this pass: on designed maps rooms 19 cells long are scarce and rooms 13
 * long are everywhere, so a vocabulary that only drew at 19 left half the map's
 * clear ground unused. What may go below the court span is exactly the forms that never read as a
 * formal court: the trough and the comb hold no islet at all, and a cove's outline is lobed off-axis
 * with its islets where the seed put them, so it does not mirror about its own axes. The basin, the ring
 * and the medallion do mirror and do hold islets, so they stay above the court span.
 */
const LONG_MIN: Readonly<Record<WaterForm, number>> = {
  basin: SPAN.min, cove: 13, ring: SPAN.min, medallion: SPAN.min, trough: 13, comb: 13,
};
/** The narrowest the short axis may be, by form: what each one needs to be itself. A basin has to hold
 *  its islets with water all round them, a ring its platform, a medallion its three bands and its
 *  islet, and a trough is three cells across whatever its length. */
const ACROSS_MIN: Readonly<Record<WaterForm, number>> = {
  basin: 7, cove: 7, ring: 9, medallion: 15, trough: 3, comb: 5,
};
/** How much of its room a figure takes across, at most: a body that filled its terrace to the last
 *  cell leaves no bank to stand on and reads as a flooded block rather than as a figure. */
const ACROSS_SHARE = 0.9;
/** The trough's own width, and the width of a ring's moat. */
const TROUGH_W = 3;
/** The comb's bar and its teeth: how wide the spine runs along the long axis, how wide a tooth is, and
 *  how often the teeth stand. A full comb is six 2-wide teeth off a bar with 2-wide dry ridges between
 *  them, each ridge holding one tree. */
const COMB = { bar: 2, tooth: { min: 1, max: 2 }, pitch: { min: 3, max: 5 } } as const;
const RING_W = { min: 2, max: 3 } as const;
/** The medallion's bands, outside in: moat, platform, basin. What is left in the middle is its
 *  islet, so the figure encloses two dry components and reads as a nesting. */
const MEDALLION = { moat: 2, platform: 2, basin: 3 } as const;
/** How many islets a basin stands, and how far off its centre they sit as a share of its own span. */
const ISLETS = { min: 2, max: 3 } as const;
const ISLET_R = 1;

// --- the shapes ---------------------------------------------------------------------------------

/**
 * One figure's cells inside its box.
 *
 * Every form is symmetric about both axes of its box, which is what makes a body read as drawn rather
 * than as dropped, and every one leaves dry ground inside it: the islets of a basin, the
 * platform of a ring, the platform and the islet of a medallion. The trough is the one exception and
 * it accounts for itself by being long and thin.
 */
export function formCells(form: WaterForm, rect: Rect, seed: number): MacroCoord[] {
  switch (form) {
    case 'trough': return troughCells(rect);
    case 'ring': return ringCells(rect, RING_W.min + (hashInt32(seed) % (RING_W.max - RING_W.min + 1)));
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
      // A lobed edge, not a wobble. `cos(2k * theta)` is even in theta and unchanged by theta ->
      // pi - theta, so the outline stays symmetric about both axes of the box however many lobes it
      // is given; a phase offset would break exactly that, and the figure would stop reading as drawn.
      // The lobe peaks sit on the axes, so the figure keeps its asked span whatever the depth.
      const limit = free
        ? 1 - free.depth + free.depth * Math.cos(free.lobes * Math.atan2(ny, nx) + free.phase)
        : lobes > 0 ? 1 - depth + depth * Math.cos(2 * lobes * Math.atan2(ny, nx)) : 1;
      if (r <= limit + 1e-9) out.add(key(rect.x + x, rect.y + y));
    }
  }
  return out;
}

export const key = (x: number, y: number): number => ((y + 1024) << 12) | (x + 1024);
export const unkey = (k: number): MacroCoord => ({ x: (k & 0xfff) - 1024, y: (k >> 12) - 1024 });

const insetBy = (rect: Rect, k: number): Rect =>
  ({ x: rect.x + k, y: rect.y + k, w: rect.w - 2 * k, h: rect.h - 2 * k });

/** A basin: a lobed ellipse with two or three dry islets standing in it, mirrored about its long
 *  axis so the whole figure still reads as composed. */
function basinCells(rect: Rect, seed: number): MacroCoord[] {
  const h = hashInt32(seed);
  const lobes = 1 + (h % 2);
  const cells = disc(rect, lobes, 0.08 + 0.04 * ((h >> 3) % 3));
  const count = ISLETS.min + (Math.abs(seed >> 3) % (ISLETS.max - ISLETS.min + 1));
  const alongX = rect.w >= rect.h;
  const cx = rect.x + (rect.w - 1) / 2, cy = rect.y + (rect.h - 1) / 2;
  // The offset is rounded before it is applied to either side, so the two islets of a pair land the
  // same distance out: rounding `centre - 6.5` and `centre + 6.5` separately puts them 13 apart on one
  // axis and 12 on the other, and the figure loses the symmetry its accounting reads.
  const spread = Math.round((alongX ? rect.w : rect.h) * 0.24);
  // A pair is taken or neither of it is. An islet is only cut where the water closes all round it, so
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

/** Whether an islet may be cut at a cell: the water closes all round it, so the dry ground it leaves
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

/** Take an islet out of the body at a cell. */
function cutIsland(cells: Set<number>, at: MacroCoord): void {
  for (let dy = -ISLET_R; dy <= ISLET_R; dy++) {
    for (let dx = -ISLET_R; dx <= ISLET_R; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > ISLET_R) continue;
      cells.delete(key(at.x + dx, at.y + dy));
    }
  }
}

/**
 * A cove: an organic pool with islets, not symmetric.
 *
 * The outline is a disc with an odd lobe count and a seeded phase, which is exactly the pair of
 * choices `disc` documents as breaking the mirror; the islets are then placed off both axes. So a cove
 * reads as a natural pool rather than as a composition and never as a formal court, which is what lets
 * it be drawn smaller than the court span.
 */
function coveCells(rect: Rect, seed: number): MacroCoord[] {
  const h = hashInt32(seed);
  const cells = disc(rect, 0, 0, { lobes: 3 + 2 * (h % 2), depth: 0.12, phase: 0.7 + (h % 5) * 0.5 });
  const want = ISLETS.min + (h >> 5) % (ISLETS.max - ISLETS.min + 1);
  // The islets are drawn from the cells the outline actually kept, in a seeded order, and only where
  // the water closes round them: a cove's outline is lobed, so a position picked off the box alone can
  // land outside the body and leave the figure with no enclosed islet at all.
  const taken: MacroCoord[] = [];
  const room = [...cells].map(unkey)
    .sort((a, b) => seedHash01(seed ^ 0x2f19, key(a.x, a.y)) - seedHash01(seed ^ 0x2f19, key(b.x, b.y)));
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

/** A medallion: moat, platform, basin, islet, the one three-layer nesting. */
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
 * The dry ridges between the teeth are planted, one tree to a ridge, so the figure is a planting
 * composition as much as a water one. It accounts for itself the way the trough does, by being long and
 * thin over its own extent, and its teeth alternate water and dry ground along it as banded water does.
 */
function combCells(rect: Rect, seed: number): MacroCoord[] {
  const h = hashInt32(seed);
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

/** A trough: a channel `TROUGH_W` across with a one-cell taper at each end, a 3:1 to 7:1 shape. */
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
function formBox(at: MacroCoord, long: number, across: number, alongX = true): Rect {
  const w = alongX ? long : across, h = alongX ? across : long;
  return { x: at.x - (w >> 1), y: at.y - (h >> 1), w, h };
}

/**
 * The largest box of this form that fits the room a site offers, or null where the room is too small
 * for the form to be itself.
 *
 * The figure is sized to the ground rather than to a tunable, which is the whole difference between a
 * pass that lands figures and one that does not: on designed maps the largest square of unreserved
 * one-tier ground is about thirteen cells, while long rooms of 20 to 39 cells are common. So the vocabulary is drawn into elongated boxes, and the aspect comes out of
 * the terrace the figure stands on.
 */
export function fitForm(form: WaterForm, room: Rect): Rect | null {
  const alongX = room.w >= room.h;
  // Odd on both axes, so the box has a centre cell: every form is drawn about its own centre, and an
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

