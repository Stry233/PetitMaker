/**
 * THE STENCIL MODULE'S DOOR: a picture — a word, a glyph, an image — read as terrain.
 *
 * Behind it:
 *
 *   stencil.ts            what a stencil IS and every reading taken of one: legibility, daylight,
 *                         separation, density, and the tone/palette fitting that picks materials
 *   stencil-sample.ts     a raster turned into a stencil — background, crop, diffusion matching
 *   stencil-stroke.ts     glyph geometry: extent, weight, outline smoothing, diagonal bridging
 *   stencil-text-grid.ts font stroke analysis and grid fitting for small text
 *   stencil-palette.ts    which catalog items a material offers, and whether it declares colours
 *   stencil-generator.ts  the run itself — terrain, objects, colour and decor laid from a plan
 *   stencil-trim.ts       the corner chooser a stencil run trims with, so a shape keeps its edges
 *
 * WHAT CROSSES IT. The shelf, which reads a typed word or a dropped picture AHEAD of the run so it
 * can show what will be laid and refuse what cannot be, plus the offline stencil evaluator. Running
 * the plan does not: `terrain-generator.ts` is a peer inside `tools/` and imports
 * `stencil-generator.ts` directly (see the paint door for why), so `runStencilPlan` and the four lay
 * passes it drives stay behind this door with the rest of the machinery.
 */
export { tilesAShape } from './stencil';
export {
  airCells, densityOf, glyphLegible, piecesOf, runsAlong, separationOf, terrainPalette, textMinBox,
  COVERAGE_ON, STENCIL_MIN_SIDE,
  type GlyphReading,
} from './stencil';
export { readSourceNature, stencilFromPixels, type SampleOptions } from './stencil-sample';
export { finishGlyph, glyphWeight, GLYPH_WEIGHTS } from './stencil-stroke';
export { analyzeTextGrid, fitTextGrid, textTopology, textStrokeEnds, type TextGridModel, type TextGridResult } from './stencil-text-grid';
export { textGraphemes, isEmojiGrapheme, limitTextGraphemes, normalizeTextPresentation } from './stencil-text-segments';
export { emojiTextDrawing, fitEmojiDrawing, type EmojiDrawing } from './stencil-emoji-mask';
export {
  declaredColorPalette, materialDeclaresColors, paletteItems,
  type ColorEntry, type StencilMaterial,
} from './stencil-palette';
