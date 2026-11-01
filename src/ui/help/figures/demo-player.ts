/** The demo timeline: steps a scene through the real renderer and world, moving the pictured pointer and posing the figure's furniture. */
import { loadMapRenderer } from '../../chrome/loaders';
import { visualRect } from '../../design/visual-rect';
import { fadeMask, SCROLL_FADE } from '../../primitives/scroll-fade';
import { glQuality } from '../../../platform/device/device-quality';
import { useEditorStore } from '../../../state/store';
import { helpFacts } from '../facts';
import { buildChecklist } from '../../../state/build-checklist';
import { NEAR } from './use-in-view';
import { queueStandup } from './standup-queue';
import { createDemoView } from './demo-view';
import { stripCardElement } from './previews/strips';
import { TOOL_CELLS } from '../../shell/bars/terrain-cells';
import type { MapRenderer } from '../../../view/map2d/scene/map-renderer';
import type { ActiveView, ToolOverlay, ViewProjection } from '../../../tools/pointer/runtime';
import { TILE_SIZE, ZOOM_MIN } from '../../../view/map2d/geometry/world';
import { demoFrame, type CellBox } from './figure-scale';
import { cellKey } from '../../../core/grid/rect';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import type { GridState, Rotation } from '../../../core/model/types';
import type { BlockRef } from '../../../state/selection';
import type { Translate, TextKey } from '../../../i18n/keys';
import { type TokenSpec } from '../hints/catalogue';
import { createSignal } from '../../../core/base/signal';
import { mapChunkAt } from '../../../core/grid/map-chunks';
import type { MazeEnds } from '../../shell/bars/generate/MazeEndpoints';
import { firePressPulse } from './caption';
import { drawCursorImg, drawFingerMark } from './demo-cursor';
import type { SandboxWorld } from '../../../editor/sandbox/demo-world';
import { prepareSceneWorld, sceneWorld, type DemoCtx, type DemoView, type HelpScene, type SceneForm, type SceneStep } from './scenes';
import { ease } from './scenes/common';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import type { MapPoint } from '../../../core/grid/grids';

interface Cam { dx: number; dy: number; z: number }
export type Toast =
  | { kind: 'key'; key: TextKey; params?: Record<string, string | number> }
  | { kind: 'refusal'; message: string; params?: Record<string, string | number>; tone: 'error' | 'warning' }
  | null;

export interface Furniture {
  capKey: TextKey | null;
  /** Every line the scene's narration says, so the caption keeps the tallest one's room. */
  captions: readonly TextKey[];
  toast: Toast;
  keys: readonly TokenSpec[] | null;
  /** The maze's end marks standing on the figure's map, or null. */
  marks: MazeEnds | null;
  /** Whether the load meter stands over the map. */
  loadMeter: boolean;
  /** The region under the pictured pointer, held once it leaves the map, as the live meter holds it. */
  loadRegion: { cx: number; cy: number } | null;
  stripSelected: number | null;
  /** The pictured slider's reading, where a beat poses one; null keeps the strip's default. */
  stripSize: number | null;
  /** A mid-scene re-arm of the tools strip; null keeps the scene's own active cell. */
  toolsActive: string | null;
  /** Live per-item placed counts for the shelf strip's badges, read off the demo world. */
  shelfCounts: ReadonlyMap<string, number> | null;
  checklist: Array<{ catalogId: string; count: number }> | null;
}

export const FURNITURE_REST: Furniture = {
  capKey: null, captions: [], toast: null, keys: null, marks: null, loadMeter: false, loadRegion: null, stripSelected: null,
  stripSize: null, toolsActive: null, shelfCounts: null, checklist: null,
};


