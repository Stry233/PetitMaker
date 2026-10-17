/** The demo timeline: steps a scene through the real renderer and world, moving the pictured pointer and posing the figure's furniture. */
import { loadMapRenderer } from '../../chrome/loaders';
import { viewportRect } from '../../../platform/device/viewport-space';
import { glQuality } from '../../../platform/device/device-quality';
import { useEditorStore } from '../../../state/store';
import { helpFacts } from '../facts';
import { NEAR } from './use-in-view';
import { queueStandup } from './standup-queue';
import { createDemoView } from './demo-view';
import type { MapRenderer } from '../../../view/map2d/scene/map-renderer';
import type { ToolOverlay } from '../../../tools/pointer/runtime';
import { TILE_SIZE, TERRAIN_GRID_OFFSET_PX } from '../../../view/map2d/geometry/world';
import { cellKey } from '../../../core/grid/rect';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import type { Rotation } from '../../../core/model/types';
import type { Translate, TextKey } from '../../../i18n/keys';
import { type TokenSpec } from '../hints/catalogue';
import { type CurveAnchor } from '../../../core/base/spline';
import { firePressPulse } from './caption';
import { drawCursorImg } from './demo-cursor';
import { SandboxWorld } from '../../../editor/sandbox/demo-world';
import type { DemoCtx, DemoView, HelpScene, SceneStep } from './scenes';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import type { MapPoint } from '../../../core/grid/grids';

export interface Cam { dx: number; dy: number; z: number }
export type Toast =
  | { kind: 'key'; key: TextKey; params?: Record<string, string | number> }
  | { kind: 'refusal'; message: string; params?: Record<string, string | number>; tone: 'error' | 'warning' }
  | null;

export interface Furniture {
  capKey: TextKey | null;
  toast: Toast;
  keys: readonly TokenSpec[] | null;
  marks: Array<{ x: number; y: number; labelKey: TextKey }>;
  gauge: number;
  stripSelected: number | null;
  /** The pictured slider's reading, where a beat poses one; null keeps the strip's default. */
  stripSize: number | null;
  /** A mid-scene re-arm of the tools strip; null keeps the scene's own active cell. */
  toolsActive: string | null;
  /** Live per-item placed counts for the shelf strip's badges, read off the demo world. */
  shelfCounts: ReadonlyMap<string, number> | null;
  checklist: Array<{ catalogId: string; count: number }> | null;
  /** A finished curve's adjust handles, standing at these anchors; null keeps them away. */
  curveHandles: CurveAnchor[] | null;
}

export const FURNITURE_REST: Furniture = {
  capKey: null, toast: null, keys: null, marks: [], gauge: -1, stripSelected: null,
  stripSize: null, toolsActive: null, shelfCounts: null, checklist: null, curveHandles: null,
};


/** The figure a player draws into: its size, the pointer and pulse elements, and where its parts sit. */
interface PlayerHost {
  W: number;
  H: number;
  cursorEl: HTMLElement;
  pulseEl: HTMLElement;
  /** Center of strip card `i`, in figure pixels, or null before the strip lays out. */
  stripCard: (i: number) => { x: number; y: number } | null;
  /** The map box's top-left within the figure column: the strip below can be wider than the
   *  box, so box space and figure space no longer share an origin. */
  boxPos: () => { x: number; y: number };
  setFurniture: (f: Furniture) => void;
}

export class Player {
  private steps: SceneStep[];
  private si = 0;
  private stepT = 0;
  private from: { cur: { x: number; y: number }; cam: Cam } | null = null;
  private target: { x: number; y: number } | null = null;
  private last: number | undefined;
  private raf = 0;
  private stopped = false;
  private still = false;

  /** The pointer, in the figure's own pixels (the outer column, map box at its top). */
  private cur: { x: number; y: number };
  private cam: Cam = { dx: 0, dy: 0, z: 1 };
  private press = false;
  private follow: { catalogId: string; rotation: Rotation } | null = null;
  private followAnchor: string | null = null;
  private ghostHeld = false;
  private hoverCell: string | null = null;
  private view: DemoView;
  private ctx: DemoCtx;
  private furnitureState: Furniture = { ...FURNITURE_REST };
  /** The figure renderer's tool overlay, the one the editor's tools draw through. */
  private readonly overlay: ToolOverlay;

