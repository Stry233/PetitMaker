import * as PIXI from 'pixi.js-legacy';
import { CHUNK_SIZE, TILE_SIZE } from '../../../core/model/constants';
import { chunkKey, getCell, macroToChunk } from '../../../core/model/grid-model';
import { getTerrainColor, getZoneColor } from '../../../core/model/colors';
import { HALF_TILE } from '../../../core/model/grid-model';
import { TerrainType } from '../../../core/model/types';
import type { GridState, MacroCoord, TerrainCell } from '../../../core/model/types';
import { drawTrimmedBlock, QUADRANT_OFFSETS } from '../draw/trim-shapes';
import { waterfallFaceMap, touchesWaterfallDependency } from '../../../core/model/waterfall-geometry';
import { requestRender } from '../render-scheduler';
import { ChunkGrid, type CullRect } from './chunk-grid';
import { NumberOverlay } from './number-overlay';
import { cellRenderSpec, cellsAffectedByLayerToggle, hiddenSetFrom } from './layer-visibility';

/** A cell needs a terrain graphic if it holds real terrain (mountain/water), OR it's a GROUND (None) cell
 *  carrying an island-cut — corners that aren't all square (the inverse of a water pond: grass rounds, the
 *  water it sits in shows behind). Plain ground (no corners / all square) is left to the BaseLayer. */
function hasTerrainGraphic(t: TerrainCell | null | undefined): boolean {
  if (!t) return false;
  if (t.type !== TerrainType.None) return true;
  return !!t.corners && !t.corners.every((c) => c === 'square');
}

export class TerrainLayer {
  public readonly container: PIXI.Container;
  /** ONE Graphics per chunk, living in the culled chunk buckets. A dense map holds
   *  10k+ terrain cells, and per-cell Graphics made every visible-everything frame
   *  (fit-to-map pans) traverse and batch each one — measured ~9 ms/frame. Cells
   *  draw at absolute world coordinates, so a whole chunk accumulates into a single
   *  Graphics; edits mark their chunk dirty and {@link flushDirty} repaints each
   *  dirty chunk once per FRAME (a brush stroke issues dozens of commands). */
  private chunkGfx = new Map<string, PIXI.Graphics>();
  private dirtyChunks = new Set<string>();
  private waterfallContainer: PIXI.Container;
  private chunks: ChunkGrid;

  constructor() {
    this.container = new PIXI.Container();
    this.waterfallContainer = new PIXI.Container();
    this.chunks = new ChunkGrid(this.container);
  }

  /** Toggle chunk visibility against the camera rect (called per viewport change). */
  cull(rect: CullRect): void {
    this.chunks.cull(rect);
  }

  /** Cells that carried a waterfall face at the last drawWaterfallIndicators pass —
   *  the "did the previous arrows overlap this edit" half of the recompute gate.
   *  (The cellFaces map itself, kept for `.has` only — no copy.) */
  private lastFaceCells: ReadonlyMap<string, unknown> = new Map();

  private numbers = new NumberOverlay();
  public get numberContainer(): PIXI.Container { return this.numbers.container; }

  private hiddenLayers = new Set<number>();

  setLayerVisibility(visibility: Record<number, boolean>): void {
    this.hiddenLayers = hiddenSetFrom(visibility);
    requestRender();
  }

  /**
   * Apply a visibility change and redraw ONLY the cells it can affect. A
   * full-map rebuild here would destroy and refill every terrain Graphics
   * (thousands on a generated map) for one panel click; a toggle of layer L
   * can only re-tier cells at elevation >= L.
   */
  applyLayerVisibility(state: GridState, visibility: Record<number, boolean>): void {
    const next = hiddenSetFrom(visibility);
    const changed: number[] = [];
    for (const l of next) if (!this.hiddenLayers.has(l)) changed.push(l);
    for (const l of this.hiddenLayers) if (!next.has(l)) changed.push(l);
    this.hiddenLayers = next;
    requestRender();
    if (changed.length === 0) return;
    this.redrawCells(cellsAffectedByLayerToggle(state, changed), state);
    // Waterfall arrows hide with their cell's layer, so any toggle re-derives them.
    this.drawWaterfallIndicators(state);
  }

