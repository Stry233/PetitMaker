import * as PIXI from 'pixi.js-legacy';
import { APP_FONT_FAMILY } from '../../../../assets/fonts/family';
import { TILE_SIZE, gridOffsetPx } from '../../geometry/world';
import { hexStringToNumber } from '../../../../core/base/color';
import { animConfig, easeOutBack } from '../../../shared/motion/anim-config';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import { selectionPopAmplitude } from '../object-animations';
import type { Rect } from '../../../../core/grid/rect';
import type { SelectionOpts } from '../../../../tools/pointer/runtime';
import type { GridId } from '../../../../core/grid/grids';
import { HOVER_BOX, SELECTION_MARKS, bracketArm, ringRadius } from '../../../shared/overlay/selection-marks';
import { MAP_TEXT, MAP_INK, MAP_EDGE_ALPHA } from '../../../../assets/brand-palette';
import type { OverlayHost } from './host';
import type { WorldRect } from './paint';
import { layerNumeral } from '../../../../i18n/terms/layer-name';

/** Selection marks wear the map-label treatment: warm off-white ink with a translucent dark edge. */
const SELECTION_CREAM = hexStringToNumber(MAP_TEXT);
const SELECTION_EDGE = hexStringToNumber(MAP_INK);
const SELECTION_EDGE_ALPHA = MAP_EDGE_ALPHA;
const { stroke: MARK_STROKE, edge: MARK_EDGE, pad: MARK_PAD, groupPad: MARK_GROUP_PAD, ringStroke: RING_STROKE, ringEdge: RING_EDGE } = SELECTION_MARKS;

/** Selection marks and the hover box, in screen px whatever the zoom. */
export class OverlayMarks {
  constructor(private readonly host: OverlayHost) {}

  readonly hoverGraphics = new PIXI.Graphics();
  readonly selectionGraphics = new PIXI.Graphics();
  /** The brackets around a whole group, redrawn as members append. */
  readonly selectionFrame = new PIXI.Graphics();
  /** Holds the selection's elevation label. */
  readonly labelSlot = new PIXI.Container();
  private selectionRects: WorldRect[] = [];
  private selectionUnion: WorldRect | null = null;
  private selectionExact = false;
  private selectionLabel: PIXI.Text | null = null;

  private lastSelKey = '';
  private selAnimId: number | null = null;

  /** Brief scale-pop of the selection ring when a new block is selected —
   *  scales the selectionGraphics around the ring's center. Skipped under
   *  reduced motion. */
  private popSelection(cx: number, cy: number, spanPx: number): void {
    if (this.host.disposed || isMotionReduced()) return;
    if (this.selAnimId !== null) { cancelAnimationFrame(this.selAnimId); this.selAnimId = null; }
    const g = this.selectionGraphics;
    g.pivot.set(cx, cy);
    g.position.set(cx, cy);
    const amp = selectionPopAmplitude(spanPx);
    const { durationMs } = animConfig.selectionPop;
    const start = performance.now();
    const animate = () => {
      this.host.requestRender();
      const t = Math.min((performance.now() - start) / durationMs, 1);
      g.scale.set(1 - amp + amp * easeOutBack(t));
      if (t < 1) {
        this.selAnimId = requestAnimationFrame(animate);
      } else {
        g.scale.set(1, 1); g.pivot.set(0, 0); g.position.set(0, 0);
        this.selAnimId = null;
      }
    };
    this.selAnimId = requestAnimationFrame(animate);
  }

  private lastHoverKey = '';

  /**
   * The hover-preview box: what a click would select right now (the
   * hovered object's footprint, or a 1×1 terrain cell), on `grid`. Keyed so a stationary
   * hover — mousemove fires per pixel — doesn't rebuild or re-render.
   */
  showHover({ x, y, w, h }: Rect, grid: GridId): void {
    const key = `${x},${y},${w},${h},${grid}`;
    if (key === this.lastHoverKey) return;
    this.lastHoverKey = key;
    const shift = gridOffsetPx(grid);
    this.hoverRect = { x: x * TILE_SIZE + shift.x, y: y * TILE_SIZE + shift.y, w: w * TILE_SIZE, h: h * TILE_SIZE };
    this.drawHover();
  }

