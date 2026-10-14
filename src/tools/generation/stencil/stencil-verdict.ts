/**
 * The verdict on a drawn glyph: the canvas-free half of the legibility reading, run on two stencils
 * the rasterizer has already drawn (`stencil-raster.ts:glyphSurvives`).
 */
import type { Stencil } from '../recipe';
import { COVERAGE_ON, densityOf, glyphLegible, piecesOf, runsAlong, separationOf, type GlyphReading } from './stencil';

/** A reading of a drawn glyph, and whether it is worth building. */
export interface GlyphVerdict extends GlyphReading { ok: boolean }

/**
 * The verdict on a glyph drawn twice: at the region's resolution and finished, and at `scale` times
 * it, the drawing it is judged against. The runs are read without registering the two pictures, so
 * a cell of misalignment reads the separation lower than it is: a card refused that could have been
 * offered, never a fused one offered.
 */
export function judgeDrawn(built: Stencil, truth: Stencil, scale: number): GlyphVerdict {
  // Nothing drawn is not a letter that survived. A region too small for the word leaves the raster
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
