/** Browser font outlines and decoded images supply the stencils used by generation. */
import type { MacroCoord, Stencil } from '../../../core/model/types';
import {
  airCells, analyzeTextGrid, COMPACT_IMAGE_LIMIT, COVERAGE_ON, densityOf, finishGlyph, fitTextGrid, glyphLegible, glyphWeight, GLYPH_WEIGHTS,
  piecesOf, runsAlong, separationOf, stencilFromPixels, type GlyphReading, type TextGridModel, type TextGridResult,
  emojiTextDrawing, fitEmojiDrawing, isEmojiGrapheme, textGraphemes, normalizeTextPresentation, textTopology, textStrokeEnds, type EmojiDrawing,
} from '../../../tools/generation/stencil';

/** The rectangle a stencil is drawn into: the painted region's bounding box, or the whole map. */
export interface StencilBox { origin: MacroCoord; width: number; height: number }

/** Shipped Latin and CJK faces stabilize ordinary glyph geometry; uncovered scripts and emoji use system fonts. */
export const GLYPH_FONT_STACK = "'PW Rounded Sans', 'Alibaba PuHuiTi 3', sans-serif";

export function glyphFontsReady(text: string): boolean {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  return !fonts?.check || GLYPH_WEIGHTS.every(weight =>
    ["'PW Rounded Sans'", "'Alibaba PuHuiTi 3'"].every(face => fonts.check(`${weight} 16px ${face}`, text)));
}

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
  const changed = weights.some(w => !fonts.check?.(`${w} 16px ${GLYPH_FONT_STACK}`, text));
  await Promise.all(weights.flatMap((w) => [
    fonts.load(`${w} 16px 'PW Rounded Sans'`, text).catch(() => undefined),
    fonts.load(`${w} 16px 'Alibaba PuHuiTi 3'`, text).catch(() => undefined),
  ]));
  if (changed) { textModels.clear(); fittedTexts.clear(); nativeTexts.clear(); survives.clear(); }
}

/**
 * The space a stencil fills: the painted region's bounding box, or the whole buildable map when
 * nothing is painted.
 *
 * NO REGION MEANS THE WHOLE MAP, the way it does for every other kind. It is the BUILDABLE extent
 * rather than the template's, so a letter is fitted to the land instead of to the sea around it --
 * fitted to the full grid, a glyph on a map whose land fills half of it comes out at half size with
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
 * Aligns a glyph to the cell grid by testing all four quarter-cell phases on each axis. Candidates
 * stay within half a cell of the centered position, matching the reserved edge air. Preserve marks
 * and counters first, then prefer coverage clearly above or below the cell threshold. All weights
 * share the reference used by final validation.
 */
function gridFit(
  ctx: CanvasRenderingContext2D, text: string, cw: number, ch: number,
  inkW: number, inkH: number, left: number, top: number, cell: number, model: TextModel | null,
): [number, number] {
  const baseX = (cw - inkW) / 2, baseY = (ch - inkH) / 2;
  const STEPS = [0, -0.25, -0.5, 0.25];
  const phases: { point: [number, number]; score: number; coverage: Uint8Array | null }[] = [];
  for (const sy of STEPS) {
    for (const sx of STEPS) {
      const x = baseX + sx * cell + left, y = baseY + sy * cell + top;
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillText(text, x, y);
      phases.push({ point: [x, y], ...outlineScore(ctx, cw, ch, cell, model !== null) });
    }
  }
  ctx.clearRect(0, 0, cw, ch);
  phases.sort((a, b) => a.score - b.score);
  let best = phases[0]!, bestLoss = Infinity;
  for (const phase of phases) {
    const topology = phase.coverage ? textTopology(phase.coverage, cw / cell, ch / cell) : null;
    const loss = topology && model ? Math.abs(topology.pieces - model.outline.pieces) + Math.abs(topology.counters - model.outline.counters) : 0;
    if (loss < bestLoss) { best = phase; bestLoss = loss; }
    if (loss === 0) break;
  }
  return best.point;
}

/** How much of a drawing sits near the threshold that will decide it, summed over the cells of the
 *  REGION's grid: 0 where every cell is plainly ink or plainly ground, and highest where the picture
 *  is all half-coverage. */