  private hoverRect: WorldRect | null = null;

  private drawHover(): void {
    this.host.requestRender();
    if (this.host.disposed) return;
    this.hoverGraphics.clear();
    const r = this.hoverRect;
    if (!r) return;
    const k = 1 / this.host.viewZoom;
    this.hoverGraphics.lineStyle(HOVER_BOX.stroke * k, SELECTION_EDGE, HOVER_BOX.edgeAlpha);
    this.hoverGraphics.beginFill(HOVER_BOX.fill, HOVER_BOX.fillAlpha);
    this.hoverGraphics.drawRoundedRect(r.x, r.y, r.w, r.h, HOVER_BOX.radius * k);
    this.hoverGraphics.endFill();
  }

  clearHover(): void {
    if (!this.lastHoverKey) return;
    this.lastHoverKey = '';
    this.hoverRect = null;
    this.host.requestRender();
    if (!this.host.disposed) this.hoverGraphics.clear();
  }

  /**
   * Mark a selection at (x, y) with optional width and height: corner brackets around one member,
   * a ring per member plus brackets around the whole of a group. A regular body (`exact`: a terrain
   * cell, a lone road) gets its exact outline instead. If elevation is provided, a label is drawn at
   * the bottom-left corner. The rect lies on `grid`.
   *
   * `append` adds a member to the marks already drawn this paint instead of starting over: a group
   * selection is one `clearSelection()` up front, then one `append` call per member. Each append
   * costs one ring and one redraw of the group brackets. An appended member skips the entrance pop
   * and the elevation label.
   */
  showSelection({ x, y, w, h }: Rect, grid: GridId, { elevation, append = false, exact = false }: SelectionOpts = {}): void {
    this.host.requestRender();
    const shift = gridOffsetPx(grid);
    const rect = { x: x * TILE_SIZE + shift.x, y: y * TILE_SIZE + shift.y, w: w * TILE_SIZE, h: h * TILE_SIZE };
    if (!append) {
      this.selectionRects = [rect];
      this.selectionUnion = rect;
      this.selectionExact = exact;
      this.drawSelectionMarks();
    } else {
      const u = this.selectionUnion ?? rect;
      const x0 = Math.min(u.x, rect.x), y0 = Math.min(u.y, rect.y);
      this.selectionUnion = { x: x0, y: y0, w: Math.max(u.x + u.w, rect.x + rect.w) - x0, h: Math.max(u.y + u.h, rect.y + rect.h) - y0 };
      this.selectionRects.push(rect);
      // The second member turns the first one's brackets into a ring; after that each append adds one.
      if (this.selectionRects.length === 2) this.drawSelectionMarks();
      else { this.drawRing(rect); this.drawGroupFrame(); }
      return;
    }
    // Pop only when a new selection appears (not on a re-paint of the same one,
    // e.g. after rotating the selected object).
    const selKey = `${x},${y},${w},${h},${shift.x},${shift.y}`;
    if (selKey !== this.lastSelKey) {
      this.lastSelKey = selKey;
      this.popSelection(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(w, h) * TILE_SIZE);
    }

    if (this.selectionLabel) {
      this.selectionLabel.parent?.removeChild(this.selectionLabel);
      this.selectionLabel.destroy();
      this.selectionLabel = null;
    }
    if (elevation !== undefined) {
      const label = new PIXI.Text(layerNumeral(elevation), {
        fontSize: 16, fontWeight: 'bold', fontFamily: APP_FONT_FAMILY,
        fill: SELECTION_CREAM, stroke: SELECTION_EDGE, strokeThickness: 3,
      });
      label.x = x * TILE_SIZE + 3 + shift.x;
      label.y = (y + h) * TILE_SIZE - 3 + shift.y;
      label.anchor.set(0, 1);
      this.selectionLabel = label;
      this.labelSlot.addChild(label);
    }
  }