/** The figure a player draws into: its size, the pointer and pulse elements, and where its parts sit. */
interface PlayerHost {
  W: number;
  H: number;
  cursorEl: HTMLElement;
  /** A second fingertip, for a two-finger gesture in a touch reader's figure. */
  fingerEl: HTMLElement;
  pulseEl: HTMLElement;
  /** The reader's form: a touch reader's figure draws fingertips where a mouse reader's draws the cursor. */
  form: SceneForm;
  /** Center of strip card `i`, in figure pixels, or null before the strip lays out. */
  stripCard: (i: number) => { x: number; y: number } | null;
  /** Center of the pictured control `testId` standing over the map, in figure pixels, or null while
   *  none stands. */
  controlAt: (testId: string) => { x: number; y: number } | null;
  /** The pan, in figure px, that stands the pictured control `testId` inside the box where it rides
   *  a row wider than the box, with the pan it stands at now and the setter; null where it needs none. */
  controlPan: (testId: string) => ControlPan | null;
  /** How far the bar must pan, in figure px, for strip card `i` to stand in the crop; null where
   *  the bar is not there or already shows it whole. */
  stripPanFor: (i: number) => number | null;
  /** Pan the bar to `px`. */
  panStrip: (px: number) => void;
  /** The map box's top-left within the figure column: the strip below can be wider than the
   *  box, so box space and figure space no longer share an origin. */
  boxPos: () => { x: number; y: number };
  setFurniture: (f: Furniture) => void;
  /** Called after the camera moves, so map-anchored controls place themselves again. */
  onCamera: () => void;
}

/** A pictured row's pan toward one of its controls, in figure px: where it stands, where it goes. */
interface ControlPan { from: number; to: number; set: (px: number) => void }

/** Marks a pictured row of controls wider than the figure's box, which the player pans by
 *  `translateX` (the attribute holds the pan in figure px) so a control the pointer heads for stands
 *  in the box; the row's parent, which holds still, fades the sides the row runs past. */
export const PAN_ROW_ATTR = 'data-pictured-pan';

/** A growing box of map points, in cells. */
class CellExtent {
  x1 = Infinity; y1 = Infinity; x2 = -Infinity; y2 = -Infinity;
  add(x1: number, y1: number, x2 = x1, y2 = y1): void {
    this.x1 = Math.min(this.x1, x1); this.y1 = Math.min(this.y1, y1);
    this.x2 = Math.max(this.x2, x2); this.y2 = Math.max(this.y2, y2);
  }
  /** The box within `stage`'s cells, or the whole stage where nothing stands in it. */
  within(stage: HelpScene['stage']): CellBox {
    const s = { x1: stage.x1 - 0.5, y1: stage.y1 - 0.5, x2: stage.x2 + 0.5, y2: stage.y2 + 0.5 };
    const box = { x1: Math.max(this.x1, s.x1), y1: Math.max(this.y1, s.y1), x2: Math.min(this.x2, s.x2), y2: Math.min(this.y2, s.y2) };
    return box.x2 > box.x1 && box.y2 > box.y1 ? box : s;
  }
}