function outlineScore(ctx: CanvasRenderingContext2D, cw: number, ch: number, cell: number, topology: boolean): { score: number; coverage: Uint8Array | null } {
  const { data } = ctx.getImageData(0, 0, cw, ch);
  const step = Math.max(1, Math.round(cell));
  const width = Math.floor(cw / step), height = Math.floor(ch / step);
  const coverage = topology ? new Uint8Array(width * height) : null;
  let sum = 0;
  for (let y = 0; y + step <= ch; y += step) {
    for (let x = 0; x + step <= cw; x += step) {
      let a = 0;
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) a += data[((y + dy) * cw + x + dx) * 4 + 3]!;
      }
      const value = a / (step * step);
      sum += Math.max(0, COVERAGE_ON - Math.abs(value - COVERAGE_ON));
      if (coverage) coverage[y / step * width + x / step] = Math.round(value) >= COVERAGE_ON ? 1 : 0;
    }
  }
  return { score: sum, coverage };
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
 * Draws a character at the largest ink-bound size that fits `box`. Browser text metrics center the
 * actual ink, and region-aware weight preserves counters at small sizes. Emoji retain colour; other
 * glyphs use solid coverage. `magnify` preserves region-relative air and grid phase at higher
 * resolution, while `search: false` disables grid fitting for evaluation comparisons.
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
    ? gridFit(ctx, text, cw, ch, w2, h2, left, top, cell, magnify === 1 ? textModel(text) : null)
    : [(cw - w2) / 2 + left, (ch - h2) / 2 + top];
  ctx.fillText(text, ox, oy);
  return readBack(ctx, width, height);
}

type TextReference = Pick<Stencil, 'width' | 'height' | 'coverage'> & { picture?: EmojiDrawing; ascent: number; descent: number };
interface TextModel extends TextGridModel { source: TextReference; emoji: boolean; outline: { pieces: number; counters: number } }
const textModels = new Map<string, TextModel>();
const fittedTexts = new Map<string, TextGridResult | null>();
const nativeTexts = new Map<string, Stencil>();

/** Font analysis is independent of the selected region and shared by fitting and rasterization. */
function textModel(text: string, detail = 0.0025, weight = 500): TextModel | null {
  if (!text.trim()) return null;
  text = normalizeTextPresentation(text);
  const key = `${text}\u0000${detail}\u0000${weight}`;
  const known = textModels.get(key);
  if (known) return known;
  const source = drawTextReference(text, detail, weight);
  if (!source) return null;
  const model = analyzeTextGrid(source);
  if (model) {
    if (textModels.size >= 48) textModels.delete(textModels.keys().next().value!);
    // Native curves retain fine counters that a one-cell skeleton deliberately simplifies.
    const outline = textTopology(Uint8Array.from(source.coverage, v => v >= COVERAGE_ON ? 1 : 0), source.width, source.height);
    const result = { ...model, source, outline, emoji: textGraphemes(text).some(isEmojiGrapheme) };
    textModels.set(key, result);
    return result;
  }
  return null;
}

