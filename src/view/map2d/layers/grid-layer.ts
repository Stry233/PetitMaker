import * as PIXI from 'pixi.js-legacy';
import type { MapTemplate } from '../../../core/model/types';
import { CHUNK_GRID_STYLE, chunkGridRects, chunkStrokeCells } from '../../shared/grid/reference-grid';
import { TILE_SIZE } from '../geometry/world';
import { CellGrid } from '../draw/cell-grid';
import { GRIDS, PLACEMENT_GRID } from '../../../core/game/profile';
import type { GridId } from '../../../core/grid/grids';
import { GridShift } from '../../shared/grid/grid-shift';

/**
 * The 2D reference grid: white cell lines at the shown grid's offset, then the dashed chunk bounds
 * over them. Both strokes are sized in screen px, so each redraws when the scale it was drawn at
 * changes, and a capture redraws them at its own resolution, its cell lines on the placement grid
 * the export's coordinate margins count.
 */
export class GridLayer {
  readonly container = new PIXI.Container();
  private readonly cells = new CellGrid();
  private readonly chunks = new PIXI.Graphics();
  private template: MapTemplate | null = null;
  private showCells = false;
  private showChunks = false;
  private readonly shift = new GridShift();
  private cellScale = 0;
  private chunkScale = 0;

  constructor() {
    this.container.addChild(this.cells, this.chunks);
  }

  /** The map the grid frames and the editor's choices, drawn at the next `redraw` or `follow`. */
  setMap(template: MapTemplate, shown: GridId | null, showChunks: boolean): void {
    this.template = template;
    this.showCells = shown !== null;
    this.showChunks = showChunks;
    if (shown !== null) this.shift.aim(shown, false);
  }

  /** Applies the editor's choices at `scale`. A shown grid moving to another grid glides there
   *  (`step` draws each frame of it); a grid coming into view stands at its grid at once. */
  setVisibility(shown: GridId | null, showChunks: boolean, scale: number): void {
    if (shown !== null) this.shift.aim(shown, this.showCells);
    this.showCells = shown !== null;
    this.showChunks = showChunks;
    this.drawCells(this.showCells, scale, showChunks);
    this.drawChunks(showChunks, scale);
  }

  /** Draws one frame of a glide at `scale`; whether the lines moved, so the renderer draws again. */
  step(scale: number): boolean {
    if (!this.shift.step()) return false;
    this.drawCells(this.showCells, scale, this.showChunks);
    return true;
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
    this.drawCells(true, resolution, true, GRIDS[PLACEMENT_GRID].offset);
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

  private drawCells(visible: boolean, scale: number, chunks: boolean, offset = this.shift.offset): void {
    if (!this.template) return;
    this.cellScale = scale;
    this.cells.draw(this.template, visible, scale, chunks, offset);
  }
}
