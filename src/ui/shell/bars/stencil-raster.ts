/*
 * stencil-raster.ts — turning a character or an image into a `Stencil`.
 *
 * THE ONE PART THAT NEEDS A BROWSER. Everything that READS a stencil is plain arithmetic in
 * `tools/generation/stencil*.ts` and runs anywhere, including the candidate worker; drawing a glyph
 * or decoding a photograph needs a canvas, so it happens here, once, on the main thread, and the
 * result travels as numbers.
 *
 * THE REGION DECIDES THE RESOLUTION. A stencil is exactly as many cells as the area it will be built
 * in, so what the visitor painted is what sets the fidelity — the same letter is a blocky five cells
 * across in a small region and a legible forty in a large one. Nothing here has a size of its own.
 */
import type { MacroCoord, Stencil } from '../../../core/model/types';
import { smoothShape } from '../../../tools/generation/stencil';

/** The rectangle a stencil is drawn into: the painted region's bounding box, or the whole map. */
export interface StencilBox { origin: MacroCoord; width: number; height: number }

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
  const { data } = ctx.getImageData(0, 0, width * 2, height * 2);
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

/** A drawing surface at TWICE the cell resolution, the size `readBack` expects. */
function surface(width: number, height: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  // `willReadFrequently`: every one of these is drawn once and read back immediately, which is the
  // case the software-raster path exists for.
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
 */
export function rasterizeText(text: string, box: StencilBox): Stencil | null {
  const { width, height } = box;
  if (width < 1 || height < 1) return null;
  const ctx = surface(width, height);
  if (!ctx) return null;

  // Everything below is in the canvas's own 2x pixels; the cells come out of `readBack`.
  const cw = width * 2, ch = height * 2;
  const REF = 100;
  ctx.font = `900 ${REF}px sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const m = ctx.measureText(text);
  const inkW = Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  const inkH = Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);

  // Fit the INK to the box, leaving a cell of air so a shape never runs into the region's edge.
  const scale = Math.min((cw - 2) / inkW, (ch - 2) / inkH);
  const size = Math.max(1, REF * scale);
  ctx.font = `900 ${size}px sans-serif`;
  const m2 = ctx.measureText(text);
  const w2 = m2.actualBoundingBoxLeft + m2.actualBoundingBoxRight;
  const h2 = m2.actualBoundingBoxAscent + m2.actualBoundingBoxDescent;
  const x = (cw - w2) / 2 + m2.actualBoundingBoxLeft;
  const y = (ch - h2) / 2 + m2.actualBoundingBoxAscent;

  ctx.fillStyle = '#000000';
  ctx.fillText(text, x, y);
  const stencil = readBack(ctx, width, height);
  // A glyph's diagonals cross cells at about half coverage and come out spotty under the whole-cell
  // threshold; the repair joins them back up, and the trim smooths what it adds.
  smoothShape(stencil);
  return stencil;
}

/**
 * An image drawn to fill `box`, keeping its aspect and centred — the same `object-fit: contain` a
 * picture gets anywhere else, so nothing is stretched into the region's shape.
 *
 * The canvas starts transparent and stays so outside the drawn rect, which is what leaves the map
 * untouched there: the colour mode treats an uncovered cell as "not part of the picture" rather than
 * as sea.
 */
export function rasterizeImage(source: CanvasImageSource, sw: number, sh: number, box: StencilBox): Stencil | null {
  const { width, height } = box;
  if (width < 1 || height < 1 || sw < 1 || sh < 1) return null;
  const ctx = surface(width, height);
  if (!ctx) return null;
  const cw = width * 2, ch = height * 2;
  const scale = Math.min(cw / sw, ch / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  ctx.drawImage(source, Math.round((cw - dw) / 2), Math.round((ch - dh) / 2), dw, dh);
  return readBack(ctx, width, height);
}
