/*
 * stencil-raster.ts — turning a character or an image into a `Stencil`.
 *
 * THE ONE PART THAT NEEDS A BROWSER. Everything that READS a stencil is plain arithmetic in
 * `tools/generation/stencil/` and runs anywhere, including the candidate worker; drawing a glyph
 * or decoding a photograph needs a canvas, so it happens here, once, on the main thread, and the
 * result travels as numbers.
 *
 * THE REGION DECIDES THE RESOLUTION. A stencil is exactly as many cells as the area it will be built
 * in, so what the visitor painted is what sets the fidelity — the same letter is a blocky five cells
 * across in a small region and a legible forty in a large one. Nothing here has a size of its own.
 */
import type { MacroCoord, Stencil } from '../../../core/model/types';
import {
  airCells, COVERAGE_ON, densityOf, finishGlyph, glyphLegible, glyphWeight, GLYPH_WEIGHTS,
  piecesOf, runsAlong, separationOf, stencilFromPixels, type GlyphReading,
} from '../../../tools/generation/stencil';

/** The rectangle a stencil is drawn into: the painted region's bounding box, or the whole map. */
export interface StencilBox { origin: MacroCoord; width: number; height: number }

/**
 * The faces a stencilled letter is drawn with, and they are THIS PROJECT'S OWN.
 *
 * `sans-serif` is not a font, it is whatever the machine happens to resolve — so the same word in the
 * same region comes out as a different picture on a different computer, which no other part of the
 * generator would tolerate, and a stroke-width table calibrated against it would be calibrated
 * against nothing. The shipped faces are also the ones whose stems the weight table is measured from.
 *
 * The Latin face leads: it is 30KB an instance against several megabytes for a CJK weight, so a word
 * of letters costs nothing to draw at whichever weight the region wants. Anything it has no glyph for
 * — every ideograph, kana and hangul — falls through to the CJK face, which is what the boot already
 * warms.
 */
export const GLYPH_FONT_STACK = "'PW Rounded Sans', 'Alibaba PuHuiTi 3', sans-serif";

/**
 * Have the browser fetch the faces before anything is drawn with them.
 *
 * A canvas does NOT wait: `ctx.font` names a family, and if that family's file has not arrived the
 * text is drawn in the fallback and read back as a different letter, silently. The boot warms one
 * weight per family, so a stencil asking for another has to say so.
 */
export async function ensureGlyphFonts(text = '', weight?: number): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts?.load) return;
  const weights = weight === undefined ? GLYPH_WEIGHTS : [weight];
  await Promise.all(weights.flatMap((w) => [
    fonts.load(`${w} 16px 'PW Rounded Sans'`, text).catch(() => undefined),
    fonts.load(`${w} 16px 'Alibaba PuHuiTi 3'`, text).catch(() => undefined),
  ]));
}

/**
 * The space a stencil fills: the painted region's bounding box, or the whole buildable island when
 * nothing is painted.
 *
 * NO REGION MEANS THE WHOLE ISLAND, the way it does for every other kind. It is the BUILDABLE extent
 * rather than the template's, so a letter is fitted to the land instead of to the sea around it --
 * fitted to the full grid, a glyph on a map whose island fills half of it comes out at half size with
 * its ends in the water.
 */