class Player {
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
  /** The second fingertip, in figure px, while a two-finger beat stands; null otherwise. */
  private second: { x: number; y: number } | null = null;
  /** The bar's pan, in figure px, and the glide a strip-bound step runs it on. */
  private pan = 0;
  private panFrom = 0;
  private panTo: number | null = null;
  private secondFrom: { x: number; y: number } | null = null;
  private secondTo: { x: number; y: number } | null = null;
  private cam: Cam = { dx: 0, dy: 0, z: 1 };
  /** The camera at rest: its cell size in figure px and its centre, a map point in cells (`demoFrame`). */
  private rest = { tile: 0, cx: 0, cy: 0 };
  private press = false;
  private follow: { catalogId: string; rotation: Rotation } | null = null;
  private followAnchor: string | null = null;
  private ghostHeld = false;
  private hoverCell: string | null = null;
  /** The pointer last went to a pictured control over the map, so it is not over the map itself. */
  private onControl = false;
  /** The glide a control-bound step runs the control's row on, as `panTo` runs the bar's. */
  private rowPan: ControlPan | null = null;
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
    this.steps = scene.run(this.ctx, (key) => this.t(key), host.form);
    this.furniture({ captions: captionsOf(this.steps) });
    this.r.initMap(world.state, PLACEMENT_GRID, false, { labels: false });
    // The stage's own camera while the subject is found, which plays the scene through on it.
    this.rest = { tile: scene.stage.tile, cx: (scene.stage.x1 + scene.stage.x2) / 2, cy: (scene.stage.y1 + scene.stage.y2) / 2 };
    this.applyCamera();
    this.rest = demoFrame(this.subject(), scene.stage.tile, host.W, host.H, ZOOM_MIN * TILE_SIZE);
    // A figure takes no pointer of its own, so its projection answers in figure px: the box's offset is the origin.
    this.r.viewport.setOriginSource(() => this.host.boxPos());
    this.applyCamera();
    this.cur = this.cellToPx(this.rest.cx, this.rest.cy);
    this.restPan();
    if (this.still) {
      this.finishAll();
      this.frame();
      return;
    }
    this.frame();
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  /**
   * What the scene shows, in cells within its stage: its plot, every map point the pointer and
   * second fingertip go to, and the notes as the renderer draws them, labels and chips included, at
   * the loop's start and at its end. The end is found by playing the scene through once, settled,
   * and rewinding it, so the figure opens on its start. A beat that leaves the map on purpose (the
   * load meter's off-map reading) widens nothing.
   */
  private subject(): CellBox {
    const box = new CellExtent();
    const plot = this.scene.plot;
    if (plot) box.add(plot.x1 - 0.5, plot.y1 - 0.5, plot.x2 + 0.5, plot.y2 + 0.5);
    for (const step of this.steps) {
      if (Array.isArray(step.move)) box.add(step.move[0], step.move[1]);
      if (step.second) box.add(step.second[0], step.second[1]);
    }
    const addInk = () => {
      const ink = this.r.annotationExtent();
      if (ink) box.add(ink.x / TILE_SIZE, ink.y / TILE_SIZE, (ink.x + ink.width) / TILE_SIZE, (ink.y + ink.height) / TILE_SIZE);
    };
    this.view.annotations();
    addInk();
    const still = this.still;
    this.still = true;
    this.finishAll();
    addInk();
    this.still = still;
    this.reset();
    this.r.settleAnnotations();
    return box.within(this.scene.stage);
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
    if (this.host.form.touch) drawFingerMark(this.host.cursorEl, this.press);
    else drawCursorImg(this.host.cursorEl, id);
  }

  /** The bar at rest, panned to the cell the scene arms (the first card on a shelf). */
  private restPan(): void {
    const strip = this.scene.strip;
    const at = strip?.kind === 'tools' ? TOOL_CELLS.findIndex((c) => c.id === strip.active) : 0;
    this.pan = (strip && at >= 0 ? this.host.stripPanFor(at) : null) ?? 0;
    this.panTo = null;
    this.host.panStrip(this.pan);
  }

  /* ── projection: figure pixels ⇄ template cells ─────────────────────────── */

  private applyCamera(): void {
    const z = (this.rest.tile / TILE_SIZE) * this.cam.z;
    const cx = (this.rest.cx + this.cam.dx) * TILE_SIZE;
    const cy = (this.rest.cy + this.cam.dy) * TILE_SIZE;
    this.r.viewport.setView({ zoom: z, offsetX: cx * z - this.host.W / 2, offsetY: cy * z - this.host.H / 2 });
    this.r.applyViewportTransform();
    this.host.onCamera();
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
    this.onControl = 'control' in move;
    if (Array.isArray(move)) return this.cellToPx(move[0], move[1]);
    if ('control' in move) {
      const at = this.host.controlAt(move.control);
      // The control stands where it will once its row has panned to it.
      this.rowPan = at ? this.host.controlPan(move.control) : null;
      return at && this.rowPan ? { x: at.x - (this.rowPan.to - this.rowPan.from), y: at.y } : at;
    }
    const card = this.host.stripCard(move.strip);
    if (!card) return null;
    // The card stands where it will once the bar has panned to it.
    const to = this.host.stripPanFor(move.strip);
    if (to === null) { this.panTo = null; return card; }
    this.panFrom = this.pan;
    this.panTo = to;
    return { x: card.x - (to - this.pan), y: card.y };
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
      if (this.host.form.touch) drawFingerMark(this.host.cursorEl, this.press);
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
    // The share window's own checklist, so the card counts what the in-game list counts.
    return buildChecklist(this.world.state).groups.flatMap((g) => g.items).map(({ catalogId, count }) => ({ catalogId, count }));
  }

