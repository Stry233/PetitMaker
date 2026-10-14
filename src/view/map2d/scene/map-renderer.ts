import { viewportRect } from '../../../platform/device/viewport-space';
import * as PIXI from 'pixi.js-legacy';
import '@pixi/unsafe-eval'; // self-installs on import (7.1+) and keeps strict-CSP shader builds
import type { ActiveView } from '../../../tools/pointer/runtime';
import type { EventBus } from '../../../core/commands/event-bus';
import type { GridState, MacroCoord } from '../../../core/model/types';
import type { EditorEvents } from '../../../state/editing/events';
import { ZOOM_STEP } from '../../shared/viewport/view-constants';
import { TILE_SIZE } from '../geometry/world';
import { FrameLoop, listenAll } from '../../shared/viewport/frame-loop';
import { WATER_COLOR } from '../../../core/model/palette';
import { getCell } from '../../../core/model/grid-model';
import { pageZoom } from '../../../platform/device/page-zoom';
import { hexStringToNumber } from '../../../core/base/color';
import { hasUsableWebGL, maxRenderScale } from '../../../platform/device/device-quality';
import { BaseLayer } from '../layers/base-layer';
import { resolveHistoryFlash } from '../../shared/overlay/error-flash';
import { cullRect } from '../layers/chunk-grid';
import { TerrainLayer } from '../layers/terrain-layer';
import { ObjectLayer } from '../layers/object-layer';
import { AnnotationLayer } from '../layers/annotation-layer';
import { OverlayLayer } from '../layers/overlay-layer';
import { GridLayer } from '../layers/grid-layer';
import { LabelLayer } from '../layers/label-layer';
import { LiveCapture } from '../capture/live-capture';
import { captureDetachedState, type DetachedCaptureOptions } from '../capture/detached-capture';
import { DEFAULT_CAPTURE_PX, type MapCaptureOptions } from '../../map-capture';
import type { PassiveOverlays, ViewSettingsTarget } from '../../shared/viewport/view-settings';
import { Viewport } from '../camera/viewport';
import { animateCamera, type CameraTweenHandle } from '../camera/tween';
import { MISSED_RENDER_CHECK, MissedRenderCheck, viewFrameReader } from './missed-render-check';
import { watchContextLoss } from '../../shared/gl/context-loss';
import { TERRAIN_GRID } from '../../../core/game/profile';
import { cellsOn } from '../../../core/grid/grid-convert';

// Sprites snap to whole device pixels: at fractional zooms an icon otherwise samples between
// pixels, a uniform blur no texture LOD can fix.
PIXI.settings.ROUND_PIXELS = true;

export class MapRenderer implements ViewSettingsTarget {
  public readonly app: PIXI.Application;
  public readonly viewport: Viewport;
  // The layers are this renderer's own: callers reach them through `asEditorView` and the verbs below.
  private readonly worldContainer: PIXI.Container;
  private readonly baseLayer: BaseLayer;
  private readonly terrainLayer: TerrainLayer;
  private readonly objectLayer: ObjectLayer;
  private readonly annotationLayer: AnnotationLayer;
  private readonly overlayLayer: OverlayLayer;
  private readonly gridLayer = new GridLayer();
  private readonly labelLayer = new LabelLayer(() => this.requestRender());

  private readonly eventBus: EventBus<EditorEvents>;
  private currentState: GridState | null = null;

  /** The ticker sleeps between requested frames. */
  private readonly frames = new FrameLoop(() => {
    this.restCheck?.cancel();
    if (this.presenting || this.frames.awaitingPaint) this.app.ticker.start();
  });
  private destroyed = false;
  /** The camera glide in flight (a zoom button, the fit), cancelled by the next and by `destroy`. */
  private readonly glide: CameraTweenHandle = { cancel: null };
  private readonly restCheck: MissedRenderCheck | null;
  /** Whether this canvas is the view on screen. Hidden under the 3D view the loop draws nothing,
   *  dirty chunks accumulate, and the first presented frame (or a capture) flushes them. */
  private presenting = true;

  /** Detaches this renderer's bus handlers. */
  private detachBus: () => void = () => {};

  /** Told when a lost WebGL context never comes back; the owner rebuilds the renderer on a fresh one. */
  onUnrecoverableLoss: (() => void) | null = null;
  private unwatchContext: () => void = () => {};

  /** Opens the render window (coalesced, spam-safe); every scene mutation and canvas-animation
   *  frame calls it. */
  requestRender = (): void => {
    if (this.destroyed) return;
    this.frames.request();
  };