export function islandBox(state: { template: { width: number; height: number }; cells: { zone: number }[][] }, buildableZone: (z: number) => boolean): StencilBox | null {
  const { width, height } = state.template;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const zone = state.cells[y]?.[x]?.zone;
      if (zone === undefined || !buildableZone(zone)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX > maxX) return null;
  return { origin: { x: minX, y: minY }, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** The bounding box of a painted region, or null when nothing is painted. */
export function regionBox(region: readonly MacroCoord[]): StencilBox | null {
  if (region.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of region) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return { origin: { x: minX, y: minY }, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Read a canvas DRAWN AT TWICE THE CELL RESOLUTION back as a stencil.
 *
 * Each cell is a 2x2 of pixels, so every quadrant's own coverage survives into `quad` — the signal
 * the trim pass chooses corner shapes from — while the cell's coverage and colour are the average of
 * its four. The colour is alpha-weighted, or a cell half-filled with red would read as half-black.
 */
function readBack(ctx: CanvasRenderingContext2D, width: number, height: number): Stencil {
  const { data } = ctx.getImageData(0, 0, width * SUB, height * SUB);
  const coverage = new Uint8Array(width * height);
  const color = new Uint32Array(width * height);
  const quad = new Uint8Array(width * height * 4);
  // Quadrant order [TL, TR, BL, BR]: the 2x pixel offsets in the corner-index convention.
  const Q = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let aSum = 0, r = 0, g = 0, b = 0;
      for (let c = 0; c < 4; c++) {
        const px = x * 2 + Q[c]![0], py = y * 2 + Q[c]![1];
        const p = (py * width * 2 + px) * 4;
        const a = data[p + 3]!;
        quad[i * 4 + c] = a;
        aSum += a;
        r += data[p]! * a; g += data[p + 1]! * a; b += data[p + 2]! * a;
      }
      coverage[i] = Math.round(aSum / 4);
      color[i] = aSum > 0
        ? (((Math.round(r / aSum) << 16) | (Math.round(g / aSum) << 8) | Math.round(b / aSum)) >>> 0)
        : 0;
    }
  }
  return { width, height, coverage, color, quad };
}

/** Canvas pixels per cell. Two, so every quadrant of every cell is a pixel of its own. */
const SUB = 2;

/**
 * Where to put the glyph so the cell grid can HOLD it — the stencil's answer to hinting.
 *
 * A cell is on or off, and the threshold is half coverage. So where a stroke lands within the cell
 * grid decides whether it survives at all: a bar one cell thick sitting square on a row is a solid
 * row of cells, and the SAME bar half a cell lower is two rows at half coverage each, both of which
 * fall below the threshold and vanish. At forty cells that costs a ragged edge; at eight it costs the
 * letter, which is how a small word comes out with strokes missing rather than merely blocky.
 *
 * A real hinting engine moves each stem onto the grid. This moves the whole glyph, which is what a
 * letter's own repeated rhythm — three bars and two counters of an E, all at one pitch — mostly wants
 * anyway: the placement is searched over the four quarter-cell phases and scored by how DECIDED the
 * resulting cells are, summing how near each one sits to the threshold it is about to be judged by.
 * The winner is the phase at which the face's strokes line up with the grid.
 *
 * THE CANDIDATES ARE MEASURED FROM THE CENTRED PLACEMENT, from half a cell before it to a quarter
 * after: four quarter-cell steps, which is every phase there is, since a whole cell of shift is the
 * same picture again. Half a cell is the FURTHEST any of them moves, and it is exactly the air the
 * fit leaves on that side (`stencil.ts:airCells`, half of its cell at each edge) — so the extreme
 * candidate lands the ink flush with the region's border and none of them can push it past. A search
 * that stepped a whole cell one way would: a glyph three quarters of a cell low loses the bottom of
 * its last stroke to the border, which is a missing bar rather than a shifted one. In a region with
 * no air to spare the ink already reaches both edges, and every phase is drawn at the same size — the
 * search then chooses among pictures that clip a fraction of a stroke at one end or the other, and
 * still picks the one the grid holds best.
 */
function gridFit(
  ctx: CanvasRenderingContext2D, text: string, cw: number, ch: number,
  inkW: number, inkH: number, left: number, top: number, cell: number,
): [number, number] {
  const baseX = (cw - inkW) / 2, baseY = (ch - inkH) / 2;
  const STEPS = [0, -0.25, -0.5, 0.25];
  let best: [number, number] = [baseX + left, baseY + top];
  let bestScore = Infinity;
  for (const sy of STEPS) {
    for (const sx of STEPS) {
      const x = baseX + sx * cell + left, y = baseY + sy * cell + top;
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillText(text, x, y);
      const score = undecided(ctx, cw, ch, cell);
      if (score < bestScore) { bestScore = score; best = [x, y]; }
    }
  }
  ctx.clearRect(0, 0, cw, ch);
  return best;
}

/** How much of a drawing sits near the threshold that will decide it, summed over the cells of the
 *  REGION's grid: 0 where every cell is plainly ink or plainly ground, and highest where the picture
 *  is all half-coverage. */
function undecided(ctx: CanvasRenderingContext2D, cw: number, ch: number, cell: number): number {
  const { data } = ctx.getImageData(0, 0, cw, ch);
  const step = Math.max(1, Math.round(cell));
  let sum = 0;
  for (let y = 0; y + step <= ch; y += step) {
    for (let x = 0; x + step <= cw; x += step) {
      let a = 0;
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) a += data[((y + dy) * cw + x + dx) * 4 + 3]!;
      }
      sum += Math.max(0, COVERAGE_ON - Math.abs(a / (step * step) - COVERAGE_ON));
    }
  }
  return sum;
}