  private finishAll(): void {
    for (const step of this.steps) {
      this.applyDiscrete(step);
      if (step.during) step.during(this.ctx, 1);
      if (step.move) {
        const px = this.resolveMove(step.move);
        if (px) this.cur = px;
        if (this.panTo !== null) { this.pan = this.panTo; this.host.panStrip(this.pan); this.panTo = null; }
        if (this.rowPan) { this.rowPan.set(this.rowPan.to); this.rowPan = null; }
      }
      if (step.cam) {
        if (step.cam.dx !== undefined) this.cam.dx = step.cam.dx;
        if (step.cam.dy !== undefined) this.cam.dy = step.cam.dy;
        if (step.cam.z !== undefined) this.cam.z = step.cam.z;
      }
    }
    this.press = false;
    this.second = null;
    if (this.host.form.touch) drawFingerMark(this.host.cursorEl, false);
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
    this.furnitureState = { ...FURNITURE_REST, captions: this.furnitureState.captions };
    this.host.setFurniture(this.furnitureState);
    this.cam = { dx: 0, dy: 0, z: 1 };
    this.restPan();
    this.applyCamera();
    this.cur = this.cellToPx(this.rest.cx, this.rest.cy);
    this.press = false;
    this.onControl = false;
    this.setPointer('select');
    this.si = 0;
    this.stepT = 0;
    this.from = null;
    this.target = null;
    this.steps = this.scene.run(this.ctx, (key) => this.t(key), this.host.form);
    this.second = null;
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
        this.panTo = null;
        this.rowPan = null;
        this.target = step.move ? this.resolveMove(step.move) : null;
        this.beginSecond(step);
        this.applyDiscrete(step);
      }
      const k = Math.min(1, this.stepT / dur);
      // The scenes' hand glides on the same curve, so the pointer and the tool it feeds move as one.
      const e = ease(k);
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
      if (this.rowPan) this.rowPan.set(this.rowPan.from + (this.rowPan.to - this.rowPan.from) * e);
      if (this.panTo !== null) {
        this.pan = this.panFrom + (this.panTo - this.panFrom) * e;
        this.host.panStrip(this.pan);
      }
      if (this.secondTo && this.secondFrom) {
        this.second = {
          x: this.secondFrom.x + (this.secondTo.x - this.secondFrom.x) * e,
          y: this.secondFrom.y + (this.secondTo.y - this.secondFrom.y) * e,
        };
      }
      if (step.during) step.during(this.ctx, k);
      if (k >= 1) { this.si++; this.stepT = 0; this.from = null; this.target = null; this.panTo = null; this.rowPan = null; }
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
    const fingerEl = this.host.fingerEl;
    if (this.second) {
      fingerEl.style.display = '';
      fingerEl.style.left = `${this.second.x}px`;
      fingerEl.style.top = `${this.second.y}px`;
    } else if (fingerEl.style.display !== 'none') {
      fingerEl.style.display = 'none';
    }

