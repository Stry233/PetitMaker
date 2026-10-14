import * as PIXI from 'pixi.js-legacy';
import { TILE_SIZE } from '../geometry/world';
import { clamp01, smoothstep } from '../../../core/base/math';
import { mapFrame } from '../../../core/grid/map-chunks';
import type { MapTemplate } from '../../../core/model/types';
import { CELL_GRID_STYLE, cellGridRects, chunkStrokeCells } from '../../shared/grid/reference-grid';

/** One cell texture handles line coverage and prevents alpha buildup at grid crossings. */
export class CellGrid extends PIXI.Graphics {
  private tile: PIXI.Texture | null = null;
  private tileCanvas: HTMLCanvasElement | null = null;
  private lastScale = 0;

  draw(template: MapTemplate, visible: boolean, scale: number, chunks: boolean): void {
    this.clear();
    const frame = mapFrame(template);
    this.position.set(frame.x * TILE_SIZE, frame.y * TILE_SIZE);
    if (!visible) return;
    if (!this.tile || scale !== this.lastScale) this.updateTile(scale);
    if (!this.tile) return;
    const matrix = new PIXI.Matrix().scale(TILE_SIZE / this.tile.width, TILE_SIZE / this.tile.height);
    this.beginTextureFill({ texture: this.tile, matrix });
    for (const rect of cellGridRects(template, chunks ? chunkStrokeCells(TILE_SIZE * scale) : 0)) {
      this.drawRect((rect.x - frame.x) * TILE_SIZE, (rect.y - frame.y) * TILE_SIZE, rect.width * TILE_SIZE, rect.height * TILE_SIZE);
    }
    this.endFill();
  }

  private updateTile(scale: number): void {
    const cellPixels = TILE_SIZE * scale;
    // Four texels per CSS pixel keep subpixel strokes thin at close zoom; repeat textures use powers of two.
    const size = 2 ** Math.ceil(Math.log2(Math.max(64, cellPixels * 4)));
    const canvas = this.tileCanvas ?? document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pixels = ctx.createImageData(size, size);
    const halfWidth = CELL_GRID_STYLE.map2d.widthPx / cellPixels / 2;
    const subHalfWidth = CELL_GRID_STYLE.subWidthPx / cellPixels / 2;
    const cellAlpha = CELL_GRID_STYLE.map2d.opacity * smoothstep(...CELL_GRID_STYLE.map2d.fadePx, cellPixels);
    const subAlpha = CELL_GRID_STYLE.map2d.subOpacity * smoothstep(...CELL_GRID_STYLE.map2d.subFadePx, cellPixels);
    const axis = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const at = (i + 0.5) / size;
      const coverage = (distance: number, half: number): number => clamp01((half - distance) * size + 0.5);
      axis[i] = Math.max(coverage(Math.min(at, 1 - at), halfWidth) * cellAlpha, coverage(Math.abs(at - 0.5), subHalfWidth) * subAlpha);
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = 255;
      pixels.data[offset + 3] = Math.round(255 * Math.max(axis[x]!, axis[y]!));
    }
    ctx.putImageData(pixels, 0, 0);
    this.tileCanvas = canvas;
    this.tile ??= PIXI.Texture.from(canvas);
    this.tile.update();
    this.lastScale = scale;
  }

  override destroy(options?: PIXI.IDestroyOptions | boolean): void {
    this.tile?.destroy(true);
    this.tile = null;
    this.tileCanvas = null;
    super.destroy(options);
  }
}
