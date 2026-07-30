import * as PIXI from 'pixi.js-legacy';
import { CHUNK_SIZE, TILE_SIZE } from '../../../core/model/constants';
import { HALF_TILE, chunkKey, macroToChunk } from '../../../core/model/grid-model';
import type { GridState, MacroCoord } from '../../../core/model/types';
import { requestRender } from '../render-scheduler';
import { chunkVisible, type CullRect } from './chunk-cull';
import { chunkNumberCells, setNumberLabelStyle, drawNumberLabel } from './number-cells';

/** One chunk's raster: a reusable canvas + its texture/sprite, repainted in place. */
interface NumberChunk {
  cx: number;
  cy: number;
  canvas: HTMLCanvasElement;
  texture: PIXI.Texture;
  sprite: PIXI.Sprite;
  dirty: boolean;
}

const CHUNK_PX = CHUNK_SIZE * TILE_SIZE; // 1024 — always far below any GPU texture cap

// Numbers are ~14px in world space, so on screen they're ~14*zoom px — below this zoom they'd be an
// illegible blur and pure overhead, so both the terrain number raster AND the per-object elevation
// labels (object-layer) hide below it. The single source for that threshold so the two stay in sync.
export const MIN_NUMBER_ZOOM = 0.3;

/**
 * The layer-number overlay as PER-CHUNK canvas rasters, mirroring the terrain
 * and object layers' chunk architecture:
 * - an edit repaints (and re-uploads) only the chunks it touched, never a
 *   full-map canvas;
 * - chunks build lazily as the camera reaches them, so toggling numbers on
 *   costs the visible chunks, not the whole map;
 * - each raster is CHUNK_PX square, so no map size can exceed the GPU texture
 *   limit (numbers stay full resolution on any map).
 * The owning TerrainLayer delegates to this and exposes {@link container}.
 */
export class NumberOverlay {
  public readonly container = new PIXI.Container();

  private chunks = new Map<string, NumberChunk>();
  private numbersVisible = false;
  private allDirty = true;
  private dirtyChunks = new Set<string>();
  private lastCull: CullRect | null = null;

  private numberZoom = 1;

  setShowNumbers(show: boolean): void {
    this.numbersVisible = show;
  }

  isShowingNumbers(): boolean {
    return this.numbersVisible;
  }

  setNumberZoom(zoom: number): void {
    this.numberZoom = zoom;
  }

  markNumbersDirty(): void {
    this.allDirty = true;
  }

  /** Mark only the chunks these cells live in — the per-edit path, so a brush
   *  stroke repaints one or two 16-cell chunks instead of the whole map. */
  markCellsDirty(cells: MacroCoord[]): void {
    for (const { x, y } of cells) {
      const c = macroToChunk(x, y);
      this.dirtyChunks.add(chunkKey(c.cx, c.cy));
    }
  }

  /**
   * Build/refresh the rasters. `cull` bounds the work to the visible chunks
   * ('all' forces every chunk — captures need the whole map; undefined reuses
   * the last camera rect). Returns true when sprites were (re)built, so the
   * caller re-mounts the container.
   */
  drawNumbers(state: GridState, hiddenLayers: Set<number>, cull?: CullRect | 'all'): boolean {
    requestRender();
    // Hidden — toggled off, OR zoomed out far enough that numbers are illegible
    // clutter. Free everything so a zoomed-out (or editing) map pays nothing.
    if (!this.numbersVisible || this.numberZoom < MIN_NUMBER_ZOOM) {
      if (this.chunks.size > 0) {
        for (const ch of this.chunks.values()) ch.texture.destroy(true);
        this.chunks.clear();
        this.container.removeChildren();
      }
      this.allDirty = true;
      this.dirtyChunks.clear();
      return false;
    }

    const rect = cull === 'all' ? null : cull ?? this.lastCull;
    if (cull && cull !== 'all') this.lastCull = cull;

    const { width, height } = state.template;
    if (width === 0 || height === 0) return false;
    const chunksX = Math.ceil(width / CHUNK_SIZE);
    const chunksY = Math.ceil(height / CHUNK_SIZE);

    let changed = false;
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const key = chunkKey(cx, cy);
        const existing = this.chunks.get(key);
        if (existing && (this.allDirty || this.dirtyChunks.has(key))) existing.dirty = true;

        const inView = !rect || chunkVisible(cx, cy, rect);
        if (existing) existing.sprite.visible = inView;
        if (!inView) continue; // off-screen: stays lazily dirty/missing until scrolled to

        if (!existing) {
          this.chunks.set(key, this.buildChunk(state, cx, cy, hiddenLayers));
          changed = true;
        } else if (existing.dirty) {
          this.paintChunk(existing, state, hiddenLayers);
          existing.dirty = false;
        }
      }
    }
    this.allDirty = false;
    // Off-screen dirt persists on the chunk entries themselves; the set is consumed.
    for (const key of this.dirtyChunks) {
      const ch = this.chunks.get(key);
      if (ch) ch.dirty = ch.dirty || !ch.sprite.visible;
    }
    this.dirtyChunks.clear();
    return changed;
  }

  private buildChunk(state: GridState, cx: number, cy: number, hiddenLayers: Set<number>): NumberChunk {
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK_PX;
    canvas.height = CHUNK_PX;
    const texture = PIXI.Texture.from(canvas);
    const sprite = new PIXI.Sprite(texture);
    sprite.x = cx * CHUNK_PX - HALF_TILE;
    sprite.y = cy * CHUNK_PX - HALF_TILE;
    const chunk: NumberChunk = { cx, cy, canvas, texture, sprite, dirty: false };
    this.paintChunk(chunk, state, hiddenLayers);
    this.container.addChild(sprite);
    return chunk;
  }

  /** Repaint one chunk's canvas in place and re-upload just its texture. */
  private paintChunk(chunk: NumberChunk, state: GridState, hiddenLayers: Set<number>): void {
    const ctx2d = chunk.canvas.getContext('2d');
    if (!ctx2d) return;
    ctx2d.clearRect(0, 0, CHUNK_PX, CHUNK_PX);
    setNumberLabelStyle(ctx2d);
    // The sprite sits at the chunk's terrain-grid origin (−HALF_TILE), so cell
    // (x, y) paints at its offset within the chunk in terrain-shifted coords.
    const ox = chunk.cx * CHUNK_PX - HALF_TILE;
    const oy = chunk.cy * CHUNK_PX - HALF_TILE;
    for (const { x, y, label } of chunkNumberCells(state, chunk.cx, chunk.cy, hiddenLayers)) {
      const bx = x * TILE_SIZE - HALF_TILE + 3 - ox;
      const by = y * TILE_SIZE - HALF_TILE + TILE_SIZE - 3 - oy;
      drawNumberLabel(ctx2d, label, bx, by);
    }
    chunk.texture.baseTexture.update();
  }
}
