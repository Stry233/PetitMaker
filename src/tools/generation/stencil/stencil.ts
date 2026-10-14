/*
 * A picture to build from, and the two things a generator does with one.
 *
 * A stencil is an input, not something a generator draws. Turning a letter, an emoji or a photograph
 * into pixels needs a canvas, and the candidate/preview pipeline runs in a worker that is
 * browser-API-free by construction (`tools/generation/run/candidate.worker.ts`). So the main thread
 * rasterizes once (`stencil-raster.ts`) and hands the result down as plain numbers,
 * which is also what lets everything below be tested with no browser at all: feed it a stencil.
 *
 * It carries coverage and colour because the two modes ask different questions of the same picture.
 * The text mode asks "is this cell inside the shape", and builds the shape out of terrain or out of
 * objects. The image mode ignores shape and asks "what colour is this cell", then picks the terrain
 * whose own colour comes closest. One structure answers both.
 */
import { ELEVATION_COLORS, WATER_COLOR } from '../../../core/model/palette';
import { hexStringToNumber } from '../../../core/base/color';
import { TerrainType, type CatalogItem } from '../../../core/model/types';
import { FLAT_SAFE_ELEVATION, type Stencil } from '../recipe';
import { colorDistanceSq, luma } from './color';
import { isEmojiGrapheme } from './stencil-text-segments';
import { graphemes } from '../../../core/base/text';
import { isCoating, isCrossing } from '../../../core/model/traits';
import { NEIGHBORS4_NESW } from '../../../core/grid/directions';
import { labelComponents } from '../../../core/grid/cell-sets';

export type { Stencil };

/**
 * Whether an item can tile a shape, which is the only thing the letter mode does with one.
 *
 * A letter needs the same item many times over, so anything the rules cap is unusable here: an
 * item with `maxCount` makes a letter whose cells past that count are refused. A bridge or a ramp spans terrain it is placed against rather than standing on it, so
 * neither tiles either, whatever its count.
 *
 * Read from the item, never from a list of ids: a catalog addition is then offered or excluded on
 * its own terms with nothing here to update.
 */
export function tilesAShape(item: CatalogItem): boolean {
  if (item.maxCount !== undefined) return false;
  if (isCrossing(item)) return false;
  if (isCoating(item)) return false;   // laid by the road tools
  return true;
}


/** Below this, a cell is not considered part of the shape. Half coverage: a glyph's stem should keep
 *  its width, and an antialiased edge should land on the side it mostly covers. */
export const COVERAGE_ON = 128;

/**
 * The least coverage that counts as the face having touched a cell: a quarter of the way to the
 * threshold, which is a quarter of the cell inked.
 *
 * A quarter because it has to sit clear of both neighbours of the question it answers. Above it are
 * the cells an antialiased edge grazes — a stroke passing near a corner leaves a third or a half —
 * and below it is the noise a rasterizer leaves in a cell the drawing does not enter at all. What
 * reads it wants "did the face put ink here", and both a lower bar (which would call the noise ink)
 * and a higher one (which would call a grazed corner empty) answer a different question.
 */
export const TOUCHED_INK = COVERAGE_ON / 4;

/** What kind of shape the characters are, which is what decides how much room the strokes need. */
export type Script = 'simple' | 'dense' | 'picture';

/**
 * Ideographs, kana and hangul pack many strokes into one square; a picture (emoji, symbols drawn in
 * colour) is not made of strokes at all, so neither a weight nor a floor under one means anything
 * to it.
 *
 * Read from code points rather than from a locale: the string is what is being drawn.
 */
export function scriptOf(text: string): Script {
  if (graphemes(text).some(isEmojiGrapheme)) return 'picture';
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text) ? 'dense' : 'simple';
}

/**
 * Conservative per-glyph floors derived from the fidelity matrix: isolated simple glyphs need 8
 * cells, adjacent simple glyphs 10, and dense scripts 14. A rendered card may admit an easier glyph
 * below these blanket floors through `glyphSurvives`.
 */
const GLYPH_FLOOR = { alone: 8, together: 10, dense: 14 } as const;

function textMinSide(text: string): number {
  if (scriptOf(text) === 'dense') return GLYPH_FLOOR.dense;
  return graphemes(text).length > 1 ? GLYPH_FLOOR.together : GLYPH_FLOOR.alone;
}

/** Minimum ink span used only to decide whether a glyph can spare an outer air cell. */
const INK_MIN = { simple: 5, dense: 13, picture: 5 } as const;

/** Keep one outer cell only when the remaining box still fits the script's minimum ink span. */
export function airCells(text: string, box: { width: number; height: number }): number {
  const glyphs = Math.max(1, graphemes(text).length);
  const withAir = Math.min(box.height - AIR_CELLS, (box.width - AIR_CELLS) / glyphs);
  return withAir >= INK_MIN[scriptOf(text)] ? AIR_CELLS : 0;
}

