import * as PIXI from 'pixi.js-legacy';
import { QUADRANT_PX, TILE_SIZE, TERRAIN_GRID_OFFSET_PX } from '../geometry/world';
import { getCell } from '../../../core/model/grid-model';
import { chunkKey } from '../../../core/grid/rect';
import { bucketOf, bucketCounts, bucketSpan } from '../../../core/grid/buckets';
import { getTerrainColor, getZoneColor } from '../draw/terrain-color';
import { TerrainType } from '../../../core/model/types';
import type { GridState, MacroCoord, TerrainCell } from '../../../core/model/types';
import { drawTrimmedBlock, QUADRANT_OFFSETS } from '../draw/trim-shapes';
import { FillGraphics } from '../draw/fill-graphics';
import { WATERFALL_ARROW_LOOK, WaterfallFaceWatch, waterfallArrowTriangles } from '../../shared/terrain/waterfall-arrows';
import { ChunkGrid, type CullRect } from './chunk-grid';
import { NumberOverlay } from './number-overlay';
import { cellRenderSpec, cellsAffectedByLayerToggle, hiddenSetFrom } from '../../shared/terrain/layer-visibility';
import { isSquareCorners } from '../../../core/model/corners';

/** A cell needs a terrain graphic if it holds real terrain (mountain/water), or it's a ground (None) cell
 *  carrying an islet cut — corners that aren't all square (the inverse of a water pond: grass rounds, the
 *  water it sits in shows behind). Plain ground (no corners / all square) is left to the BaseLayer. */
function hasTerrainGraphic(t: TerrainCell | null | undefined): boolean {
  if (!t) return false;
  if (t.type !== TerrainType.None) return true;
  return !isSquareCorners(t.corners);
}

export class TerrainLayer {
  public readonly container: PIXI.Container;
  /** One Graphics per chunk, living in the culled chunk buckets, so a fit-to-map frame batches a
   *  chunk rather than each of a dense map's 10k+ cells. Cells draw at absolute world coordinates;
   *  edits mark their chunk dirty and {@link flushDirty} repaints each dirty chunk once per frame
   *  (a brush stroke issues dozens of commands). */
  private chunkGfx = new Map<string, PIXI.Graphics>();
  private dirtyChunks = new Set<string>();
  /** Every waterfall arrow, in one fill-only Graphics kept above the chunk buckets. */
  private readonly waterfallArrows = new FillGraphics();
  private chunks: ChunkGrid;
  /** Opens the owning renderer's render window. */
  constructor(readonly requestRender: () => void) {
    this.container = new PIXI.Container();
    this.chunks = new ChunkGrid(this.container);
    this.numbers = new NumberOverlay(requestRender);
  }

  /** Toggle chunk visibility against the camera rect (called per viewport change). */
  cull(rect: CullRect): void {
    this.chunks.cull(rect);
  }

  /** The faces the arrows show, scanned from the live map. */
  private readonly waterfalls = new WaterfallFaceWatch();

  private readonly numbers: NumberOverlay;
  public get numberContainer(): PIXI.Container { return this.numbers.container; }

  private hiddenLayers = new Set<number>();

  setLayerVisibility(visibility: Record<number, boolean>): void {
    this.hiddenLayers = hiddenSetFrom(visibility);
    this.requestRender();
  }

  withAllLayersVisible<T>(state: GridState, capture: () => T): T {
    const previous = Object.fromEntries([...this.hiddenLayers].map(layer => [layer, false]));
    try {
      this.applyLayerVisibility(state, {});
      return capture();
    } finally {
      this.applyLayerVisibility(state, previous);
    }
  }

  /**
   * Apply a visibility change and redraw only the cells it can affect. A
   * full-map rebuild here would destroy and refill every terrain Graphics
   * (thousands on a generated map) for one panel click; a toggle of layer L
   * can only re-tier cells at elevation >= L.
   */
  applyLayerVisibility(state: GridState | null, visibility: Readonly<Record<number, boolean>>): void {
    const next = hiddenSetFrom(visibility);
    const changed: number[] = [];
    for (const l of next) if (!this.hiddenLayers.has(l)) changed.push(l);
    for (const l of this.hiddenLayers) if (!next.has(l)) changed.push(l);
    this.hiddenLayers = next;
    this.requestRender();
    // Without a map the floors are only recorded; the first full draw reads them.
    if (changed.length === 0 || !state) return;
    this.redrawCells(cellsAffectedByLayerToggle(state, changed), state);
    // Waterfall arrows hide with their cell's layer; the faces themselves are the live map's.
    this.drawWaterfallIndicators(state, false);
  }

  drawFull(state: GridState): void {
    this.requestRender();
    this.chunks.clear(); // destroys the chunk graphics with their buckets
    this.chunkGfx.clear();
    this.dirtyChunks.clear();
    this.container.removeChildren();

    const { width, height } = state.template;
    const buckets = bucketCounts(width, height);
    for (let cy = 0; cy < buckets.rows; cy++) {
      for (let cx = 0; cx < buckets.cols; cx++) this.dirtyChunks.add(chunkKey(cx, cy));
    }
    this.flushDirty(state); // the initial build is synchronous

    this.drawWaterfallIndicators(state, true);
    this.container.addChild(this.waterfallArrows);
  }

