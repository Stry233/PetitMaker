import fixtures from '../../../fixtures/stencil-text-fonts.json';
import { analyzeTextGrid, type TextGridModel } from '../../../../tools/generation/stencil/stencil-text-grid';

const models = new Map<string, TextGridModel>();

/** Independent font rasters keep the fitter testable without a browser canvas. */
export function fontModel(text: string): TextGridModel {
  const known = models.get(text);
  if (known) return known;
  const source = fixtures.glyphs.find(glyph => glyph.text === text);
  if (!source) throw new Error(`No font raster for ${text}`);
  const bytes = atob(source.ink);
  const coverage = Uint8Array.from({ length: source.width * source.height }, (_, i) =>
    bytes.charCodeAt(Math.floor(i / 8)) & (1 << (i % 8)) ? 255 : 0);
  const model = analyzeTextGrid({ ...source, coverage });
  if (!model) throw new Error(`Empty font raster for ${text}`);
  models.set(text, model);
  return model;
}