    const cell = this.pxToCell(this.cur);
    const box = this.host.boxPos();
    const onMap = !this.onControl && this.cur.y >= box.y && this.cur.y <= box.y + this.host.H
      && this.cur.x >= box.x && this.cur.x <= box.x + this.host.W
      && !!this.world.state.cells[Math.round(cell.y)]?.[Math.round(cell.x)];

    // The load meter reads the region under the pointer and holds the last once it leaves the map.
    if (this.furnitureState.loadMeter && onMap) {
      const { cx, cy } = mapChunkAt(this.world.state.template, Math.floor(cell.x), Math.floor(cell.y));
      const was = this.furnitureState.loadRegion;
      if (!was || was.cx !== cx || was.cy !== cy) this.furniture({ loadRegion: { cx, cy } });
    }

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
    // A picked tool draws its own hover and ghost, as on the live map.
    if (this.ghostHeld || !onMap || this.world.toolPicked) {
      if (this.hoverCell) { this.overlay.clearHover(); this.hoverCell = null; }
    } else if (this.hoverCell !== key) {
      this.overlay.showHover({ x: hoverX, y: hoverY, w: 1, h: 1 }, TERRAIN_GRID);
      this.hoverCell = key;
    }
  }

  /** A step's second fingertip: it lands where the step puts it (gliding from where it stood, or
   *  from the first finger), and a step setting null lifts it. A mouse reader's figure has none. */
  private beginSecond(step: SceneStep): void {
    if (step.second === undefined || !this.host.form.touch) { this.secondFrom = null; this.secondTo = null; return; }
    if (step.second === null) { this.second = null; this.secondFrom = null; this.secondTo = null; return; }
    const to = this.cellToPx(step.second[0], step.second[1]);
    this.secondFrom = this.second ?? { ...this.cur };
    this.secondTo = to;
    this.second = { ...this.secondFrom };
    drawFingerMark(this.host.fingerEl, true);
  }

  /** The click indicator: a ring that blooms out of the press point. */
  private pulse(): void {
    if (this.still) return;
    firePressPulse(this.host.pulseEl);
  }
}

/** What a demo figure hands its standup: its scene, its box and pointer elements, and where the
 *  furniture and readiness go. */
interface DemoStandup {
  scene: HelpScene;
  W: number;
  H: number;
  outer: HTMLElement;
  canvasHost: HTMLElement;
  cursorEl: HTMLElement;
  fingerEl: HTMLElement;
  pulseEl: HTMLElement;
  form: SceneForm;
  strip: () => HTMLElement | null;
  box: () => HTMLElement | null;
  t: Translate;
  onFurniture: (f: Furniture) => void;
  onReady: (ready: boolean) => void;
  /** Hands the figure the world's curve sessions and the renderer's view, so the live curve handle
   *  layer stands on the figure's map; null on teardown. */
  /** Hands the figure its world and view, so the live map controls (curve handles, maze marks, the
   *  load meter, the checklist) stand on the figure's map; null on teardown. */
  onMap: (map: DemoMap | null) => void;
  /** The bar's height standing over the map's foot; the canvas draws that much more map below. */
  barH: number;
  /** The element the bar pans by. */
  stripPan: () => HTMLElement | null;
}

/** The figure's map as its controls read it: the projection answers in the map box's own px. */
export interface DemoMap {
  state: SandboxWorld['state'];
  curves: SandboxWorld['curve'];
  view: () => Pick<ActiveView, 'overlay' | 'projection'>;
  watch: (tell: () => void) => () => void;
  /** The world's selection, its map and touch multi-select's latch, read live. */
  selection: () => { selection: readonly BlockRef[]; gridState: GridState; latched: boolean };
  /** Calls `tell` whenever the selection, the latch or the objects change, with an edit's cause;
   *  returns the unsubscribe. */
  onSelection: (tell: (cause?: string) => void) => () => void;
}

/** Every caption a scene's steps say, in order of first use. */
function captionsOf(steps: readonly SceneStep[]): TextKey[] {
  return [...new Set(steps.flatMap((s) => (s.capKey ? [s.capKey] : [])))];
}

