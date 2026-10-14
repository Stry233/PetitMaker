import * as PIXI from 'pixi.js-legacy';
import { APP_FONT_FAMILY } from '../../../assets/fonts/family';
import { chunkColumnLabel, chunkRowLabel, mapChunkAxes, mapFrame } from '../../../core/grid/map-chunks';
import type { MapTemplate } from '../../../core/model/types';
import { TILE_SIZE } from '../geometry/world';

const FONT_SIZE = 400;
const ALPHA = 0.12;
/** Labels rasterized per frame: a 400px text raster is the costly part, so the build spreads out. */
const PER_FRAME = 2;

/** The faint chunk legend outside the map: row letters down the left, column numbers along the bottom. */
export class LabelLayer {
  readonly container = new PIXI.Container();

  /** Opens the owning renderer's render window. */
  constructor(readonly requestRender: () => void) {}
  private raf = 0;

  /** Rebuilds the legend for `template` over the next frames; `current` turning false stops it. */
  build(template: MapTemplate, current: () => boolean): void {
    cancelAnimationFrame(this.raf);
    this.container.removeChildren();

    const frame = mapFrame(template);
    const { columns, rows } = mapChunkAxes(template);
    const style = { fontSize: FONT_SIZE, fill: 0x000000, fontFamily: APP_FONT_FAMILY, fontWeight: 'bold' as const };

    interface Spec { label: string; x: number; y: number; ax: number; ay: number }
    const specs: Spec[] = [];
    for (let row = 0; row < rows.length; row++) {
      specs.push({
        label: chunkRowLabel(row), x: frame.x * TILE_SIZE - FONT_SIZE * 1.5,
        y: rows[row]!.center * TILE_SIZE, ax: 0, ay: 0.5,
      });
    }
    for (let col = 0; col < columns.length; col++) {
      specs.push({
        label: chunkColumnLabel(col),
        x: columns[col]!.center * TILE_SIZE,
        y: (frame.y + frame.height) * TILE_SIZE + FONT_SIZE * 0.3, ax: 0.5, ay: 0,
      });
    }

    let i = 0;
    const step = (): void => {
      if (!current()) return;
      for (let k = 0; k < PER_FRAME && i < specs.length; k++, i++) {
        const s = specs[i]!;
        const text = new PIXI.Text(s.label, style);
        text.alpha = ALPHA;
        text.anchor.set(s.ax, s.ay);
        text.x = s.x;
        text.y = s.y;
        this.container.addChild(text);
      }
      this.requestRender();
      if (i < specs.length) this.raf = requestAnimationFrame(step);
    };
    step();
  }

  /** Stops a build in progress. */
  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}