/**
 * The three numbers a glyph is drawn by, all of them arithmetic on the air the region can spare
 * (`stencil.ts:airCells`): how many canvas pixels a REGION cell is, how many of them to keep clear
 * around the ink, and whether the placement search has anywhere to move the glyph.
 *
 * THE AIR IS ASKED OF THE REGION'S OWN GRID, which is this box divided by the magnification — a
 * reference drawn four times over would otherwise find room for air a five-cell region does not have,
 * and come back a different size as well as a finer picture.
 *
 * NO AIR, NOWHERE TO MOVE. The search shifts the glyph by up to half a cell and spends the air to do
 * it; in a region with none the ink already reaches both edges, so every phase but the centred one
 * pushes a sliver of a stroke off the region and can only lose ink. Measured at five cells against
 * each glyph's own reference, searching anyway costs N 0.94 -> 0.68, Z 0.82 -> 0.60 and X 0.67 ->
 * 0.53, with I, E and L unmoved.
 *
 * SEPARATE FROM `drawGlyph` because that function needs a canvas and this is what a test can hold:
 * everything here is arithmetic, and a change to it that a suite could not see is a change to where
 * every letter in a small region lands.
 */
export function glyphFrame(
  text: string, box: { width: number; height: number }, magnify = 1,
): { cell: number; margin: number; mayShift: boolean } {
  const cell = SUB * magnify;
  const air = airCells(text, { width: box.width / magnify, height: box.height / magnify });
  return { cell, margin: air * cell, mayShift: air > 0 };
}

/** A drawing surface at TWICE the cell resolution, the size `readBack` expects. */
function surface(width: number, height: number): CanvasRenderingContext2D | null {
  // A DRAWING SURFACE IS NOT ALWAYS THERE. The rasterizer is only ever reached from the shell, but the
  // shelf's gates are plain predicates that a test or a worker may call, and a missing document is a
  // "cannot measure" for them to fall back from rather than a crash inside a boolean.
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width * SUB;
  canvas.height = height * SUB;
  // `willReadFrequently`: the grid-fit search draws and reads the same surface a dozen times over,
  // which is the case the software-raster path exists for.
  return canvas.getContext('2d', { willReadFrequently: true });
}

/**
 * A character — a letter, a digit, an emoji — drawn as large as it will go inside `box`.
 *
 * MEASURED, THEN FITTED. A glyph's ink is not its font size and not its advance width: an emoji is
 * nearly square, a 'j' hangs below the baseline, and a 'W' is far wider than tall. So it is drawn
 * once at a reference size, its ink measured through the text metrics the browser reports, and then
 * drawn again scaled and centred on that ink. Fitting to the font size instead leaves a letter
 * floating high in its box with the descender's worth of empty cells under it.
 *
 * Emoji are drawn in COLOUR and everything else in solid black: the image mode reads colour and the
 * text mode reads coverage, and an emoji carries its own colours either way.
 *
 * DRAWN AT THE WEIGHT THE REGION CAN CARRY (`tools/generation/stencil/stencil-stroke.ts`), rather than at the
 * heaviest there is: a stroke and the counter beside it are each a whole number of cells, so in a
 * small region a bold face closes the letter up. The weight can be given instead of derived, which is
 * how the same letter is drawn with more resolution than its region has — the reference picture an
 * evaluation compares the built one against has to differ in resolution ALONE.
 *
 * `magnify` says how many times the REGION's own cell grid this drawing is, and 1 is the region
 * itself. It is what lets that higher-resolution draw be the same picture rather than a similar one:
 * the air and the grid a glyph is fitted to are both measured in region cells, so a drawing at four
 * times the resolution leaves four times the pixels of air and lines its strokes up with the same
 * grid. Told nothing, it would fit a proportionally larger letter and land it on a finer grid, and
 * the two pictures would differ in size and phase as well as in resolution.
 *
 * `search` off draws the glyph plainly centred, with no grid fit at all. Nothing in the app asks for
 * that; the evaluation does, because a fit judged only against
 * pictures the fit itself placed would be judging its own choice — the fixed placement is the
 * outside reference the search has to beat.
 */