  drawFull(state: GridState): void {
    requestRender();
    this.chunks.clear(); // destroys the chunk graphics with their buckets
    this.chunkGfx.clear();
    this.dirtyChunks.clear();
    this.container.removeChildren();

    const { width, height } = state.template;
    for (let cy = 0; cy * CHUNK_SIZE < height; cy++) {
      for (let cx = 0; cx * CHUNK_SIZE < width; cx++) this.dirtyChunks.add(chunkKey(cx, cy));
    }
    this.flushDirty(state); // initial build is synchronous, like before

    this.drawWaterfallIndicators(state);
    this.container.addChild(this.waterfallContainer);
  }

  /** Mark the chunks these cells live in for repaint. The actual painting happens
   *  in {@link flushDirty} (once per frame, before the render) — this runs once
   *  per COMMAND, dozens of times per brush stroke, and repainting a 256-cell
   *  chunk per command would cost far more than the per-cell path it replaces. */
  redrawCells(coords: MacroCoord[], state: GridState): void {
    requestRender();
    for (const { x, y } of coords) {
      const c = macroToChunk(x, y);
      this.dirtyChunks.add(chunkKey(c.cx, c.cy));
    }

    // detectWaterfalls is a full-grid scan and this runs once per COMMAND (dozens per
    // stroke), so skip it whenever the changed cells provably can't alter the face set.
    if (this.touchesWaterfalls(coords, state)) this.drawWaterfallIndicators(state);
  }

  /** Repaint every dirty chunk (each once). Called by the render loop right
   *  before a frame is drawn, and by capture paths that render synchronously.
   *  Returns the number of chunks repainted. */
  flushDirty(state: GridState): number {
    if (this.dirtyChunks.size === 0) return 0;
    const n = this.dirtyChunks.size;
    for (const key of this.dirtyChunks) {
      const [cx, cy] = key.split(',').map(Number);
      this.repaintChunk(cx!, cy!, state);
    }
    this.dirtyChunks.clear();
    // Repainting may have created new chunk buckets — re-hoist the waterfall
    // arrows above them.
    if (this.waterfallContainer.parent) {
      this.waterfallContainer.parent.removeChild(this.waterfallContainer);
    }
    this.container.addChild(this.waterfallContainer);
    requestRender();
    return n;
  }

