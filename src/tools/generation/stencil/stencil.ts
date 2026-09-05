/*
 * stencil.ts — a picture to build from, and the two things a generator does with one.
 *
 * A STENCIL IS AN INPUT, NOT SOMETHING A GENERATOR DRAWS. Turning a letter, an emoji or a photograph
 * into pixels needs a canvas, and the candidate/preview pipeline runs in a worker that is
 * browser-API-free by construction (`kit/operations/candidate.worker.ts`). So the main thread
 * rasterizes once (`ui/shell/bars/stencil-raster.ts`) and hands the result down as plain numbers,
 * which is also what lets everything below be tested with no browser at all: feed it a stencil.
 *
 * It carries COVERAGE and COLOUR because the two modes ask different questions of the same picture.
 * The text mode asks "is this cell inside the shape", and builds the shape out of terrain or out of
 * objects. The image mode ignores shape and asks "what colour is this cell", then picks the terrain
 * whose own colour comes closest. One structure answers both.
 */
import { ELEVATION_COLORS, WATER_COLOR } from '../../../core/model/constants';
import { hexStringToNumber } from '../../../core/model/colors';
import { ItemCategory, TerrainType, type CatalogItem, type Stencil } from '../../../core/model/types';
import { isEmojiGrapheme, textGraphemes } from './stencil-text-segments';

export type { Stencil };

/**
 * Whether an item can TILE a shape, which is the only thing the letter mode does with one.
 *
 * A letter needs the same item many times over, so anything the rules cap is unusable here: every
 * unique cabin carries `maxCount: 1`, and offering one means a letter whose second cell onward is
 * refused. A bridge or a ramp SPANS terrain it is placed against rather than standing on it, so
 * neither tiles either, whatever its count.
 *
 * Read from the item, never from a list of ids: a catalog addition is then offered or excluded on
 * its own terms with nothing here to update.
 */
export function tilesAShape(item: CatalogItem): boolean {
  if (item.maxCount !== undefined) return false;
  if (item.category === ItemCategory.Bridge || item.category === ItemCategory.Ramp) return false;
  if (item.category === ItemCategory.Road) return false;   // a coating, laid by the road tools
  return true;
}


/** Below this, a cell is not considered part of the shape. Half coverage: a glyph's stem should keep
 *  its width, and an antialiased edge should land on the side it mostly covers. */
export const COVERAGE_ON = 128;

/**
 * The least coverage that counts as the face having TOUCHED a cell: a quarter of the way to the
 * threshold, which is a quarter of the cell inked.
 *
 * A QUARTER because it has to sit clear of both neighbours of the question it answers. Above it are
 * the cells an antialiased edge grazes — a stroke passing near a corner leaves a third or a half —
 * and below it is the noise a rasterizer leaves in a cell the drawing does not enter at all. What
 * reads it wants "did the face put ink here", and both a lower bar (which would call the noise ink)
 * and a higher one (which would call a grazed corner empty) answer a different question.
 */
export const TOUCHED_INK = COVERAGE_ON / 4;

/** What KIND of shape the characters are, which is what decides how much room the strokes need. */
export type Script = 'simple' | 'dense' | 'picture';

/**
 * Ideographs, kana and hangul pack many strokes into one square; a picture (emoji, symbols drawn in
 * colour) is not made of strokes at all, so neither a weight nor a floor under one means anything
 * to it.
 *
 * Read from code points rather than from a locale: the string is what is being drawn.
 */
export function scriptOf(text: string): Script {
  if (textGraphemes(text).some(isEmojiGrapheme)) return 'picture';
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text) ? 'dense' : 'simple';
}

/**
 * Conservative per-glyph floors derived from the fidelity matrix: isolated simple glyphs need 8
 * cells, adjacent simple glyphs 10, and dense scripts 14. A rendered card may admit an easier glyph
 * below these blanket floors through `glyphSurvives`.
 */
const GLYPH_FLOOR = { alone: 8, together: 10, dense: 14 } as const;

export function textMinSide(text: string): number {
  if (scriptOf(text) === 'dense') return GLYPH_FLOOR.dense;
  return textGraphemes(text).length > 1 ? GLYPH_FLOOR.together : GLYPH_FLOOR.alone;
}

/** Minimum ink span used only to decide whether a glyph can spare an outer air cell. */
const INK_MIN = { simple: 5, dense: 13, picture: 5 } as const;

