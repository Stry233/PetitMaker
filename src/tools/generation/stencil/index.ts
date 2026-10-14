/**
 * The stencil module's door: a picture (a word, a glyph, an image) read as terrain. Its callers are
 * the shelf and Help's previews, which read a typed word or dropped picture ahead of the run to show
 * what will be laid and refuse what cannot, and the editor host, which installs the browser seam.
 * Running the plan goes through the facade (`../generate.ts`), which imports `run.ts` directly, so
 * `generateStencil`, `runStencilPlan` and the lay passes stay behind this door.
 */
export { terrainPalette, tilesAShape, STENCIL_MIN_SIDE } from './stencil';
export { readSourceNature, type SampleOptions } from './stencil-sample';
export { fitTextGrid } from './stencil-text-grid';
export { isEmojiGrapheme, limitTextGraphemes } from './stencil-text-segments';
export { installStencilBrowser, type DecodedImage, type StencilBrowser } from './stencil-browser';
export {
  ensureGlyphFonts, glyphFontsReady, islandBox, rasterizeImage, rasterizeText, regionBox, type StencilBox,
} from './stencil-raster';
export { textFitsBox } from './stencil-text-fit';
export { buildStencilPlan, forgetStencilImage, peekStencilPlan, type PlanInputs, type StencilSource } from './stencil-plan';
export { letterRecipe, pictureRecipe, type StencilFillKind } from './fill-recipes';
export { planInputsFor, regionAllow, stencilBoxFor, type PlanKnobs } from './plan-inputs';
export { paletteItems } from './stencil-palette';
