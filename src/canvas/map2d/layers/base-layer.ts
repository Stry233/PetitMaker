import * as PIXI from 'pixi.js-legacy';
import { TILE_SIZE } from '../../../core/model/constants';
import { getCell } from '../../../core/model/grid-model';
import { getZoneColor } from '../../../core/model/colors';
import { requestRender } from '../render-scheduler';
import { FillGraphics } from '../draw/fill-graphics';
import type { GridState } from '../../../core/model/types';

export class BaseLayer {
  public readonly container: PIXI.Container;
  /** Opens the owning renderer's render window; MapRenderer rebinds it to itself right after
   *  construction. Defaults to the module broadcast, for an instance nobody has wired yet. */
  public requestRender: () => void = requestRender;
  private graphics: PIXI.Graphics;

  constructor() {
    this.container = new PIXI.Container();
    this.graphics = new FillGraphics();
    this.container.addChild(this.graphics);
  }

  /**
   * Draw the zone-color background. Same pixels as a rect-per-cell, but adjacent
   * cells of the same zone in a row are merged into one rect (run-length) — large
   * grass/sea regions collapse from thousands of quads to a handful, which slashes
   * the one-time tessellation cost on the opening's first render.
   */
  drawFull(state: GridState): void {
    this.requestRender();
    this.graphics.clear();
    const { width, height } = state.template;

    for (let y = 0; y < height; y++) {
      let runStart = 0;
      let runColor: number | null = null;
      const flush = (xEnd: number): void => {
        if (runColor !== null && xEnd > runStart) {
          this.graphics.beginFill(runColor);
          this.graphics.drawRect(runStart * TILE_SIZE, y * TILE_SIZE, (xEnd - runStart) * TILE_SIZE, TILE_SIZE);
          this.graphics.endFill();
        }
      };
      for (let x = 0; x < width; x++) {
        const cell = getCell(state.cells, x, y);
        const color = cell ? getZoneColor(cell.zone) : null;
        if (color !== runColor) {
          flush(x);
          runStart = x;
          runColor = color;
        }
      }
      flush(width);
    }
  }
}