  private restTicker(): void {
    this.app.ticker.stop();
  }

  /** Presented or not, decided by `PixiCanvas` from the view mode. Coming back on screen opens the
   *  render window, which flushes whatever the hidden stretch accumulated. */
  setPresenting(on: boolean): void {
    if (this.presenting === on) return;
    this.presenting = on;
    if (on) this.requestRender();
    else {
      this.restCheck?.cancel();
      if (!this.frames.awaitingPaint) this.app.ticker.stop();
    }
  }

  private renderTick = (): void => {
    if (!this.presenting && !this.frames.awaitingPaint) { this.restTicker(); return; }
    const painted = this.frames.advance();
    if (painted) {
      this.flushDirtyChunks();
      this.app.render();
      this.frames.painted();
    }
    if (!this.frames.isOpen) {
      this.restTicker();
      if (painted && this.presenting) this.restCheck?.rested();
    }
  };

  /** Repaint the chunks the edits since the last frame dirtied, zone colours and terrain alike. */
  private flushDirtyChunks(): void {
    if (!this.currentState) return;
    this.baseLayer.flushDirty(this.currentState);
    this.terrainLayer.flushDirty(this.currentState);
  }

  /** Runs `cb` after the next frame this renderer draws. */
  onNextPaint(cb: () => void): void {
    this.frames.onNextPaint(cb);
  }

