/*
 * Help figures run the real 2D renderer and tool paths against an isolated demo world. DOM overlays
 * reuse the app's pointer, hints, captions, notices, and controls. Pointer positions use figure pixels
 * so scenes can cross between map and shelf, converting through the live viewport when cell data is
 * needed. Pixi loads only when canvas exists. Reduced motion renders the settled end state once.
 */
import { useEffect, useRef, useState } from 'react';
import type { MapRenderer } from '../../../../../canvas/map2d/map-renderer';
import { TILE_SIZE } from '../../../../../core/model/constants';
import { HALF_TILE } from '../../../../../core/model/grid-model';
import { annotationInkScale } from '../../../../../core/model/annotations';
import { isMotionReduced } from '../../../../../canvas/map2d/motion-state';
import { getCatalogItem } from '../../../../../state/catalog';
import { footprintCells, getRotatedSize } from '../../../../../state/object-geometry';
import { GHOST_VALID, GHOST_INVALID } from '../../../../../tools/objects/object-placer';
import { useKeybinds } from '../../../../../core/runtime/keybindings';
import type { MacroCoord, PlacementTrait } from '../../../../../core/model/types';
import { detectBridgeSpan } from '../../../../../core/model/bridge-span';
import { useEditorStore } from '../../../../../state/store';
import { localizedName, useT } from '../../../../../i18n/context';
import { tagLabel } from '../../../../../i18n/annotation-tags';
import { resolveTokenSpecs, type TokenSpec } from '../../../../hints/catalogue';
import { HintTokens } from '../../../../hints/tokens';
import { helpFacts } from '../facts';
import { INK, PLATE, PLATE_INK } from '../../../../design/tokens';
import { colors, font, radii, shadows } from '../../../../design/styles';
import { roleFont } from '../../../../design/text-weight';
import { LoadDiscSvg } from '../../../../shell/windows/LoadMeter';
import { LoadingDots } from '../../../../primitives/LoadingDots';
import { face as handleFace, GRAB, KNOB } from '../../../floating/CurveHandles';
import { anchorHandles, type CurveAnchor } from '../../../../../tools/paint/shapes';
import { gateMarkStyle, MIN_PX } from '../../../../shell/bars/MazeEndpoints';
import { ToastFace } from '../../../floating/Toast';
import { ChecklistItemRow } from '../../export/BuildChecklist';
import { figureCaption, firePressPulse, pressPulseFace } from './caption';
import { drawCursorImg } from './demo-cursor';
import { DemoWorld } from './demo-world';
import { useInView, NEAR } from './use-in-view';
import { queueStandup } from './standup-queue';
import { glQuality } from '../../../../../core/runtime/device-quality';
import { TerrainToolsStrip, ShelfStrip } from './previews/strips';
import type { DemoCtx, DemoView, HelpScene, SceneStep, Stage } from './scenes';

type Resolver = (key: string, params?: Record<string, string | number>) => string;

interface Cam { dx: number; dy: number; z: number }
type Toast =
  | { kind: 'key'; key: string; params?: Record<string, string | number> }
  | { kind: 'refusal'; message: string; params?: Record<string, string | number>; tone: 'error' | 'warning' }
  | null;

