import * as PIXI from 'pixi.js-legacy';
import type { MapTemplate } from '../../../core/model/types';
import { CHUNK_GRID_STYLE, chunkGridRects, chunkStrokeCells } from '../../shared/grid/reference-grid';
import { TILE_SIZE } from '../geometry/world';
import { CellGrid } from '../draw/cell-grid';

/**
 * The 2D reference grid: white cell lines, then the dashed chunk bounds over them. Both strokes are
 * sized in screen px, so each redraws when the scale it was drawn at changes, and a capture redraws
 * them at its own resolution.
 */
export class GridLayer {
  readonly container = new PIXI.Container();
  private readonly cells = new CellGrid();
  private readonly chunks = new PIXI.Graphics();
  private template: MapTemplate | null = null;
  private showCells = false;
  private showChunks = false;
  private cellScale = 0;
  private chunkScale = 0;

  constructor() {
    this.container.addChild(this.cells, this.chunks);
  }

  /** The map the grid frames and the editor's toggles, drawn at the next `redraw` or `follow`. */
  setMap(template: MapTemplate, showCells: boolean, showChunks: boolean): void {
    this.template = template;
    this.showCells = showCells;
    this.showChunks = showChunks;
  }

  /** Applies the editor's toggles at `scale`. */
  setVisibility(showCells: boolean, showChunks: boolean, scale: number): void {
    this.showCells = showCells;
    this.showChunks = showChunks;
    this.drawCells(showCells, scale, showChunks);
    this.drawChunks(showChunks, scale);
  }

  /** Redraws both strokes at `scale` as the toggles stand. */
  redraw(scale: number): void {
    this.drawChunks(this.showChunks, scale);
    this.drawCells(this.showCells, scale, this.showChunks);
  }

  /** Redraws whatever is shown and was drawn at another scale. */
  follow(scale: number): void {
    if (this.showChunks && scale !== this.chunkScale) this.drawChunks(true, scale);
    if (this.showCells && scale !== this.cellScale) this.drawCells(true, scale, this.showChunks);
  }

  /** Draws the whole grid, chunk bounds included, at a capture's resolution. */
  drawForCapture(resolution: number): void {
    this.drawCells(true, resolution, true);
    this.drawChunks(true, resolution);
  }

  private drawChunks(visible: boolean, scale: number): void {
    if (!this.template) return;
    const g = this.chunks;
    g.clear();
    this.chunkScale = scale;
    if (!visible) return;
    const strokeCells = chunkStrokeCells(scale * TILE_SIZE);
    g.beginFill(0x000000, CHUNK_GRID_STYLE.map2d.opacity);
    for (const rect of chunkGridRects(this.template, strokeCells)) {
      g.drawRect(rect.x * TILE_SIZE, rect.y * TILE_SIZE, rect.width * TILE_SIZE, rect.height * TILE_SIZE);
    }
    g.endFill();
  }

  private drawCells(visible: boolean, scale: number, chunks: boolean): void {
    if (!this.template) return;
    this.cellScale = scale;
    this.cells.draw(this.template, visible, scale, chunks);
  }
}
