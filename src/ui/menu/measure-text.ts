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