interface Furniture {
  capKey: string | null;
  toast: Toast;
  keys: readonly TokenSpec[] | null;
  marks: Array<{ x: number; y: number; labelKey: string }>;
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

const FURNITURE_REST: Furniture = {
  capKey: null, toast: null, keys: null, marks: [], gauge: -1, stripSelected: null,
  stripSize: null, toolsActive: null, shelfCounts: null, checklist: null, curveHandles: null,
};

function footprint(catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270): MacroCoord[] {
  const item = getCatalogItem(catalogId);
  const { w, h } = getRotatedSize(item ?? { width: 1, height: 1 }, rotation);
  return footprintCells(Math.floor(x), Math.floor(y), w, h);
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
  private cam: Cam = { dx: 0, dy: 0, z: 1 };
  private press = false;
  private follow: { catalogId: string; rotation: 0 | 90 | 180 | 270 } | null = null;
  private followAnchor: string | null = null;
  private ghostHeld = false;
  private hoverCell: string | null = null;
  private view: DemoView;
  private ctx: DemoCtx;
  private furnitureState: Furniture = { ...FURNITURE_REST };

  constructor(
    private r: MapRenderer,
    private world: DemoWorld,
    private scene: HelpScene,
    private t: Resolver,
    private W: number,
    private H: number,
    private cursorEl: HTMLElement,
    private pulseEl: HTMLElement,
    /** Center of strip card `i`, in figure pixels, or null before the strip lays out. */
    private stripCard: (i: number) => { x: number; y: number } | null,
    /** The map box's top-left within the figure column: the strip below can be wider than the
     *  box, so box space and figure space no longer share an origin. */
    private boxPos: () => { x: number; y: number },
    private setFurniture: (f: Furniture) => void,
  ) {
    this.view = this.makeView();
    this.ctx = { world, view: this.view };
    this.still = isMotionReduced();
    this.steps = scene.run(this.ctx, (key) => this.t(key));
    this.r.initMap(world.state, true, false, { labels: false });
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
    drawCursorImg(this.cursorEl, id);
  }

  /* ── projection: figure pixels ⇄ template cells ─────────────────────────── */

  private applyCamera(): void {
    const s = this.scene.stage;
    const z = (s.tile / TILE_SIZE) * this.cam.z;
    const cx = (((s.x1 + s.x2 + 1) / 2) + this.cam.dx) * TILE_SIZE - HALF_TILE;
    const cy = (((s.y1 + s.y2 + 1) / 2) + this.cam.dy) * TILE_SIZE - HALF_TILE;
    this.r.viewport.setView({ zoom: z, offsetX: cx * z - this.W / 2, offsetY: cy * z - this.H / 2 });
    this.r.applyViewportTransform();
  }

  /** A terrain cell's CENTER (world `x*64`) in figure px (the box's own px plus its offset). */
  private cellToPx(x: number, y: number): { x: number; y: number } {
    const view = this.r.viewport.getView();
    const box = this.boxPos();
    return {
      x: x * TILE_SIZE * view.zoom - view.offsetX + box.x,
      y: y * TILE_SIZE * view.zoom - view.offsetY + box.y,
    };
  }

  private pxToCell(px: { x: number; y: number }): { x: number; y: number } {
    const view = this.r.viewport.getView();
    const box = this.boxPos();
    return {
      x: (px.x - box.x + view.offsetX) / (TILE_SIZE * view.zoom),
      y: (px.y - box.y + view.offsetY) / (TILE_SIZE * view.zoom),
    };
  }

  private resolveMove(move: NonNullable<SceneStep['move']>): { x: number; y: number } | null {
    if (Array.isArray(move)) return this.cellToPx(move[0], move[1]);
    return this.stripCard(move.strip);
  }

  /* ── the view a scene speaks through ────────────────────────────────────── */

  private makeView(): DemoView {
    const overlay = () => this.r.overlayLayer;
    return {
      ghost: (catalogId, x, y, rotation, ok, cells) => {
        overlay().showGhost(cells ?? footprint(catalogId, x, y, rotation), ok ? GHOST_VALID : GHOST_INVALID, false);
        overlay().showPlacementGhost(catalogId, x, y, rotation, ok, 0);
        this.ghostHeld = true;
      },
      clearGhost: () => { overlay().clearGhost(); this.ghostHeld = false; },
      groupGhost: (members) => { overlay().showGroupPlacementGhost(members, true); this.ghostHeld = true; },
      selection: (x, y, w, h, append) => { overlay().showSelection(x, y, w, h, undefined, false, append); },
      clearSelection: () => { overlay().clearSelection(); },
      band: (rect) => {
        if (rect) overlay().showBand({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
        else overlay().clearBand();
      },
      paintGhost: (cells, icon = 'mountain') => {
        if (cells) { overlay().showGhost(cells, { icon, valid: true }, icon !== 'ground'); this.ghostHeld = true; }
        else { overlay().clearGhost(); this.ghostHeld = false; }
      },
      region: (cells) => {
        if (cells) overlay().showBuildableRegion(cells, true);
        else overlay().clearBuildableRegion();
      },
      route: (cells) => {
        if (cells) overlay().showRoute(cells);
        else overlay().clearRoute();
      },
      marks: (marks) => { this.furniture({ marks: [...marks] }); },
      gauge: (v) => { this.furniture({ gauge: v }); },
      plop: (id) => { if (!this.still) this.r.objectLayer.requestPlop(id); },
      poof: (id) => { if (!this.still) this.r.objectLayer.animateRemove(id); },
      spin: (id, fromDeg, toDeg) => { if (!this.still) this.r.objectLayer.animateRotation(id, fromDeg, toDeg); },
      groupSpin: (turn) => { if (!this.still) this.r.objectLayer.animateGroupRotation(turn); },
      annotations: (draft, selection) => {
        this.r.annotationLayer.draw(this.world.state.annotations ?? null, {
          draft: draft ?? null, selectionIds: selection ?? [], inkScale: annotationInkScale(this.world.state.template),
          tagLabel: (tag) => tagLabel(tag, useEditorStore.getState().locale),
        });
        this.r.requestRender();
      },
      curveHandles: (anchors) => { this.furniture({ curveHandles: anchors ? anchors.map((a) => ({ ...a })) : null }); },
    };
  }

  private furniture(patch: Partial<Furniture>): void {
    this.furnitureState = { ...this.furnitureState, ...patch };
    this.setFurniture(this.furnitureState);
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
    // The refusal is read AFTER `on`, which is the step that provoked it.
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
    const o = this.r.overlayLayer;
    o.clearGhost(); o.clearHover(); o.clearSelection(); o.clearBand(); o.clearBuildableRegion(); o.clearRoute();
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
    this.setFurniture(this.furnitureState);
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
    this.cursorEl.style.left = `${this.cur.x}px`;
    this.cursorEl.style.top = `${this.cur.y}px`;
    this.pulseEl.style.left = `${this.cur.x}px`;
    this.pulseEl.style.top = `${this.cur.y}px`;

    const cell = this.pxToCell(this.cur);
    const box = this.boxPos();
    const onMap = this.cur.y >= box.y && this.cur.y <= box.y + this.H
      && this.cur.x >= box.x && this.cur.x <= box.x + this.W
      && !!this.world.state.cells[Math.round(cell.y)]?.[Math.round(cell.x)];

    // The follow-ghost: anchored so the footprint centers on the pointer, validity from the rules
    // at every anchor it crosses. A span item (a bridge) previews the way the span placer does:
    // the real detector answers with the whole deck, or with nothing where no legal span stands.
    if (this.follow) {
      if (onMap) {
        const item = getCatalogItem(this.follow.catalogId);
        const span = item?.traits?.find((t): t is Extract<PlacementTrait, { type: 'waterSpan' }> => t.type === 'waterSpan');
        if (item && span) {
          const anchor = { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };
          const key = `span:${anchor.x},${anchor.y}`;
          if (this.followAnchor !== key) {
            this.followAnchor = key;
            const deck = detectBridgeSpan(this.world.state, anchor, item.width, span.min, span.max);
            if (deck) this.view.ghost(this.follow.catalogId, deck.position.x, deck.position.y, deck.rotation, true, deck.cells);
            else this.view.clearGhost();
          }
        } else {
          const { w: fw, h: fh } = getRotatedSize(item ?? { width: 1, height: 1 }, this.follow.rotation);
          const ax = Math.round(cell.x - (fw - 1) / 2);
          const ay = Math.round(cell.y - (fh - 1) / 2);
          const key = `${ax},${ay}`;
          if (this.followAnchor !== key) {
            this.followAnchor = key;
            this.view.ghost(this.follow.catalogId, ax, ay, this.follow.rotation, this.world.canPlace(this.follow.catalogId, ax, ay, this.follow.rotation));
          }
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
    const key = `${hoverX},${hoverY}`;
    if (this.ghostHeld || !onMap) {
      if (this.hoverCell) { this.r.overlayLayer.clearHover(); this.hoverCell = null; }
    } else if (this.hoverCell !== key) {
      this.r.overlayLayer.showHover(hoverX, hoverY, 1, 1, true);
      this.hoverCell = key;
    }
  }

  /** The click indicator: a ring that blooms out of the press point. */
  private pulse(): void {
    if (this.still) return;
    firePressPulse(this.pulseEl);
  }
}

/** The load disc: the meter's own drawing. */
function LoadDisc({ fill }: { fill: number }) {
  return <LoadDiscSvg fill={fill} maskId="help-load-hole" style={{ width: 44, height: 44 }} />;
}

/** The built-pieces card: real localized names, real icons, real counts from the demo world. */
function BuiltCard({ rows, title }: { rows: Array<{ catalogId: string; count: number }>; title: string }) {
  const locale = useEditorStore((s) => s.locale);
  // Imperative entrance (the press pulse's own idiom): the demo box sits under nested presence
  // gates that can hold a framer child at its initial frame, and a card that never reaches
  // opacity 1 is a card that does not exist.
  const enter = (el: HTMLDivElement | null) => {
    if (!el || typeof el.animate !== 'function' || isMotionReduced()) return;
    el.animate(
      [
        { opacity: 0, transform: 'translateY(10px) scale(0.95)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
  };
  return (
    <div
      ref={enter}
      style={{
        position: 'relative', background: PLATE, borderRadius: radii.md,
        boxShadow: shadows.s2, padding: '12px 16px', display: 'flex', flexDirection: 'column',
        gap: 6, pointerEvents: 'none',
      }}
    >
      <span style={{ ...roleFont('small'), color: INK, fontFamily: font.family }}>{title}</span>
      {rows.map((row) => {
        const item = getCatalogItem(row.catalogId);
        if (!item) return null;
        return (
          <ChecklistItemRow
            key={row.catalogId}
            icon={item.icon}
            color={item.color}
            name={localizedName(item.name, locale)}
            countText={`x${row.count}`}
          />
        );
      })}
    </div>
  );
}

export function HelpDemo({ scene }: { scene: HelpScene }) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const locale = useEditorStore((s) => s.locale);
  const overrides = useKeybinds((s) => s.overrides);
  const outerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const [furniture, setFurniture] = useState<Furniture>(FURNITURE_REST);
  /** The first frame is on the canvas. Until then the box holds the app's own dots: a demo that
   *  starts as the reader arrives (`use-in-view`) has a beat of import and world-building first,
   *  and an empty box for that beat reads as a figure that failed. */
  const [ready, setReady] = useState(false);

  const stage: Stage = scene.stage;
  const W = Math.round((stage.x2 - stage.x1 + 1) * stage.tile);
  const H = Math.round((stage.y2 - stage.y1 + 1) * stage.tile);

  const inView = useInView(outerRef);

  useEffect(() => {
    // The renderer, the world and the timeline stand up only once the figure nears the viewport:
    // a page mounts every demo at once, and a reader arrives at the top.
    if (!inView) return undefined;
    // No 2D canvas context means no renderer either (a DOM test environment): the guard must run
    // BEFORE the dynamic import, or loading Pixi is itself the crash.
    const probe = document.createElement('canvas');
    if (typeof probe.getContext !== 'function' || !probe.getContext('2d')) return undefined;
    const outer = outerRef.current;
    const canvasHost = canvasHostRef.current;
    const cursorEl = cursorRef.current;
    const pulseEl = pulseRef.current;
    if (!outer || !canvasHost || !cursorEl || !pulseEl) return undefined;
    let disposed = false;
    let player: Player | null = null;
    let renderer: MapRenderer | null = null;
    let visibility: IntersectionObserver | null = null;
    // Strip card centers, measured against the figure box (the pointer's own space).
    const stripCard = (i: number): { x: number; y: number } | null => {
      const strip = stripRef.current;
      if (!strip) return null;
      const card = strip.querySelectorAll('[data-strip-card]')[i];
      if (!card) return null;
      const cardRect = card.getBoundingClientRect();
      const outerRect = outer.getBoundingClientRect();
      // Rect deltas are SCREEN px; the cursor is positioned in the column's LAYOUT px. Any
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
    const measureBoxAt = () => { boxAt = { x: boxRef.current?.offsetLeft ?? 0, y: boxRef.current?.offsetTop ?? 0 }; };
    measureBoxAt();
    const boxWatch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureBoxAt) : null;
    boxWatch?.observe(outer);
    const boxPos = () => boxAt;
    queueStandup(async () => {
      if (disposed) return;
      const { MapRenderer: Renderer } = await import('../../../../../canvas/map2d/map-renderer');
      if (disposed) return;
      const world = new DemoWorld(scene.template);
      // The pictured bar's chip shows the visitor's own auto-trim setting, so the pictured
      // strokes obey the same setting.
      world.autoTrim = useEditorStore.getState().autoEdgeCut;
      // A figure-sized canvas on a software rasterizer skips WebGL outright: pixi's Canvas2D
      // starts at once where a software GL context costs most of a second per figure.
      renderer = new Renderer(world.bus, canvasHost, W, H, { preferCanvas: glQuality() === 'lite' });
      const facts = helpFacts(useEditorStore.getState().locale);
      player = new Player(
        renderer, world, scene,
        (key, params) => tRef.current(key, params ? { ...facts, ...params } : facts),
        W, H, cursorEl, pulseEl, stripCard, boxPos, setFurniture,
      );
      player.setPointer('select');
      // The Player's constructor has drawn the first frame by here.
      setReady(true);
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
      setReady(false);
      visibility?.disconnect();
      boxWatch?.disconnect();
      player?.dispose();
      renderer?.destroy();
      if (canvasHost) canvasHost.replaceChildren();
    };
  }, [scene, W, H, inView]);

  const facts = helpFacts(locale);
  const toastText = furniture.toast
    ? furniture.toast.kind === 'key'
      ? t(furniture.toast.key, { ...facts, ...furniture.toast.params })
      : t(furniture.toast.message, { ...facts, ...furniture.toast.params })
    : null;
  const keyTokens = furniture.keys ? resolveTokenSpecs(furniture.keys, overrides) : null;
  const stagePx = (x: number, y: number) => ({
    left: (x - stage.x1 + 0.5) * stage.tile,
    top: (y - stage.y1 + 0.5) * stage.tile,
  });
  const strip = scene.strip;

  return (
    <div
      ref={outerRef}
      aria-hidden
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: font.family }}
    >
      <div
        ref={boxRef}
        style={{
          position: 'relative', width: W, height: H, flex: 'none',
          borderRadius: radii.md, overflow: 'hidden', contain: 'paint',
        }}
      >
        <div ref={canvasHostRef} style={{ position: 'absolute', inset: 0 }} />
        {!ready && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <LoadingDots color={PLATE_INK} />
          </div>
        )}
        {/* Gate pills, the way MazeEndpoints shows them. Positioned against the stage frame: the
            scenes that carry marks hold their camera still. */}
        {furniture.marks.map((m, i) => (
          <div
            key={`${m.labelKey}-${i}`}
            style={{
              position: 'absolute', ...stagePx(m.x, m.y), transform: 'translate(-50%, -50%)',
              display: 'flex', alignItems: 'center', pointerEvents: 'none',
              ...gateMarkStyle(Math.max(MIN_PX, stage.tile)),
            }}
          >
            {t(m.labelKey)}
          </div>
        ))}
        {/* A finished curve's adjust handles: the live controls' own faces and direction lines
            (`CurveHandles.tsx`), positioned against the stage frame the way the gate pills are.
            Terrain anchors sit on the micro grid, half a cell up-left of the macro centre, so
            they project without the pills' half-cell shift. */}
        {furniture.curveHandles && (() => {
          const k = Math.min(1, Math.max(0.45, stage.tile / TILE_SIZE));
          const hs = anchorHandles(furniture.curveHandles);
          const px = (x: number, y: number) => ({ x: (x - stage.x1) * stage.tile, y: (y - stage.y1) * stage.tile });
          const dot = (x: number, y: number, size: number, fill: string, key: string) => {
            const p = px(x, y);
            return (
              <span key={key} style={{ position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
                <span style={{ ...handleFace(size, fill), display: 'block' }} />
              </span>
            );
          };
          return (
            <>
              <svg width={W} height={H} aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
                {furniture.curveHandles.map((a, i) => {
                  const h = hs[i]!;
                  const into = px(a.x + h.ihx, a.y + h.ihy);
                  const at = px(a.x, a.y);
                  const out = px(a.x + h.hx, a.y + h.hy);
                  return (
                    <polyline
                      key={i}
                      points={`${into.x},${into.y} ${at.x},${at.y} ${out.x},${out.y}`}
                      fill="none" stroke={colors.frameDark} strokeWidth={3 * k} strokeOpacity={0.35}
                      strokeLinecap="round" strokeLinejoin="round"
                    />
                  );
                })}
              </svg>
              {furniture.curveHandles.map((a, i) => {
                const h = hs[i]!;
                return [
                  dot(a.x + h.ihx, a.y + h.ihy, KNOB * k, colors.panelCream, `${i}-into`),
                  dot(a.x + h.hx, a.y + h.hy, KNOB * k, colors.panelCream, `${i}-out`),
                  dot(a.x, a.y, GRAB * k, colors.tileYellow, `${i}-grab`),
                ];
              })}
            </>
          );
        })()}
        {furniture.gauge >= 0 && (
          <div style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none' }}>
            <LoadDisc fill={furniture.gauge} />
          </div>
        )}
        {furniture.checklist && furniture.checklist.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div
              ref={(el) => {
                if (!el || typeof el.animate !== 'function' || isMotionReduced()) return;
                el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
              }}
              style={{ position: 'absolute', inset: 0, background: colors.surfaceOverlay }}
            />
            <BuiltCard rows={furniture.checklist} title={t('help.fig.built_title', facts)} />
          </div>
        )}
        {/* Caption, key chips and toast share ONE stacked column, so none can cover another. */}
        {(furniture.capKey || keyTokens || toastText) && (
          <div
            style={{
              position: 'absolute', top: 6, left: 0, right: 0, display: 'flex',
              flexDirection: 'column', alignItems: 'center', gap: 5, pointerEvents: 'none',
            }}
          >
            {furniture.capKey && (
              <span style={figureCaption({ role: 'small', padding: '4px 12px', ink: INK, alpha: 0.92, maxWidth: '92%' })}>
                {t(furniture.capKey, facts)}
              </span>
            )}
            {keyTokens && <HintTokens tokens={keyTokens} />}
            {/* A scripted notice keeps the live raiser's 'info'; a refusal carries the world's own tone. */}
            {furniture.toast && toastText && (
              <ToastFace
                text={toastText}
                type={furniture.toast.kind === 'refusal' ? furniture.toast.tone : 'info'}
                count={1}
              />
            )}
          </div>
        )}
      </div>
      {/* The strip stands below the map box rather than over it: it is often wider than the crop,
          and inside the box the crop's own overflow would cut its ends. */}
      {strip && (
        <div ref={stripRef} style={{ display: 'flex', justifyContent: 'center', pointerEvents: 'none', marginTop: 6 }}>
          {strip.kind === 'tools'
            ? <TerrainToolsStrip active={furniture.toolsActive ?? strip.active} surface={strip.surface} size={furniture.stripSize ?? undefined} />
            : <ShelfStrip items={strip.items} smart={strip.smart} selected={furniture.stripSelected} counts={furniture.shelfCounts} />}
        </div>
      )}
      <div ref={pulseRef} style={{ position: 'absolute', zIndex: 2, ...pressPulseFace }} />
      <div ref={cursorRef} style={{ position: 'absolute', pointerEvents: 'none', zIndex: 2 }} />
      {/* PLATE anchors the pointer's fallback tint while its art decodes. */}
      <span style={{ display: 'none', color: PLATE }} />
    </div>
  );
}