/** A font outline with enough pixels to distinguish strokes before fitting them to map cells. */
export function drawTextReference(text: string, detail = 0.0025, weight = 500): TextReference | null {
  text = normalizeTextPresentation(text);
  const ctx = surface(1, 1);
  if (!ctx) return null;
  ctx.font = `${weight} 100px ${GLYPH_FONT_STACK}`;
  const metrics = ctx.measureText(text);
  const inkW = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  const inkH = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  if (!(inkW > 0 && inkH > 0)) return null;
  const scale = Math.min(96 / inkH, 2044 / inkW);
  const width = Math.ceil(inkW * scale) + 4, height = Math.ceil(inkH * scale) + 4;
  ctx.canvas.width = width; ctx.canvas.height = height;
  ctx.font = `${weight} ${100 * scale}px ${GLYPH_FONT_STACK}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 2 + metrics.actualBoundingBoxLeft * scale, 2 + metrics.actualBoundingBoxAscent * scale);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const picture = textGraphemes(text).some(isEmojiGrapheme) ? emojiTextDrawing({ width, height, data: rgba }, detail) : undefined;
  const coverage = picture?.coverage ?? Uint8Array.from({ length: width * height }, (_, i) => rgba[i * 4 + 3]!);
  return { width: picture?.width ?? width, height: picture?.height ?? height, coverage, picture, ascent: metrics.actualBoundingBoxAscent, descent: metrics.actualBoundingBoxDescent };
}

export function measuredTextMinimum(text: string): { width: number; height: number } | null {
  const runs = textRuns(text);
  if (runs.some(run => run.emoji)) {
    return { width: runs.reduce((sum, run) => sum + run.gap + (run.emoji ? 5 : textModel(run.text)?.minimum.width ?? 5), 0), height: 5 };
  }
  return textModel(text)?.minimum ?? null;
}

interface TextRun { text: string; emoji: boolean; gap: number }

function textRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let buffer = '', gap = 0;
  const flush = () => {
    if (buffer.trim()) runs.push({ text: buffer.trim(), emoji: false, gap: runs.length ? Math.max(gap, /^\s/u.test(buffer) ? 2 : 1) : 0 });
    if (buffer) gap = /\s$/u.test(buffer) ? 2 : 1;
    buffer = '';
  };
  for (const glyph of textGraphemes(text)) {
    if (isEmojiGrapheme(glyph)) {
      flush();
      runs.push({ text: glyph, emoji: true, gap: runs.length ? gap || 1 : 0 });
      gap = 1;
    } else buffer += glyph;
  }
  flush();
  return runs;
}

function fitMixedText(runs: TextRun[], box: { width: number; height: number }): TextGridResult {
  const { width, height } = box;
  const stencil: Stencil = { width, height, coverage: new Uint8Array(width * height), color: new Uint32Array(width * height), cellAligned: true };
  const refused = { stencil, ok: false, loss: 1 };
  const models = runs.map(run => textModel(run.text));
  if (models.some(model => !model)) return refused;
  const ascent = Math.max(...models.map(model => model!.source.ascent));
  const descent = Math.max(...models.map(model => model!.source.descent));
  const scale = height / (ascent + descent);
  const heights = models.map(model => Math.min(height, Math.max(5, Math.round((model!.source.ascent + model!.source.descent) * scale))));
  const minimums = models.map((model, i) => runs[i]!.emoji ? 5 : model!.minimum.width);
  const widths = models.map((model, i) => Math.max(minimums[i]!, Math.round(model!.width / model!.height * heights[i]!)));
  const gaps = runs.map(run => Math.max(run.gap, Math.round(height / 10) * run.gap));
  const total = () => widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  while (total() > width) {
    let chosen = -1;
    for (let i = 0; i < widths.length; i++) if (widths[i]! > minimums[i]! && (chosen < 0 || widths[i]! / minimums[i]! > widths[chosen]! / minimums[chosen]!)) chosen = i;
    if (chosen >= 0) { widths[chosen]!--; continue; }
    chosen = gaps.findIndex((gap, i) => gap > runs[i]!.gap);
    if (chosen < 0) return refused;
    gaps[chosen]!--;
  }
  let x0 = Math.floor((width - total()) / 2);
  for (let i = 0; i < runs.length; i++) {
    x0 += gaps[i]!;
    const frame = { origin: { x: 0, y: 0 }, width: widths[i]!, height: heights[i]! };
    const fitted = gridText(runs[i]!.text, frame);
    if (fitted && !fitted.ok) return refused;
    const raster = fitted?.stencil ?? nativeText(runs[i]!.text, frame);
    if (!raster) return refused;
    const source = models[i]!.source;
    const y0 = Math.max(0, Math.min(height - frame.height, Math.round(ascent * scale - source.ascent / (source.ascent + source.descent) * frame.height)));
    for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
      stencil.coverage[(y0 + y) * width + x0 + x] = raster.coverage[y * raster.width + x]!;
    }
    x0 += raster.width;
  }
  return { stencil, ok: true, loss: 0 };
}

function gridText(text: string, box: { width: number; height: number }): TextGridResult | null {
  const key = `${text}\u0000${box.width}x${box.height}`;
  if (fittedTexts.has(key)) return fittedTexts.get(key)!;
  const result = fitText(text, box);
  if (fittedTexts.size >= 64) fittedTexts.delete(fittedTexts.keys().next().value!);
  fittedTexts.set(key, result);
  return result;
}

function structureLoss(model: TextGridModel, stencil: Stencil): number {
  const ink = Uint8Array.from(stencil.coverage, value => value >= COVERAGE_ON ? 255 : 0);
  const topology = textTopology(ink, stencil.width, stencil.height);
  return Math.abs(topology.pieces - model.pieces) + Math.abs(topology.counters - model.counters)
    + Math.max(0, model.ends - Math.max(1, Math.floor(model.ends / 4)) - textStrokeEnds(ink, stencil.width, stencil.height));
}

function fitText(text: string, box: { width: number; height: number }): TextGridResult | null {
  const runs = textRuns(text);
  if (runs.length > 1 && runs.some(run => run.emoji)) return fitMixedText(runs, box);
  const model = textModel(text);
  if (!model) return null;
  if (model.emoji) {
    return fitEmojiDrawing(model.source.picture!, box);
  }
  // Once stems occupy several cells, the outline retains the font's curves without grid deformation.
  const stroke = 2 * model.radius * Math.min(box.width / model.width, box.height / model.height);
  if (stroke >= 1.5) return null;
  const fitted = fitTextGrid(model, box);
  if (!fitted || fitted.ok) return fitted;
  const frame = { origin: { x: 0, y: 0 }, ...box };
  // Lighter outlines can separate neighboring strokes before geometry is extracted.
  for (const weight of new Set([glyphWeight(text, box), ...GLYPH_WEIGHTS].filter(value => value <= 500))) {
    const reference = weight === 500 ? model : textModel(text, 0.0025, weight)!;
    const native = drawGlyph(text, frame, weight);
    if (!native) continue;
    const raw = native.coverage.slice();
    finishGlyph(native);
    if (structureLoss(reference, native) === 0) return { stencil: { ...native, cellAligned: true }, ok: true, loss: 0 };
    // Font antialiasing can hide a subcell stem; every alternative still passes the structure check.
    for (const threshold of [96, 160, 64]) {
      const candidate = { ...native, coverage: Uint8Array.from(raw, v => v >= threshold ? 255 : 0), cellAligned: true };
      finishGlyph(candidate);
      if (structureLoss(reference, candidate) === 0) return { stencil: candidate, ok: true, loss: 0 };
    }
    if (weight !== 500) {
      const alternative = fitTextGrid(reference, box);
      if (alternative?.ok) return alternative;
    }
  }
  return fitted;
}

/** Null leaves native-outline acceptance to the conservative bound and outline judge. */
export function gridTextFits(text: string, box: { width: number; height: number }): boolean | null {
  return gridText(text, box)?.ok ?? null;
}

/** Phase and weight changes retain native curves once stems have room for multiple cells. */
function nativeText(text: string, box: StencilBox): Stencil | null {
  const key = `${text}\u0000${box.width}x${box.height}`;
  const known = nativeTexts.get(key);
  if (known) return known;
  const model = textModel(text), weight = glyphWeight(text, box);
  let best = drawGlyph(text, box, weight);
  if (!best) return null;
  finishGlyph(best);
  const lossOf = (stencil: Stencil): number => {
    if (!model) return 0;
    const topology = textTopology(Uint8Array.from(stencil.coverage, v => v >= COVERAGE_ON ? 1 : 0), stencil.width, stencil.height);
    return Math.abs(topology.pieces - model.outline.pieces) + Math.abs(topology.counters - model.outline.counters);
  };
  let loss = lossOf(best);
  for (const lighter of [500, 400]) {
    if (loss === 0) break;
    if (lighter >= weight) continue;
    const candidate = drawGlyph(text, box, lighter);
    if (!candidate) continue;
    finishGlyph(candidate);
    const next = lossOf(candidate);
    if (next < loss) { best = candidate; loss = next; }
  }
  if (nativeTexts.size >= 64) nativeTexts.delete(nativeTexts.keys().next().value!);
  nativeTexts.set(key, best);
  return best;
}

export function rasterizeText(text: string, box: StencilBox): Stencil | null {
  const minimum = measuredTextMinimum(text);
  if (minimum && (box.width < minimum.width || box.height < minimum.height)) return null;
  const grid = gridText(text, box);
  if (grid) return grid.ok ? grid.stencil : null;
  return nativeText(text, box);
}

/** Resolution multiplier for the outline reference used by the shelf's legibility check. */
const JUDGE_SCALE = 4;

/** Fitting and preview share the same geometry verdict. */
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
  const minimum = measuredTextMinimum(text);
  if (minimum && (box.width < minimum.width || box.height < minimum.height)) return UNMEASURED;
  const grid = gridText(text, box);
  if (grid) return { ...judgeDrawn(grid.stencil, grid.stencil, 1), ok: grid.ok };
  const flat = { origin: box.origin, width: box.width, height: box.height };
  const built = nativeText(text, flat);
  const weight = glyphWeight(text, flat);
  const truth = drawGlyph(
    text, { origin: box.origin, width: box.width * JUDGE_SCALE, height: box.height * JUDGE_SCALE },
    weight, JUDGE_SCALE,
  );
  if (!built || !truth) return UNMEASURED;
  const reading = judgeDrawn(built, truth, JUDGE_SCALE);
  const model = textModel(text);
  // A different native weight or phase can shift scanlines while retaining every structural feature.
  if (!reading.ok && model && structureLoss(model, built) === 0) reading.ok = true;
  return reading;
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
  // Premature reduction can erase fine details and misclassify flat artwork as photographic.
  const detail = Math.max(1, COMPACT_IMAGE_LIMIT / Math.min(width, height));
  const scale = Math.min(1, (width * detail * 2 * OVERSAMPLE) / sw, (height * detail * 2 * OVERSAMPLE) / sh);
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