/** Keep one outer cell only when the remaining box still fits the script's minimum ink span. */
export function airCells(text: string, box: { width: number; height: number }): number {
  const glyphs = Math.max(1, textGraphemes(text).length);
  const withAir = Math.min(box.height - AIR_CELLS, (box.width - AIR_CELLS) / glyphs);
  return withAir >= INK_MIN[scriptOf(text)] ? AIR_CELLS : 0;
}

/** The air a region large enough to spare it leaves around the ink. */
const AIR_CELLS = 1;

/** Absolute brush floor; individual glyph acceptance is measured after rasterization. */
const GLYPH_ABSOLUTE_FLOOR = 5;

/** Short-side floors shared by the shelf gate and region brush. */
export const STENCIL_MIN_SIDE = { text: GLYPH_ABSOLUTE_FLOOR, image: 20 } as const;

/** Minimum box accounts for the width divided among all characters. */
export function textMinBox(text: string): { width: number; height: number } {
  const side = textMinSide(text);
  return { width: side * Math.max(1, textGraphemes(text).length), height: side };
}

/**
 * Promote near-threshold gaps and touched notches to reconnect strokes, preserving each cell's
 * quadrant coverage. Iterate to a fixpoint, but reject promotions that enclose ground or bridge an
 * open channel between strokes; diagonal connectivity is repaired separately.
 */
export function smoothShape(s: Stencil): void {
  const { width: w, height: h, coverage } = s;
  const NEAR = COVERAGE_ON / 2;
  const TOUCHED = TOUCHED_INK;
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
        // A cell walled in on all four sides is a pinhole in a stroke however little ink the face
        // left in it; a three-sided dent has to have been touched, or it is the letter's own daylight.
        const notch = neighbours === 4 || (neighbours === 3 && coverage[i]! >= TOUCHED);
        if (!notch && !(neighbours >= 2 && coverage[i]! >= NEAR)) continue;
        if (bridgesDaylight(s, x, y) || sealsGround(s, x, y)) continue;
        coverage[i] = 255;
        changed = true;
      }
    }
  }
}

/**
 * Whether covering (x, y) would close a letter's own daylight rather than fill a dent in a stroke.
 *
 * A CHANNEL AND A NOTCH LOOK THE SAME FROM ONE CELL, and the difference is in the WALLS. A notch
 * bitten out of a stroke has the stroke's own body either side of it — ink that carries on past the
 * cell that touches the notch. A gap between two strokes has one cell of stroke either side and then
 * open ground, since that is what a stroke at this size IS. So a promotion whose ink neighbours face
 * each other across the cell is refused unless one of those two walls is more than a cell thick.
 *
 * The test is on the pairs, not on the count: a dent in the top of a bar has ink east and west of it
 * and the bar continues past both, which is a wall two cells deep in the direction that matters.
 */
export function bridgesDaylight(s: Stencil, x: number, y: number): boolean {
  const ink = (cx: number, cy: number): boolean => covered(s, cx, cy);
  // A cell with ink on all four sides is a pinhole in a stroke, whatever the walls are like: there is
  // no daylight there to close, since nothing reaches it in the first place.
  if (EDGE_STEPS.every(([dx, dy]) => ink(x + dx, y + dy))) return false;
  for (const [dx, dy] of [[0, 1], [1, 0]] as const) {
    if (!ink(x - dx, y - dy) || !ink(x + dx, y + dy)) continue;
    if (!ink(x - 2 * dx, y - 2 * dy) && !ink(x + 2 * dx, y + 2 * dy)) return true;
  }
  return false;
}

/**
 * Whether covering (x, y) would shut ground in: any one of the open sides it leaves is cut off from
 * the outside once this cell is covered.
 *
 * EACH SIDE ON ITS OWN. A cell can have one side opening onto the world and another onto a pocket
 * that reaches the world only THROUGH this cell — and a walk that stops at the first way out declares
 * the promotion safe and seals the pocket anyway. So every open side is walked separately, and one
 * that cannot get out is enough to refuse.
 *
 * Ground walks the EDGES only, the way the map does: a diagonal touch is a point, and nothing passes
 * through a point. Each walk stops the moment it reaches the edge of the picture, so a dent that opens
 * outward costs a handful of steps and only a genuine pocket is walked whole.
 */