/** The air a region large enough to spare it leaves around the ink. */
const AIR_CELLS = 1;

/** Absolute brush floor; individual glyph acceptance is measured after rasterization. */
const GLYPH_ABSOLUTE_FLOOR = 5;

/** Short-side floors shared by the shelf gate and region brush. */
export const STENCIL_MIN_SIDE = { text: GLYPH_ABSOLUTE_FLOOR, image: 7 } as const;

/** Smaller image boxes retain area-averaged detail before matching the material palette. */
export const COMPACT_IMAGE_LIMIT = 20;

/** Minimum box accounts for the width divided among all characters. */
export function textMinBox(text: string): { width: number; height: number } {
  const side = textMinSide(text);
  return { width: side * Math.max(1, graphemes(text).length), height: side };
}

/**
 * Whether covering (x, y) would close a letter's own daylight rather than fill a dent in a stroke.
 *
 * A channel and a notch look the same from one cell, and the difference is in the walls. A notch
 * bitten out of a stroke has the stroke's own body either side of it — ink that carries on past the
 * cell that touches the notch. A gap between two strokes has one cell of stroke either side and then
 * open ground, since that is what a stroke at this size is. So a promotion whose ink neighbours face
 * each other across the cell is refused unless one of those two walls is more than a cell thick.
 *
 * The test is on the pairs, not on the count: a dent in the top of a bar has ink east and west of it
 * and the bar continues past both, which is a wall two cells deep in the direction that matters.
 */
export function bridgesDaylight(s: Stencil, x: number, y: number): boolean {
  const ink = (cx: number, cy: number): boolean => covered(s, cx, cy);
  // A cell with ink on all four sides is a pinhole in a stroke, whatever the walls are like: there is
  // no daylight there to close, since nothing reaches it in the first place.
  if (NEIGHBORS4_NESW.every(([dx, dy]) => ink(x + dx, y + dy))) return false;
  for (const [dx, dy] of [[0, 1], [1, 0]] as const) {
    if (!ink(x - dx, y - dy) || !ink(x + dx, y + dy)) continue;
    if (!ink(x - 2 * dx, y - 2 * dy) && !ink(x + 2 * dx, y + 2 * dy)) return true;
  }
  return false;
}

/**
 * Ink runs along one row or column: how many separate pieces of the shape it crosses.
 *
 * Two strokes with daylight between them are two runs; the same two fused are one. That makes this
 * the reading behind "the path is clear" — a letter is legible when its strokes are still separate
 * things, and a stencil loses that long before it loses a counter.
 */
export function runsAlong(s: Stencil, lane: number, vertical: boolean): number {
  const n = vertical ? s.height : s.width;
  let runs = 0, was = false;
  for (let i = 0; i < n; i++) {
    const on = vertical ? covered(s, lane, i) : covered(s, i, lane);
    if (on && !was) runs++;
    was = on;
  }
  return runs;
}

/**
 * How much of the drawing's stroke separation a quantised shape still carries: 1 where every row and
 * column crosses as many pieces as the drawing did. `runsRow` and `runsCol` must come from a higher
 * resolution, since a weight that fuses two strokes fuses them in any picture at that weight; an M's
 * fusion shows in no count of pieces, counters or outline damage. A share, because a stroke meeting
 * another (an N's diagonal) is the letter: a junction costs a little, a filled letter most of it.
 */
export function separationOf(
  s: Stencil, runsRow: readonly number[], runsCol: readonly number[], shift: readonly [number, number] = [0, 0],
): number {
  const [dx, dy] = shift;
  let had = 0, kept = 0;
  for (let y = 0; y < s.height; y++) {
    const want = runsRow[y - dy] ?? 0;
    const got = runsAlong(s, y, false);
    // A line the shape does not reach at all is an extent difference, which other readings answer
    // for; only a line it is on can have lost a gap.
    if (want > 0 && got > 0) { had += want; kept += Math.min(got, want); }
  }
  for (let x = 0; x < s.width; x++) {
    const want = runsCol[x - dx] ?? 0;
    const got = runsAlong(s, x, true);
    if (want > 0 && got > 0) { had += want; kept += Math.min(got, want); }
  }
  return had ? kept / had : 1;
}

/**
 * How much of the shape's own bounding box is ink.
 *
 * A letter is mostly not ink. Its strokes are what the eye follows and the ground between them is
 * what makes them followable, so past about three quarters of the box the strokes have eaten the gaps
 * and the shape reads as a slab with dents in it. Measured over the ink's own box rather than the
 * region, since a letter narrower than its region would otherwise read as light for being small.
 */
