import * as PIXI from 'pixi.js-legacy';
import { TILE_SIZE, WATER_COLOR } from '../../../core/model/constants';
import { mapFrame } from '../../../core/model/map-chunks';
import { chunkKey, getCell, macroToChunk } from '../../../core/model/grid-model';
import { getZoneColor, hexStringToNumber } from '../../../core/model/colors';
import { requestRender } from '../render-scheduler';
import { FillGraphics } from '../draw/fill-graphics';
import type { CellZone, GridState, MacroCoord } from '../../../core/model/types';
import { CHUNK_SIZE } from '../../../core/model/game-profile';

/**
 * The zone-colour background: a sea backdrop over the map frame, then one Graphics per chunk. Zones
 * change only through ground edits, so the layer keeps the zones it last drew and a cells change
 * marks a chunk dirty only where a zone actually differs; {@link flushDirty} repaints each dirty
 * chunk once per frame, as the terrain layer does.
 */
export class BaseLayer {
  public readonly container: PIXI.Container;
  /** Opens the owning renderer's render window; MapRenderer rebinds it to itself right after
   *  construction. Defaults to the module broadcast, for an instance nobody has wired yet. */
  public requestRender: () => void = requestRender;
  private backdrop: PIXI.Graphics;
  private chunkGfx = new Map<string, PIXI.Graphics>();
  private dirtyChunks = new Set<string>();
  /** The zone each cell was drawn with, row-major over the template. */
  private drawn = new Uint8Array(0);
  private width = 0;

  constructor() {
    this.container = new PIXI.Container();
    this.backdrop = new FillGraphics();
    this.container.addChild(this.backdrop);
  }

  drawFull(state: GridState): void {
    this.requestRender();
    for (const g of this.chunkGfx.values()) g.destroy();
    this.chunkGfx.clear();
    this.dirtyChunks.clear();
    const { width, height } = state.template;
    this.width = width;
    this.drawn = new Uint8Array(width * height);

    const frame = mapFrame(state.template);
    this.backdrop.clear();
    this.backdrop.beginFill(hexStringToNumber(WATER_COLOR));
    this.backdrop.drawRect(frame.x * TILE_SIZE, frame.y * TILE_SIZE, frame.width * TILE_SIZE, frame.height * TILE_SIZE);
    this.backdrop.endFill();

    for (let cy = 0; cy * CHUNK_SIZE < height; cy++) {
      for (let cx = 0; cx * CHUNK_SIZE < width; cx++) this.dirtyChunks.add(chunkKey(cx, cy));
    }
    this.flushDirty(state);
  }

  /** Mark the chunks of the cells whose zone differs from what was drawn. Runs once per command, so
   *  the repaint waits for {@link flushDirty}. */
  redrawCells(coords: readonly MacroCoord[], state: GridState): void {
    const height = this.width > 0 ? this.drawn.length / this.width : 0;
    let marked = false;
    for (const { x, y } of coords) {
      if (x < 0 || y < 0 || x >= this.width || y >= height) continue;
      const zone = getCell(state.cells, x, y)?.zone;
      if (zone === undefined || zone === this.drawn[y * this.width + x]) continue;
      const c = macroToChunk(x, y);
      this.dirtyChunks.add(chunkKey(c.cx, c.cy));
      marked = true;
    }
    if (marked) this.requestRender();
  }

  /** Repaint every dirty chunk once; returns how many. Called before each drawn frame and by the
   *  captures that render synchronously. */
  flushDirty(state: GridState): number {
    const n = this.dirtyChunks.size;
    if (n === 0) return 0;
    for (const key of this.dirtyChunks) {
      const [cx, cy] = key.split(',').map(Number);
      this.repaintChunk(cx!, cy!, state);
    }
    this.dirtyChunks.clear();
    this.requestRender();
    return n;
  }

  /** Adjacent cells of one zone in a chunk row merge into one rect, so broad grass and sea regions
   *  tessellate as a handful of quads rather than one per cell. */
  private repaintChunk(cx: number, cy: number, state: GridState): void {
    const { width, height } = state.template;
    const x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE;
    if (x0 >= width || y0 >= height || cx < 0 || cy < 0) return;
    const key = chunkKey(cx, cy);
    let g = this.chunkGfx.get(key);
    if (g) g.clear();
    else {
      g = new FillGraphics();
      this.chunkGfx.set(key, g);
      this.container.addChild(g);
    }
    const x1 = Math.min(x0 + CHUNK_SIZE, width), y1 = Math.min(y0 + CHUNK_SIZE, height);
    for (let y = y0; y < y1; y++) {
      let runStart = x0;
      let runColor: number | null = null;
      const flush = (xEnd: number): void => {
        if (runColor !== null && xEnd > runStart) {
          g!.beginFill(runColor);
          g!.drawRect(runStart * TILE_SIZE, y * TILE_SIZE, (xEnd - runStart) * TILE_SIZE, TILE_SIZE);
          g!.endFill();
        }
      };
      for (let x = x0; x < x1; x++) {
        const zone: CellZone | undefined = getCell(state.cells, x, y)?.zone;
        if (zone !== undefined) this.drawn[y * width + x] = zone;
        const color = zone === undefined ? null : getZoneColor(zone);
        if (color !== runColor) {
          flush(x);
          runStart = x;
          runColor = color;
        }
      }
      flush(x1);
    }
  }
}