export function sealsGround(s: Stencil, x: number, y: number): boolean {
  const { width: w, height: h, coverage } = s;
  const blocked = y * w + x;
  for (const [dx, dy] of EDGE_STEPS) {
    const sx = x + dx, sy = y + dy;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;      // this side is the outside already
    const start = sy * w + sx;
    if (coverage[start]! >= COVERAGE_ON) continue;
    const seen = new Uint8Array(w * h);
    seen[blocked] = 1;
    seen[start] = 1;
    const stack = [start];
    let escapes = false;
    while (stack.length && !escapes) {
      const i = stack.pop()!;
      const cx = i % w, cy = (i / w) | 0;
      for (const [ex, ey] of EDGE_STEPS) {
        const nx = cx + ex, ny = cy + ey;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { escapes = true; break; }
        const n = ny * w + nx;
        if (coverage[n]! >= COVERAGE_ON || seen[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (!escapes) return true;
  }
  return false;
}

const EDGE_STEPS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Ink RUNS along one row or column: how many separate pieces of the shape it crosses.
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
 * HOW MUCH OF THE DRAWING'S OWN STROKE SEPARATION A QUANTISED SHAPE STILL CARRIES: 1 where every row
 * and column of it crosses as many separate pieces as the drawing did, and lower where they fused.
 *
 * `runsRow` and `runsCol` are that drawing's answer, counted at a HIGHER resolution than the shape
 * being judged. They have to come from there: a weight heavy enough to fuse two strokes fuses them in
 * any picture drawn at the same weight, so a shape compared against its own resolution scores
 * perfectly while arriving as a block. An M is two stems and a middle V — three strokes across one
 * row with nothing enclosed anywhere — so the fusion shows in no count of pieces, counters or
 * outline damage.
 *
 * A SHARE RATHER THAN A COUNT of failing lines, because a stroke that MEETS another is the letter
 * rather than a defect: the diagonal of an N joins both its stems. Summed over the whole shape a
 * junction costs a little, and a letter that filled in costs most of it.
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
    // for; only a line it IS on can have lost a gap.
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
 * A LETTER IS MOSTLY NOT INK. Its strokes are what the eye follows and the ground between them is
 * what makes them followable, so past about three quarters of the box the strokes have eaten the gaps
 * and the shape reads as a slab with dents in it. Measured over the ink's OWN box rather than the
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
 * The pieces a shape is in, counted the way the MAP counts them: two cells meeting at a corner alone
 * are two blocks with ground between them.
 */
export function piecesOf(s: Stencil): number {
  const seen = new Uint8Array(s.width * s.height);
  let count = 0;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !covered(s, start % s.width, (start / s.width) | 0)) continue;
    count++;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % s.width, y = (i / s.width) | 0;
      for (const [dx, dy] of EDGE_STEPS) {
        const nx = x + dx, ny = y + dy;
        if (!covered(s, nx, ny)) continue;
        const n = ny * s.width + nx;
        if (!seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
  }
  return count;
}

/**
 * The bars a drawn glyph has to clear to be worth building, and the ONE place they are written.
 *
 * The evaluation matrix holds every committed letter to them and the shelf's card gate asks the same
 * two of a letter a visitor has actually typed (`stencil-raster.ts:glyphSurvives`), so a card can
 * only ever offer what the matrix would call legible.
 *
 * SEPARATION at 0.7 with the worst passing cell at 0.73, and the gap is headroom: the matrix is
 * fourteen glyph sets and the alphabet is not, so the bar sits below the worst letter MEASURED rather
 * than on top of it. The letters that fail sit at 0.53 to 0.62, which is nowhere near either number.
 * DENSITY at 0.8 against a worst pass of 0.73, for the same reason and with the same distance from
 * the blobs (0.90 and up).
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
 * WHETHER A DRAWN GLYPH IS WORTH BUILDING, from those numbers alone — the one decision, so the shelf
 * cannot offer what the evaluation matrix would call illegible.
 *
 * THREE BARS, and the pieces are the one a share cannot see. Separation is summed over every row and
 * column, so two LETTERS fusing into each other costs a couple of runs out of a whole row and comes
 * back at 0.9: measured, HELLO in a six-cell region scores 0.898 separation and 0.540 density while
 * arriving as three pieces of five. What a row of letters loses first is not the ground inside a
 * letter but the ground BETWEEN them, and that is a count of pieces rather than a proportion of runs.
 *
 * DENSITY is asked only of a shape the drawing gave more than one stroke to, since a bare stem fills
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

/** Brightness as the eye weighs the channels. The one measure of tone this file works in. */
export function luma(rgb: number): number {
  return 0.299 * ((rgb >> 16) & 0xff) + 0.587 * ((rgb >> 8) & 0xff) + 0.114 * (rgb & 0xff);
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
 * CONTRAST IS THE WINDOW, not a push away from mid-grey. What a contrast control has to decide here
 * is how much of the picture's range is spread across the palette and how much of it clips at the
 * ends: above 1 the window narrows and the extremes flatten out, below 1 it widens and the result is
 * gentler. Pushing away from mid-grey instead does nothing useful to art that has no mid-greys in it
 * — a pastel drawing pushed harder is a white drawing.
 */
export function narrowRange(range: ToneRange, contrast: number): ToneRange {
  const amount = contrast > 0 ? contrast : 1;
  if (amount === 1) return range;   // the range ITSELF, so a caller can recognise "nothing was asked"
  const mid = (range.lo + range.hi) / 2, half = (range.hi - range.lo) / 2 / amount;
  return { lo: mid - half, hi: mid + half };
}

/**
 * The tones a picture should be LANDED on, given what the palette can draw: MOVED into the palette's
 * reach, and squeezed only if it is wider than the palette is.
 *
 * A picture whose own range already sits inside the palette's is left exactly where it is. The
 * object catalogue carries dozens of hues from white to near-black, so a sticker matched against it
 * is already reproducible and moving its tones only makes the colours wrong — measured, a stretch
 * there cost a third of the reproduction. The terrain ramp is the other case: eight greens between
 * luma 79 and 184, against art that lives above 200, so nothing of the picture is in reach and every
 * cell of it matches layer 1.
 *
 * NEVER MAGNIFIED. Moving a picture in is what the out-of-gamut case needs; blowing a narrow range
 * up to fill the ramp is a contrast decision, and making it here would amplify a flat picture's own
 * noise into a relief and leave a single-colour picture — which has no range to speak of — landing
 * in the middle of the ramp instead of where its colour actually is. Contrast is the visitor's, and
 * it is the window (`narrowRange`).
 */
export function fitTarget(source: ToneRange, palette: ToneRange): ToneRange {
  // The range ITSELF when it is already in reach, rather than one arithmetically equal to it: the
  // fit recognises "nothing to do" by comparing the two, and `lo + (hi - lo)` is not always `hi`.
  if (source.lo >= palette.lo && source.hi <= palette.hi) return source;
  const span = Math.min(source.hi - source.lo, palette.hi - palette.lo);
  const lo = Math.min(Math.max(source.lo, palette.lo), palette.hi - span);
  return { lo, hi: lo + span };
}

/**
 * The transform that lands a picture's own tones on the ones a palette can draw.
 *
 * THIS IS THE WHOLE OF WHY A BRIGHT PICTURE CAME OUT FLAT. The terrain ramp runs from luma 184 at
 * layer 1 down to 79 at layer 8, and pastel art — a sticker, an emoji, most of what anybody pastes —
 * lives above 200 nearly everywhere. Every cell of it is therefore nearer layer 1 than anything else
 * and the picture arrives as one solid tier: a shape with no drawing in it. Matching absolute
 * colours only works while the two gamuts overlap, and here they mostly do not.
 *
 * So the picture's OWN range is stretched onto the palette's before anything is matched: the
 * brightest thing in it becomes the palette's brightest entry and the darkest its darkest, which is
 * what puts an outline, a face and a shadow on different tiers instead of all on one.
 *
 * HUE SURVIVES AS FAR AS IT FITS. Each channel moves by the same amount, so the differences between
 * them — which is what colour is — are untouched; where that would take a channel past 0 or 255 the
 * chroma is pulled in by exactly as much as it has to be and no more, rather than the channel being
 * clipped on its own (which would swing the hue).
 */
/**
 * The same colour at a different TONE: the tone is set to `want` and the chroma is given up only as
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

export function toneFit(from: ToneRange, to: ToneRange): (rgb: number) => number {
  // NOTHING TO DO IS NOT THE SAME AS DOING NOTHING MEASURABLE. Mapping a range onto itself still
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

/** The terrain-ramp match: same arithmetic, non-null for the never-empty ramp. */
export function nearestTerrain(palette: readonly PaletteEntry[], rgb: number): PaletteEntry {
  return nearestByColor(palette, rgb) ?? palette[0]!;
}
