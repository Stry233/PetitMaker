/*
 * stencil.ts — a picture to build from, and the two things a generator does with one.
 *
 * A STENCIL IS AN INPUT, NOT SOMETHING A GENERATOR DRAWS. Turning a letter, an emoji or a photograph
 * into pixels needs a canvas, and the candidate/preview pipeline runs in a worker that is
 * browser-API-free by construction (`kit/operations/candidate.worker.ts`). So the main thread
 * rasterizes once (`ui/shell/bars/rasterize.ts`) and hands the result down as plain numbers, which
 * is also what lets everything below be tested with no browser at all: feed it a stencil.
 *
 * It carries COVERAGE and COLOUR because the two modes ask different questions of the same picture.
 * The text mode asks "is this cell inside the shape", and builds the shape out of terrain or out of
 * objects. The image mode ignores shape and asks "what colour is this cell", then picks the terrain
 * whose own colour comes closest. One structure answers both.
 */
import { ELEVATION_COLORS, WATER_COLOR } from '../../core/model/constants';
import { hexStringToNumber } from '../../core/model/colors';
import { TerrainType, type Stencil } from '../../core/model/types';

export type { Stencil };

/** Below this, a cell is not considered part of the shape. Half coverage: a glyph's stem should keep
 *  its width, and an antialiased edge should land on the side it mostly covers. */
export const COVERAGE_ON = 128;

/**
 * Reconnect and de-speckle a rasterized shape, in place.
 *
 * A diagonal or shallow-angled stroke crosses each cell at about half coverage, so the whole-cell
 * threshold drops some of its cells and keeps others: the stroke comes out spotty, and the survivors
 * touch only at corners, which reads as scales. Two promotions repair it, both biased toward the
 * shape reading WHOLE over matching the raster cell for cell:
 *
 *  - a NEAR-threshold cell with two or more covered 4-neighbours joins the shape — it is the gap in
 *    a stroke both of its neighbours belong to;
 *  - an uncovered cell with three or more covered 4-neighbours joins too — a one-cell notch in an
 *    otherwise solid run, which the eye reads as damage rather than detail.
 *
 * Promoted cells keep their own quadrant coverage, so the trim pass bevels them hard — a bridge
 * cell's corners carry little source ink — and the repaired diagonal comes out smooth rather than
 * blocky. Run to a fixpoint: one repair can complete the neighbourhood of the next.
 */
export function smoothShape(s: Stencil): void {
  const { width: w, height: h, coverage } = s;
  const NEAR = COVERAGE_ON / 2;
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (coverage[i]! >= COVERAGE_ON) continue;
        let neighbours = 0;
        if (x > 0 && coverage[i - 1]! >= COVERAGE_ON) neighbours++;
        if (x < w - 1 && coverage[i + 1]! >= COVERAGE_ON) neighbours++;
        if (y > 0 && coverage[i - w]! >= COVERAGE_ON) neighbours++;
        if (y < h - 1 && coverage[i + w]! >= COVERAGE_ON) neighbours++;
        if (neighbours >= 3 || (neighbours >= 2 && coverage[i]! >= NEAR)) {
          coverage[i] = 255;
          changed = true;
        }
      }
    }
  }
}

/** Whether the stencil claims cell (x, y) as part of its shape. */
export function covered(s: Stencil, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return false;
  return (s.coverage[y * s.width + x] ?? 0) >= COVERAGE_ON;
}

/**
 * How deep inside the shape each covered cell sits: 1 on the outline, 2 one cell in, and so on.
 * Anything off the stencil counts as outside, so a shape running to the edge is still measured from
 * it. Uncovered cells read 0. `usable` narrows the shape further to the cells the caller can
 * actually lay — a covered cell on unbuildable ground is a hole in the base exactly as an uncovered
 * one is, and depth measured past it promises support that will never exist.
 *
 * MEASURED IN THE 8-NEIGHBOURHOOD, because that is the neighbourhood V-MTN-03 asks about: a base is
 * a full 3x3. Measured 4-connected, a cell two steps in could still have a DIAGONAL neighbour
 * outside the shape, its base would be short by that one cell, and the whole letter came back
 * refused — every layer above 3 unwound, which `commitStroke` then took the rest of the stroke down
 * with. Depth 2 has to mean "a complete 3x3 of shape around me", and only Chebyshev says that.
 *
 * This is what lets a tall shape be LEGAL. Layers 1-3 need no 3x3 base, but a flat slab at layer 4
 * is refused all along its border, where the base would have to reach past the shape. Terracing by
 * inset gives every raised cell the mass it needs underneath, and it does it without touching the
 * outline: the border is always laid, at the height that always stands.
 */
export function insetDepth(s: Stencil, usable?: (x: number, y: number) => boolean): Uint16Array {
  const { width: w, height: h } = s;
  const inside = (x: number, y: number): boolean => covered(s, x, y) && (!usable || usable(x, y));
  const depth = new Uint16Array(w * h);
  const queue: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside(x, y)) continue;
      // On the outline when ANY of the eight around it is outside the shape (or off the stencil).
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && !inside(x + dx, y + dy)) { edge = true; break; }
        }
      }
      if (edge) { depth[i] = 1; queue.push(i); }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % w, y = (i / w) | 0;
    const next = depth[i]! + 1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const ni = ny * w + nx;
        if (depth[ni] !== 0) continue;
        depth[ni] = next;
        queue.push(ni);
      }
    }
  }
  return depth;
}

