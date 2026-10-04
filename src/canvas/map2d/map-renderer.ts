import { viewportRect } from '../../core/runtime/viewport-space';
import * as PIXI from 'pixi.js-legacy';
import { APP_FONT_FAMILY } from '../../assets/fonts/family';
import '@pixi/unsafe-eval'; // self-installs on import (7.1+) — keeps strict-CSP shader builds
import type { ActiveView } from '../view-projection';
import type { CellFrame } from '../thumbnail';
import { CHUNK_GRID_STYLE, chunkGridRects, chunkStrokeCells } from '../reference-grid';

// Snap sprite rendering to whole device pixels: at fractional zooms every icon
// otherwise samples BETWEEN pixels, a uniform slight blur no texture LOD can fix
// (the editor is a static scene, so per-frame snapping has no motion cost).
PIXI.settings.ROUND_PIXELS = true;
import type { EventBus } from '../../core/commands/event-bus';
import { CommandType } from '../../core/model/types';
import type { EditorEvents, GridState, MacroCoord, MapTemplate } from '../../core/model/types';
import { TILE_SIZE, WATER_COLOR } from '../../core/model/constants';
import { mapCaptureFrame, mapChunkAxes, mapFrame } from '../../core/model/map-chunks';
import { getCell } from '../../core/model/grid-model';
import { pageZoom } from '../../core/runtime/page-zoom';
import { hexStringToNumber } from '../../core/model/colors';
import { maxRenderScale } from '../../core/runtime/device-quality';
import { getCatalogItem } from '../../state/catalog';
import { iconUrl } from '../../assets/icon-urls';
import { roadTileReady } from '../road-tile-texture';
import { roadMaterialSettled } from '../road-material';
import { decodeIcons } from './draw/icon-color';
import { BaseLayer } from './layers/base-layer';
import { resolveHistoryFlash } from '../error-flash';
import { cullRect } from './layers/chunk-grid';
import { TerrainLayer } from './layers/terrain-layer';
import { ObjectLayer, objectSpriteUrl } from './layers/object-layer';
import { AnnotationLayer } from './layers/annotation-layer';
import { annotationInkScale } from '../../core/model/annotations';
import { tagLabel } from '../../i18n/annotation-tags';
import { useEditorStore } from '../../state/store';
import { OverlayLayer } from './layers/overlay-layer';
import { Viewport } from './viewport';
import { addRenderRequester } from './render-scheduler';
import { isCoatingItem } from '../../core/model/traits';


export class MapRenderer {
  public readonly app: PIXI.Application;
  public readonly worldContainer: PIXI.Container;
  public readonly baseLayer: BaseLayer;
  public readonly terrainLayer: TerrainLayer;
  public readonly objectLayer: ObjectLayer;
  public readonly annotationLayer: AnnotationLayer;
  public readonly overlayLayer: OverlayLayer;
  public readonly viewport: Viewport;

  private readonly eventBus: EventBus<EditorEvents>;
  private currentState: GridState | null = null;
  private chunkGridContainer = new PIXI.Container();
  private chunkGridGraphics = new PIXI.Graphics();
  private chunkGridScale = 0;
  private cellGridScale = 0;
  private labelsContainer = new PIXI.Container();

  // The ticker sleeps between requested frames; a timed heartbeat retains missed-invalidation recovery.
  private renderWindow = 0;            // frames left to render
  private destroyed = false;           // guards deferred initMap work after teardown
  private labelBuildRaf = 0;           // incremental chunk-label build
  private showGrid = false;            // current editor grid visibility (restored after a grid capture)
  private showChunks = false;          // current editor chunk-grid visibility
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private static readonly HEARTBEAT_MS = 250;
  private static readonly HEARTBEAT_REST_MS = 1000;
  private static readonly REST_AFTER_HEARTBEATS = 8;
  private stillHeartbeats = 0;
  /** Whether this canvas is the view on screen. The 3D view stands over the 2D canvas while it is
   *  active, and a scene nobody can see earns no frames: hidden, the loop draws nothing, dirty
   *  chunks accumulate, and the first presented frame (or a capture) flushes them. */
  private presenting = true;

  /** Handlers registered on the shared bus, detached again in destroy(). */
  private busSubscriptions: Array<() => void> = [];

  /** This instance's entry in the render scheduler's requester set. */
  private detachRequester: () => void = () => {};

  private subscribe<K extends keyof EditorEvents>(event: K, handler: (data: EditorEvents[K]) => void): void {
    this.eventBus.on(event, handler);
    this.busSubscriptions.push(() => this.eventBus.off(event, handler));
  }

  /** Open the render window for a few frames (coalesced; spam-safe). Called by
   *  every scene mutation + every canvas-animation frame (via render-scheduler). */
  requestRender = (): void => {
    if (this.destroyed) return;
    this.renderWindow = 4;
    this.stillHeartbeats = 0;
    this.clearHeartbeat();
    if (this.presenting || this.paintWaiters.length > 0) this.app.ticker.start();
  };

  private clearHeartbeat(): void {
    if (this.heartbeat !== null) clearTimeout(this.heartbeat);
    this.heartbeat = null;
  }

  private restTicker(): void {
    this.app.ticker.stop();
    if (!this.presenting || this.destroyed || this.heartbeat !== null) return;
    const delay = this.stillHeartbeats >= MapRenderer.REST_AFTER_HEARTBEATS
      ? MapRenderer.HEARTBEAT_REST_MS : MapRenderer.HEARTBEAT_MS;
    this.heartbeat = setTimeout(() => {
      this.heartbeat = null;
      if (this.destroyed || !this.presenting) return;
      this.stillHeartbeats = Math.min(MapRenderer.REST_AFTER_HEARTBEATS, this.stillHeartbeats + 1);
      this.renderWindow = 1;
      this.app.ticker.start();
    }, delay);
  }