export function densityOf(s: Stencil): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, ink = 0;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (!covered(s, x, y)) continue;
      ink++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return ink ? ink / ((maxX - minX + 1) * (maxY - minY + 1)) : 0;
}

/**
 * The pieces a shape is in, counted the way the map counts them: two cells meeting at a corner alone
 * are two blocks with ground between them.
 */
export function piecesOf(s: Stencil): number {
  const mask = new Uint8Array(s.width * s.height);
  for (let i = 0; i < mask.length; i++) mask[i] = covered(s, i % s.width, (i / s.width) | 0) ? 1 : 0;
  return labelComponents(mask, s.width, s.height).sizes.length - 1;
}

/**
 * The bars a drawn glyph has to clear to be worth building, written once: every committed letter is
 * held to them and the shelf's card gate asks the same of a typed letter
 * (`stencil-raster.ts:glyphSurvives`). Each bar sits a little past the worst passing letter, as
 * headroom for letters outside the matrix, and well clear of the failing ones.
 */
export const GLYPH_LEGIBLE = { separation: 0.7, density: 0.8 } as const;

/** What a drawn glyph came out as, against what the drawing itself holds. */
export interface GlyphReading {
  separation: number;
  density: number;
  /** Pieces the quantised shape is in, and pieces the drawing is in. */
  pieces: number;
  wholePieces: number;
  /** Whether the drawing gave this shape more than one stroke across some line of it. */
  multiStroke: boolean;
}

/**
 * Whether a drawn glyph is worth building, from those numbers alone: the one decision, so the shelf
 * cannot offer a letter that reads as illegible.
 *
 * Three bars, and the pieces are the one a share cannot see. Separation is summed over every row and
 * column, so two letters fusing into each other costs a couple of runs out of a whole row and comes
 * back at 0.9 while the word arrives as fewer pieces than it has letters. What a row of letters loses first is not the ground inside a
 * letter but the ground between them, and that is a count of pieces rather than a proportion of runs.
 *
 * Density is asked only of a shape the drawing gave more than one stroke to, since a bare stem fills
 * its own box by definition.
 */
export function glyphLegible(r: GlyphReading): boolean {
  if (r.pieces < r.wholePieces) return false;
  if (r.separation < GLYPH_LEGIBLE.separation) return false;
  return !r.multiStroke || r.density <= GLYPH_LEGIBLE.density;
}

/** Whether the stencil claims cell (x, y) as part of its shape. */
export function covered(s: Stencil, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return false;
  return (s.coverage[y * s.width + x] ?? 0) >= COVERAGE_ON;
}


/**
 * Lower whatever cannot stand, until everything can. In colour mode a cell's elevation is its colour,
 * so heights land in any order and V-MTN-03 refuses any cell more than three layers above its 3x3.
 * Heights are relaxed first: a cell more than `FLAT_SAFE_ELEVATION` above its lowest neighbour comes
 * down to exactly that, to a fixpoint (passes only lower, zero is the floor). Off-picture cells read
 * 0, so the edges slope to the ground. It costs the top of the ramp in the brightest places.
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
 * What the map can be coloured with, and the whole of it.
 *
 * The terrain palette is a colour ramp already: eight greens climbing with elevation, plus one blue
 * for water. That is what makes an image mode possible without inventing anything — a cell's
 * Elevation is chosen for the colour it draws in, not for the height it means. The result reads as a
 * mosaic of the picture and is a real, buildable map underneath.
 */