  /** Mark the chunks these cells live in for repaint. The actual painting happens
   *  in {@link flushDirty} (once per frame, before the render) — this runs once
   *  per command, dozens of times per brush stroke, and repainting a 256-cell
   *  chunk per command would cost far more than the per-cell path it replaces. */
  redrawCells(coords: MacroCoord[], state: GridState): void {
    this.requestRender();
    for (const { x, y } of coords) {
      const c = bucketOf(x, y);
      this.dirtyChunks.add(chunkKey(c.cx, c.cy));
    }

    // The face scan reads the whole map and this runs once per command (dozens per stroke), so it
    // runs only when the changed cells can alter the faces.
    if (this.waterfalls.touchedBy(coords, state)) this.drawWaterfallIndicators(state, true);
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
    // Repainting may have created new chunk buckets: the arrows go back above them.
    this.container.addChild(this.waterfallArrows);
    this.requestRender();
    return n;
  }

  /** Rebuild one chunk's Graphics from the current state. */
  private repaintChunk(cx: number, cy: number, state: GridState): void {
    const { width, height } = state.template;
    const { x0, y0, x1, y1 } = bucketSpan(cx, cy, width, height);
    if (x0 >= width || y0 >= height || cx < 0 || cy < 0) return;
    const key = chunkKey(cx, cy);
    let g = this.chunkGfx.get(key);
    g?.clear();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!hasTerrainGraphic(getCell(state.cells, x, y)?.terrain)) continue;
        if (!g) {
          // Created on the first paintable cell, so terrain-less chunks carry no node.
          g = new FillGraphics();
          this.chunkGfx.set(key, g);
          this.chunks.bucketFor(x0 * TILE_SIZE, y0 * TILE_SIZE).addChild(g);
        }
        this.paintCell(g, x, y, state);
      }
    }
  }

  /**
   * Paint one cell into its chunk's Graphics under the current layer visibility.
   * What to paint is decided by the pure cellRenderSpec (layer-visibility.ts) —
   * the tier the cell renders at, whether its trim applies (a stack rendered
   * below its own elevation is a full block: the corners belong to the hidden
   * top's silhouette), and the per-corner backing derived from neighbours as
   * They render. Cells are disjoint rects in absolute world coordinates, so
   * paint order within the shared Graphics can't change how overlaps stack.
   */
  private paintCell(g: PIXI.Graphics, x: number, y: number, state: GridState): void {
    const cell = getCell(state.cells, x, y);
    if (!cell?.terrain) return;
    const spec = cellRenderSpec(state, x, y, this.hiddenLayers);
    if (!spec) return;
    const terrain = cell.terrain;

    // Block rendered on the terrain grid, centred at an object-grid intersection
    const bx = x * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.x;
    const by = y * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.y;

    if (spec.base) {
      const color = terrain.type === TerrainType.None ? getZoneColor(cell.zone) : getTerrainColor(terrain.type, spec.base.tier);
      this.drawBacking(g, spec.base.backing, bx, by);
      drawTrimmedBlock(g, spec.base.corners, { bx, by, halfSize: QUADRANT_PX }, { color, alpha: 1, patchOnly: false });
    }
    if (spec.fillet) {
      const color = getTerrainColor(terrain.type, spec.fillet.tier);
      drawTrimmedBlock(g, spec.fillet.corners, { bx, by, halfSize: QUADRANT_PX }, { color, alpha: 1, patchOnly: true });
    }
  }

  private drawBacking(g: PIXI.Graphics, backs: readonly ({ type: TerrainType; elevation: number } | null)[], bx: number, by: number): void {
    for (let i = 0; i < 4; i++) {
      const back = backs[i];
      if (!back) continue;
      g.beginFill(getTerrainColor(back.type, back.elevation), 1);
      g.drawRect(bx + QUADRANT_OFFSETS[i]![0], by + QUADRANT_OFFSETS[i]![1], QUADRANT_PX, QUADRANT_PX);
      g.endFill();
    }
  }

  /** Redraws the arrows, scanning the faces again first when `rescan`. */
  private drawWaterfallIndicators(state: GridState, rescan: boolean): void {
    const faces = rescan ? this.waterfalls.scan(state) : this.waterfalls.faces;
    const g = this.waterfallArrows;
    g.clear();
    const shown = (x: number, y: number): boolean => {
      const t = getCell(state.cells, x, y)?.terrain;
      return !!t && !this.hiddenLayers.has(t.elevation);
    };
    const px = (v: number, offset: number): number => offset + v * TILE_SIZE;
    g.beginFill(WATERFALL_ARROW_LOOK.color, WATERFALL_ARROW_LOOK.alpha);
    for (const { points: p } of waterfallArrowTriangles(faces, shown)) {
      const { x: ox, y: oy } = TERRAIN_GRID_OFFSET_PX;
      g.drawPolygon([px(p[0], ox), px(p[1], oy), px(p[2], ox), px(p[3], oy), px(p[4], ox), px(p[5], oy)]);
    }
    g.endFill();
    this.requestRender();
  }

  // Layer-number raster overlay — delegated to NumberOverlay (its own texture /
  // dirty / visibility lifecycle). numberContainer (above) exposes its display
  // object for MapRenderer to mount.
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
