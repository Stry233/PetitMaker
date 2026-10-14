/**
 * Captures of the live 2D world: the whole map or an inclusive cell rect in its capture frame, an
 * export tile, and the plan notes or the grid alone on transparency. Every capture bakes the world
 * with the editor's transform reset and its chrome hidden, whatever the camera shows, and puts the
 * editor back as it stood.
 */
import * as PIXI from 'pixi.js-legacy';
import type { GridState } from '../../../core/model/types';
import { cellsCaptureFrame, mapCaptureFrame, type MapFrame } from '../../../core/grid/map-chunks';
import { TILE_SIZE } from '../geometry/world';
import type { AnnotationLayer } from '../layers/annotation-layer';
import type { OverlayLayer } from '../layers/overlay-layer';
import type { GridLayer } from '../layers/grid-layer';
import type { LabelLayer } from '../layers/label-layer';

/** What the captures read from the renderer that holds them. */
export interface LiveCaptureHost {
  readonly app: PIXI.Application;
  readonly worldContainer: PIXI.Container;
  readonly annotationLayer: AnnotationLayer;
  readonly overlayLayer: OverlayLayer;
  readonly gridLayer: GridLayer;
  readonly labelLayer: LabelLayer;
  /** The base, terrain and object layers' roots, which the single-layer captures hide. */
  readonly mapLayers: readonly PIXI.Container[];
  state(): GridState | null;
  /** Repaint pending edits and reveal every culled chunk; returns the re-cull for the live camera. */
  uncull(): () => void;
  flushDirtyChunks(): void;
  flushNumbers(): void;
  /** Put the editor's own grid back after a bake drew it at its resolution. */
  restoreGrid(): void;
  requestRender(): void;
}

export class LiveCapture {
  constructor(private readonly host: LiveCaptureHost) {}

  /** Longest side a render target may have here: the texture and the multisample renderbuffer
   *  ceilings both bound it, and the smaller one is what fails first on huge maps. */
  textureCap(): number {
    const glr = this.host.app.renderer as unknown as { gl?: WebGLRenderingContext };
    const gl = glr.gl && typeof glr.gl.getParameter === 'function' ? glr.gl : null;
    const maxTex = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 0;
    const maxRb = gl ? (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) : 0;
    const hardMax = Math.min(...[maxTex, maxRb].filter((v) => v && v > 0));
    return Number.isFinite(hardMax) ? hardMax : Infinity;
  }

  /** The map, or an inclusive saved-cell `rect` with terrain's half-cell bleed, at most `maxPx` on
   *  its long side. `annotations` overrides the notes layer's eye for this capture; omitted keeps
   *  the editor's. */
  mapCanvas(maxPx: number, includeGrid: boolean, rect?: { x1: number; y1: number; x2: number; y2: number }, annotations?: boolean): HTMLCanvasElement | null {
    const state = this.host.state();
    if (!state) return null;
    return this.withLiveWorld(state, annotations, () => {
      const { width, height } = state.template;
      let frame: MapFrame;
      if (rect) {
        const x1 = Math.max(0, Math.min(rect.x1, rect.x2));
        const y1 = Math.max(0, Math.min(rect.y1, rect.y2));
        const x2 = Math.min(width - 1, Math.max(rect.x1, rect.x2));
        const y2 = Math.min(height - 1, Math.max(rect.y1, rect.y2));
        if (x2 < x1 || y2 < y1) return null;
        frame = cellsCaptureFrame({ x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 });
      } else {
        frame = mapCaptureFrame(state.template);
      }
      const region = frameRegion(frame);
      if (region.width <= 0 || region.height <= 0) return null;
      // Clamp the request to the GPU limits so a native-resolution ("Original") request never
      // exceeds them (which would upload black); the achieved size is region*resolution.
      return this.bake(region, this.resolutionFor(region, maxPx), this.chrome(includeGrid));
    });
  }

  /** An export tile: `region` in px relative to the capture frame, its sea margin or terrain bleed
   *  included, at `resolution`. */
  regionCanvas(
    region: { x: number; y: number; w: number; h: number }, resolution: number, includeGrid: boolean, annotations?: boolean,
  ): HTMLCanvasElement | null {
    const state = this.host.state();
    if (!state) return null;
    return this.withLiveWorld(state, annotations, () => {
      const frame = mapCaptureFrame(state.template);
      const world = new PIXI.Rectangle(region.x + frame.x * TILE_SIZE, region.y + frame.y * TILE_SIZE, region.w, region.h);
      if (world.width <= 0 || world.height <= 0) return null;
      return this.bake(world, resolution, this.chrome(includeGrid));
    });
  }

  /**
   * The plan-notes ink alone, for the stylize compose step that lays the user's ink back over a
   * redrawn map bitmap. Every other layer is hidden, and a fresh render target clears to
   * transparent (the paper only appears in other captures because the base layer fills the region
   * opaquely), so nothing but ink paints. An empty notes layer would capture as a blank sheet the
   * compose step cannot use, so a map without notes returns null.
   */
  annotationsCanvas(maxPx: number): HTMLCanvasElement | null {
    const state = this.host.state();
    if (!state || (state.annotations?.items.length ?? 0) === 0) return null;
    const notes = this.host.annotationLayer.container;
    const prev = notes.visible;
    notes.visible = true;
    try {
      this.host.flushNumbers();
      const { overlayLayer, gridLayer, labelLayer } = this.host;
      return this.layerCanvas(state, maxPx, [...this.host.mapLayers, gridLayer.container, overlayLayer.container, labelLayer.container]);
    } finally {
      notes.visible = prev;
    }
  }