  constructor(
    private r: MapRenderer,
    private world: SandboxWorld,
    private scene: HelpScene,
    private t: Translate,
    private host: PlayerHost,
  ) {
    this.overlay = r.asEditorView().overlay;
    this.view = createDemoView({
      renderer: r, world,
      still: () => this.still,
      holdGhost: (on) => { this.ghostHeld = on; },
      furniture: (patch) => this.furniture(patch),
    });
    this.ctx = { world, view: this.view };
    this.still = isMotionReduced();
    this.steps = scene.run(this.ctx, (key) => this.t(key));
    this.r.initMap(world.state, PLACEMENT_GRID, false, { labels: false });
    // A figure takes no pointer of its own, so its projection answers in figure px: the box's offset is the origin.
    this.r.viewport.setOriginSource(() => this.host.boxPos());
    this.applyCamera();
    this.cur = this.cellToPx((scene.stage.x1 + scene.stage.x2) / 2, (scene.stage.y1 + scene.stage.y2) / 2);
    if (this.still) {
      this.finishAll();
      this.frame();
      return;
    }
    this.frame();
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
  }

  private paused = false;

  /** Hold the timeline while nobody can see the figure: eleven playing demos saturate a weak
   *  machine's main thread, and every one of them but the few on screen is invisible work. The
   *  loop resumes where it stood, which is also what a returning reader expects of a loop. */
  pause(): void {
    if (this.paused || this.still || this.stopped) return;
    this.paused = true;
    cancelAnimationFrame(this.raf);
  }

