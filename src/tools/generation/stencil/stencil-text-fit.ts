/** Whether a typed word can be laid in a box, asked ahead of the run so a caller can refuse it. */
import type { StencilFillKind } from './fill-recipes';
import { textMinBox } from './stencil';
import { glyphSurvives, gridTextFits, measuredTextMinimum, rasterizeStrokeText, rasterizeText } from './stencil-raster';

/** Grid-fitted text uses its geometry verdict; native outlines retain the conservative bound. A null
 *  box is the whole map, which always fits. */
export function textFitsBox(text: string, box: { width: number; height: number } | null, fill?: StencilFillKind): boolean {
  if (!box) return true;
  if (fill === 'print') return rasterizeStrokeText(text, { ...box, origin: { x: 0, y: 0 } }) !== null;
  const minimum = measuredTextMinimum(text);
  if (minimum && (box.width < minimum.width || box.height < minimum.height)) return rasterizeText(text, { ...box, origin: { x: 0, y: 0 } }) !== null;
  const fitted = gridTextFits(text, box);
  if (fitted !== null) return fitted || rasterizeText(text, { ...box, origin: { x: 0, y: 0 } }) !== null;
  const need = textMinBox(text);
  if (box.width >= need.width && box.height >= need.height) return true;
  return glyphSurvives(text, { origin: { x: 0, y: 0 }, width: box.width, height: box.height }).ok;
}
