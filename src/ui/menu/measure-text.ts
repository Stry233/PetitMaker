// Canvas text measurement at DESIGN px — scale-independent, shared by the menu panels that size
// themselves to their localized labels (LayerPanel, PlacementPanel, LoadBar, MenuTile). One lazy
// module-level canvas; SSR/jsdom falls back to a character-count estimate.
import { font } from '../styles';

let _measureCanvas: HTMLCanvasElement | null = null;

/** Width (design px) of `text` at the app font in the given size/weight. */
export function measureTextW(text: string, size: number, weight = 900): number {
  if (typeof document === 'undefined') return text.length * size * 0.62; // SSR/test fallback
  _measureCanvas ??= document.createElement('canvas');
  const ctx = _measureCanvas.getContext('2d');
  if (!ctx) return text.length * size * 0.62;
  ctx.font = `${weight} ${size}px ${font.family}`;
  return ctx.measureText(text).width;
}

/**
 * How far to nudge a `translate(-50%, -50%)`-centred string DOWN (design px) so its INK sits on the
 * anchor rather than its line box.
 *
 * Centring the box centres the em square, which is not where the letters are: the descender space
 * is empty for a string of caps or digits, so the visible glyphs ride above the anchor by half of
 * it. On CJK the ink fills the square and the two agree, which is why the design canvas (authored
 * in Chinese) never showed this and every Latin locale does.
 *
 * Returns 0 where the browser cannot report ink extents (SSR/jsdom, or an engine without the
 * `actualBoundingBox` metrics), which is the same box-centred result as before.
 */
export function inkCenterOffset(text: string, size: number, weight = 900): number {
  if (typeof document === 'undefined') return 0;
  _measureCanvas ??= document.createElement('canvas');
  const ctx = _measureCanvas.getContext('2d');
  if (!ctx) return 0;
  ctx.font = `${weight} ${size}px ${font.family}`;
  const m = ctx.measureText(text);
  const up = m.actualBoundingBoxAscent;
  const down = m.actualBoundingBoxDescent;
  const fUp = m.fontBoundingBoxAscent;
  const fDown = m.fontBoundingBoxDescent;
  if ([up, down, fUp, fDown].some((v) => typeof v !== 'number')) return 0;
  // With `line-height: 1` the baseline sits (fontAscent - fontDescent)/2 BELOW the box centre, and
  // the ink's own centre sits (up - down)/2 ABOVE the baseline. The nudge is the distance between
  // the box centre and the ink centre, which is the difference of those two.
  return (up - down) / 2 - (fUp - fDown) / 2;
}