  resume(): void {
    if (!this.paused || this.stopped) return;
    this.paused = false;
    this.last = undefined;
    this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  setPointer(id: NonNullable<SceneStep['pointer']>): void {
    drawCursorImg(this.host.cursorEl, id);
  }

  /* ── projection: figure pixels ⇄ template cells ─────────────────────────── */

  private applyCamera(): void {
    const s = this.scene.stage;
    const z = (s.tile / TILE_SIZE) * this.cam.z;
    const cx = (((s.x1 + s.x2 + 1) / 2) + this.cam.dx) * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.x;
    const cy = (((s.y1 + s.y2 + 1) / 2) + this.cam.dy) * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.y;
    this.r.viewport.setView({ zoom: z, offsetX: cx * z - this.host.W / 2, offsetY: cy * z - this.host.H / 2 });
    this.r.applyViewportTransform();
  }

  /** A terrain coordinate (world `x*64`) in figure px. */
  private cellToPx(x: number, y: number): { x: number; y: number } {
    return this.r.viewport.macroToScreen({ x, y });
  }

  /** The map point under a figure pixel, in cells, as the live view resolves it. */
  private pxToCell(px: { x: number; y: number }): MapPoint {
    return this.r.viewport.screenToPoint(px.x, px.y);
  }

  private resolveMove(move: NonNullable<SceneStep['move']>): { x: number; y: number } | null {
    if (Array.isArray(move)) return this.cellToPx(move[0], move[1]);
    return this.host.stripCard(move.strip);
  }

  private furniture(patch: Partial<Furniture>): void {
    this.furnitureState = { ...this.furnitureState, ...patch };
    this.host.setFurniture(this.furnitureState);
  }

  /* ── the step machine ───────────────────────────────────────────────────── */

  private applyDiscrete(step: SceneStep): void {
    if (step.press !== undefined) {
      const was = this.press;
      this.press = step.press;
      if (step.press && !was) this.pulse();
    }
    if (step.pointer !== undefined) this.setPointer(step.pointer);
    if (step.keys !== undefined) this.furniture({ keys: step.keys });
    if (step.capKey !== undefined) this.furniture({ capKey: step.capKey });
    if (step.toastKey !== undefined) {
      this.furniture({ toast: step.toastKey === null ? null : { kind: 'key', key: step.toastKey, ...(step.toastParams ? { params: step.toastParams } : {}) } });
    }
    if (step.strip !== undefined) this.furniture({ stripSelected: step.strip });
    if (step.tool !== undefined) this.furniture({ toolsActive: step.tool });
    if (step.stripSize !== undefined) this.furniture({ stripSize: step.stripSize });
    if (step.follow !== undefined) {
      this.follow = step.follow === null ? null : { catalogId: step.follow.catalogId, rotation: step.follow.rotation ?? 0 };
      this.followAnchor = null;
      if (step.follow === null) this.view.clearGhost();
    }
    if (step.on) step.on(this.ctx);
    // The shelf badges track the world after every discrete beat, the way the live shelf's do.
    if (this.scene.strip?.kind === 'shelf') {
      this.furniture({ shelfCounts: new Map(this.builtPieces().map((p) => [p.catalogId, p.count])) });
    }
    if (step.checklist !== undefined) this.furniture({ checklist: step.checklist ? this.builtPieces() : null });
    // The refusal is read after `on`, which is the step that provoked it.
    if (step.realToast) {
      const refusal = this.world.refusal;
      this.furniture({ toast: refusal ? { kind: 'refusal', message: refusal.message, params: refusal.params, tone: refusal.tone } : null });
    }
  }

  /** What stands on the map right now, the plaza excluded — real counts for the checklist card. */
  private builtPieces(): Array<{ catalogId: string; count: number }> {
    const counts = new Map<string, number>();
    for (const obj of this.world.state.objects.values()) {
      if (obj.locked) continue;
      counts.set(obj.catalogId, (counts.get(obj.catalogId) ?? 0) + 1);
    }
    return [...counts.entries()].map(([catalogId, count]) => ({ catalogId, count }));
  }

  private finishAll(): void {
    for (const step of this.steps) {
      this.applyDiscrete(step);
      if (step.during) step.during(this.ctx, 1);
      if (step.move) {
        const px = this.resolveMove(step.move);
        if (px) this.cur = px;
      }
      if (step.cam) {
        if (step.cam.dx !== undefined) this.cam.dx = step.cam.dx;
        if (step.cam.dy !== undefined) this.cam.dy = step.cam.dy;
        if (step.cam.z !== undefined) this.cam.z = step.cam.z;
      }
    }
    this.press = false;
    this.follow = null;
    this.view.clearGhost();
    this.furniture({ keys: null });
  }

  /** Rewind the world to the template through the real undo stack, clear every overlay, and start
   *  the timeline over with fresh closures. */
  private reset(): void {
    const o = this.overlay;
    o.clearGhost(); o.clearHover(); o.clearSelection(); o.clearBand(); o.clearBuildableRegion(); o.clearPath();
    this.ghostHeld = false;
    this.hoverCell = null;
    this.follow = null;
    this.followAnchor = null;
    while (this.world.undo()) { /* each entry is one real stroke */ }
    if (this.world.state.annotations) {
      this.world.state.annotations = undefined;
      this.view.annotations();
    }
    this.furnitureState = { ...FURNITURE_REST };
    this.host.setFurniture(this.furnitureState);
    this.cam = { dx: 0, dy: 0, z: 1 };
    this.applyCamera();
    const s = this.scene.stage;
    this.cur = this.cellToPx((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
    this.press = false;
    this.setPointer('select');
    this.si = 0;
    this.stepT = 0;
    this.from = null;
    this.target = null;
    this.steps = this.scene.run(this.ctx, (key) => this.t(key));
    this.frame();
  }

  private tick(now: number): void {
    if (this.stopped) return;
    // The preference can flip while a demo runs; the settled end state replaces the loop.
    if (isMotionReduced()) {
      this.still = true;
      this.reset();
      this.finishAll();
      this.frame();
      return;
    }
    const dt = Math.min(50, now - (this.last ?? now));
    this.last = now;
    this.stepT += dt;
    const step = this.steps[this.si];
    if (step) {
      const dur = step.dur ?? 400;
      if (this.from === null) {
        this.from = { cur: { ...this.cur }, cam: { ...this.cam } };
        this.target = step.move ? this.resolveMove(step.move) : null;
        this.applyDiscrete(step);
      }
      const k = Math.min(1, this.stepT / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
      if (this.target) {
        this.cur.x = this.from.cur.x + (this.target.x - this.from.cur.x) * e;
        this.cur.y = this.from.cur.y + (this.target.y - this.from.cur.y) * e;
      }
      if (step.cam) {
        const targets: Array<['dx' | 'dy' | 'z', number | undefined]> = [
          ['dx', step.cam.dx], ['dy', step.cam.dy], ['z', step.cam.z],
        ];
        for (const [key, to] of targets) {
          if (to !== undefined) this.cam[key] = this.from.cam[key] + (to - this.from.cam[key]) * e;
        }
      }
      if (step.during) step.during(this.ctx, k);
      if (k >= 1) { this.si++; this.stepT = 0; this.from = null; this.target = null; }
    } else if (this.stepT > 1600) {
      this.reset();
    }
    this.frame();
    this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  private lastCam: Cam = { dx: NaN, dy: NaN, z: NaN };

  /** One visual frame: the real camera onto the crop, the pointer, the follow-ghost riding it,
   *  the live hover box under it. Camera writes are gated on change: `applyViewportTransform`
   *  opens the render window, and a per-frame reapply would keep the GPU drawing a still scene. */
  private frame(): void {
    if (this.cam.dx !== this.lastCam.dx || this.cam.dy !== this.lastCam.dy || this.cam.z !== this.lastCam.z) {
      this.lastCam = { ...this.cam };
      this.applyCamera();
    }
    this.host.cursorEl.style.left = `${this.cur.x}px`;
    this.host.cursorEl.style.top = `${this.cur.y}px`;
    this.host.pulseEl.style.left = `${this.cur.x}px`;
    this.host.pulseEl.style.top = `${this.cur.y}px`;

    const cell = this.pxToCell(this.cur);
    const box = this.host.boxPos();
    const onMap = this.cur.y >= box.y && this.cur.y <= box.y + this.host.H
      && this.cur.x >= box.x && this.cur.x <= box.x + this.host.W
      && !!this.world.state.cells[Math.round(cell.y)]?.[Math.round(cell.x)];

    // The follow-ghost is the placement tool's own hover, asked again whenever the pointer crosses
    // a half cell (the finest step a cell or half-step anchor resolves at).
    if (this.follow) {
      if (onMap) {
        const key = `${Math.floor(cell.x * 2)},${Math.floor(cell.y * 2)},${Math.round(cell.x * 2)},${Math.round(cell.y * 2)}`;
        if (this.followAnchor !== key) {
          this.followAnchor = key;
          this.ghostHeld = this.world.hoverPlacement(this.overlay, this.follow.catalogId, cell, this.follow.rotation) !== null;
        }
      } else if (this.followAnchor !== null) {
        this.followAnchor = null;
        this.view.clearGhost();
      }
    }

    // The live hover box under the pointer, unless a ghost is standing (the ghost carries its own
    // cell wash, exactly as the placement tool's preview does).
    const hoverX = Math.round(cell.x);
    const hoverY = Math.round(cell.y);
    const key = cellKey(hoverX, hoverY);
    if (this.ghostHeld || !onMap) {
      if (this.hoverCell) { this.overlay.clearHover(); this.hoverCell = null; }
    } else if (this.hoverCell !== key) {
      this.overlay.showHover({ x: hoverX, y: hoverY, w: 1, h: 1 }, TERRAIN_GRID);
      this.hoverCell = key;
    }
  }

  /** The click indicator: a ring that blooms out of the press point. */
  private pulse(): void {
    if (this.still) return;
    firePressPulse(this.host.pulseEl);
  }
}

/** What a demo figure hands its standup: its scene, its box and pointer elements, and where the
 *  furniture and readiness go. */
export interface DemoStandup {
  scene: HelpScene;
  W: number;
  H: number;
  outer: HTMLElement;
  canvasHost: HTMLElement;
  cursorEl: HTMLElement;
  pulseEl: HTMLElement;
  strip: () => HTMLElement | null;
  box: () => HTMLElement | null;
  t: Translate;
  onFurniture: (f: Furniture) => void;
  onReady: (ready: boolean) => void;
}

/** Stands a demo up in the standup queue (renderer, world, player) and returns its teardown. */
export function standUpDemo(opts: DemoStandup): () => void {
  const { scene, W, H, outer, canvasHost, cursorEl, pulseEl } = opts;
  // No 2D canvas context means no renderer either (a DOM test environment): the guard must run
  // Before the dynamic import, or loading Pixi is itself the crash.
  const probe = document.createElement('canvas');
  if (typeof probe.getContext !== 'function' || !probe.getContext('2d')) return () => {};
  let disposed = false;
  let player: Player | null = null;
  let renderer: MapRenderer | null = null;
  let visibility: IntersectionObserver | null = null;
  // Strip card centers, measured against the figure box (the pointer's own space).
  const stripCard = (i: number): { x: number; y: number } | null => {
    const strip = opts.strip();
    if (!strip) return null;
    const card = strip.querySelectorAll('[data-strip-card]')[i];
    if (!card) return null;
    const cardRect = viewportRect(card);
    const outerRect = viewportRect(outer);
    // Rect deltas are screen px; the cursor is positioned in the column's layout px. Any
    // ancestor zoom (the chrome scale the help window rides, the user's UI zoom) scales the
    // two apart, so divide it back out the way `measureBox` does.
    const zoom = outerRect.width / (outer.offsetWidth || outerRect.width);
    return {
      x: (cardRect.left + cardRect.width / 2 - outerRect.left) / zoom,
      y: (cardRect.top + cardRect.height / 2 - outerRect.top) / zoom,
    };
  };
  // Layout px against the figure column, which is the cursor's own coordinate space.
  // The pointer math asks for the box's place in the column every frame, and an `offsetLeft`
  // read forces layout right after the cursor's own style write invalidated it — eleven playing
  // figures ping-ponged write/read into a reflow per demo per frame. The place only moves when
  // the column's layout does, so it is read once and again when the column resizes.
  let boxAt = { x: 0, y: 0 };
  const measureBoxAt = () => { boxAt = { x: opts.box()?.offsetLeft ?? 0, y: opts.box()?.offsetTop ?? 0 }; };
  measureBoxAt();
  const boxWatch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureBoxAt) : null;
  boxWatch?.observe(outer);
  const boxPos = () => boxAt;
  queueStandup(async () => {
    if (disposed) return;
    const { MapRenderer: Renderer } = await loadMapRenderer();
    if (disposed) return;
    const world = new SandboxWorld(scene.template);
    // The pictured bar's chip shows the visitor's own auto-trim setting, so the pictured
    // strokes obey the same setting.
    world.autoTrim = useEditorStore.getState().autoEdgeCut;
    // A figure-sized canvas on a software rasterizer skips WebGL outright: pixi's Canvas2D
    // starts at once where a software GL context costs most of a second per figure.
    renderer = new Renderer(world.bus, canvasHost, W, H, { preferCanvas: glQuality() === 'lite' });
    const facts = helpFacts(useEditorStore.getState().locale);
    player = new Player(
      renderer, world, scene,
      (key, params) => opts.t(key as TextKey, params ? { ...facts, ...params } : facts),
      { W, H, cursorEl, pulseEl, stripCard, boxPos, setFurniture: opts.onFurniture },
    );
    player.setPointer('select');
    // The Player's constructor has drawn the first frame by here.
    opts.onReady(true);
    // Playback follows visibility at the standup margin: a figure scrolled past holds its
    // timeline and takes it up where it stood when the reader comes back.
    if (typeof IntersectionObserver !== 'undefined') {
      visibility = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) player?.resume();
        else player?.pause();
      }, { rootMargin: NEAR });
      visibility.observe(outer);
    }
  });
  return () => {
    disposed = true;
    opts.onReady(false);
    visibility?.disconnect();
    boxWatch?.disconnect();
    player?.dispose();
    renderer?.destroy();
    if (canvasHost) canvasHost.replaceChildren();
  };
}
