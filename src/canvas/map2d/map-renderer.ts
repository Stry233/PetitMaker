import * as PIXI from 'pixi.js-legacy';
import '@pixi/unsafe-eval'; // self-installs on import (7.1+) — keeps strict-CSP shader builds
import type { ActiveView } from '../view-projection';

// Snap sprite rendering to whole device pixels: at fractional zooms every icon
// otherwise samples BETWEEN pixels, a uniform slight blur no texture LOD can fix
// (the editor is a static scene, so per-frame snapping has no motion cost).
PIXI.settings.ROUND_PIXELS = true;
import type { EventBus } from '../../core/commands/event-bus';
import { CommandType } from '../../core/model/types';
import type { EditorEvents, GridState, MacroCoord } from '../../core/model/types';
import { CHUNK_SIZE, TILE_SIZE, WATER_COLOR } from '../../core/model/constants';
import { getCell } from '../../core/model/grid-model';
import { pageZoom } from '../../core/runtime/page-zoom';
import { hexStringToNumber } from '../../core/model/colors';
import { maxRenderScale } from '../../core/runtime/device-quality';
import { getCatalogItem } from '../../state/catalog';
import { decodeIcons } from './draw/icon-color';
import { BaseLayer } from './layers/base-layer';
import { resolveHistoryFlash } from './layers/error-flash';
import { cullRect } from './layers/chunk-grid';
import { TerrainLayer } from './layers/terrain-layer';
import { ObjectLayer, objectSpriteUrl } from './layers/object-layer';
import { OverlayLayer } from './layers/overlay-layer';
import { Viewport } from './viewport';
import { setRenderRequester } from './render-scheduler';


export class MapRenderer {
  public readonly app: PIXI.Application;
  public readonly worldContainer: PIXI.Container;
  public readonly baseLayer: BaseLayer;
  public readonly terrainLayer: TerrainLayer;
  public readonly objectLayer: ObjectLayer;
  public readonly overlayLayer: OverlayLayer;
  public readonly viewport: Viewport;

  private readonly eventBus: EventBus<EditorEvents>;
  private currentState: GridState | null = null;
  private chunkGridContainer = new PIXI.Container();
  private labelsContainer = new PIXI.Container();

  // ── Render-on-demand loop ─────────────────────────────────────────────────
  // The app does not auto-render; this ticker callback draws only while a render
  // window is open (requestRender refreshes it) so a static editor costs no GPU.
  // A low-frequency heartbeat is a safety floor: should some mutation path forget
  // to requestRender, the canvas still refreshes within a few frames rather than
  // going stale.
  private renderWindow = 0;            // frames left to render
  private framesIdle = 0;              // frames since the last draw
  private destroyed = false;           // guards deferred initMap work after teardown
  private labelBuildRaf = 0;           // incremental chunk-label build
  private showGrid = false;            // current editor grid visibility (restored after a grid capture)
  private showChunks = false;          // current editor chunk-grid visibility
  private static readonly HEARTBEAT_FRAMES = 15; // ~4fps safety floor

  /** Handlers registered on the shared bus, detached again in destroy(). */
  private busSubscriptions: Array<() => void> = [];

  private subscribe<K extends keyof EditorEvents>(event: K, handler: (data: EditorEvents[K]) => void): void {
    this.eventBus.on(event, handler);
    this.busSubscriptions.push(() => this.eventBus.off(event, handler));
  }

  /** Open the render window for a few frames (coalesced; spam-safe). Called by
   *  every scene mutation + every canvas-animation frame (via render-scheduler). */
  requestRender = (): void => { this.renderWindow = 4; };

  /** One-shot waiters for "a frame was actually DRAWN" (see onNextPaint). */
  private paintWaiters: Array<() => void> = [];