  constructor(
    eventBus: EventBus<EditorEvents>,
    container: HTMLElement,
    width: number,
    height: number,
    opts?: {
      /** Takes pixi's Canvas2D renderer without asking for WebGL: on a software rasterizer a GL
       *  context costs seconds per figure-sized canvas, and Canvas2D is the renderer a WebGL-less
       *  browser gets anyway. */
      preferCanvas?: boolean;
    },
  ) {
    this.eventBus = eventBus;

    const useCanvas = opts?.preferCanvas === true || !hasUsableWebGL();
    this.app = new PIXI.Application({
      width,
      height,
      background: hexStringToNumber(WATER_COLOR),
      antialias: true,
      resolution: maxRenderScale(),
      autoDensity: true,
      forceCanvas: useCanvas,
      preserveDrawingBuffer: true,
      autoStart: false,
      // Nothing in the scene is a Pixi event target: the pointer machine listens on the container
      // and hit-tests through state/object-index, and Pixi's own event system would walk the whole
      // display list on every pointermove.
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    container.appendChild(this.app.view as HTMLCanvasElement);
    // The Canvas2D renderer has no context to lose.
    const gl = (this.app.renderer as { gl?: WebGLRenderingContext }).gl;
    if (gl) {
      this.unwatchContext = watchContextLoss(this.app.view as HTMLCanvasElement, {
        isLost: () => gl.isContextLost(),
        onUnrecovered: () => this.onUnrecoverableLoss?.(),
      });
    }

    this.worldContainer = new PIXI.Container();
    this.restCheck = MISSED_RENDER_CHECK
      ? new MissedRenderCheck(viewFrameReader(this.app.view as HTMLCanvasElement), () => { this.flushDirtyChunks(); this.app.render(); })
      : null;

    // Each layer opens this renderer's window, so a Help figure's animation never wakes the editor.
    this.baseLayer = new BaseLayer(this.requestRender);
    this.terrainLayer = new TerrainLayer(this.requestRender);
    this.objectLayer = new ObjectLayer({ state: () => this.currentState, requestRender: this.requestRender });
    this.annotationLayer = new AnnotationLayer(this.requestRender);
    this.overlayLayer = new OverlayLayer(this.requestRender);
    this.overlayLayer.setShapeSource((x, y) =>
      (this.currentState ? getCell(this.currentState.cells, x, y)?.terrain : null) ?? null);

    // Notes sit over the map and its grid and labels, under the tool feedback.
    this.worldContainer.addChild(
      this.baseLayer.container,
      this.terrainLayer.container,
      this.objectLayer.container,
      this.gridLayer.container,
      this.labelLayer.container,
      this.annotationLayer.container,
      this.overlayLayer.container,
    );

    this.app.stage.addChild(this.worldContainer);

    this.viewport = new Viewport(width, height);
    // Read at use: the dock slide moves the box without resizing it, so a recorded origin goes stale.
    this.viewport.setOriginSource(() => {
      const rect = viewportRect(container);
      return { x: rect.left, y: rect.top };
    });

    // The bus outlives any one renderer (StrictMode remounts the canvas), so destroy() detaches these.
    this.detachBus = listenAll(eventBus, {
      'cells-changed': (data) => {
        if (!this.currentState) return;
        const cells = cellsOn(data.cells, TERRAIN_GRID);
        this.baseLayer.redrawCells(cells, this.currentState);
        this.terrainLayer.redrawCells(cells, this.currentState);
        this.refreshNumbers(cells);
        this.requestRender();
      },
      'objects-changed': (data) => {
        if (data.removed) this.objectLayer.removeObjects(data.removed);
        if (data.added) this.objectLayer.addObjects(data.added);
        this.refreshNumbers();
        this.requestRender();
      },
      'validation-failed': (data) => {
        this.overlayLayer.flashErrors(data.errors);
        this.requestRender();
      },
      // Latest-wins, so a burst of undos flashes once.
      'history-applied': ({ cells, objects }) => {
        this.overlayLayer.flashCommit(resolveHistoryFlash(cells, objects));
        this.requestRender();
      },
    });

    // Pixi adds its own ungated `app.render` to the ticker at construction, whatever `autoStart`
    // says; left there it draws every frame beside renderTick, which must be the only drawer.
    this.app.ticker.remove(this.app.render, this.app);
    this.app.ticker.add(this.renderTick);
    this.app.ticker.start();
    this.requestRender();
  }

  initMap(state: GridState, showGrid: boolean, showChunks?: boolean, opts?: { labels?: boolean }): void {
    this.currentState = state;
    this.gridLayer.setMap(state.template, showGrid, showChunks ?? false);
    this.requestRender();
    this.baseLayer.drawFull(state);
    this.terrainLayer.drawFull(state);
    this.objectLayer.sync(state.objects);

    this.viewport.fitToMap(state.template.width, state.template.height);
    this.applyViewportTransform();

    // The grid and then the chunk labels follow the first paint, a frame apart, so no frame carries
    // their tessellation and text rasters together; a newer map or a teardown skips them.
    const current = (): boolean => !this.destroyed && this.currentState === state;
    requestAnimationFrame(() => {
      if (!current()) return;
      this.gridLayer.redraw(this.viewport.getZoom());
      this.requestRender();
      // A figure opts out: the labels sit outside the map, and their rasters are this pass's cost.
      if (opts?.labels === false) return;
      requestAnimationFrame(() => {
        if (!current()) return;
        this.labelLayer.build(state.template, current);
        this.requestRender();
      });
    });
  }

  /** Reconciles the object layer with the map after a bulk commit (Generate, Clear, a macro press).
   *  Every mutation emits its own `objects-changed`, so this is a backstop. */
  resyncObjects(): void {
    if (!this.currentState) return;
    this.objectLayer.sync(this.currentState.objects);
    this.refreshNumbers();
    this.requestRender();
  }

  /** The passive overlays last given, so a toggle repaints only what it changed. */
  private passive: PassiveOverlays | null = null;

  /** The Settings toggles: the grid and chunk bounds, and the layer numbers. */
  setPassiveOverlays(flags: PassiveOverlays): void {
    const prev = this.passive;
    this.passive = { ...flags };
    if (this.currentState && (!prev || prev.grid !== flags.grid || prev.chunks !== flags.chunks)) {
      this.gridLayer.setVisibility(flags.grid, flags.chunks, this.viewport.getZoom());
      this.requestRender();
    }
    if (!prev || prev.numbers !== flags.numbers) this.setShowLayerNumbers(flags.numbers);
  }

  private numbersRefreshRaf = 0;

  /** Refreshes the layer-number overlay after an edit, only while it is shown. The dirty mark is
   *  synchronous, so a capture that draws numbers itself rebuilds; the repaint coalesces to one per
   *  frame, since this runs once per command. With `cells`, only their chunk rasters repaint. */
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

  /** Builds every chunk of the number overlay now: a capture bakes the whole world at once. */
  private flushNumbers(): void {
    if (!this.currentState || !this.terrainLayer.isShowingNumbers()) return;
    if (this.terrainLayer.drawNumbers(this.currentState, 'all')) this.mountNumberContainer();
  }

  /** Layer visibility from the panel: only the affected cells redraw, and the number raster, which
   *  bakes visibility, is rebuilt. */
  setLayerVisibility(visibility: Readonly<Record<number, boolean>>): void {
    this.terrainLayer.applyLayerVisibility(this.currentState, visibility);
    this.objectLayer.setLayerVisibility(visibility);
    this.terrainLayer.markNumbersDirty();
    if (this.currentState && this.terrainLayer.drawNumbers(this.currentState)) this.mountNumberContainer();
  }

  /** The layer-number toggle: swaps the number raster and the per-object labels, never terrain. */
  private setShowLayerNumbers(on: boolean): void {
    this.terrainLayer.setShowNumbers(on);
    this.objectLayer.setShowNumbers(on);
    this.terrainLayer.markNumbersDirty();
    if (!this.currentState) return;
    this.terrainLayer.drawNumbers(this.currentState);
    this.mountNumberContainer();
  }

  /** The plan-notes layer, drawn whole. */
  drawAnnotations(...args: Parameters<AnnotationLayer['draw']>): void {
    this.annotationLayer.draw(...args);
  }

  /** Mounts the number overlay just above the terrain layer. */
  private mountNumberContainer(): void {
    const nc = this.terrainLayer.numberContainer;
    if (nc.parent) nc.parent.removeChild(nc);
    const terrainIdx = this.worldContainer.getChildIndex(this.terrainLayer.container);
    this.worldContainer.addChildAt(nc, terrainIdx + 1);
  }

  /** This renderer as the tool layer's active view, built once: the viewport's projection, the Pixi
   *  overlay, and camera verbs that move the viewport and re-apply its transform. */
  asEditorView(): ActiveView {
    this.editorView ??= this.buildEditorView();
    return this.editorView;
  }

  private editorView: ActiveView | null = null;

  private buildEditorView(): ActiveView {
    return {
      projection: this.viewport,
      overlay: this.overlayLayer,
      rendersState: () => this.currentState,
      onNextPaint: (cb: () => void) => this.onNextPaint(cb),
      plopObject: (id: string) => this.objectLayer.requestPlop(id),
      animateRotation: (id, from, to, onFrame) => this.objectLayer.animateRotation(id, from, to, onFrame),
      animateGroupRotation: (turn, onFrame) => this.objectLayer.animateGroupRotation(turn, onFrame),
      animateRemove: (id: string) => this.objectLayer.animateRemove(id),
      camera: {
        pan: (dx, dy) => {
          this.viewport.pan(dx, dy);
          this.applyViewportTransform();
        },
        zoomStep: (dir, ax, ay) => {
          this.viewport.setZoom(this.viewport.getZoom() * ZOOM_STEP.notch.map2d ** dir, ax, ay);
          this.applyViewportTransform();
        },
        // The camera buttons glide about the map box centre, as the 3D camera dollies about its
        // target, rather than jump.
        zoomStepAnimated: (dir) => {
          animateCamera(this, this.glide, (r) => r.viewport.setZoomAtCentre(r.viewport.getZoom() * ZOOM_STEP.button ** dir));
        },
        fitToMap: () => {
          const template = this.currentState?.template;
          if (template) animateCamera(this, this.glide, (r) => r.viewport.fitToMap(template.width, template.height));
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
    if (this.currentState) this.gridLayer.follow(zoom);
    const rect = this.cullLayers(zoom, offset);
    // The number overlay hides and frees its rasters when zoomed out, builds chunks the camera
    // reaches, and does nothing on a plain pan.
    this.terrainLayer.setNumberZoom(zoom);
    if (this.currentState && this.terrainLayer.drawNumbers(this.currentState, rect)) {
      this.mountNumberContainer();
    }
    this.objectLayer.updateLod(zoom, this.app.renderer.resolution);
    this.objectLayer.setNumberZoom(zoom);
    this.overlayLayer.setViewZoom(zoom);
    this.annotationLayer.setCellPixels(zoom * TILE_SIZE);
    this.eventBus.emit('viewport-changed', { zoom });
    this.requestRender();
  }

  /** Shows only the terrain and object chunks the camera rect reaches: Pixi has no culling of its
   *  own, and every frame would otherwise walk the whole map. */
  private cullLayers(zoom: number, offset: { x: number; y: number }) {
    const rect = cullRect(offset.x, offset.y, zoom, this.app.renderer.screen.width, this.app.renderer.screen.height);
    this.terrainLayer.cull(rect);
    this.objectLayer.cull(rect);
    return rect;
  }

  private lastPageZoom = pageZoom();

  /**
   * Follows the box the interface gives the map, keeping the world point at the box centre where
   * it was, as the 3D camera does; the dock slide then moves nothing on screen. The anchor is read
   * before the page-zoom rebase, which redefines the css px. Where the box stands is read by the
   * projection at use.
   */
  resize(width: number, height: number): void {
    const centre = this.viewport.worldAtCentre();
    // A page-zoom step arrives as a resize; an ordinary window resize leaves the factor unchanged.
    const zoom = pageZoom();
    if (zoom !== this.lastPageZoom) {
      this.viewport.rebaseForPageZoom(zoom / this.lastPageZoom);
      this.lastPageZoom = zoom;
    }
    this.app.renderer.resize(width, height);
    this.viewport.resize(width, height);
    this.viewport.centreOn(centre);
    // The resize moved the camera (anchor, rebase, clamp), so the stage takes it now.
    this.applyViewportTransform();
    // Buffer allocation clears the canvas; paint before ResizeObserver returns to the compositor.
    this.renderTick();
  }

  /** Reveals every culled chunk for a capture, which renders the whole map whatever the camera
   *  shows, after repainting pending edits and road surfaces. Returns the re-cull. */
  private uncullForCapture(): () => void {
    this.flushDirtyChunks();
    this.objectLayer.flushRoadRegions();
    const everything = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    this.terrainLayer.cull(everything);
    this.objectLayer.cull(everything);
    return () => this.cullLayers(this.viewport.getZoom(), this.viewport.getOffset());
  }

  /** The live-world captures (`capture/live-capture.ts`). */
  private liveCapture: LiveCapture | null = null;
  private get live(): LiveCapture {
    return this.liveCapture ??= new LiveCapture({
      app: this.app,
      worldContainer: this.worldContainer,
      annotationLayer: this.annotationLayer,
      overlayLayer: this.overlayLayer,
      gridLayer: this.gridLayer,
      labelLayer: this.labelLayer,
      mapLayers: [this.baseLayer.container, this.terrainLayer.container, this.objectLayer.container],
      state: () => this.currentState,
      uncull: () => this.uncullForCapture(),
      flushDirtyChunks: () => this.flushDirtyChunks(),
      flushNumbers: () => this.flushNumbers(),
      restoreGrid: () => { if (this.currentState) this.gridLayer.redraw(this.viewport.getZoom()); },
      requestRender: () => this.requestRender(),
    });
  }

  /** The live map as `options` describe it (`view/map-capture.ts`). A `complete` capture shows
   *  every layer, hidden ones included, as a saved map holds them. */
  capture(options: MapCaptureOptions = {}): HTMLCanvasElement | null {
    const { content = 'map', maxPx = DEFAULT_CAPTURE_PX, grid = false, annotations, rect, tile } = options;
    switch (content) {
      case 'notes': return this.live.annotationsCanvas(maxPx);
      case 'grid': return this.live.gridCanvas(maxPx);
      case 'complete': {
        const state = this.currentState;
        if (!state) return null;
        return this.terrainLayer.withAllLayersVisible(state, () =>
          this.objectLayer.withAllLayersVisible(() => this.capture({ ...options, content: 'map', annotations: annotations ?? true })));
      }
      case 'map':
        return tile
          ? this.live.regionCanvas(tile.region, tile.resolution, grid, annotations)
          : this.live.mapCanvas(maxPx, grid, rect, annotations);
    }
  }

  /** `capture` as a PNG data URL, or null when the capture or its encoding failed. */
  captureImage(options: MapCaptureOptions = {}): string | null {
    const canvas = this.capture(options);
    try { return canvas?.toDataURL('image/png') ?? null; } catch { return null; }
  }

  /** Longest side a render target may have here. */
  textureCap(): number {
    return this.live.textureCap();
  }

  /** Detached layers preserve the live camera, culling and sprites while capturing another state
   *  (`capture/detached-capture.ts`). */
  captureState(state: GridState, capture?: DetachedCaptureOptions): Promise<HTMLCanvasElement | null> {
    return captureDetachedState(this.app, () => this.destroyed, state, capture);
  }

  destroy(): void {
    this.destroyed = true;
    this.glide.cancel?.();
    this.unwatchContext();
    this.restCheck?.cancel();
    this.frames.painted();  // a destroyed renderer never draws again; a waiter must not hang on it
    this.detachBus();
    this.labelLayer.dispose();
    cancelAnimationFrame(this.numbersRefreshRaf);
    this.overlayLayer.dispose();
    const canvas = this.app.view as HTMLCanvasElement;
    this.app.destroy(false, { children: true });
    canvas.parentElement?.removeChild(canvas);
  }
}