/** The tallest a cell may stand with no 3x3 base under it: layers 1-3 are exempt from V-MTN-03. */
export const FLAT_SAFE_ELEVATION = 3;

/**
 * Lower whatever cannot stand, until everything can.
 *
 * The COLOUR mode has no freedom to terrace: a cell's elevation is its colour, so the picture
 * decides the heights and they land beside each other in any order. V-MTN-03 then refuses every cell
 * more than three layers above its own 3x3 neighbourhood, and a refused layer takes the stroke down
 * with it.
 *
 * So the heights are relaxed FIRST, in place: while any cell stands more than `FLAT_SAFE_ELEVATION`
 * above the lowest of the eight around it, it comes down to exactly that much. Repeated to a
 * fixpoint, which it always reaches — every pass only ever lowers, and zero is the floor. A cell off
 * the picture reads 0, so the edges slope down to the ground they sit on.
 *
 * What this costs is the top of the ramp in the brightest places, and what it buys is a picture that
 * commits instead of one that vanishes.
 */
export function relaxHeights(target: Int16Array, width: number, height: number): void {
  let moved = true;
  while (moved) {
    moved = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const e = target[i]!;
        if (e <= FLAT_SAFE_ELEVATION) continue;
        let lowest = e;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            const n = nx < 0 || ny < 0 || nx >= width || ny >= height ? 0 : target[ny * width + nx]!;
            if (n < lowest) lowest = n;
          }
        }
        const cap = lowest + FLAT_SAFE_ELEVATION;
        if (e > cap) { target[i] = cap; moved = true; }
      }
    }
  }
}

/**
 * What the map can be COLOURED with, and the whole of it.
 *
 * The terrain palette is a colour ramp already: eight greens climbing with elevation, plus one blue
 * for water. That is what makes an image mode possible without inventing anything — a cell's
 * ELEVATION is chosen for the colour it draws in, not for the height it means. The result reads as a
 * mosaic of the picture and is a real, buildable map underneath.
 */
export interface PaletteEntry {
  type: TerrainType;
  elevation: number;
  /** Packed 0xRRGGBB, as the renderers draw it. */
  rgb: number;
}

export function terrainPalette(maxElevation: number, water = true): PaletteEntry[] {
  // With water out, a photograph's blues match the darkest greens.
  const out: PaletteEntry[] = water
    ? [{ type: TerrainType.Water, elevation: 0, rgb: hexStringToNumber(WATER_COLOR) }]
    : [];
  for (let e = 1; e <= maxElevation; e++) {
    const hex = ELEVATION_COLORS[e];
    if (hex) out.push({ type: TerrainType.Mountain, elevation: e, rgb: hexStringToNumber(hex) });
  }
  return out;
}

/**
 * `rgb` pushed away from mid-grey by `amount` (1 leaves it alone), per channel.
 *
 * The terrain palette is eight greens over a narrow range, so an ordinary photograph — most of whose
 * pixels sit near the middle — collapses onto two or three of them and reads as a flat wash. Raising
 * the contrast first is what spreads it back across the ramp.
 */
export function applyContrast(rgb: number, amount: number): number {
  if (amount === 1) return rgb;
  const push = (v: number): number => {
    const out = Math.round(128 + (v - 128) * amount);
    return out < 0 ? 0 : out > 255 ? 255 : out;
  };
  return ((push((rgb >> 16) & 0xff) << 16) | (push((rgb >> 8) & 0xff) << 8) | push(rgb & 0xff)) >>> 0;
}

/**
 * The palette entry closest to `rgb`, by distance in a channel-weighted RGB space.
 *
 * Weighted rather than plain Euclidean: the eye is far more sensitive to green than to blue, and an
 * unweighted match sent mid greens to the water blue often enough to put ponds through a photograph.
 * The weights are the usual luma coefficients, which is the cheapest thing that behaves.
 *
 * `nearestByColor` above is the same arithmetic over anything carrying an `rgb`, which is what lets
 * a picture be matched against the OBJECT catalogue as well as against the terrain ramp.
 */
export function nearestByColor<T extends { rgb: number }>(palette: readonly T[], rgb: number): T | null {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  let best: T | null = null;
  let bestD = Infinity;
  for (const entry of palette) {
    const dr = r - ((entry.rgb >> 16) & 0xff);
    const dg = g - ((entry.rgb >> 8) & 0xff);
    const db = b - (entry.rgb & 0xff);
    const d = 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
    if (d < bestD) { bestD = d; best = entry; }
  }
  return best;
}

export function nearestTerrain(palette: readonly PaletteEntry[], rgb: number): PaletteEntry {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  let best = palette[0]!;
  let bestD = Infinity;
  for (const entry of palette) {
    const dr = r - ((entry.rgb >> 16) & 0xff);
    const dg = g - ((entry.rgb >> 8) & 0xff);
    const db = b - (entry.rgb & 0xff);
    const d = 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
    if (d < bestD) { bestD = d; best = entry; }
  }
  return best;
}