  /** The grid alone (sub, cell and chunk lines), transparent everywhere else: the layer the stylize
   *  compose step lays over a redrawn map so a stylized export keeps the grid a plain one bakes in.
   *  Forced on for the bake whatever the editor shows; the chunk labels stay hidden, since the
   *  composition draws its own legend outside the map. */
  gridCanvas(maxPx: number): HTMLCanvasElement | null {
    const state = this.host.state();
    if (!state) return null;
    const { annotationLayer, overlayLayer, labelLayer } = this.host;
    return this.layerCanvas(state, maxPx, [...this.host.mapLayers, annotationLayer.container, overlayLayer.container, labelLayer.container]);
  }

  /** Runs a capture of the live world as it is: every chunk revealed and repainted, the notes'
   *  eye overridden when asked, and both put back however the capture ends. */
  private withLiveWorld(state: GridState, annotations: boolean | undefined, capture: () => HTMLCanvasElement | null): HTMLCanvasElement | null {
    const recull = this.host.uncull();
    const notes = this.host.annotationLayer.container;
    const prevAnnotations = notes.visible;
    if (annotations !== undefined) notes.visible = annotations && (state.annotations?.items.length ?? 0) > 0;
    try {
      // The live containers again: a hidden canvas holds its chunk repaints, and this bake must
      // show the map as it is.
      this.host.flushDirtyChunks();
      this.host.flushNumbers();
      return capture();
    } catch {
      return null;
    } finally {
      notes.visible = prevAnnotations;
      recull();
    }
  }

  /** The whole capture frame with `hidden` layers off, on transparency. */
  private layerCanvas(state: GridState, maxPx: number, hidden: PIXI.Container[]): HTMLCanvasElement | null {
    const recull = this.host.uncull();
    try {
      const region = frameRegion(mapCaptureFrame(state.template));
      if (region.width <= 0 || region.height <= 0) return null;
      return this.bake(region, this.resolutionFor(region, maxPx), hidden);
    } catch {
      return null;
    } finally {
      recull();
    }
  }

  /** The editor chrome a map capture hides: the tool overlay and the chunk labels always, and the
   *  reference grid unless the export bakes it. */
  private chrome(includeGrid: boolean): PIXI.Container[] {
    const { overlayLayer, gridLayer, labelLayer } = this.host;
    return includeGrid
      ? [overlayLayer.container, labelLayer.container]
      : [gridLayer.container, overlayLayer.container, labelLayer.container];
  }

  private resolutionFor(region: PIXI.Rectangle, maxPx: number): number {
    return Math.min(1, Math.min(maxPx, this.textureCap()) / Math.max(region.width, region.height));
  }

  /**
   * Renders `region` of the world at `resolution` into a canvas with `hidden` off. A capture that
   * keeps the reference grid bakes the same grid the editor draws (sub, cell and chunk lines) at
   * the capture's resolution, and the editor's own grid is put back after.
   */
  private bake(region: PIXI.Rectangle, resolution: number, hidden: PIXI.Container[]): HTMLCanvasElement | null {
    const { app, worldContainer: world, annotationLayer, gridLayer } = this.host;
    const grid = !hidden.includes(gridLayer.container);
    if (grid) gridLayer.drawForCapture(resolution);
    const prevVisible = hidden.map((c) => c.visible);
    // generateTexture bakes the container's current transform, so the editor's pan/zoom would render
    // the map small and off-corner inside the region. Reset to identity for the capture (the map's
    // local content then fills the template region), restore after.
    const sx = world.scale.x, sy = world.scale.y;
    const px = world.position.x, py = world.position.y;
    hidden.forEach((c) => { c.visible = false; });
    annotationLayer.setCellPixels(resolution * TILE_SIZE, true);
    world.scale.set(1, 1);
    world.position.set(0, 0);
    world.updateTransform(); // ensure the identity matrix is current before generateTexture bakes it
    try {
      // No multisample: MSAA is invisible on an export and its renderbuffer has the smaller ceiling.
      const rt = app.renderer.generateTexture(world, { resolution, region, multisample: PIXI.MSAA_QUALITY.NONE });
      try { return app.renderer.extract.canvas(rt) as HTMLCanvasElement; }
      finally { rt.destroy(true); }
    } finally {
      world.scale.set(sx, sy);
      world.position.set(px, py);
      annotationLayer.setCellPixels(sx * TILE_SIZE, true);
      hidden.forEach((c, i) => { c.visible = prevVisible[i]!; });
      if (grid) this.host.restoreGrid();
      this.host.requestRender();
    }
  }
}

function frameRegion(frame: MapFrame): PIXI.Rectangle {
  return new PIXI.Rectangle(frame.x * TILE_SIZE, frame.y * TILE_SIZE, frame.width * TILE_SIZE, frame.height * TILE_SIZE);
}