export function drawGlyph(
  text: string, box: StencilBox, weight = glyphWeight(text, box), magnify = 1, search = true,
): Stencil | null {
  const { width, height } = box;
  if (width < 1 || height < 1) return null;
  const ctx = surface(width, height);
  if (!ctx) return null;

  // Everything below is in the canvas's own 2x pixels; the cells come out of `readBack`.
  const cw = width * SUB, ch = height * SUB;
  const REF = 100;
  ctx.font = `${weight} ${REF}px ${GLYPH_FONT_STACK}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const m = ctx.measureText(text);
  const inkW = Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  const inkH = Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);

  const { cell, margin, mayShift } = glyphFrame(text, box, magnify);
  const scale = Math.min((cw - margin) / inkW, (ch - margin) / inkH);
  const size = Math.max(1, REF * scale);
  ctx.font = `${weight} ${size}px ${GLYPH_FONT_STACK}`;
  const m2 = ctx.measureText(text);
  const w2 = m2.actualBoundingBoxLeft + m2.actualBoundingBoxRight;
  const h2 = m2.actualBoundingBoxAscent + m2.actualBoundingBoxDescent;
  const left = m2.actualBoundingBoxLeft, top = m2.actualBoundingBoxAscent;

  ctx.fillStyle = '#000000';
  const [ox, oy] = search && mayShift
    ? gridFit(ctx, text, cw, ch, w2, h2, left, top, cell)
    : [(cw - w2) / 2 + left, (ch - h2) / 2 + top];
  ctx.fillText(text, ox, oy);
  return readBack(ctx, width, height);
}

/**
 * The glyph as the generator takes it: drawn by the face, then repaired and held to the stroke width
 * the region can carry (`tools/generation/stencil/stencil-stroke.ts:finishGlyph`).
 *
 * The two halves are separate because only the DRAWING needs a browser. A stored raster can be
 * finished anywhere, which is what lets the evaluation harness and its tests run the processing over
 * committed font rasters instead of re-deriving it.
 */
export function rasterizeText(text: string, box: StencilBox): Stencil | null {
  const stencil = drawGlyph(text, box);
  if (!stencil) return null;
  finishGlyph(stencil);
  return stencil;
}

/**
 * How many times the region's own grid the DRAWING is read at when a glyph is being judged. Four: the
 * same magnification the evaluation matrix compares its letters against, so the shelf and the matrix
 * are asking one question.
 */
const JUDGE_SCALE = 4;

/**
 * WHETHER THIS GLYPH SURVIVES THIS REGION, measured on the drawing rather than guessed from the text.
 *
 * The floors in `stencil.ts` answer for a whole shelf — one region serves five dealt cards and the
 * visitor's own at once, and a string is all they have to go on — so they have to hold for the
 * hardest letter anyone might type. A card knows its own text, and by the time it has a picture the
 * glyph has been drawn: at that point the better answer is the drawing's.
 *
 * The reading is the legibility bars (`stencil.ts:GLYPH_LEGIBLE`): the pieces the drawing is in, how
 * much of the separation it gave its strokes the quantised letter still carries, and how much of its
 * own box is ink. The truth comes from the SAME glyph drawn four times over, because a weight heavy
 * enough to fuse two strokes fuses them in any picture drawn at that weight — a letter compared
 * against its own resolution scores perfectly while arriving as a block.
 *
 * MEMOISED on the text and the region, since the shelf asks per card and re-renders freely and the
 * answer is a pure function of the two. Unbounded on purpose and safely so: an entry is a handful of
 * numbers, and one is added only when a visitor types a different word or paints a different region —
 * a bound driven by hands, not by a loop.
 */
const survives = new Map<string, GlyphVerdict>();

export interface GlyphVerdict extends GlyphReading { ok: boolean }

export function glyphSurvives(text: string, box: StencilBox): GlyphVerdict {
  const key = `${text}\u0000${box.width}x${box.height}`;
  const known = survives.get(key);
  if (known) return known;
  const verdict = judge(text, box);
  survives.set(key, verdict);
  return verdict;
}

/** What a region with no drawing surface can say: nothing, so the blanket floor the caller already
 *  found the region short of stands as it is. */
const UNMEASURED: GlyphVerdict = { separation: 0, density: 1, pieces: 0, wholePieces: 1, multiStroke: true, ok: false };

function judge(text: string, box: StencilBox): GlyphVerdict {
  const flat = { origin: box.origin, width: box.width, height: box.height };
  const built = drawGlyph(text, flat);
  const weight = glyphWeight(text, flat);
  const truth = drawGlyph(
    text, { origin: box.origin, width: box.width * JUDGE_SCALE, height: box.height * JUDGE_SCALE },
    weight, JUDGE_SCALE,
  );
  if (!built || !truth) return UNMEASURED;
  finishGlyph(built);
  return judgeDrawn(built, truth, JUDGE_SCALE);
}

/**
 * The verdict on a glyph that has already been drawn twice: once at the region's own resolution and
 * finished, and once at `scale` times it, which is the DRAWING the first one is judged against.
 *
 * SEPARATE FROM THE DRAWING because a canvas is the one thing a test cannot have here, and everything
 * below is arithmetic: what a suite can hold is that an empty picture is refused, that a fused one is,
 * and that a letter with its strokes apart is not.
 *
 * THE RUNS ARE READ WITHOUT REGISTERING the two pictures against each other, which the evaluation
 * harness does. The two placements are chosen independently and can settle a cell apart, and where
 * they do, a row of the drawing lines up with the wrong row of the letter and the separation comes
 * back LOWER than it is. That is the direction to be wrong in: a card refused that could have been
 * offered, never a fused one offered.
 */
export function judgeDrawn(built: Stencil, truth: Stencil, scale: number): GlyphVerdict {
  // NOTHING DRAWN IS NOT A LETTER THAT SURVIVED. A region too small for the word leaves the raster
  // empty, and an empty picture crosses none of the drawing's pieces and fills none of its own box —
  // every reading comes back perfect on a card that would build nothing at all.
  const wholePieces = piecesOf(truth);
  const empty: GlyphVerdict = { separation: 0, density: 0, pieces: 0, wholePieces, multiStroke: true, ok: false };
  if (!built.coverage.some((v) => v >= COVERAGE_ON)) return empty;
  const runsRow: number[] = [], runsCol: number[] = [];
  for (let y = 0; y < built.height; y++) {
    let most = 0;
    for (let sy = 0; sy < scale; sy++) most = Math.max(most, runsAlong(truth, y * scale + sy, false));
    runsRow.push(most);
  }
  for (let x = 0; x < built.width; x++) {
    let most = 0;
    for (let sx = 0; sx < scale; sx++) most = Math.max(most, runsAlong(truth, x * scale + sx, true));
    runsCol.push(most);
  }
  const reading: GlyphReading = {
    separation: separationOf(built, runsRow, runsCol),
    density: densityOf(built),
    pieces: piecesOf(built),
    wholePieces,
    multiStroke: Math.max(...runsRow, ...runsCol) > 1,
  };
  return { ...reading, ok: glyphLegible(reading) };
}

/**
 * How much bigger than the cell grid the picture is read at before it is integrated.
 *
 * The area sampling wants the source's own pixels, but a photograph can be tens of megapixels and
 * decoding it into one buffer to average thirty pixels per cell is a lot of memory for no gain. Four
 * source pixels per quadrant is already sixteen per cell, which is plenty to integrate over; the
 * browser's own reduction handles the (moderate) step down to that.
 */
const OVERSAMPLE = 4;

/**
 * An image fitted into `box`, keeping its aspect and centred — the same `object-fit: contain` a
 * picture gets anywhere else, so nothing is stretched into the region's shape.
 *
 * READ BY AREA, not by sample. Drawing the picture straight into a canvas the size of the region
 * hands the reduction to the browser, and at these factors (a photograph into twenty cells) it takes
 * whichever pixels its samples land on: a one-pixel highlight survives at full strength and a whole
 * eye disappears. So the source is decoded at a bounded multiple of the cell grid and each cell
 * integrates the rectangle under it (`tools/generation/stencil/stencil-sample.ts`), which is what a
 * photographic reduction does.
 *
 * Everything outside the drawn rect stays transparent, which is what leaves the map untouched there:
 * the colour mode treats an uncovered cell as "not part of the picture" rather than as sea.
 */
export function rasterizeImage(source: CanvasImageSource, sw: number, sh: number, box: StencilBox): Stencil | null {
  const { width, height } = box;
  if (width < 1 || height < 1 || sw < 1 || sh < 1) return null;
  const scale = Math.min(1, (width * 2 * OVERSAMPLE) / sw, (height * 2 * OVERSAMPLE) / sh);
  const iw = Math.max(1, Math.round(sw * scale)), ih = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = iw;
  canvas.height = ih;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, iw, ih);
  const { data } = ctx.getImageData(0, 0, iw, ih);
  return stencilFromPixels({ data, width: iw, height: ih }, box);
}
