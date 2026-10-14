/**
 * MapRenderer3D, the 3D view's WebGL scene. Builds a three.js scene from a GridState snapshot through
 * its parts (terrain chunks, road surfaces, object instances and their tweens, waterfall arrows,
 * notes and the legend), drives a render-on-demand loop (renders only while something moves or
 * the controls settle), and disposes everything on teardown.
 */
import { addProximityFade } from '../draw/proximity-fade';
import { LiteFrameBudget } from './lite-frame-budget';
import { viewportRect } from '../../../platform/device/viewport-space';
import { IS_LITE } from '../../../platform/build/edition';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { watchContextLoss } from '../../shared/gl/context-loss';
import { glQuality, canIncreaseRenderScale, type GlQuality } from '../../../platform/device/device-quality';
import { resolveHistoryFlash } from '../../shared/overlay/error-flash';
import { dirtyChunksFor } from '../geometry/chunk-dirty';
import { bodyRoute } from '../geometry/object-meshes';
import { visibilityView } from '../geometry/visibility-view';
import { pickSurface } from '../geometry/pick';
import type { GroupRotation } from '../../../tools/objects';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import { OverlayLayer3D } from '../layers/overlay-layer';
import { AnnotationLayer3D, type AnnotationLayer3DOpts } from '../layers/annotation-layer';
import type { AnnotationsState } from '../../../core/model/annotations';
import { Projection3D } from '../camera/projection';
import type { ActiveView, ViewCamera } from '../../../tools/pointer/runtime';
import { cellsAffectedByLayerToggle, hiddenSetFrom } from '../../shared/terrain/layer-visibility';
import type { PassiveOverlays, ViewSettingsTarget } from '../../shared/viewport/view-settings';
import type { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../state/editing/events';
import { leaseModelCaches } from '../models/cache-lease';
import type { CameraAngle } from '../../../state/view-camera';
import { islandBounds } from '../camera/controls';
import { SceneCamera, maxHeight } from '../camera/scene-camera';
import { layerToY, mapCenterOffset } from '../geometry/coords';
import { alignGridUniforms, createGridUniforms } from '../draw/grid-drape';
import { LabelLayer3D } from '../layers/label-layer';
import { ObjectLayer3D } from '../layers/object-layer';
import { ObjectMotion } from '../layers/object-motion';
import { RoadSurfaces3D } from '../layers/road-surfaces';
import { TerrainLayer3D } from '../layers/terrain-layer';
import { WaterfallArrows } from '../layers/waterfall-arrows';
import { HORIZON, addLights, setupShadows, skyBackground } from './environment';
import { Presenter } from './presenter';
import { DirtyFlags, FrameLoop, MOVE_WINDOW_FRAMES, listenAll } from '../../shared/viewport/frame-loop';
import { TERRAIN_GRID } from '../../../core/game/profile';
import { cellsOn } from '../../../core/grid/grid-convert';

export class MapRenderer3D implements ViewSettingsTarget {
  // three numbers objects and materials as they are created, and equal-depth draws break their ties
  // on those numbers, so the parts are created in a fixed order: the field initialisers in
  // declaration order, then the constructor body, whose `buildTerrain` creates the terrain and the
  // roads after the instances, the motion and the legend.
  private scene = new THREE.Scene();
  private releaseModelCaches = leaseModelCaches();
  private arrows = new WaterfallArrows();
  /** The plan-notes layer's own group; asks arrive through `setAnnotations` and re-drape with the
   *  terrain flush, since its heights are baked into its vertices. */
  private annotationLayer = new AnnotationLayer3D();
  private pendingAnnotations: { data: AnnotationsState | null; opts: AnnotationLayer3DOpts } | null = null;
  /** The remeshed chunks the notes have not re-draped over yet, or 'all' for a whole rebuild. */
  private annotationsTerrainDirty: Set<string> | 'all' | null = null;
  private presenter: Presenter;
  /** The presenter's renderer and the camera's own handles, read by the capture and model rigs. */
  private renderer: THREE.WebGLRenderer;
  private cam: SceneCamera;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private disposables: { dispose(): void }[] = [];
  private sun: THREE.DirectionalLight;
  private sharedMat: THREE.MeshLambertMaterial;
  private modelMat: THREE.MeshLambertMaterial;
  private gridUniforms = createGridUniforms();
  private passive = { grid: false, numbers: false, chunks: false };
  private terrain!: TerrainLayer3D;
  private roads!: RoadSurfaces3D;
  private instances: ObjectLayer3D;
  private motion: ObjectMotion;
  private legend: LabelLayer3D;
  private hiddenLayers: ReadonlySet<number> = new Set();
  /** Object edits arrived while the scene was paused: the deltas were skipped, so the instanced
   *  set no longer matches the map and `resume()` rebuilds it whole (see `resetObjects`). */
  private objectsStale = false;
  private viewCache: GridState | null = null;
  private overlayLayer: OverlayLayer3D | null = null;
  private editorView: ActiveView | null = null;
  private bus: EventBus<EditorEvents> | null = null;
  /**
   * Whole-map work an object edit owes, run once per rendered frame: the road surfaces and the
   * icon-colour refinement each scan every object, and one dab fires several objects-changed
   * events. The chrome nudge emits `viewport-changed`, which the pointer machine answers at once
   * with a re-sample (a heightfield ray-march in 3D), so it is owed per frame, never per object.
   */
  private objectDirty = new DirtyFlags<'roads' | 'icons' | 'chrome'>([
    ['roads', () => this.roads.rebuild()],
    ['icons', () => this.instances.refineIconColors()],
    ['chrome', () => this.emitViewportChanged()],
  ]);
  /** Whether the buildable drape needs re-baking against the terrain as it now stands. */
  private buildableDirty = false;
  /** The render window, held open by the camera, the intro, the overlay and the object tweens. */
  private frames = new FrameLoop(() => this.scheduleFrame(), [
    () => this.cam.tickInertia(),
    () => { if (!this.cam.introActive) return false; this.cam.animateIntro(); return true; },
    () => { if (!this.cam.camTween) return false; this.cam.animateCamTween(); return true; },
    () => this.overlayLayer?.tick() ?? false,
    () => this.motion.tickPlops(),
    () => this.motion.tickSpins(),
    () => this.motion.tickGroupArc(),
  ]);
  private running = true;
  private raf = 0;
  private busDetach: (() => void) | null = null;
  /** Lightweight effects profile; drawing-buffer resolution is budgeted separately. */
  private lite = false;
  private modelQuality = (): GlQuality => this.lite ? 'lite' : 'full';
  private frameBudget = new LiteFrameBudget();
  private resolutionLimited = false;
  private previousFrameContinuous = false;
  private movePreviewIds = new Set<string>();
  private boxWatch: ResizeObserver | null = null;
  private disposed = false;
  onPerformanceLimit: (() => void) | null = null;
  private onVisibility = (): void => {
    if (document.hidden) { this.frameBudget.reset(); cancelAnimationFrame(this.raf); this.raf = 0; }
    else this.requestRender();
  };
  private contextLost = false;
  /** Told when the lost context never comes back; the owner rebuilds the scene on a fresh one. */
  onUnrecoverableLoss: (() => void) | null = null;
  private unwatchContext: () => void = () => {};

  /** The camera moved: the pointer machine re-samples and the chrome re-anchors. */
  private emitViewportChanged(): void {
    this.bus?.emit('viewport-changed', { zoom: this.cam.zoomPercent() / 100 });
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  /** The shadow map is frozen between frames; whatever moves a caster or a receiver recasts it. */
  private recastShadows(): void { this.renderer.shadowMap.needsUpdate = true; }

  private onContextRestored = (): void => {
    this.contextLost = false;
    // The frozen shadow map died with the context; recompute it once on the restored one.
    this.recastShadows();
    this.requestRender();
  };

  constructor(private container: HTMLElement, private liveState: GridState, bus?: EventBus<EditorEvents>) {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    // On a software rasterizer (glQuality 'lite') every pixel is CPU work, which shadow maps and the
    // MSAA target multiply; lite drops both and renders at 1x.
    this.lite = glQuality() === 'lite';
    this.presenter = new Presenter(container, w, h, this.lite, this.frameBudget.scale);
    this.renderer = this.presenter.renderer;
    // A GPU reset loses the context mid-session. preventDefault asks the browser for a restore;
    // rendering pauses meanwhile, and the restore reopens the render window.
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    this.unwatchContext = watchContextLoss(this.renderer.domElement, {
      isLost: () => this.renderer.getContext().isContextLost(),
      onUnrecovered: () => this.onUnrecoverableLoss?.(),
    });

    const sky = skyBackground();
    this.scene.background = sky;
    this.disposables.push(sky);
    this.cam = new SceneCamera(w / h, this.renderer.domElement, {
      requestRender: this.requestRender,
      viewportChanged: () => this.emitViewportChanged(),
      template: () => this.liveState.template,
      viewHeight: () => this.container.clientHeight,
    });
    this.camera = this.cam.camera;
    this.controls = this.cam.controls;

    this.sun = addLights(this.scene);
    // Lambert = clean, vibrant diffuse (no PBR roughness desaturation); flat-shaded
    // for the chunky low-poly read; DoubleSide so no face can vanish from any angle.
    this.sharedMat = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide });
    // Bespoke models bake their own (multi-)colours into vertex colours.
    this.modelMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    addProximityFade(this.sharedMat);
    addProximityFade(this.modelMat);
    this.disposables.push(this.sharedMat, this.modelMat);
    this.instances = new ObjectLayer3D({
      scene: this.scene, sharedMat: this.sharedMat, modelMat: this.modelMat,
      state: () => this.liveState, hiddenLayers: () => this.hiddenLayers, quality: this.modelQuality,
      running: () => this.running, requestRender: this.requestRender,
    });
    this.motion = new ObjectMotion({
      drawn: (id) => this.instances.drawn(id), state: () => this.liveState,
      recastShadows: () => this.recastShadows(),
      rebuildRoads: (offsets) => this.roads.rebuild(offsets),
    });
    this.legend = new LabelLayer3D(this.scene);

    this.buildTerrain(this.liveState);
    this.scene.add(this.arrows.group);
    this.scene.add(this.annotationLayer.group);
    this.rebuildWaterfallArrows();
    if (bus) {
      this.bus = bus;
      // Live edit sync: an edit dirties its chunks (+1-cell ring — neighbors'
      // exposed faces and backing change too); the render loop remeshes them.
      const onCells = (data: EditorEvents['cells-changed']) => {
        this.viewCache = null;
        const { width, height } = this.liveState.template;
        for (const k of dirtyChunksFor(cellsOn(data.cells, TERRAIN_GRID), width, height)) this.terrain.dirty.add(k);
        // The buildable drape is baked at each cell's surface height, so terrain moving under a
        // painted region leaves it describing ground that is gone — a generation's old elevations,
        // standing until the region happened to be shown again.
        this.buildableDirty = true;
        this.requestRender();
      };
      const onObjects = (data: EditorEvents['objects-changed']) => {
        // A paused scene (the 2D view standing over this one) mirrors nothing per object: a road
        // fill is thousands of these events, and instancing them into meshes nobody can see costs
        // more than rebuilding the whole set from the live map once on resume.
        if (!this.running) {
          this.objectsStale = true;
          return;
        }
        let roads = false;
        for (const id of data.removed ?? []) roads = this.instances.remove(id) || roads;
        for (const obj of data.added ?? []) roads = this.instances.add(obj) || roads;
        if (roads) this.objectDirty.mark('roads');
        if (data.added?.length) this.objectDirty.mark('icons');
        this.recastShadows();
        this.objectDirty.mark('chrome');
        this.requestRender();
      };
      this.busDetach = listenAll(bus, {
        'cells-changed': onCells,
        'objects-changed': onObjects,
        'validation-failed': (data) => { this.overlayLayer?.flashErrors(data.errors); },
        'history-applied': ({ cells, objects }) => { this.overlayLayer?.flashCommit(resolveHistoryFlash(cells, objects)); },
      });
    }
    this.instances.buildAll();

    const off = mapCenterOffset(this.liveState.template.width, this.liveState.template.height);
    const bounds = islandBounds(this.liveState.template, layerToY(maxHeight(this.liveState)));
    this.cam.frame(bounds);
    // Fog melts distant terrain into the horizon band (depth + immersion).
    this.scene.fog = new THREE.Fog(HORIZON, this.controls.maxDistance * 0.45, this.controls.maxDistance * 1.3);
    setupShadows(this.scene, this.sun, { halfX: off.x, halfZ: off.z, maxY: bounds.maxY });
    this.cam.beginIntro(!isMotionReduced() && !this.lite);

    // Shadows are baked once and frozen: geometry, sun and water stand still while the camera moves.
    // autoUpdate goes off first, so the priming render below cannot be the bake.
    this.renderer.shadowMap.autoUpdate = false;
    this.presenter.primeLightState(this.scene, this.camera);
    this.recastShadows();

    // The host box changes without the window (the assistant's dock takes a strip of it); the window
    // listener stays for page-zoom steps, which redefine the css px the box is measured in.
    if (IS_LITE) document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver === 'function') {
      this.boxWatch = new ResizeObserver(this.onResize);
      this.boxWatch.observe(this.container);
    }
    this.requestRender();
  }

  /** Open a short keep-alive render window (coalesced, spam-safe). */
  requestRender = (): void => {
    this.frames.request();
  };

  private scheduleFrame(): void {
    if (!this.raf && this.running && !this.disposed && !this.contextLost && (!IS_LITE || !document.hidden)) this.raf = requestAnimationFrame(this.loop);
  }

  /** Run `cb` after the next frame this scene draws. The loop renders on demand, so the request
   *  also opens the render window — a waiter wants the current scene on screen, not the next edit's. */
  onNextPaint(cb: () => void): void {
    this.frames.onNextPaint(cb);
  }

  /** Draw one frame. Every producer of a visible frame (loop, capture, intro skip) goes through
   *  here so on-screen and captured frames share one pipeline. */
  private renderFrame(): void {
    if (this.contextLost) return;
    this.gridUniforms.uGridPixelRatio.value = this.presenter.gridPixelRatio();
    this.flushTerrainDirty();
    this.objectDirty.flush();
    this.flushAnnotations();
    this.overlayLayer?.flush();
    this.presenter.present(this.scene, this.camera);
    this.frames.painted();
  }

  /** Render the current framing and return it as a PNG data URL. The synchronous
   *  render immediately before the read is what keeps the canvas readable
   *  (the drawing buffer is not preserved across frames — see the presenter's
   *  renderer options). Used by the in-view screenshot button. */
  captureImage(): string {
    this.renderFrame();
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** Capture the current framing cropped to a centred rect of `aspect` (width/
   *  height) — the largest that fits the canvas. The export re-renders each shot
   *  at CARD_3D_CELL_ASPECT with this same camera + vertical FOV, so that still is
   *  exactly this crop (full height, centre width for a wide view). Used by the
   *  edit-mode download so the PNG matches the viewfinder and the exported shot. */
  captureFramed(aspect: number): string {
    this.renderFrame();
    const src = this.renderer.domElement;
    const sw = src.width, sh = src.height;
    let cw = sw, ch = sh;
    if (sw / sh > aspect) cw = Math.max(1, Math.round(sh * aspect)); // wider than aspect → crop width
    else ch = Math.max(1, Math.round(sw / aspect));                  // taller → crop height
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    c.getContext('2d')!.drawImage(src, Math.round((sw - cw) / 2), Math.round((sh - ch) / 2), cw, ch, 0, 0, cw, ch);
    return c.toDataURL('image/png');
  }

  /** Poses the camera at `angle` and captures it: the export's several stills from one scene. */
  captureFromAngle(angle: CameraAngle): string {
    this.applyCameraAngle(angle);
    return this.captureImage();
  }

  /** Pose the camera at a CameraAngle without capturing (`SceneCamera.applyCameraAngle`). */
  applyCameraAngle(angle: CameraAngle): void {
    this.cam.applyCameraAngle(angle);
  }

  /** The current camera framing as a CameraAngle (`SceneCamera.getCurrentAngle`). */
  getCurrentAngle(): CameraAngle {
    return this.cam.getCurrentAngle();
  }

  /** Skip the ~0.8s camera fly-in intro and render one frame at the resting position.
   *  Used by the offscreen export capture path so it gets a fully-framed still without
   *  waiting for the animation loop. Safe to call even when the intro is already done. */
  skipIntroAndRender(): void {
    this.cam.landIntro();
    this.renderFrame();
  }

  private loop = (): void => {
    this.raf = 0;
    if (!this.running || this.contextLost) return;
    if (!this.frames.advance()) return;
    const follow = this.cam.followControls();
    if (follow?.more) this.frames.keepOpen(MOVE_WINDOW_FRAMES);
    if (follow?.moving) this.emitViewportChanged();
    const started = IS_LITE ? performance.now() : 0;
    this.renderFrame();
    if (IS_LITE) {
      const step = this.frameBudget.step(started, performance.now() - started, {
        calls: this.presenter.frameCalls, triangles: this.presenter.frameTriangles, lite: this.lite,
        continuous: this.previousFrameContinuous,
        canIncrease: () => !this.resolutionLimited && canIncreaseRenderScale(),
      });
      if (step === 'fallback') {
        this.pause();
        this.onPerformanceLimit?.();
        return;
      }
      // A reduction is final: the scale never climbs back once the device has struggled.
      if (step === 'reduce' || step === 'enter-lite') this.resolutionLimited = true;
      if (step === 'enter-lite') {
        this.lite = true;
        this.instances.requalify();
        this.presenter.enterLite();
      }
      if (step) this.onResize();
    }
    this.previousFrameContinuous = this.frames.isOpen;
    if (this.frames.isOpen) this.scheduleFrame();
  };

  private buildTerrain(state: GridState): void {
    this.terrain = new TerrainLayer3D({
      scene: this.scene, meshState: () => this.meshState(), hiddenLayers: () => this.hiddenLayers,
      numbersShown: () => this.passive.numbers, gridUniforms: this.gridUniforms,
    });
    this.roads = new RoadSurfaces3D({
      scene: this.scene, state: () => this.liveState, hiddenLayers: () => this.hiddenLayers,
      maxAnisotropy: () => this.renderer.capabilities.getMaxAnisotropy(),
      disposed: () => this.disposed, requestRender: this.requestRender,
      rebuildOwed: () => this.objectDirty.mark('roads'),
    });
    // The reference grid + chunk bounds are draped onto the terrain via the material shader (world XZ),
    // so they follow the surface as a light texture. Align to macro cells + seed the live toggles.
    alignGridUniforms(this.gridUniforms, state.template, this.passive);
    this.terrain.drape();
    // Trimmed road tiles (edge-cut corners) — a flat custom mesh; untrimmed roads stay instanced.
    this.roads.rebuild();
    this.terrain.buildAll(state);
  }

  /** The state the terrain mesher consumes: the live state, or (with layers
   *  hidden) its cached visibility view — 2D peel semantics via clampNeighbor. */
  private meshState(): GridState {
    if (this.hiddenLayers.size === 0) return this.liveState;
    if (!this.viewCache) this.viewCache = visibilityView(this.liveState, this.hiddenLayers);
    return this.viewCache;
  }

  /** Apply a layer-visibility change: remesh the affected chunks under the new
   *  peel view, zero-scale instanced objects on hidden elevations (their slot
   *  keeps its metadata, so unhiding rewrites the real transform), filter the
   *  trimmed-road mesh. */
  setLayerVisibility(visibility: Readonly<Record<number, boolean>>): void {
    const hidden = hiddenSetFrom(visibility);
    const changed: number[] = [];
    for (const l of hidden) if (!this.hiddenLayers.has(l)) changed.push(l);
    for (const l of this.hiddenLayers) if (!hidden.has(l)) changed.push(l);
    if (changed.length === 0) return;
    this.hiddenLayers = new Set(hidden);
    this.viewCache = null;
    const { width, height } = this.liveState.template;
    for (const k of dirtyChunksFor(cellsAffectedByLayerToggle(this.liveState, changed), width, height)) {
      this.terrain.dirty.add(k);
    }
    this.instances.applyLayerToggle(changed, hidden);
    this.roads.rebuild();
    this.rebuildWaterfallArrows();
    this.recastShadows();
    this.requestRender();
  }

  /** The plan-notes layer as the store holds it; the scene re-drapes the same ask itself when the
   *  ground moves. */
  setAnnotations(data: AnnotationsState | null, opts: AnnotationLayer3DOpts): void {
    this.pendingAnnotations = { data, opts };
    this.requestRender();
  }

  private flushAnnotations(): void {
    const pending = this.pendingAnnotations;
    this.pendingAnnotations = null;
    if (pending) this.annotationLayer.update(this.meshState(), pending.data, pending.opts);
    else if (this.annotationsTerrainDirty) {
      const dirty = this.annotationsTerrainDirty;
      this.annotationLayer.refresh(this.meshState(), dirty === 'all' ? undefined : dirty);
    }
    this.annotationsTerrainDirty = null;
  }

  /** Re-rasterise the note labels — for when the app's own fonts finish loading after the first
   *  bake, which would otherwise leave fallback-face lettering standing for the session. */
  rebakeAnnotationText(): void {
    this.annotationLayer.dropBakes();
    this.annotationsTerrainDirty = 'all';
    this.requestRender();
  }

  /** Settings toggles for the passive overlays. The grid + chunk bounds are draped via the terrain
   *  shader (see `draw/grid-drape.ts`) — toggling is a single uniform write, no rebuild; only the
   *  layer numbers remesh with their chunks. */
  setPassiveOverlays(flags: PassiveOverlays): void {
    const rebuild = flags.numbers !== this.passive.numbers;
    this.passive = { ...flags };
    if (rebuild) this.terrain.dirtyAll(this.liveState.template);
    this.gridUniforms.uGrid.value = flags.grid ? 1 : 0;
    this.gridUniforms.uChunks.value = flags.chunks ? 1 : 0;
    this.legend.rebuild(this.liveState.template, this.passive.chunks);
    this.requestRender();
  }

  /** Remesh every chunk an edit dirtied — called once per rendered frame, so a
   *  multi-command stroke coalesces. Refreshes the frozen shadow map once. */
  private flushTerrainDirty(): void {
    const remeshed = [...this.terrain.dirty];
    if (!this.terrain.flush()) return;
    this.rebuildWaterfallArrows();
    // Re-baked here, with the terrain flush, so the drape and the ground under it are one frame's
    // worth of the same map. Coalesced with it too: a generation fires thousands of cells-changed.
    if (this.buildableDirty) { this.buildableDirty = false; this.overlayLayer?.refreshBuildable(); }
    if (this.annotationsTerrainDirty !== 'all') {
      this.annotationsTerrainDirty ??= new Set();
      for (const key of remeshed) this.annotationsTerrainDirty.add(key);
    }
    this.recastShadows();
  }

  private rebuildWaterfallArrows(): void {
    this.arrows.rebuild(this.meshState(), this.hiddenLayers);
    this.requestRender();
  }

  /**
   * Follows the canvas box and draws the resized frame in the same task: a resize reallocates an
   * empty drawing buffer, and a render merely requested would let the compositor show it empty for
   * one frame. A ResizeObserver callback runs before that composite. The render window opens too,
   * since a box change often comes with controls still settling.
   */
  private onResize = (): void => {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.presenter.resize(w, h, this.frameBudget.scale);
    this.requestRender();
    this.renderFrame();
  };

  /** Selection bounds use the occupied footprint in X/Z and the rendered body's vertical extent.
   *  Objects without an instanced body use the overlay's flat footprint fallback. */
  objectBoundingBox(id: string): THREE.Box3 | null {
    return this.instances.boundingBox(id);
  }

  /** The object whose mesh the pointer ray hits first — canopy, roof, or wall,
   *  not the ground cell under it. Terrain closer than the mesh occludes (null
   *  falls back to footprint hit-testing on the picked cell). */
  pickObjectAt(sx: number, sy: number): string | null {
    const rect = viewportRect((this.renderer.domElement as HTMLCanvasElement));
    const ndc = new THREE.Vector2(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const best = this.instances.pick(rc);
    if (!best) return null;
    // Terrain in front of the mesh wins (a hill hides the tree behind it).
    const surface = pickSurface(this.meshState(), {
      x: rc.ray.origin.x, y: rc.ray.origin.y, z: rc.ray.origin.z,
    }, { x: rc.ray.direction.x, y: rc.ray.direction.y, z: rc.ray.direction.z });
    if (surface) {
      const d = Math.hypot(surface.point.x - rc.ray.origin.x, surface.point.y - rc.ray.origin.y, surface.point.z - rc.ray.origin.z);
      if (d < best.dist - 0.05) return null;
    }
    return best.id;
  }

  /** Preview matrices never replace canonical instance metadata or map objects. */
  private previewObjectMove(destinations: readonly PlacedObject[]): void {
    const next = new Map(destinations.map(obj => [obj.id, obj]));
    const ids = new Set([...this.movePreviewIds, ...next.keys()]);
    let roads = false;
    for (const id of ids) {
      const original = this.liveState.objects.get(id);
      if (!original) continue;
      if (bodyRoute(this.liveState, id) === 'roadTrim') { roads = true; continue; }
      const obj = next.get(id) ?? original;
      if (next.has(id)) this.motion.stop(id);
      this.instances.showAt(obj);
    }
    if (roads) {
      const objects = new Map(this.liveState.objects);
      for (const obj of destinations) objects.set(obj.id, obj);
      this.roads.rebuild(undefined, { ...this.liveState, objects });
    }
    this.movePreviewIds = new Set(next.keys());
    this.recastShadows();
    this.requestRender();
  }

  /** This scene as the tool layer's active view: surface-pick projection +
   *  the decal overlay. Created on first request; the overlay group joins the
   *  scene then (the read-only preview never pays for it). */
  asEditorView(): ActiveView {
    if (!this.editorView) {
      const overlay = new OverlayLayer3D({
        state: () => this.meshState(),
        requestRender: this.requestRender,
        objectBox: (id) => this.objectBoundingBox(id),
        moveObjects: (destinations) => this.previewObjectMove(destinations),
        camera: this.camera,
        viewport: () => viewportRect(this.renderer.domElement),
        modelQuality: this.modelQuality,
      });
      this.scene.add(overlay.group);
      this.overlayLayer = overlay;
      this.editorView = {
        rendersState: () => this.liveState,
        onNextPaint: (cb: () => void) => this.onNextPaint(cb),
        projection: new Projection3D({
          camera: this.camera,
          canvas: this.renderer.domElement as HTMLCanvasElement,
          state: () => this.meshState(),
          pickObjectAt: (sx, sy) => this.pickObjectAt(sx, sy),
          objectBoundingBox: (id) => this.objectBoundingBox(id),
          pickAnnotationLabel: (sx, sy) => {
            this.flushAnnotations();
            return this.annotationLayer.pickLabel(sx, sy, this.camera, viewportRect(this.renderer.domElement));
          },
          annotationLabelBox: (id) => {
            this.flushAnnotations();
            return this.annotationLayer.labelBox(id, this.camera, viewportRect(this.renderer.domElement));
          },
        }),
        overlay,
        // Under reduced motion neither decorative tween is registered: the instance already carries
        // its canonical transform, so skipping goes straight to the settled pose. The spin still has
        // to dirty the frozen shadow map by hand, since no tick will run to do it.
        plopObject: (id: string) => {
          if (!isMotionReduced()) this.motion.plops.set(id, performance.now());
          this.requestRender();
        },
        animateRotation: (id: string, fromDeg: number, toDeg: number, onFrame?: (eased: number) => void) => {
          if (isMotionReduced()) this.recastShadows();
          else this.motion.spins.set(id, { from: fromDeg, to: toDeg, born: performance.now(), onFrame });
          this.requestRender();
        },
        animateGroupRotation: (turn: GroupRotation, onFrame?: (eased: number) => void) => {
          if (isMotionReduced()) this.recastShadows();
          else this.motion.turnGroup(turn, onFrame);
          this.requestRender();
        },
        // No animateRemove: `deleteGroup` fires this hook, then removes the object, then execute()
        // emits objects-changed synchronously — this scene's own listener frees the departing
        // instance's slot and repacks a different object into it before any render frame runs. A
        // tween would need a decoy mesh outside the InstancedMesh's dense packing, which this view
        // does not have; the object simply disappears with the InstancedMesh's next repaint.
        camera: this.cameraVerbs(),
      };
    }
    return this.editorView;
  }

  /** The camera verbs on their own, without the editing overlay `asEditorView` builds. The shot
   *  editor drives the same camera through the same gestures and never needs ghosts or rings. */
  cameraVerbs(): ViewCamera {
    return this.cam.cameraVerbs();
  }

  /** The dolly distance as a share of the fit distance — the zoom readout. */
  zoomPercent(): number {
    return this.cam.zoomPercent();
  }

  /** Halt the render loop while this view is hidden (the canvas stays alive and
   *  its GL resources warm); resume() restarts it. No-ops after destroy(). */
  pause(): void {
    this.frameBudget.reset();
    this.previousFrameContinuous = false;
    this.running = false;
    this.cam.cancelGlides();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resume(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    if (this.objectsStale) {
      this.objectsStale = false;
      this.resetObjects();
    }
    this.requestRender();
  }

  /** Rebuild the instanced-object set from the live map; every in-flight per-object tween is
   *  bookkeeping about the set this scene stopped mirroring. */
  private resetObjects(): void {
    this.instances.reset();
    this.motion.clear();
    this.objectDirty.mark('roads');
    this.objectDirty.mark('icons');
    this.objectDirty.mark('chrome');
    this.recastShadows();
  }

  destroy(): void {
    if (IS_LITE) document.removeEventListener('visibilitychange', this.onVisibility);
    this.disposed = true;
    this.running = false;
    this.frames.painted();  // a disposed scene never draws again; a waiter must not hang on it
    cancelAnimationFrame(this.raf);
    this.busDetach?.();
    this.overlayLayer?.dispose();
    this.annotationLayer.dispose();
    this.terrain.dispose();
    this.roads.dispose();
    window.removeEventListener('resize', this.onResize);
    this.boxWatch?.disconnect();
    this.boxWatch = null;
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.unwatchContext();
    this.cam.dispose();
    this.instances.dispose();
    this.legend.dispose();
    this.arrows.dispose();
    for (const d of this.disposables) d.dispose();
    this.releaseModelCaches();
    this.presenter.dispose();
  }
}
