import * as PIXI from 'pixi.js-legacy';
import { TILE_SIZE } from '../../geometry/world';
import type { MacroRect } from '../../../interaction/marquee';
import { BAND_COLOR } from '../../../shared/overlay/preview-cell';
import type { OverlayHost } from './host';

const BAND_DASH = 6;
const BAND_GAP = 4;

/** One dashed segment from (x0,y0) to (x1,y1); PIXI.Graphics has no native dash pattern. */
function dashedSegment(g: PIXI.Graphics, x0: number, y0: number, x1: number, y1: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len === 0) return;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  for (let d = 0; d < len; d += BAND_DASH + BAND_GAP) {
    const end = Math.min(d + BAND_DASH, len);
    g.moveTo(x0 + ux * d, y0 + uy * d);
    g.lineTo(x0 + ux * end, y0 + uy * end);
  }
}

/** Dashed rectangle outline, perimeter walked as four segments so the dash phase
 *  restarts at each corner rather than wrapping. */
function dashedRect(g: PIXI.Graphics, x: number, y: number, w: number, h: number): void {
  g.lineStyle(2, BAND_COLOR, 0.9);
  dashedSegment(g, x, y, x + w, y);
  dashedSegment(g, x + w, y, x + w, y + h);
  dashedSegment(g, x + w, y + h, x, y + h);
  dashedSegment(g, x, y + h, x, y);
}

/** The Ctrl+drag rubber band over a placement-grid rect. */
export class OverlayBand {
  constructor(private readonly host: OverlayHost) {}

  readonly bandGraphics = new PIXI.Graphics();

  /** The Ctrl+drag rubber band: a translucent fill + dashed outline over the raw
   *  placement-grid rect: a band only ever selects objects. */
  showBand(rect: MacroRect): void {
    this.host.requestRender();
    if (this.host.disposed) return;
    this.bandGraphics.clear();
    const x = rect.x * TILE_SIZE, y = rect.y * TILE_SIZE, w = rect.w * TILE_SIZE, h = rect.h * TILE_SIZE;
    this.bandGraphics.beginFill(BAND_COLOR, 0.06);
    this.bandGraphics.drawRect(x, y, w, h);
    this.bandGraphics.endFill();
    dashedRect(this.bandGraphics, x, y, w, h);
  }

  clearBand(): void {
    this.host.requestRender();
    if (!this.host.disposed) this.bandGraphics.clear();
  }
}