  /** Presented or not, decided by whoever owns the canvas element (`PixiCanvas`, on the view
   *  mode). Coming back on screen opens the render window, which is what flushes whatever the
   *  hidden stretch accumulated. */
  setPresenting(on: boolean): void {
    if (this.presenting === on) return;
    this.presenting = on;
    if (on) this.requestRender();
    else {
      this.clearHeartbeat();
      if (this.paintWaiters.length === 0) this.app.ticker.stop();
    }
  }

  /** One-shot waiters for "a frame was actually DRAWN" (see onNextPaint). */
  private paintWaiters: Array<() => void> = [];

  private renderTick = (): void => {
    if (!this.presenting && this.paintWaiters.length === 0) { this.restTicker(); return; }
    if (this.renderWindow > 0) {
      this.renderWindow--;
      this.flushDirtyChunks();
      this.app.render();
      this.notifyPainted();
    }
    if (this.renderWindow <= 0) this.restTicker();
  };

  /** Repaint the chunks the edits since the last frame dirtied, zone colours and terrain alike. */
  private flushDirtyChunks(): void {
    if (!this.currentState) return;
    this.baseLayer.flushDirty(this.currentState);
    this.terrainLayer.flushDirty(this.currentState);
  }

  /** Run `cb` after the next frame this renderer DRAWS. Render-on-demand means a frame boundary
   *  proves nothing on its own, so the request also opens the render window: whoever is waiting
   *  wants the current scene on screen, not the next mutation's. */
  onNextPaint(cb: () => void): void {
    this.paintWaiters.push(cb);
    this.requestRender();
  }

  private notifyPainted(): void {
    if (this.paintWaiters.length === 0) return;
    const waiting = this.paintWaiters;
    this.paintWaiters = [];
    for (const cb of waiting) cb();
  }

