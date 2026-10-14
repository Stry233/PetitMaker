/**
 * Finds the rectangles a landmark panel fits: per-tier searches over a summed-area mask of the
 * ground each placement may use.
 */
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import { rectSum } from '../summed-area';

// --- finding a rectangle ---------------------------------------------------------------------------------

export interface PanelSearch {
  W: number; H: number;
  area: Rect;
  toward: { x: number; y: number };
  /** Summed area over the cells the panel's inside may take. */
  inside: Int32Array;
  /** Summed area over the cells its surrounding ring must satisfy; absent leaves the ring free. */
  ring?: Int32Array;
  /**
   * The tallest rectangle of each width that fits inside the mask at all, indexed by width, and the whole
   * point of it is to be asked before a position scan: `findPanel` sweeps every position of the map, and
   * the size ladder asks about twenty sizes in two orientations against every tier. An area bound is not
   * enough — a tier holding thousands of open cells in awkward shapes passes it for every size and then
   * pays the sweep — so the profile answers each (w, h) exactly.
   */
  profile: Int32Array;
}

/** The panel of `w` x `h` closest to `toward` whose inside and ring both hold, or null. Positions
 *  are compared by Manhattan distance from `toward` and ties go to the first in scan order, so the
 *  answer is a function of the terrain rather than of the order candidates were reached in. */
export function findPanel(s: PanelSearch, w: number, h: number): Rect | null {
  if (w > s.area.w || h > s.area.h) return null;
  let best: Rect | null = null;
  let bestD = Infinity;
  for (let y = s.area.y; y + h <= s.area.y + s.area.h; y++) {
    for (let x = s.area.x; x + w <= s.area.x + s.area.w; x++) {
      const rect = { x, y, w, h };
      if (rectSum(s.inside, s.W, rect) !== w * h) continue;
      if (s.ring) {
        const round = { x: x - 1, y: y - 1, w: w + 2, h: h + 2 };
        if (round.x < 0 || round.y < 0 || round.x + round.w > s.W || round.y + round.h > s.H) continue;
        if (rectSum(s.ring, s.W, round) !== round.w * round.h) continue;
      }
      const d = Math.abs(x + w / 2 - s.toward.x) + Math.abs(y + h / 2 - s.toward.y);
      if (d < bestD) { bestD = d; best = rect; }
    }
  }
  return best;
}

/**
 * The tallest all-inside rectangle of each width, indexed by width: `profile[w]` is the greatest `h` for
 * which some `w` x `h` rectangle fits wholly inside the mask, and 0 where none does.
 *
 * The standard histogram sweep — per row, the run of set cells above each column, then every maximal
 * rectangle in that histogram off one stack — and a suffix pass at the end, since a rectangle `w` wide
 * and `h` tall means one `w - 1` wide is at least as tall. O(W x H) once per tier, against a sweep of
 * every position per size asked.
 */
export function rectProfile(mask: Uint8Array, W: number, area: Rect): Int32Array {
  const heights = new Int32Array(area.w);
  const best = new Int32Array(area.w + 2);
  const stack: number[] = [];
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let c = 0; c < area.w; c++) {
      heights[c] = mask[flatIndex(area.x + c, y, W)] ? heights[c]! + 1 : 0;
    }
    stack.length = 0;
    for (let c = 0; c <= area.w; c++) {
      const h = c === area.w ? 0 : heights[c]!;
      while (stack.length && heights[stack[stack.length - 1]!]! >= h) {
        const top = stack.pop()!;
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
        const width = c - left;
        if (heights[top]! > best[width]!) best[width] = heights[top]!;
      }
      stack.push(c);
    }
  }
  for (let w = area.w - 1; w >= 1; w--) if (best[w + 1]! > best[w]!) best[w] = best[w + 1]!;
  return best;
}

/** Whether a `w` x `h` panel fits anywhere inside the search's mask, read off its profile. */
export const canHold = (s: PanelSearch, w: number, h: number): boolean =>
  w <= s.area.w && h <= s.area.h && (s.profile[w] ?? 0) >= h;

export function clipRect(r: Rect, W: number, H: number): Rect | null {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  const x1 = Math.min(W, r.x + r.w), y1 = Math.min(H, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