/** Stands a demo up in the standup queue (renderer, world, player) and returns its teardown. */
export function standUpDemo(opts: DemoStandup): () => void {
  const { scene, W, H, outer, canvasHost, cursorEl, pulseEl } = opts;
  // No 2D canvas context means no renderer either (a DOM test environment): the guard must run
  // Before the dynamic import, or loading Pixi is itself the crash.
  const probe = document.createElement('canvas');
  if (typeof probe.getContext !== 'function' || !probe.getContext('2d')) return () => {};
  let disposed = false;
  const moved = createSignal();
  let player: Player | null = null;
  let renderer: MapRenderer | null = null;
  let visibility: IntersectionObserver | null = null;
  // Strip card centers, measured against the figure box (the pointer's own space).
  const stripCard = (i: number): { x: number; y: number } | null => {
    const strip = opts.strip();
    if (!strip) return null;
    const card = stripCardElement(strip, scene.strip?.kind ?? 'shelf', i);
    if (!card) return null;
    const cardRect = visualRect(card);
    const outerRect = visualRect(outer);
    // Rect deltas are screen px; the cursor is positioned in the column's layout px. Any
    // ancestor zoom (the chrome scale the help window rides, the user's UI zoom) scales the
    // two apart, so divide it back out the way `measureBox` does.
    const zoom = outerRect.width / (outer.offsetWidth || outerRect.width);
    return {
      x: (cardRect.left + cardRect.width / 2 - outerRect.left) / zoom,
      y: (cardRect.top + cardRect.height / 2 - outerRect.top) / zoom,
    };
  };
  /** The bar's pan that stands card `i` in the crop with room either side, clamped to the bar's
   *  ends; null where the whole bar fits. Figure px, against an unpanned bar. */
  const stripPanFor = (i: number): number | null => {
    const strip = opts.strip();
    const pan = opts.stripPan();
    if (!strip || !pan) return null;
    const outerRect = visualRect(outer);
    const zoom = outerRect.width / (outer.offsetWidth || outerRect.width);
    const crop = strip.clientWidth;
    const full = visualRect(pan).width / zoom;
    if (full <= crop + 0.5) return null;
    const card = stripCardElement(strip, scene.strip?.kind ?? 'shelf', i);
    if (!card) return null;
    const panRect = visualRect(pan);
    const cardRect = visualRect(card);
    const centre = (cardRect.left + cardRect.width / 2 - panRect.left) / zoom;
    return Math.max(0, Math.min(full - crop, centre - crop / 2));
  };
  const controlAt = (testId: string): { x: number; y: number } | null => {
    const el = opts.box()?.querySelector(`[data-testid="${testId}"]`);
    if (!el) return null;
    const r = visualRect(el);
    const outerRect = visualRect(outer);
    const zoom = outerRect.width / (outer.offsetWidth || outerRect.width);
    return { x: (r.left + r.width / 2 - outerRect.left) / zoom, y: (r.top + r.height / 2 - outerRect.top) / zoom };
  };
  /** Clear air kept between a panned control and the box's sides, in figure px. */
  const PAN_MARGIN = 8;
  const controlPan = (testId: string): ControlPan | null => {
    const boxEl = opts.box();
    const el = boxEl?.querySelector(`[data-testid="${testId}"]`);
    const row = el?.closest<HTMLElement>(`[${PAN_ROW_ATTR}]`);
    if (!boxEl || !el || !row) return null;
    const outerRect = visualRect(outer);
    const zoom = outerRect.width / (outer.offsetWidth || outerRect.width);
    const from = Number(row.getAttribute(PAN_ROW_ATTR)) || 0;
    const boxLeft = visualRect(boxEl).left;
    const width = boxEl.clientWidth;
    const r = visualRect(el);
    const rowRect = visualRect(row);
    // Unpanned places, in the box's px.
    const left = (r.left - boxLeft) / zoom + from, right = (r.right - boxLeft) / zoom + from;
    const full = rowRect.width / zoom;
    const reach = Math.max(0, full - width);
    const to = Math.max(0, Math.min(reach, Math.min(left - PAN_MARGIN, Math.max(from, right + PAN_MARGIN - width))));
    if (Math.abs(to - from) < 0.5) return null;
    const clip = row.parentElement;
    const set = (px: number) => {
      row.setAttribute(PAN_ROW_ATTR, String(px));
      row.style.transform = px ? `translateX(${-px}px)` : '';
      if (!clip) return;
      const mask = fadeMask('x', { start: px > 0.5 ? SCROLL_FADE : 0, end: px < reach - 0.5 ? SCROLL_FADE : 0 }) ?? '';
      clip.style.maskImage = mask;
      clip.style.webkitMaskImage = mask;
    };
    return { from, to, set };
  };
  const panStrip = (px: number) => {
    const pan = opts.stripPan();
    const strip = opts.strip();
    if (!pan || !strip) return;
    pan.style.transform = px ? `translateX(${-px}px)` : '';
    const outerRect = visualRect(outer);
    const zoom = outerRect.width / (outer.offsetWidth || outerRect.width);
    const full = visualRect(pan).width / zoom;
    const mask = fadeMask('x', { start: px > 0.5 ? SCROLL_FADE : 0, end: px + strip.clientWidth < full - 0.5 ? SCROLL_FADE : 0 }) ?? '';
    strip.style.maskImage = mask;
    strip.style.webkitMaskImage = mask;
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
    const [{ MapRenderer: Renderer }] = await Promise.all([loadMapRenderer(), prepareSceneWorld(scene)]);
    if (disposed) return;
    const world = sceneWorld(scene);
    // The pictured bar's chip shows the visitor's own auto-trim setting, so the pictured
    // strokes obey the same setting.
    world.autoTrim = useEditorStore.getState().autoEdgeCut;
    // A figure-sized canvas on a software rasterizer skips WebGL outright: pixi's Canvas2D
    // starts at once where a software GL context costs most of a second per figure.
    renderer = new Renderer(world.bus, canvasHost, W, H + opts.barH, { preferCanvas: glQuality() === 'lite' });
    // Tools a scene arms draw their previews on this figure's overlay, as the live tools draw on the map's.
    world.drawToolsOn(renderer.asEditorView().overlay);
    const facts = helpFacts(useEditorStore.getState().locale);
    const view = renderer.asEditorView();
    // The projection answers in the column's px (the pointer's); the map's controls stand in the box.
    const live = view.projection;
    const projection: ViewProjection = {
      screenToPoint: (sx, sy) => live.screenToPoint(sx + boxAt.x, sy + boxAt.y),
      cellToScreen: (x, y) => { const p = live.cellToScreen(x, y); return { ...p, x: p.x - boxAt.x, y: p.y - boxAt.y }; },
    };
    const boxView = { overlay: view.overlay, projection };
    opts.onMap({
      state: world.state, curves: world.curve, view: () => boxView, watch: (tell) => moved.subscribe(tell),
      selection: () => ({ selection: world.selection, gridState: world.state, latched: world.multiSelectLatched }),
      onSelection: (tell) => world.watchSelection(tell),
    });
    player = new Player(
      renderer, world, scene,
      (key, params) => opts.t(key as TextKey, params ? { ...facts, ...params } : facts),
      {
        W, H, cursorEl, fingerEl: opts.fingerEl, pulseEl, form: opts.form, stripCard, controlAt, controlPan, stripPanFor, panStrip, boxPos,
        setFurniture: opts.onFurniture, onCamera: () => moved.emit(),
      },
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
    opts.onMap(null);
    visibility?.disconnect();
    boxWatch?.disconnect();
    player?.dispose();
    renderer?.destroy();
    if (canvasHost) canvasHost.replaceChildren();
  };
}