  constructor(
    eventBus: EventBus<EditorEvents>,
    container: HTMLElement,
    width: number,
    height: number,
    opts?: {
      /** Take pixi's Canvas2D renderer without asking for WebGL. For a figure-sized surface on a
       *  software rasterizer (`glQuality() === 'lite'`), a GL context plus pixi's capability walk
       *  costs seconds per canvas while Canvas2D starts at once — and canvas parity is a shipped
       *  state (the renderer a WebGL-less browser gets). */
      preferCanvas?: boolean;
    },
  ) {
    this.eventBus = eventBus;

    const useCanvas = opts?.preferCanvas === true || !MapRenderer.isWebGLAvailable();
    this.app = new PIXI.Application({
      width,
      height,
      background: hexStringToNumber(WATER_COLOR),
      antialias: true,
      // Cap resolution (≤2×, ≤1.5× on low-end) — above this the sharpness gain is imperceptible but
      // GPU fill cost grows quadratically; the worst FPS offender on hi-DPI phones under a heavy map.
      resolution: maxRenderScale(),
      autoDensity: true,
      forceCanvas: useCanvas,
      preserveDrawingBuffer: true,
      // Render on demand (see render loop below) — a static map costs no GPU.
      autoStart: false,
      // Nothing in the scene is a Pixi event target: every pointer, wheel and context-menu
      // listener the map has is bound to the CONTAINER by usePointerInteraction, and hit-testing
      // goes through state/object-index. Left on, Pixi's own event system walks the whole display
      // list per pointermove (hitTestMoveRecursive), which on a decorated map is thousands of
      // nodes of pure waste on the drag's critical path, growing with every object a stroke lays.
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    container.appendChild(this.app.view as HTMLCanvasElement);

    this.worldContainer = new PIXI.Container();

    this.baseLayer = new BaseLayer();
    this.terrainLayer = new TerrainLayer();
    this.objectLayer = new ObjectLayer();
    this.annotationLayer = new AnnotationLayer();
    this.overlayLayer = new OverlayLayer();
    this.overlayLayer.setShapeSource((x, y) =>
      (this.currentState ? getCell(this.currentState.cells, x, y)?.terrain : null) ?? null);

    // Each layer asks THIS renderer to repaint rather than broadcasting to every mounted one — a
    // Help figure's demo animation must not open the standing editor's render window (or every
    // other figure's) alongside its own.
    this.baseLayer.requestRender = this.requestRender;
    this.terrainLayer.requestRender = this.requestRender;
    this.objectLayer.requestRender = this.requestRender;
    this.annotationLayer.requestRender = this.requestRender;
    this.overlayLayer.requestRender = this.requestRender;

    this.worldContainer.addChild(this.baseLayer.container);
    this.worldContainer.addChild(this.terrainLayer.container);
    this.overlayLayer.referenceGrid.addChild(this.chunkGridContainer);
    this.chunkGridContainer.addChild(this.chunkGridGraphics);
    this.worldContainer.addChild(this.objectLayer.container); // includes the plaza (a self-described locked object)
    this.worldContainer.addChild(this.overlayLayer.referenceGrid);
    this.worldContainer.addChild(this.labelsContainer);
    this.worldContainer.addChild(this.annotationLayer.container); // plan notes: over the map, under the tool feedback
    this.worldContainer.addChild(this.overlayLayer.container);

    this.app.stage.addChild(this.worldContainer);

    this.viewport = new Viewport(width, height);
    // The projection answers in client coordinates, and the canvas does not always start at the
    // window's corner (the assistant's dock insets it). The container's rect is read AT USE: the
    // box also moves without resizing — the dock slide settles a transform away — and no resize
    // event marks that moment, so a recorded origin would keep answering for where the box was.
    this.viewport.setOriginSource(() => {
      const rect = viewportRect(container);
      return { x: rect.left, y: rect.top };
    });

    // Subscribe to EventBus events. Every handler is registered through
    // subscribe() so destroy() can detach them all: the bus outlives any one
    // renderer (React StrictMode remounts the canvas in dev), and a destroyed
    // renderer's handler acting on destroyed Pixi objects throws mid-dispatch.
    this.subscribe('cells-changed', (data) => {
      if (!this.currentState) return;
      this.baseLayer.redrawCells(data.cells, this.currentState);
      this.terrainLayer.redrawCells(data.cells, this.currentState);
      this.refreshNumbers(data.cells);
      this.requestRender();
    });

    this.subscribe('objects-changed', (data) => {
      if (data.added) {
        this.objectLayer.addObjects(data.added);
      }
      if (data.removed) {
        this.objectLayer.removeObjects(data.removed);
      }
      this.refreshNumbers();
      this.requestRender();
    });

    this.subscribe('validation-failed', (data) => {
      // Terrain edits render on the micro grid (-HALF_TILE); object placements on
      // the macro grid. Offset the error flash to match so it lands on the cells.
      const terrainMode = data.cmd.type === CommandType.PaintTerrain || data.cmd.type === CommandType.EraseTerrain;
      this.overlayLayer.flashErrors(data.errors, terrainMode);
      this.requestRender();
    });

    // Flash the region an undo/redo touched (neutral, latest-wins so a
    // mashed-undo burst coalesces into one beat). Each part of the step is on its own grid:
    // an item's footprint on the macro grid (no offset), terrain cells on the micro grid.
    this.subscribe('history-applied', ({ cells, objects }) => {
      const flash = resolveHistoryFlash(cells, objects);
      if (flash) this.overlayLayer.flashCommit(flash.cells);
      this.requestRender();
    });

    // Drive the render-on-demand loop and route every scene mutation /
    // animation frame (via render-scheduler) to open the render window.
    this.detachRequester = addRenderRequester(this.requestRender);
    // Pixi's TickerPlugin adds `app.render` to the application ticker inside the `ticker` property
    // setter, i.e. at construction; `autoStart` decides only whether the ticker is STARTED. Starting
    // it here for our own gated tick therefore runs pixi's UNGATED whole-scene render beside it —
    // measured at exactly 2.00 renders per frame while panning, and one full repaint per frame on an
    // untouched map, which is the render-on-demand gate defeated. renderTick is the only drawer.
    this.app.ticker.remove(this.app.render, this.app);
    this.app.ticker.add(this.renderTick);
    this.app.ticker.start();
    this.requestRender();
  }

  initMap(state: GridState, showGrid: boolean, showChunks?: boolean, opts?: { labels?: boolean }): void {
    this.currentState = state;
    this.showGrid = showGrid;
    this.showChunks = showChunks ?? false;
    this.requestRender();
    this.baseLayer.drawFull(state);
    this.terrainLayer.drawFull(state);
    this.objectLayer.sync(state.objects, state);   // includes the plaza (self-described locked object)

    this.viewport.fitToMap(state.template.width, state.template.height);
    this.applyViewportTransform();        // first paint: the map (base + terrain + objects incl. plaza)

    // Defer the overlays past the first paint, spread across frames so no single
    // frame carries their whole cost: grid lines (tessellation) next frame, then
    // chunk labels (heavy text rasterization) the frame after. They aren't the
    // map; appearing a couple of frames later is imperceptible. The guard skips a
    // stale build if a newer map loaded or the renderer was torn down.
    const stale = (): boolean => this.destroyed || this.currentState !== state;
    requestAnimationFrame(() => {
      if (stale()) return;
      this.drawChunkGrid(state.template, showChunks ?? false);
      this.drawCellGrid(state.template, showGrid);
      this.requestRender();
      // A figure-sized view opts out: the labels sit outside the map (never in a crop's frame)
      // and their 400px text rasters are the deferred pass's whole cost.
      if (opts?.labels === false) return;
      requestAnimationFrame(() => {
        if (stale()) return;
        this.drawLabels(state);
        this.requestRender();
      });
    });
  }

  private drawChunkGrid(template: MapTemplate, visible: boolean, scale = this.viewport.getZoom()): void {
    const g = this.chunkGridGraphics;
    g.clear();
    this.chunkGridScale = scale;
    if (!visible) return;

    const strokeCells = chunkStrokeCells(scale * TILE_SIZE);
    g.beginFill(0x000000, CHUNK_GRID_STYLE.map2d.opacity);
    for (const rect of chunkGridRects(template, strokeCells)) {
      g.drawRect(rect.x * TILE_SIZE, rect.y * TILE_SIZE, rect.width * TILE_SIZE, rect.height * TILE_SIZE);
    }
    g.endFill();
  }

  private drawCellGrid(template: MapTemplate, visible: boolean, scale = this.viewport.getZoom(), chunks = this.showChunks): void {
    this.cellGridScale = scale;
    this.overlayLayer.drawGridLines(template, visible, scale, chunks);
  }

  /** Reconcile the object layer with state: drop any sprite state no longer has, add any it is
   *  missing, redraw any whose object was edited under the same id. Bulk callers (Generate, Clear,
   *  a macro press) run it after committing — every mutation does emit its own `objects-changed`,
   *  so this is a backstop rather than the mechanism, and it costs two walks of the object map. */
  resyncObjects(): void {
    if (!this.currentState) return;
    this.objectLayer.sync(this.currentState.objects);
    this.refreshNumbers();
    this.requestRender();
  }

  updateGridVisibility(showGrid: boolean, showChunks: boolean): void {
    if (!this.currentState) return;
    this.showGrid = showGrid;
    this.showChunks = showChunks;
    this.drawCellGrid(this.currentState.template, showGrid);
    this.drawChunkGrid(this.currentState.template, showChunks);
    this.requestRender();
  }

  private numbersRefreshRaf = 0; // deferred number-raster rebuild (cancelled in destroy, like labelBuildRaf)

  /** Refresh the layer-number overlay after an edit — but only when it's actually
   *  shown. While numbers are hidden (the default) this path is skipped, so brush
   *  strokes don't pay for it. With `cells`, only their CHUNK rasters repaint (the
   *  per-edit hot path); without, everything is marked. The dirty mark is
   *  synchronous (so any capture/zoom path that calls drawNumbers itself still
   *  rebuilds), but the repaint + texture upload coalesce to once per frame —
   *  this runs once per COMMAND, dozens of times per stroke. */
  private refreshNumbers(cells?: MacroCoord[]): void {
    if (!this.currentState || !this.terrainLayer.isShowingNumbers()) return;
    if (cells) this.terrainLayer.markNumberCellsDirty(cells);
    else this.terrainLayer.markNumbersDirty();
    if (this.numbersRefreshRaf) return;
    this.numbersRefreshRaf = requestAnimationFrame(() => {
      this.numbersRefreshRaf = 0;
      if (!this.currentState || !this.terrainLayer.isShowingNumbers()) return;
      if (this.terrainLayer.drawNumbers(this.currentState)) this.mountNumberContainer();
      this.requestRender();
    });
  }

  /** Synchronously build EVERY chunk of the number overlay (refreshNumbers defers
   *  to the next frame and builds only visible chunks) — captures bake the whole
   *  world container NOW, so no raster may be stale or missing. */
  private flushNumbers(): void {
    if (!this.currentState || !this.terrainLayer.isShowingNumbers()) return;
    if (this.terrainLayer.drawNumbers(this.currentState, 'all')) this.mountNumberContainer();
  }

  mountNumberContainer(): void {
    const nc = this.terrainLayer.numberContainer;
    if (nc.parent) nc.parent.removeChild(nc);
    // Insert above terrain layer, below object/overlay
    const terrainIdx = this.worldContainer.getChildIndex(this.terrainLayer.container);
    this.worldContainer.addChildAt(nc, terrainIdx + 1);
  }

  /** This renderer as the tool layer's active view: the 2D projection is the
   *  viewport's camera math, the overlay is the Pixi overlay layer, and the
   *  camera verbs are offset/zoom moves that re-apply the transform. */
  asEditorView(): ActiveView {
    return {
      projection: this.viewport,
      overlay: this.overlayLayer,
      rendersState: () => this.currentState,
      onNextPaint: (cb: () => void) => this.onNextPaint(cb),
      applyCameraTransform: () => this.applyViewportTransform(),
      plopObject: (id: string) => this.objectLayer.requestPlop(id),
      animateRotation: (id, from, to, onFrame) => this.objectLayer.animateRotation(id, from, to, onFrame),
      animateGroupRotation: (turn, onFrame) => this.objectLayer.animateGroupRotation(turn, onFrame),
      animateRemove: (id: string) => this.objectLayer.animateRemove(id),
      leftDragPans: true,
      camera: {
        // The wheel zooms here as it does in 3D: a mouse notch steps, a touchpad scroll glides,
        // and panning stays on drags and the pan keys.
        wheelZooms: true,
        pan: (dx, dy) => {
          this.viewport.pan(dx, dy);
          this.applyViewportTransform();
        },
        zoomStep: (dir, ax, ay) => {
          this.viewport.setZoom(this.viewport.getZoom() * (dir > 0 ? 1.1 : 0.9), ax, ay);
          this.applyViewportTransform();
        },
        zoomBy: (factor, ax, ay) => {
          this.viewport.setZoom(this.viewport.getZoom() * factor, ax, ay);
          this.applyViewportTransform();
        },
      },
    };
  }

  applyViewportTransform(): void {
    const zoom = this.viewport.getZoom();
    const offset = this.viewport.getOffset();
    this.worldContainer.scale.set(zoom);
    this.worldContainer.position.set(-offset.x, -offset.y);
    if (this.currentState && this.showChunks && zoom !== this.chunkGridScale) {
      this.drawChunkGrid(this.currentState.template, true, zoom);
    }
    if (this.currentState && this.showGrid && zoom !== this.cellGridScale) {
      this.drawCellGrid(this.currentState.template, true, zoom);
    }
    const rect = this.cullLayers(zoom, offset);
    // Re-evaluate the layer-number overlay for the new zoom/camera: it hides (and
    // frees its rasters) when zoomed out, builds newly visible chunks when the
    // camera reaches them, and early-outs when nothing changed on a plain pan.
    this.terrainLayer.setNumberZoom(zoom);
    if (this.currentState && this.terrainLayer.drawNumbers(this.currentState, rect)) {
      this.mountNumberContainer();
    }
    // Icon LOD tracks the live zoom so texture sampling stays near 1:1 (crisp).
    this.objectLayer.updateLod(zoom, this.app.renderer.resolution);
    // Object elevation labels honour the same zoom LOD as the terrain numbers (hide when zoomed out).
    this.objectLayer.setNumberZoom(zoom);
    this.overlayLayer.setViewZoom(zoom);
    // Let screen-anchored React overlays (selection handles) re-track the view.
    this.eventBus.emit('viewport-changed', { zoom });
    this.requestRender();
  }

  /** Toggle terrain/object chunk visibility against the camera rect — Pixi has no built-in
   *  culling, so without this every rendered frame traverses every off-screen node too and
   *  pan/zoom cost scales with the map total instead of what's visible. O(chunks). */
  private cullLayers(zoom: number, offset: { x: number; y: number }) {
    const rect = cullRect(offset.x, offset.y, zoom, this.app.renderer.screen.width, this.app.renderer.screen.height);
    this.terrainLayer.cull(rect);
    this.objectLayer.cull(rect);
    return rect;
  }

  private lastPageZoom = pageZoom();

  /**
   * A BOX CHANGE MOVES THE BOX'S CENTRE, AND THE WORLD FOLLOWS IT. The box is a layer of the
   * interface — the assistant's dock takes a strip of the window, so the box changes size and place
   * while the scene inside should keep reading as the same scene. Anchoring the world point at the
   * old centre onto the new one is the 3D camera's own behaviour (its projection is about its box
   * centre, and a resize hands it only the aspect), and it is what makes the dock slide land
   * silently: the slide carries the drawing by HALF the dock's width, which is exactly the centre's
   * travel, so the one resize at each end of the slide moves nothing on screen. The anchor is read
   * BEFORE the page-zoom rebase — a zoom step redefines the css px, and the world point at the old
   * css centre standing at the new css centre is that rebase's own answer. Where the box STANDS is
   * not taken here at all: the projection reads the container's rect at use.
   */
  resize(width: number, height: number): void {
    const centre = this.viewport.worldAtCentre();
    // A page-zoom step arrives here as a resize (the CSS viewport changed), so this is where the
    // map is held still against it — see `Viewport.rebaseForPageZoom`. Compared against the LAST
    // seen factor, not against 1, so an ordinary window resize rebases nothing.
    const zoom = pageZoom();
    if (zoom !== this.lastPageZoom) {
      this.viewport.rebaseForPageZoom(zoom / this.lastPageZoom);
      this.lastPageZoom = zoom;
    }
    this.app.renderer.resize(width, height);
    this.viewport.resize(width, height);
    this.viewport.centreOn(centre);
    // Push the camera to the stage rather than only re-culling: a resize moves the camera (the
    // centre anchor, the page-zoom rebase, and the clamp that keeps the map on screen inside a
    // smaller canvas). Left in the model, that change would sit invisible until the next pan or
    // zoom applied it, and the map would jump then.
    this.applyViewportTransform();
    // Buffer allocation clears the canvas; paint before ResizeObserver returns to the compositor.
    this.renderTick();
  }

  /** Capture the full map (independent of current pan/zoom) as a PNG data URL
   *  with the long side capped at maxPx. Renders into a resolution-bounded
   *  RenderTexture so the texture never exceeds GPU limits (unlike a raw stage
   *  extract, which allocates the map at full pixel size). */
  /** Temporarily reveal every culled chunk: captures render the WHOLE map irrespective of the
   *  camera, and getLocalBounds skips invisible children — a culled capture would lose the
   *  off-screen map. Returns the restore fn that re-culls for the live camera. */
  private uncullForCapture(): () => void {
    // Captures render synchronously, outside the render tick — repaint any
    // pending terrain edits first or they'd be missing from the export. Road
    // surfaces rebuild on the same schedule, so flush those too.
    this.flushDirtyChunks();
    this.objectLayer.flushRoadRegions();
    const everything = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    this.terrainLayer.cull(everything);
    this.objectLayer.cull(everything);
    return () => this.cullLayers(this.viewport.getZoom(), this.viewport.getOffset());
  }

  captureFullMap(maxPx = 1024): string | null {
    const recull = this.uncullForCapture();
    try {
      // A hidden canvas defers its chunk repaints to the next presented frame, so a capture baked
      // from the live containers settles them itself — same contract as `flushNumbers` below.
      this.flushDirtyChunks();
      this.flushNumbers();
      const world = this.worldContainer;
      const b = world.getLocalBounds();
      if (b.width <= 0 || b.height <= 0) return null;
      const resolution = Math.min(1, maxPx / Math.max(b.width, b.height));
      const rt = this.app.renderer.generateTexture(world, { resolution, region: b });
      const canvas = this.app.renderer.extract.canvas(rt) as HTMLCanvasElement;
      rt.destroy(true);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    } finally {
      recull();
    }
  }

  /** Saved maps include hidden layers; their detached capture must include them too. */
  captureCompleteMapCanvas(maxPx: number, annotations = true): HTMLCanvasElement | null {
    if (!this.currentState) return null;
    return this.terrainLayer.withAllLayersVisible(this.currentState, () =>
      this.objectLayer.withAllLayersVisible(() => this.captureMapCanvas(maxPx, false, undefined, annotations)));
  }

  /** Export capture includes the map's sea frame and omits editor chrome. Optional grid lines
   *  are baked in; the export composition supplies its own labels outside the image. */
  captureMapImage(maxPx = 1024, includeGrid = false, rect?: { x1: number; y1: number; x2: number; y2: number }, annotations?: boolean): string | null {
    try { return this.captureMapCanvas(maxPx, includeGrid, rect, annotations)?.toDataURL('image/png') ?? null; } catch { return null; }
  }

  captureMapCanvas(maxPx = 1024, includeGrid = false, rect?: { x1: number; y1: number; x2: number; y2: number }, annotations?: boolean): HTMLCanvasElement | null {
    if (!this.currentState) return null;
    const recull = this.uncullForCapture();
    // `annotations` overrides the plan-notes layer's eye for this capture. Omitted values preserve
    // the editor's current visibility.
    const prevAnnotations = this.annotationLayer.container.visible;
    if (annotations !== undefined) this.annotationLayer.container.visible = annotations && (this.currentState.annotations?.items.length ?? 0) > 0;
    try {
      // The live containers again: a hidden canvas holds its chunk repaints, and this bake must
      // show the map as it IS.
      this.flushDirtyChunks();
      this.flushNumbers();
      const { width, height } = this.currentState.template;
      const half = TILE_SIZE / 2;
      // Region captures use inclusive saved-cell coordinates and retain terrain's half-cell bleed.
      let region: PIXI.Rectangle;
      if (rect) {
        const x1 = Math.max(0, Math.min(rect.x1, rect.x2));
        const y1 = Math.max(0, Math.min(rect.y1, rect.y2));
        const x2 = Math.min(width - 1, Math.max(rect.x1, rect.x2));
        const y2 = Math.min(height - 1, Math.max(rect.y1, rect.y2));
        if (x2 < x1 || y2 < y1) return null;
        region = new PIXI.Rectangle(x1 * TILE_SIZE - half, y1 * TILE_SIZE - half, (x2 - x1 + 1) * TILE_SIZE + half, (y2 - y1 + 1) * TILE_SIZE + half);
      } else {
        const frame = mapCaptureFrame(this.currentState.template);
        region = new PIXI.Rectangle(frame.x * TILE_SIZE, frame.y * TILE_SIZE, frame.width * TILE_SIZE, frame.height * TILE_SIZE);
      }
      if (region.width <= 0 || region.height <= 0) return null;
      // Clamp the request to the GPU limits so a native-resolution ("Original") request never
      // exceeds them (which would upload black); the achieved size is region*resolution.
      const cap = Math.min(maxPx, this.textureCap());
      return this.bake(region, Math.min(1, cap / Math.max(region.width, region.height)), includeGrid);
    } catch {
      return null;
    } finally {
      this.annotationLayer.container.visible = prevAnnotations;
      recull();
    }
  }

  /** Export tiles use pixels relative to the capture frame, including its sea margin or terrain bleed. */
  captureRegionCanvas(region: { x: number; y: number; w: number; h: number }, resolution: number, includeGrid = false, annotations?: boolean): HTMLCanvasElement | null {
    if (!this.currentState) return null;
    const recull = this.uncullForCapture();
    const prevAnnotations = this.annotationLayer.container.visible;
    if (annotations !== undefined) this.annotationLayer.container.visible = annotations && (this.currentState.annotations?.items.length ?? 0) > 0;
    try {
      this.flushDirtyChunks();
      this.flushNumbers();
      const frame = mapCaptureFrame(this.currentState.template);
      const world = new PIXI.Rectangle(region.x + frame.x * TILE_SIZE, region.y + frame.y * TILE_SIZE, region.w, region.h);
      if (world.width <= 0 || world.height <= 0) return null;
      return this.bake(world, resolution, includeGrid);
    } catch {
      return null;
    } finally {
      this.annotationLayer.container.visible = prevAnnotations;
      recull();
    }
  }

  /** Longest side a render target may have here: the texture and the multisample renderbuffer
   *  ceilings both bound it, and the smaller one is what fails first on huge maps. */
  textureCap(): number {
    const glr = this.app.renderer as unknown as { gl?: WebGLRenderingContext };
    const gl = glr.gl && typeof glr.gl.getParameter === 'function' ? glr.gl : null;
    const maxTex = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 0;
    const maxRb = gl ? (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) : 0;
    const hardMax = Math.min(...[maxTex, maxRb].filter((v) => v && v > 0));
    return Number.isFinite(hardMax) ? hardMax : Infinity;
  }

  /** Renders `region` of the world at `resolution` into a canvas, with the editor's transform
   *  reset, its chrome hidden, and the grid forced on when the export bakes it. */
  private bake(region: PIXI.Rectangle, resolution: number, includeGrid: boolean): HTMLCanvasElement | null {
    if (!this.currentState) return null;
    {
      // With grid ON, bake the SAME grid the editor draws (sub + cell + chunk lines) into the
      // capture so the export reuses the real 2D rendering. Chunk LABELS stay hidden — the export
      // composition draws its own legend outside the map. Restored to the editor state afterwards.
      if (includeGrid) {
        this.drawCellGrid(this.currentState.template, true, resolution, true);
        this.drawChunkGrid(this.currentState.template, true, resolution);
      }
      const chrome = includeGrid
        ? [this.overlayLayer.container, this.labelsContainer]
        : [this.overlayLayer.referenceGrid, this.overlayLayer.container, this.labelsContainer];
      const prevVisible = chrome.map((c) => c.visible);
      // generateTexture bakes the container's CURRENT transform, so the editor's pan/zoom
      // would render the map small and off-corner inside the region. Reset to identity for
      // the capture (the map's local content then fills the template region), restore after.
      const sx = this.worldContainer.scale.x, sy = this.worldContainer.scale.y;
      const px = this.worldContainer.position.x, py = this.worldContainer.position.y;
      chrome.forEach((c) => { c.visible = false; });
      this.worldContainer.scale.set(1, 1);
      this.worldContainer.position.set(0, 0);
      this.worldContainer.updateTransform(); // ensure the identity matrix is current before generateTexture bakes it
      let captured: HTMLCanvasElement | null = null;
      try {
        // No multisample: MSAA is invisible on an export and its renderbuffer has the smaller ceiling.
        const rt = this.app.renderer.generateTexture(this.worldContainer, { resolution, region, multisample: PIXI.MSAA_QUALITY.NONE });
        try { captured = this.app.renderer.extract.canvas(rt) as HTMLCanvasElement; }
        finally { rt.destroy(true); }
      } finally {
        this.worldContainer.scale.set(sx, sy);
        this.worldContainer.position.set(px, py);
        chrome.forEach((c, i) => { c.visible = prevVisible[i]!; });
        // Restore the editor's actual grid visibility (the capture may have forced it on).
        if (includeGrid) {
          this.drawCellGrid(this.currentState.template, this.showGrid);
          this.drawChunkGrid(this.currentState.template, this.showChunks);
        }
        this.requestRender();
      }
      return captured;
    }
  }

  /** Export-focused capture of the plan-notes ink ALONE, same template-framed rect and
   *  transform-reset dance as `captureMapImage`, for the stylize compose step that layers the
   *  user's ink back over a redrawn map bitmap. Every other layer is hidden (base, terrain,
   *  object, plus the chrome `captureMapImage` already hides), so nothing but ink can paint —
   *  `generateTexture`'s render target clears to transparent by construction (a fresh
   *  `RenderTexture`'s clear color is `[0,0,0,0]`, independent of the app's own background; the
   *  paper only appears in other captures because `BaseLayer` fills the region opaquely), so
   *  hiding those layers leaves genuine transparency rather than the app's water-color backdrop.
   *  An empty annotation layer would capture as a blank sheet the compose step cannot use, so an
   *  empty map returns null instead of a picture. */
  captureAnnotationsImage(maxPx: number): string | null {
    try { return this.captureAnnotationsCanvas(maxPx)?.toDataURL('image/png') ?? null; } catch { return null; }
  }

  captureAnnotationsCanvas(maxPx: number): HTMLCanvasElement | null {
    if (!this.currentState) return null;
    if ((this.currentState.annotations?.items.length ?? 0) === 0) return null;
    const prevAnnotations = this.annotationLayer.container.visible;
    this.annotationLayer.container.visible = true;
    try {
      this.flushNumbers();
      return this.bakeLayersCanvas(maxPx, [this.baseLayer.container, this.terrainLayer.container, this.objectLayer.container, this.overlayLayer.referenceGrid, this.overlayLayer.container, this.labelsContainer]);
    } finally {
      this.annotationLayer.container.visible = prevAnnotations;
    }
  }

  /** Export-focused capture of the grid ALONE (the sub, cell and chunk lines the editor draws),
   *  transparent everywhere else: the layer the stylize compose step lays over a redrawn map so a
   *  stylized export keeps the same grid a plain one bakes in. Forced on for the bake whatever the
   *  editor shows, and restored after; the chunk labels stay hidden, since the composition draws
   *  its own legend outside the map. */
  captureGridImage(maxPx: number): string | null {
    if (!this.currentState) return null;
    this.drawCellGrid(this.currentState.template, true);
    try {
      return this.bakeLayersImage(maxPx, [this.baseLayer.container, this.terrainLayer.container, this.objectLayer.container, this.annotationLayer.container, this.overlayLayer.container, this.labelsContainer]);
    } finally {
      this.drawCellGrid(this.currentState.template, this.showGrid);
      this.drawChunkGrid(this.currentState.template, this.showChunks);
    }
  }

  /** The world baked to a transparent PNG with `hidden` layers off: the shared body of the
   *  single-layer captures. Same template-framed rect, same reset-transform-then-restore dance and
   *  the same GPU-limit clamp as `captureMapImage` (see its body for why each is there). */
  private bakeLayersImage(maxPx: number, hidden: PIXI.Container[]): string | null {
    try { return this.bakeLayersCanvas(maxPx, hidden)?.toDataURL('image/png') ?? null; } catch { return null; }
  }

  private bakeLayersCanvas(maxPx: number, hidden: PIXI.Container[]): HTMLCanvasElement | null {
    if (!this.currentState) return null;
    const recull = this.uncullForCapture();
    try {
      const frame = mapCaptureFrame(this.currentState.template);
      const region = new PIXI.Rectangle(frame.x * TILE_SIZE, frame.y * TILE_SIZE, frame.width * TILE_SIZE, frame.height * TILE_SIZE);
      if (region.width <= 0 || region.height <= 0) return null;
      const prevVisible = hidden.map((c) => c.visible);
      const sx = this.worldContainer.scale.x, sy = this.worldContainer.scale.y;
      const px = this.worldContainer.position.x, py = this.worldContainer.position.y;
      hidden.forEach((c) => { c.visible = false; });
      this.worldContainer.scale.set(1, 1);
      this.worldContainer.position.set(0, 0);
      this.worldContainer.updateTransform();
      let captured: HTMLCanvasElement | null = null;
      try {
        const glr = this.app.renderer as unknown as { gl?: WebGLRenderingContext };
        const getP = glr.gl && typeof glr.gl.getParameter === 'function' ? glr.gl : null;
        const maxTex = getP ? (getP.getParameter(getP.MAX_TEXTURE_SIZE) as number) : 0;
        const maxRb = getP ? (getP.getParameter(getP.MAX_RENDERBUFFER_SIZE) as number) : 0;
        const hardMax = Math.min(...[maxTex, maxRb].filter((v) => v && v > 0));
        const cap = Number.isFinite(hardMax) ? Math.min(maxPx, hardMax) : maxPx;
        const resolution = Math.min(1, cap / Math.max(region.width, region.height));
        if (!hidden.includes(this.overlayLayer.referenceGrid)) {
          this.drawCellGrid(this.currentState.template, true, resolution, true);
          this.drawChunkGrid(this.currentState.template, true, resolution);
        }
        const rt = this.app.renderer.generateTexture(this.worldContainer, { resolution, region, multisample: PIXI.MSAA_QUALITY.NONE });
        try { captured = this.app.renderer.extract.canvas(rt) as HTMLCanvasElement; }
        finally { rt.destroy(true); }
      } finally {
        this.worldContainer.scale.set(sx, sy);
        this.worldContainer.position.set(px, py);
        hidden.forEach((c, i) => { c.visible = prevVisible[i]!; });
        this.requestRender();
      }
      return captured;
    } catch {
      return null;
    } finally {
      recull();
    }
  }

  /** Detached layers preserve the live camera, culling and sprites while capturing another state.
   *  Thumbnails frame the saved island or an explicit crop, excluding the surrounding grid sea.
   *  Icons, road tiles and the road-band clipper must be ready before this single-pass capture. */
  async captureState(state: GridState, maxPx = 640, frame?: CellFrame, opts?: { annotations?: boolean }): Promise<HTMLCanvasElement | null> {
    const icons = new Set<string>();
    const tiles = new Set<string>();
    let banded = false;
    for (const obj of state.objects.values()) {
      const item = getCatalogItem(obj.catalogId);
      if (item?.roadMaterial) banded = true;
      const url = objectSpriteUrl(obj, item);
      if (url) icons.add(url);
      // A road carries a colour, so it has no sprite url — its art reaches the map as the fill of
      // its surface instead, one tile per material.
      const tile = isCoatingItem(item) ? item!.icon : undefined;
      const tileUrl = tile ? iconUrl(tile) : undefined;
      if (tileUrl) tiles.add(tileUrl);
    }
    await Promise.all([
      decodeIcons(icons), ...[...tiles].map((url) => roadTileReady(url)), ...(banded ? [roadMaterialSettled()] : []),
    ]);
    if (this.destroyed) return null;

    const base = new BaseLayer();
    const terrain = new TerrainLayer();
    const objects = new ObjectLayer();
    // A capture renders explicitly (generateTexture, below) — no draw call here owes anyone a
    // render window.
    base.requestRender = () => {};
    terrain.requestRender = () => {};
    objects.requestRender = () => {};
    const world = new PIXI.Container();
    world.addChild(base.container, terrain.container, objects.container);
    try {
      base.drawFull(state);
      terrain.drawFull(state);
      objects.sync(state.objects, state);
      // sync only QUEUES the road surfaces for the next frame, and this capture has none: the world
      // is rasterized below and destroyed on the way out. Draw them now, as every other capture does.
      objects.flushRoadRegions();
      // Opt-in plan notes, drawn by the real annotation layer. A fresh layer fades notes in over a
      // few frames and this capture has exactly one, so every part is settled to opaque by hand.
      if (opts?.annotations && state.annotations?.items.length) {
        const notes = new AnnotationLayer();
        notes.requestRender = () => {};
        world.addChild(notes.container);
        notes.draw(state.annotations, {
          draft: null, selectionIds: [], inkScale: annotationInkScale(state.template),
          tagLabel: (tag) => tagLabel(tag, useEditorStore.getState().locale),
        });
        for (const pass of notes.container.children) {
          if (pass instanceof PIXI.Container) for (const part of pass.children) part.alpha = 1;
        }
      }

      const half = TILE_SIZE / 2;
      // Thumbnail framing excludes the surrounding reference-grid sea and retains terrain bleed.
      const box = frame ?? { x: 0, y: 0, width: state.template.width + 0.5, height: state.template.height + 0.5 };
      const region = new PIXI.Rectangle(
        box.x * TILE_SIZE - half, box.y * TILE_SIZE - half,
        box.width * TILE_SIZE, box.height * TILE_SIZE,
      );
      if (region.width <= 0 || region.height <= 0) return null;
      const resolution = Math.min(1, maxPx / Math.max(region.width, region.height));
      const rt = this.app.renderer.generateTexture(world, {
        resolution, region, multisample: PIXI.MSAA_QUALITY.NONE,
      });
      const canvas = this.app.renderer.extract.canvas(rt) as HTMLCanvasElement;
      rt.destroy(true);
      return canvas;
    } catch {
      return null;
    } finally {
      // The icon textures are shared with the live scene and with the next capture, so only the
      // nodes go.
      world.destroy({ children: true, texture: false, baseTexture: false });
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.clearHeartbeat();
    this.notifyPainted();  // a destroyed renderer never draws again; a waiter must not hang on it
    for (const off of this.busSubscriptions) off();
    this.busSubscriptions = [];
    cancelAnimationFrame(this.labelBuildRaf);
    cancelAnimationFrame(this.numbersRefreshRaf);
    this.overlayLayer.endPlanetFlash();
    this.detachRequester();
    const canvas = this.app.view as HTMLCanvasElement;
    this.app.destroy(false, { children: true });
    canvas.parentElement?.removeChild(canvas);
  }

  private drawLabels(state: GridState): void {
    cancelAnimationFrame(this.labelBuildRaf);
    this.labelsContainer.removeChildren();

    const frame = mapFrame(state.template);
    const { columns, rows } = mapChunkAxes(state.template);
    const fontSize = 400;
    const textStyle = { fontSize, fill: 0x000000, fontFamily: APP_FONT_FAMILY, fontWeight: 'bold' as const };

    // Precompute the label specs (cheap); the cost is PIXI.Text rasterization.
    interface Spec { label: string; x: number; y: number; ax: number; ay: number; }
    const specs: Spec[] = [];
    for (let row = 0; row < rows.length; row++) {                 // row letters A,B,C… (left)
      specs.push({
        label: String.fromCharCode(65 + (row % 26)), x: frame.x * TILE_SIZE - fontSize * 1.5,
        y: rows[row]!.center * TILE_SIZE, ax: 0, ay: 0.5,
      });
    }
    for (let col = 0; col < columns.length; col++) {                 // column numbers 1,2,3… (bottom)
      specs.push({
        label: String(col + 1),
        x: columns[col]!.center * TILE_SIZE,
        y: (frame.y + frame.height) * TILE_SIZE + fontSize * 0.3, ax: 0.5, ay: 0,
      });
    }

    // PIXI.Text rasterizes at 400px on first render — ~20 of them in one frame is
    // the opening's remaining stall. Add a couple per frame + render between, so
    // the rasterization spreads across frames. They're faint (0.12) watermarks, so
    // appearing progressively over a few frames is imperceptible.
    let i = 0;
    const step = (): void => {
      if (this.destroyed || this.currentState !== state) return;
      for (let k = 0; k < 2 && i < specs.length; k++, i++) {
        const s = specs[i]!;
        const text = new PIXI.Text(s.label, textStyle);
        text.alpha = 0.12;
        text.anchor.set(s.ax, s.ay);
        text.x = s.x;
        text.y = s.y;
        this.labelsContainer.addChild(text);
      }
      this.requestRender();
      if (i < specs.length) this.labelBuildRaf = requestAnimationFrame(step);
    };
    step();
  }

  /** The probe's one answer per page load. A WebGL probe context is not free — on a software
   *  rasterizer it costs most of a second — and the help figures construct a renderer per demo,
   *  so an unmemoized probe pays that once per figure. */
  private static webglProbe: boolean | null = null;

  private static isWebGLAvailable(): boolean {
    if (MapRenderer.webglProbe !== null) return MapRenderer.webglProbe;
    let ok = false;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const maxUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
        ok = maxUniforms > 0;
        // The probe context is done answering; releasing it keeps it from holding one of the
        // browser's limited live-context slots for the rest of the session.
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch {
      ok = false;
    }
    MapRenderer.webglProbe = ok;
    return ok;
  }
}
