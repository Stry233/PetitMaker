import * as PIXI from 'pixi.js-legacy';
import { TILE_SIZE } from '../../geometry/world';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import { CHUNK_GRID_STYLE, chunkStrokeCells, planetFrameRects } from '../../../shared/grid/reference-grid';
import type { PlanetFrame } from '../../../../core/model/planet';
import type { OverlayHost } from './host';
import { timedBeat } from '../../../shared/viewport/frame-loop';
import { GHOST_LOSS } from '../../../shared/viewport/view-constants';

/** The custom planet's dashed frame and its warning flash. */
export class OverlayPlanetFrame {
  constructor(private readonly host: OverlayHost) {}

  private planetFrame: PlanetFrame | null = null;
  readonly planetFrameGraphics = new PIXI.Graphics();
  /** The same dashes in the warning tint, faded in and out over the ink by a flash. */
  readonly planetFrameFlash = new PIXI.Graphics();
  private stopFrameFlash: (() => void) | null = null;

  showFrame(frame: PlanetFrame | null): void {
    this.planetFrame = frame;
    this.drawPlanetFrame();
  }

  /** Dash widths are screen px, so the frame redraws as the zoom moves. */
  private drawPlanetFrame(): void {
    this.host.requestRender();
    const ink = this.planetFrameGraphics, flash = this.planetFrameFlash;
    if (this.host.disposed) return;
    ink.clear(); flash.clear();
    if (!this.planetFrame) { this.endFrameFlash(); return; }
    const rects = planetFrameRects(this.planetFrame, chunkStrokeCells(this.host.viewZoom * TILE_SIZE));
    for (const [g, color, alpha] of [[ink, CHUNK_GRID_STYLE.planetFrame.ink, CHUNK_GRID_STYLE.planetFrame.opacity], [flash, GHOST_LOSS, 1]] as const) {
      g.beginFill(color, alpha);
      for (const r of rects) g.drawRect(r.x * TILE_SIZE, r.y * TILE_SIZE, r.width * TILE_SIZE, r.height * TILE_SIZE);
      g.endFill();
    }
  }

  /**
   * The warning tint rising over the frame and falling away once (`sin`, so both ends are at rest).
   * Under reduced motion nothing runs: the frame itself still shows where the planet ends.
   */
  flashFrame(durationMs: number): void {
    if (this.host.disposed || !this.planetFrame || this.stopFrameFlash !== null || isMotionReduced()) return;
    let ended = false;
    const stop = this.host.play(timedBeat(durationMs, (t) => {
      this.planetFrameFlash.alpha = Math.sin(Math.PI * t);
      if (t >= 1) { ended = true; this.endFrameFlash(); }
    }));
    if (!ended) this.stopFrameFlash = stop;
  }

  /** Ends a running frame flash. */
  endFrameFlash(): void {
    this.stopFrameFlash?.();
    this.stopFrameFlash = null;
    this.planetFrameFlash.alpha = 0;
  }

  /** Dash widths follow the zoom. */
  rezoom(): void {
    if (this.planetFrame) this.drawPlanetFrame();
  }
}