  /** Redraw what keeps its screen size after a zoom change. */
  rezoom(): void {
    if (this.selectionRects.length) { this.drawSelectionMarks(); this.host.requestRender(); }
    if (this.hoverRect) this.drawHover();
  }

  private drawSelectionMarks(): void {
    if (this.host.disposed) return;
    this.selectionGraphics.clear(); this.selectionFrame.clear();
    if (this.selectionRects.length === 1) {
      if (this.selectionExact) this.drawOutline(this.selectionRects[0]!);
      else this.drawBrackets(this.selectionGraphics, this.selectionRects[0]!, MARK_PAD);
      return;
    }
    for (const r of this.selectionRects) this.drawRing(r);
    this.drawGroupFrame();
  }

  private drawGroupFrame(): void {
    if (this.host.disposed) return;
    this.selectionFrame.clear();
    if (this.selectionUnion) this.drawBrackets(this.selectionFrame, this.selectionUnion, MARK_GROUP_PAD);
  }

  private drawBrackets(g: PIXI.Graphics, r: WorldRect, padPx: number): void {
    const k = 1 / this.host.viewZoom, pad = padPx * k;
    const x = r.x - pad, y = r.y - pad, w = r.w + 2 * pad, h = r.h + 2 * pad;
    const arm = bracketArm(w, h, k);
    const corners: [number, number, number, number][] = [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]];
    for (const [width, color, alpha] of [[MARK_EDGE * k, SELECTION_EDGE, SELECTION_EDGE_ALPHA], [MARK_STROKE * k, SELECTION_CREAM, 1]] as const) {
      g.lineStyle({ width, color, alpha, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
      for (const [cx, cy, sx, sy] of corners) {
        g.moveTo(cx, cy + sy * arm); g.lineTo(cx, cy); g.lineTo(cx + sx * arm, cy);
      }
    }
  }

  /** The exact outline of a regular cell, in the marks' treatment. */
  private drawOutline(r: WorldRect): void {
    const k = 1 / this.host.viewZoom, g = this.selectionGraphics;
    for (const [width, color, alpha] of [[MARK_EDGE * k, SELECTION_EDGE, SELECTION_EDGE_ALPHA], [MARK_STROKE * k, SELECTION_CREAM, 1]] as const) {
      g.lineStyle({ width, color, alpha, join: PIXI.LINE_JOIN.ROUND });
      g.drawRect(r.x, r.y, r.w, r.h);
    }
  }

  private drawRing(r: WorldRect): void {
    const k = 1 / this.host.viewZoom, g = this.selectionGraphics;
    const radius = ringRadius(r.w, r.h, k);
    g.lineStyle({ width: RING_EDGE * k, color: SELECTION_EDGE, alpha: SELECTION_EDGE_ALPHA });
    g.drawCircle(r.x + r.w / 2, r.y + r.h / 2, radius);
    g.lineStyle({ width: RING_STROKE * k, color: SELECTION_CREAM, alpha: 1 });
    g.drawCircle(r.x + r.w / 2, r.y + r.h / 2, radius);
  }

  /**
   * Clear the selection rectangle and any elevation label.
   */
  clearSelection(): void {
    this.host.requestRender();
    this.selectionRects = [];
    this.selectionUnion = null;
    if (!this.host.disposed) { this.selectionGraphics.clear(); this.selectionFrame.clear(); }
    this.lastSelKey = '';
    if (this.selectionLabel) {
      this.selectionLabel.parent?.removeChild(this.selectionLabel);
      this.selectionLabel.destroy();
      this.selectionLabel = null;
    }
  }

  dispose(): void {
    if (this.selAnimId !== null) cancelAnimationFrame(this.selAnimId);
    this.selAnimId = null;
  }
}