  /** Rebuild one chunk's Graphics from the current state. */
  private repaintChunk(cx: number, cy: number, state: GridState): void {
    const { width, height } = state.template;
    const x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE;
    if (x0 >= width || y0 >= height || cx < 0 || cy < 0) return;
    const key = chunkKey(cx, cy);
    let g = this.chunkGfx.get(key);
    g?.clear();
    const x1 = Math.min(x0 + CHUNK_SIZE, width), y1 = Math.min(y0 + CHUNK_SIZE, height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!hasTerrainGraphic(getCell(state.cells, x, y)?.terrain)) continue;
        if (!g) {
          // Created on the first paintable cell, so terrain-less chunks carry no node.
          g = new PIXI.Graphics();
          this.chunkGfx.set(key, g);
          this.chunks.bucketFor(x0 * TILE_SIZE, y0 * TILE_SIZE).addChild(g);
        }
        this.paintCell(g, x, y, state);
      }
    }
  }

  /**
   * Can this batch of changed cells possibly alter the waterfall face set? The dependency-
   * footprint reasoning lives with the face definition (touchesWaterfallDependency in
   * core/model/waterfall-geometry); this adds only the renderer's half — a changed cell that
   * carried a face at the last draw (the erase-a-whole-body case) also forces a recompute.
   */
  private touchesWaterfalls(coords: MacroCoord[], state: GridState): boolean {
    for (const { x, y } of coords) {
      if (this.lastFaceCells.has(`${x},${y}`)) return true;
      if (touchesWaterfallDependency(state, x, y)) return true;
    }
    return false;
  }

  /**
   * Paint one cell into its chunk's Graphics under the current layer visibility.
   * WHAT to paint is decided by the pure cellRenderSpec (layer-visibility.ts) —
   * the tier the cell renders at, whether its trim applies (a stack rendered
   * below its own elevation is a full block: the corners belong to the hidden
   * top's silhouette), and the per-corner backing derived from neighbours as
   * THEY render. Cells are disjoint rects in absolute world coordinates, so
   * paint order within the shared Graphics can't change how overlaps stack.
   */
  private paintCell(g: PIXI.Graphics, x: number, y: number, state: GridState): void {
    const cell = getCell(state.cells, x, y);
    if (!cell?.terrain) return;
    const spec = cellRenderSpec(state, x, y, this.hiddenLayers);
    if (!spec) return;
    const terrain = cell.terrain;

    // Block rendered centered at grid intersection
    const bx = x * TILE_SIZE - HALF_TILE;
    const by = y * TILE_SIZE - HALF_TILE;

    if (spec.base) {
      const color = terrain.type === TerrainType.None ? getZoneColor(cell.zone) : getTerrainColor(terrain.type, spec.base.tier);
      this.drawBacking(g, spec.base.backing, bx, by);
      drawTrimmedBlock(g, spec.base.corners, bx, by, HALF_TILE, color, 1, false);
    }
    if (spec.fillet) {
      drawTrimmedBlock(g, spec.fillet.corners, bx, by, HALF_TILE, getTerrainColor(terrain.type, spec.fillet.tier), 1, true);
    }
  }

  private drawBacking(g: PIXI.Graphics, backs: readonly ({ type: TerrainType; elevation: number } | null)[], bx: number, by: number): void {
    for (let i = 0; i < 4; i++) {
      const back = backs[i];
      if (!back) continue;
      g.beginFill(getTerrainColor(back.type, back.elevation), 1);
      g.drawRect(bx + QUADRANT_OFFSETS[i]![0], by + QUADRANT_OFFSETS[i]![1], HALF_TILE, HALF_TILE);
      g.endFill();
    }
  }

  private drawWaterfallIndicators(state: GridState): void {
    // Clear previous indicators
    this.waterfallContainer.removeChildren();

    const arrowSize = TILE_SIZE / 3;
    const halfArrow = arrowSize / 2;

    const cellFaces = waterfallFaceMap(state);
    this.lastFaceCells = cellFaces;

    for (const [key, dirs] of cellFaces) {
      const [xStr, yStr] = key.split(',');
      const x = Number(xStr), y = Number(yStr);
      const cell = getCell(state.cells, x, y);
      if (!cell?.terrain) continue;
      if (this.hiddenLayers.has(cell.terrain.elevation)) continue;

      const baseCx = x * TILE_SIZE - HALF_TILE + TILE_SIZE / 2;
      const baseCy = y * TILE_SIZE - HALF_TILE + TILE_SIZE / 2;
      const count = dirs.length;
      const offset = count > 1 ? arrowSize * 0.6 : 0;

      for (const dir of dirs) {
        const g = new PIXI.Graphics();
        let cx = baseCx, cy = baseCy;

        if (count > 1) {
          if (dir === 'north') cy -= offset;
          else if (dir === 'south') cy += offset;
          else if (dir === 'west') cx -= offset;
          else if (dir === 'east') cx += offset;
        }

        g.beginFill(0xffffff, 0.6);
        switch (dir) {
          case 'north':
            g.drawPolygon([cx, cy - halfArrow, cx - halfArrow, cy + halfArrow, cx + halfArrow, cy + halfArrow]);
            break;
          case 'south':
            g.drawPolygon([cx, cy + halfArrow, cx - halfArrow, cy - halfArrow, cx + halfArrow, cy - halfArrow]);
            break;
          case 'west':
            g.drawPolygon([cx - halfArrow, cy, cx + halfArrow, cy - halfArrow, cx + halfArrow, cy + halfArrow]);
            break;
          case 'east':
            g.drawPolygon([cx + halfArrow, cy, cx - halfArrow, cy - halfArrow, cx - halfArrow, cy + halfArrow]);
            break;
        }
        g.endFill();
        this.waterfallContainer.addChild(g);
      }
    }
  }

  // Layer-number raster overlay — delegated to NumberOverlay (its own texture /
  // dirty / visibility lifecycle). numberContainer (above) exposes its display
  // object so MapRenderer mounts it at the same z-order as before.
  setShowNumbers(show: boolean): void { this.numbers.setShowNumbers(show); }
  isShowingNumbers(): boolean { return this.numbers.isShowingNumbers(); }
  setNumberZoom(zoom: number): void { this.numbers.setNumberZoom(zoom); }
  markNumbersDirty(): void { this.numbers.markNumbersDirty(); }
  /** Per-edit path: only the chunks these cells live in repaint. */
  markNumberCellsDirty(cells: MacroCoord[]): void { this.numbers.markCellsDirty(cells); }

  /** (Re)build the number rasters if needed ('all' = every chunk, for captures;
   *  a camera rect bounds the work to visible chunks). Returns true when sprites
   *  were (re)built (so the caller should (re)mount the container). */
  drawNumbers(state: GridState, cull?: CullRect | 'all'): boolean {
    return this.numbers.drawNumbers(state, this.hiddenLayers, cull);
  }
}