interface PaletteEntry {
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

/** A span of tone, in luma. */
export interface ToneRange { lo: number; hi: number }

/** How much of each end of a picture's tonal range is allowed to clip when the range is measured, so
 *  one stray highlight cannot set the top of it. */
const TONE_CLIP = 0.02;

/** The tone the palette can actually draw in, from its darkest entry to its brightest. */
export function paletteToneRange(palette: readonly { rgb: number }[]): ToneRange {
  let lo = Infinity, hi = -Infinity;
  for (const entry of palette) {
    const l = luma(entry.rgb);
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  return lo > hi ? { lo: 0, hi: 255 } : { lo, hi };
}

/** A picture's own tonal range, robustly: the 2nd and 98th percentiles of what it is made of. */
export function sourceToneRange(lumas: readonly number[]): ToneRange {
  if (lumas.length === 0) return { lo: 0, hi: 255 };
  const sorted = [...lumas].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
  return { lo: at(TONE_CLIP), hi: at(1 - TONE_CLIP) };
}

/**
 * A range narrowed by `contrast` about its own middle — 1 leaves it alone.
 *
 * Contrast is the window, not a push away from mid-grey. What a contrast control has to decide here
 * is how much of the picture's range is spread across the palette and how much of it clips at the
 * ends: above 1 the window narrows and the extremes flatten out, below 1 it widens and the result is
 * gentler. Pushing away from mid-grey instead does nothing useful to art that has no mid-greys in it
 * — a pastel drawing pushed harder is a white drawing.
 */
export function narrowRange(range: ToneRange, contrast: number): ToneRange {
  const amount = contrast > 0 ? contrast : 1;
  if (amount === 1) return range;   // the range itself, so a caller can recognise "nothing was asked"
  const mid = (range.lo + range.hi) / 2, half = (range.hi - range.lo) / 2 / amount;
  return { lo: mid - half, hi: mid + half };
}

/**
 * The tones a picture should land on, given the palette's reach: moved into it, and squeezed only if
 * wider. A range already inside the palette stays put (the object catalogue spans white to
 * near-black). Never magnified: stretching a narrow range is a contrast decision that would amplify a
 * flat picture's noise and misplace a single-colour one; contrast is the visitor's (`narrowRange`).
 */
export function fitTarget(source: ToneRange, palette: ToneRange): ToneRange {
  // The range itself when it is already in reach, rather than one arithmetically equal to it: the
  // fit recognises "nothing to do" by comparing the two, and `lo + (hi - lo)` is not always `hi`.
  if (source.lo >= palette.lo && source.hi <= palette.hi) return source;
  const span = Math.min(source.hi - source.lo, palette.hi - palette.lo);
  const lo = Math.min(Math.max(source.lo, palette.lo), palette.hi - span);
  return { lo, hi: lo + span };
}

/**
 * The same colour at a different tone: the tone is set to `want` and the chroma is given up only as
 * far as it has to be.
 *
 * Each channel moves by the same amount, so the differences between them — which is what colour is —
 * are untouched; where that would take a channel past 0 or 255 the whole chroma is pulled in by
 * exactly as much as it must be, rather than the channel being clipped on its own (which would swing
 * the hue).
 */
export function withTone(rgb: number, want: number): number {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  const l = luma(rgb);
  let scale = 1;
  for (const c of [r - l, g - l, b - l]) {
    if (c > 0 && want + c > 255) scale = Math.min(scale, (255 - want) / c);
    else if (c < 0 && want + c < 0) scale = Math.min(scale, want / -c);
  }
  const out = (c: number): number => {
    const v = Math.round(want + (c - l) * scale);
    return v < 0 ? 0 : v > 255 ? 255 : v;
  };
  return ((out(r) << 16) | (out(g) << 8) | out(b)) >>> 0;
}

/**
 * The transform that lands a picture's tones on the ones a palette can draw. The terrain ramp runs
 * from luma 184 at layer 1 to 79 at layer 8, and pastel art lives above 200, so absolute matching
 * lands it all on layer 1. The picture's own range is stretched onto the palette's, putting outline,
 * face and shadow on different tiers. Each channel moves by the same amount, so hue survives; where
 * a channel would pass 0 or 255 the chroma is pulled in just enough, rather than clipping one channel
 * and swinging the hue.
 */
export function toneFit(from: ToneRange, to: ToneRange): (rgb: number) => number {
  // Nothing to do is not the same as doing nothing measurable. Mapping a range onto itself still
  // clamps every cell outside the measured percentiles back to them — which is 4% of the picture by
  // construction — and rounds every channel on the way through. So a picture the palette already
  // covers, which is meant to be matched exactly as it always was, would come back quietly altered
  // at its brightest and darkest cells. It has to come back untouched, byte for byte.
  if (from.lo === to.lo && from.hi === to.hi) return (rgb: number): number => rgb;
  const span = from.hi - from.lo;
  return (rgb: number): number => {
    const t = span < 1 ? 0.5 : Math.min(1, Math.max(0, (luma(rgb) - from.lo) / span));
    return withTone(rgb, to.lo + t * (to.hi - to.lo));
  };
}

/**
 * The palette entry closest to `rgb`, by distance in a channel-weighted RGB space.
 *
 * Weighted rather than plain Euclidean: the eye is far more sensitive to green than to blue, and an
 * unweighted match sent mid greens to the water blue often enough to put ponds through a photograph.
 * The weights are the usual luma coefficients, which is the cheapest thing that behaves.
 *
 * `nearestByColor` above is the same arithmetic over anything carrying an `rgb`, which is what lets
 * a picture be matched against the object catalogue as well as against the terrain ramp.
 */
export function nearestByColor<T extends { rgb: number }>(palette: readonly T[], rgb: number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const entry of palette) {
    const d = colorDistanceSq(rgb, entry.rgb);
    if (d < bestD) { bestD = d; best = entry; }
  }
  return best;
}

/** The terrain-ramp match: same arithmetic, non-null for the never-empty ramp. */
export function nearestTerrain(palette: readonly PaletteEntry[], rgb: number): PaletteEntry {
  return nearestByColor(palette, rgb) ?? palette[0]!;
}