  private renderTick = (): void => {
    if (this.renderWindow > 0) {            // keep-alive window after a mutation/anim
      this.renderWindow--;
      this.framesIdle = 0;
      // Edits marked terrain chunks dirty (per command); repaint them once per
      // FRAME, right before the render that shows them. No-op when clean.
      if (this.currentState) this.terrainLayer.flushDirty(this.currentState);
      this.app.render();
      this.notifyPainted();
    } else if (++this.framesIdle >= MapRenderer.HEARTBEAT_FRAMES) {
      this.framesIdle = 0;
      if (this.currentState) this.terrainLayer.flushDirty(this.currentState);
      this.app.render();                      // ~4fps safety floor
      this.notifyPainted();
    }
  };

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
  ) {
    this.eventBus = eventBus;

    const useCanvas = !MapRenderer.isWebGLAvailable();
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
    this.overlayLayer = new OverlayLayer();
    this.overlayLayer.setShapeSource((x, y) =>
      (this.currentState ? getCell(this.currentState.cells, x, y)?.terrain : null) ?? null);

    this.worldContainer.addChild(this.baseLayer.container);
    this.worldContainer.addChild(this.terrainLayer.container);
    this.worldContainer.addChild(this.chunkGridContainer);
    this.worldContainer.addChild(this.objectLayer.container); // includes the plaza (a self-described locked object)
    this.worldContainer.addChild(this.overlayLayer.container);
    this.worldContainer.addChild(this.labelsContainer);

    this.app.stage.addChild(this.worldContainer);

    this.viewport = new Viewport(width, height);

    // Subscribe to EventBus events. Every handler is registered through
    // subscribe() so destroy() can detach them all: the bus outlives any one
    // renderer (React StrictMode remounts the canvas in dev), and a destroyed
    // renderer's handler acting on destroyed Pixi objects throws mid-dispatch.
    this.subscribe('cells-changed', (data) => {
      if (!this.currentState) return;
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
    // mashed-undo burst coalesces into one beat). Object-only steps flash each
    // item's footprint on the macro grid (no offset); everything else flashes
    // the terrain cells offset to the micro grid.
    this.subscribe('history-applied', ({ cells, objects }) => {
      const flash = resolveHistoryFlash(cells, objects);
      if (flash) this.overlayLayer.flashCommit(flash.cells, { terrainMode: flash.terrainMode });
      this.requestRender();
    });

    // Drive the render-on-demand loop and route every scene mutation /
    // animation frame (via render-scheduler) to open the render window.
    setRenderRequester(this.requestRender);
    this.app.ticker.add(this.renderTick);
    this.app.ticker.start();
    this.requestRender();
  }

  initMap(state: GridState, showGrid: boolean, showChunks?: boolean): void {
    this.currentState = state;
    this.showGrid = showGrid;
    this.showChunks = showChunks ?? false;
    this.requestRender();
    const { width, height } = state.template;

    this.baseLayer.drawFull(state);
    this.terrainLayer.drawFull(state);
    this.objectLayer.sync(state.objects);   // includes the plaza (self-described locked object)

    this.viewport.fitToMap(width, height);
    this.applyViewportTransform();        // first paint: the map (base + terrain + objects incl. plaza)

    // Defer the overlays past the first paint, spread across frames so no single
    // frame carries their whole cost: grid lines (tessellation) next frame, then
    // chunk labels (heavy text rasterization) the frame after. They aren't the
    // map; appearing a couple of frames later is imperceptible. The guard skips a
    // stale build if a newer map loaded or the renderer was torn down.
    const stale = (): boolean => this.destroyed || this.currentState !== state;
    requestAnimationFrame(() => {
      if (stale()) return;
      this.drawChunkGrid(width, height, showChunks ?? false);
      this.overlayLayer.drawGridLines(width, height, showGrid);
      this.requestRender();
      requestAnimationFrame(() => {
        if (stale()) return;
        this.drawLabels(state);
        this.requestRender();
      });
    });
  }

  private drawChunkGrid(mapWidth: number, mapHeight: number, visible: boolean): void {
    this.chunkGridContainer.removeChildren();
    if (!visible) return;

    const g = new PIXI.Graphics();
    g.lineStyle(2, 0x000000, 0.35);

    const totalW = mapWidth * TILE_SIZE;
    const totalH = mapHeight * TILE_SIZE;

    for (let cx = CHUNK_SIZE; cx < mapWidth; cx += CHUNK_SIZE) {
      const px = cx * TILE_SIZE;
      g.moveTo(px, 0);
      g.lineTo(px, totalH);
    }
    for (let cy = CHUNK_SIZE; cy < mapHeight; cy += CHUNK_SIZE) {
      const py = cy * TILE_SIZE;
      g.moveTo(0, py);
      g.lineTo(totalW, py);
    }

    this.chunkGridContainer.addChild(g);
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
    const { width, height } = this.currentState.template;
    this.overlayLayer.drawGridLines(width, height, showGrid);
    this.drawChunkGrid(width, height, showChunks);
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
    const rect = cullRect(offset.x, offset.y, zoom, this.app.renderer.screen.width, this.app.renderer.screen.height);
    this.terrainLayer.cull(rect);
    this.objectLayer.cull(rect);
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
    // Let screen-anchored React overlays (selection handles) re-track the view.
    this.eventBus.emit('viewport-changed', { zoom });
    this.requestRender();
  }

  /** Toggle terrain/object chunk visibility against the camera rect — Pixi has no built-in
   *  culling, so without this every rendered frame traverses every off-screen node too and
   *  pan/zoom cost scales with the map total instead of what's visible. O(chunks). */
  private cullLayers(zoom: number, offset: { x: number; y: number }): void {
    const rect = cullRect(offset.x, offset.y, zoom, this.app.renderer.screen.width, this.app.renderer.screen.height);
    this.terrainLayer.cull(rect);
    this.objectLayer.cull(rect);
  }

  private lastPageZoom = pageZoom();

  resize(width: number, height: number): void {
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
    // Push the camera to the stage rather than only re-culling: a resize can move the camera (the
    // page-zoom rebase, and the clamp that keeps the map on screen inside a smaller canvas). Left
    // in the model, that change would sit invisible until the next pan or zoom applied it, and the
    // map would jump then.
    this.applyViewportTransform();
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
    // pending terrain edits first or they'd be missing from the export.
    if (this.currentState) this.terrainLayer.flushDirty(this.currentState);
    const everything = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    this.terrainLayer.cull(everything);
    this.objectLayer.cull(everything);
    return () => this.cullLayers(this.viewport.getZoom(), this.viewport.getOffset());
  }

  captureFullMap(maxPx = 1024): string | null {
    const recull = this.uncullForCapture();
    try {
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

  /** Export-focused capture: a TIGHTLY-FRAMED PNG of just the map CONTENT (zones /
   *  terrain / objects) with the editor chrome hidden (no grid, chunk bounds,
   *  coordinates or chunk labels). Framed to the EXACT template region so the map
   *  fills the image — unlike captureFullMap, whose world-local bounds can include
   *  chrome that extends past the map and leaves it tiny in a corner. Long side
   *  capped at maxPx. Used by the export preview/compose pipeline. */
  captureMapImage(maxPx = 1024, includeGrid = false): string | null {
    if (!this.currentState) return null;
    const recull = this.uncullForCapture();
    try {
      this.flushNumbers();
      const { width, height } = this.currentState.template;
      const half = TILE_SIZE / 2;
      const region = new PIXI.Rectangle(-half, -half, width * TILE_SIZE + half, height * TILE_SIZE + half);
      if (region.width <= 0 || region.height <= 0) return null;
      // With grid ON, bake the SAME grid the editor draws (sub + cell + chunk lines) into the
      // capture so the export reuses the real 2D rendering. Chunk LABELS stay hidden — the export
      // composition draws its own legend outside the map. Restored to the editor state afterwards.
      if (includeGrid) {
        this.overlayLayer.drawGridLines(width, height, true);
        this.drawChunkGrid(width, height, true);
      }
      const chrome = includeGrid
        ? [this.labelsContainer]
        : [this.chunkGridContainer, this.overlayLayer.container, this.labelsContainer];
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
      let dataUrl: string | null = null;
      try {
        // Clamp the request to the GPU limits so a native-resolution ("Original") request never
        // exceeds them (which would upload black). Two separate limits matter: MAX_TEXTURE_SIZE
        // bounds the output texture, but the render target also allocates a MULTISAMPLE
        // renderbuffer whose ceiling is MAX_RENDERBUFFER_SIZE (often smaller) — that
        // allocation is what failed on huge maps ("glRenderbufferStorageMultisample: Texture
        // total allocation size is too large", leaving a zero-size framebuffer = blank map). Cap
        // to the smaller of the two, AND disable multisample for the capture (MSAA is invisible on
        // a downscaled export and only shrinks the safe size), so the offscreen target is a plain
        // texture. The achieved size is region*resolution — callers read it back from the image.
        const glr = this.app.renderer as unknown as { gl?: WebGLRenderingContext };
        const getP = glr.gl && typeof glr.gl.getParameter === 'function' ? glr.gl : null;
        const maxTex = getP ? (getP.getParameter(getP.MAX_TEXTURE_SIZE) as number) : 0;
        const maxRb = getP ? (getP.getParameter(getP.MAX_RENDERBUFFER_SIZE) as number) : 0;
        const hardMax = Math.min(...[maxTex, maxRb].filter((v) => v && v > 0));
        const cap = Number.isFinite(hardMax) ? Math.min(maxPx, hardMax) : maxPx;
        const resolution = Math.min(1, cap / Math.max(region.width, region.height));
        const rt = this.app.renderer.generateTexture(this.worldContainer, { resolution, region, multisample: PIXI.MSAA_QUALITY.NONE });
        const canvas = this.app.renderer.extract.canvas(rt) as HTMLCanvasElement;
        rt.destroy(true);
        dataUrl = canvas.toDataURL('image/png');
      } finally {
        this.worldContainer.scale.set(sx, sy);
        this.worldContainer.position.set(px, py);
        chrome.forEach((c, i) => { c.visible = prevVisible[i]!; });
        // Restore the editor's actual grid visibility (the capture may have forced it on).
        if (includeGrid) {
          this.overlayLayer.drawGridLines(width, height, this.showGrid);
          this.drawChunkGrid(width, height, this.showChunks);
        }
        this.requestRender();
      }
      return dataUrl;
    } catch {
      return null;
    } finally {
      recull();
    }
  }

  /**
   * A PNG-ready canvas of SOME OTHER map, drawn by this renderer.
   *
   * The generate shelf shows what a recipe builds before anything is built, and that picture has to
   * be the map the click produces. It is one map drawn twice otherwise, and two drawings of one
   * thing drift: the second one grew its own framing and its own idea of what an object looks like,
   * and the cards stopped resembling the island they promised.
   *
   * So the candidate is drawn by the real layers, off the stage. Three fresh layers over `state`
   * build into a detached container, this renderer's GPU context rasterizes it and the container is
   * thrown away — the live scene is never touched, so the map under the shelf keeps its camera, its
   * culling and its sprites. Framed to the template exactly, as `captureMapImage` frames an export:
   * the whole map, no chrome, which is the view the editor itself opens on.
   *
   * Asynchronous for one reason: the drawing itself is a single synchronous pass with no next
   * frame, so every icon on the map has to have decoded before it starts or those sprites are holes.
   */
  async captureState(state: GridState, maxPx = 640): Promise<HTMLCanvasElement | null> {
    const icons = new Set<string>();
    for (const obj of state.objects.values()) {
      const url = objectSpriteUrl(obj, getCatalogItem(obj.catalogId));
      if (url) icons.add(url);
    }
    await decodeIcons(icons);
    if (this.destroyed) return null;

    const base = new BaseLayer();
    const terrain = new TerrainLayer();
    const objects = new ObjectLayer();
    const world = new PIXI.Container();
    world.addChild(base.container, terrain.container, objects.container);
    try {
      base.drawFull(state);
      terrain.drawFull(state);
      objects.sync(state.objects, state);

      const { width, height } = state.template;
      const half = TILE_SIZE / 2;
      const region = new PIXI.Rectangle(-half, -half, width * TILE_SIZE + half, height * TILE_SIZE + half);
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
    this.notifyPainted();  // a destroyed renderer never draws again; a waiter must not hang on it
    for (const off of this.busSubscriptions) off();
    this.busSubscriptions = [];
    cancelAnimationFrame(this.labelBuildRaf);
    cancelAnimationFrame(this.numbersRefreshRaf);
    setRenderRequester(null);
    const canvas = this.app.view as HTMLCanvasElement;
    this.app.destroy(false, { children: true });
    canvas.parentElement?.removeChild(canvas);
  }

  private drawLabels(state: GridState): void {
    cancelAnimationFrame(this.labelBuildRaf);
    this.labelsContainer.removeChildren();

    const { width, height } = state.template;
    const chunksX = Math.ceil(width / CHUNK_SIZE);
    const chunksY = Math.ceil(height / CHUNK_SIZE);
    const fontSize = 400;
    const textStyle = { fontSize, fill: 0x000000, fontFamily: 'sans-serif', fontWeight: 'bold' as const };

    // Precompute the label specs (cheap); the cost is PIXI.Text rasterization.
    interface Spec { label: string; x: number; y: number; ax: number; ay: number; }
    const specs: Spec[] = [];
    for (let row = 0; row < chunksY; row++) {                 // row letters A,B,C… (left)
      specs.push({
        label: String.fromCharCode(65 + (row % 26)), x: -fontSize * 1.5,
        y: row * CHUNK_SIZE * TILE_SIZE + (CHUNK_SIZE * TILE_SIZE) / 2 - TILE_SIZE / 2, ax: 0, ay: 0.5,
      });
    }
    for (let col = 0; col < chunksX; col++) {                 // column numbers 1,2,3… (bottom)
      specs.push({
        label: String(col + 1),
        x: col * CHUNK_SIZE * TILE_SIZE + (CHUNK_SIZE * TILE_SIZE) / 2 - TILE_SIZE / 2,
        y: height * TILE_SIZE + fontSize * 0.3, ax: 0.5, ay: 0,
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

  private static isWebGLAvailable(): boolean {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return false;
      const maxUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
      return maxUniforms > 0;
    } catch {
      return false;
    }
  }
}
