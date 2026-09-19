/*
 * annotation-layer.ts — the plan-notes layer of the 2D map: zone washes with dashed rounded
 * outlines and their number + tag captions, tag chips, and route arrows, drawn between the
 * objects and the tool overlay.
 *
 * It draws from the store's annotation data rather than the EventBus — annotations are not grid
 * state, and their epoch is bumped by every slice verb. EVERY NOTE IS ITS OWN NODE, reconciled by
 * the note's identity: an unchanged note keeps the node (and the PIXI.Text raster) it already has,
 * an edited one rebuilds only itself, and an ARRIVING or LEAVING one fades over `FADE_MS` instead
 * of popping — planning ink appears on a map someone is looking at, and a mark from nowhere reads
 * as a glitch. Under reduced motion the fade is skipped to the end state.
 *
 * Sizes come from `core/model/annotations.ts:INK_CELLS` × the map's own `annotationInkScale`, so
 * a note holds the same share of the whole-map picture on every template — the layer's home
 * framing is the shared image, not the close-up.
 */
import * as PIXI from 'pixi.js-legacy';
import { APP_FONT_FAMILY } from '../../../assets/fonts/family';
import { TILE_SIZE } from '../../../core/model/constants';
import {
  ANNOTATION_INK, INK_CELLS, roundedZoneLoops, zoneCornerRadius, ZONE_GRID_SHIFT, zoneDashCells, routeSamples, zoneLabelAnchor,
  type AnnotationsState, type ChipNote, type MapAnnotation, type RouteNote, type TagId, type ZoneNote,
} from '../../../core/model/annotations';
import { cellBounds, dimensionDrawing, measureDrawing, type DimensionDrawing } from '../../../core/model/annotation-dimensions';
import { isMotionReduced } from '../motion-state';
import { requestRender } from '../render-scheduler';

/** The lettering ink and its outline — the treatment every word standing on the map wears
 *  (`ui/design/tokens.ts:MAP_LABEL`), restated as numbers because a canvas takes no CSS. */
const MAP_TEXT = 0xfffee3;
const INK = 0x43413f;

const WASH_ALPHA = 0.3;
const WASH_ALPHA_INK = 0.38;
const FADE_MS = 220;

const hex = (color: string): number => {
  const n = parseInt(color.slice(1, 7), 16);
  return Number.isFinite(n) ? n : 0xffffff;
};
const isInk = (color: string): boolean => color.toLowerCase() === ANNOTATION_INK.toLowerCase();

export interface AnnotationDrawOpts {
  draft: MapAnnotation | null;
  selectionIds: readonly string[];
  /** `annotationInkScale(template)`, handed in because the layer draws DATA, not a grid. */
  inkScale: number;
  /** The drawn label for a tag, in the interface language. */
  tagLabel: (tag: TagId) => string;
}

/** One note's screen presence: what it was built FROM (staleness by identity — the slice replaces
 *  an edited note's object), and the display parts standing in the passes. */
interface NoteNode {
  ref: MapAnnotation;
  selected: boolean;
  draft: boolean;
  label: string;
  inkScale: number;
  parts: PIXI.Container[];
  /** A fade in flight: negative-going means the note is leaving and the parts go at 0. */
  fade?: { from: number; to: number; start: number };
}

export class AnnotationLayer {
  public readonly container = new PIXI.Container();
  /** Opens the owning renderer's render window; MapRenderer rebinds it to itself right after
   *  construction. Defaults to the module broadcast, for an instance nobody has wired yet. */
  public requestRender: () => void = requestRender;
  private readonly washPass = new PIXI.Container();
  private readonly routePass = new PIXI.Container();
  private readonly labelPass = new PIXI.Container();
  private readonly nodes = new Map<string, NoteNode>();
  private fadeRaf = 0;

  constructor() {
    this.container.addChild(this.washPass);
    this.container.addChild(this.routePass);
    this.container.addChild(this.labelPass);
  }

  draw(data: AnnotationsState | null, opts: AnnotationDrawOpts): void {
    this.requestRender();
    this.container.visible = data?.visible !== false;
    const items: MapAnnotation[] = [...(data?.items ?? [])];
    if (opts.draft) items.push(opts.draft);
    const present = new Set(items.map((n) => n.id));

    for (const [id, node] of this.nodes) {
      if (present.has(id)) continue;
      if (node.fade?.to === 0) continue;
      this.beginFade(id, node, 0);
    }
    for (const note of items) {
      const node = this.nodes.get(note.id);
      const label = (note.kind === 'zone' || note.kind === 'chip') && note.tag ? opts.tagLabel(note.tag) : '';
      const fresh = node === undefined || node.fade?.to === 0
        ? this.rebuild(note, label, opts, node)
        : node.ref !== note || node.selected !== (opts.selectionIds.includes(note.id))
          || node.draft !== (note === opts.draft)
          || node.inkScale !== opts.inkScale || node.label !== label
          ? this.rebuild(note, label, opts, node)
          : node;
      // Later notes paint over earlier within each pass, the same order the hit test reads back.
      for (const part of fresh.parts) part.parent?.addChild(part);
    }
  }

  destroy(): void {
    if (this.fadeRaf) cancelAnimationFrame(this.fadeRaf);
    for (const [, node] of this.nodes) this.drop(node);
    this.nodes.clear();
  }

  private rebuild(note: MapAnnotation, label: string, opts: AnnotationDrawOpts, old: NoteNode | undefined): NoteNode {
    // A note re-arriving mid-leave keeps its alpha, so an undo right after a delete fades back
    // from wherever the leave had got to; a brand-new note arrives from 0.
    const arriveFrom = old ? this.alphaOf(old) : 0;
    const wasHere = old !== undefined && old.fade?.to !== 0;
    if (old) this.drop(old);
    const selected = opts.selectionIds.includes(note.id);
    const node: NoteNode = {
      ref: note, selected, draft: note === opts.draft, label, inkScale: opts.inkScale,
      parts: this.build(note, selected, label, opts),
    };
    this.nodes.set(note.id, node);
    if (!wasHere) this.beginFade(note.id, node, 1, arriveFrom);
    return node;
  }

  private build(note: MapAnnotation, selected: boolean, label: string, opts: AnnotationDrawOpts): PIXI.Container[] {
    if (note.kind === 'zone') {
      const parts: PIXI.Container[] = [this.washPass.addChild(zoneBody(note, selected, opts.inkScale))];
      const caption = zoneLabel(note, label, opts.inkScale);
      if (caption) parts.push(this.labelPass.addChild(caption));
      const bounds = cellBounds(note.cells);
      if (bounds && (selected || note === opts.draft)) parts.push(this.labelPass.addChild(dimensionBody(dimensionDrawing(bounds, opts.inkScale), note.color, opts.inkScale)));
      return parts;
    }
    if (note.kind === 'measure') return [this.labelPass.addChild(dimensionBody(measureDrawing(note.points, opts.inkScale, note.flipped), note.color, opts.inkScale, selected))];
    if (note.kind === 'route') return [this.routePass.addChild(routeBody(note, selected, opts.inkScale))];
    return [this.labelPass.addChild(chipBody(note, label, selected, opts.inkScale))];
  }

  private drop(node: NoteNode): void {
    for (const part of node.parts) part.destroy({ children: true });
    node.parts = [];
  }

  private alphaOf(node: NoteNode): number {
    return node.parts[0]?.alpha ?? 1;
  }

  private beginFade(id: string, node: NoteNode, to: number, fromOverride?: number): void {
    const from = fromOverride ?? this.alphaOf(node);
    if (isMotionReduced()) {
      this.settleFade(id, node, to);
      return;
    }
    node.fade = { from, to, start: performance.now() };
    for (const part of node.parts) part.alpha = from;
    this.tickFades();
  }

  private settleFade(id: string, node: NoteNode, to: number): void {
    node.fade = undefined;
    if (to === 0) {
      this.drop(node);
      this.nodes.delete(id);
    } else {
      for (const part of node.parts) part.alpha = 1;
    }
  }

  private tickFades(): void {
    if (this.fadeRaf) return;
    const step = () => {
      this.fadeRaf = 0;
      const now = performance.now();
      let live = false;
      for (const [id, node] of this.nodes) {
        const f = node.fade;
        if (!f) continue;
        const t = Math.min(1, (now - f.start) / FADE_MS);
        const eased = 1 - (1 - t) * (1 - t);
        const alpha = f.from + (f.to - f.from) * eased;
        for (const part of node.parts) part.alpha = alpha;
        if (t >= 1) this.settleFade(id, node, f.to);
        else live = true;
      }
      this.requestRender();
      if (live) this.fadeRaf = requestAnimationFrame(step);
    };
    this.fadeRaf = requestAnimationFrame(step);
  }
}

/* ── the drawings, one node per note ─────────────────────────────────────── */

function zoneBody(zone: ZoneNote, selected: boolean, inkScale: number): PIXI.Graphics {
  const g = new PIXI.Graphics();
  const color = hex(zone.color);
  const outlineW = INK_CELLS.outline * inkScale * TILE_SIZE;
  const dashes = zoneDashCells(inkScale);
  const dash = dashes.dash * TILE_SIZE;
  const gap = dashes.gap * TILE_SIZE;
  g.beginFill(color, isInk(zone.color) ? WASH_ALPHA_INK : WASH_ALPHA);
  // Zone ink lives on the terrain grid (ZONE_GRID_SHIFT): the wash covers the drawn blocks.
  for (const c of zone.cells) g.drawRect((c.x + ZONE_GRID_SHIFT) * TILE_SIZE, (c.y + ZONE_GRID_SHIFT) * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  g.endFill();
  const strokeColor = isInk(zone.color) ? 0xffffff : color;
  for (const loop of roundedZoneLoops(zone.cells, zoneCornerRadius(inkScale))) {
    const pts: number[] = [];
    for (const [x, y] of loop) pts.push((x + ZONE_GRID_SHIFT) * TILE_SIZE, (y + ZONE_GRID_SHIFT) * TILE_SIZE);
    g.lineStyle({ width: outlineW, color: strokeColor, alpha: 0.95, cap: PIXI.LINE_CAP.ROUND });
    dashPolyline(g, pts, dash, gap);
    if (selected) {
      selectionStroke(g, pts, outlineW * 0.65);
    }
    g.lineStyle();
  }
  return g;
}

function zoneLabel(zone: ZoneNote, label: string, inkScale: number): PIXI.Container | null {
  const withNum = zone.num > 0;
  if (!withNum && !label) return null;
  const box = new PIXI.Container();
  const fs = INK_CELLS.zoneLabel[zone.size ?? 'm'] * inkScale * TILE_SIZE;
  const { x, y } = zoneLabelAnchor(zone.cells);
  const X = x * TILE_SIZE;
  const Y = y * TILE_SIZE;
  const text = label ? makeText(label, labelStyle(fs, MAP_TEXT)) : null;
  const numR = fs * 0.62;
  const total = (withNum ? numR * 2 + (label ? fs * 0.3 : 0) : 0) + (text?.width ?? 0);
  let x0 = X - total / 2;
  if (withNum) {
    const g = new PIXI.Graphics();
    g.lineStyle(Math.max(1.6, fs * 0.06), 0xffffff, 0.85);
    g.beginFill(isInk(zone.color) ? 0x8a9bae : hex(zone.color), 1);
    g.drawCircle(x0 + numR, Y, numR);
    g.endFill();
    box.addChild(g);
    const num = makeText(String(zone.num), {
      fontFamily: APP_FONT_FAMILY, fontSize: fs * 0.68, fontWeight: '800', fill: 0xffffff,
    });
    num.anchor.set(0.5, 0.5);
    num.position.set(x0 + numR, Y);
    box.addChild(num);
    x0 += numR * 2 + (label ? fs * 0.3 : 0);
  }
  if (text) {
    text.anchor.set(0, 0.5);
    text.position.set(x0, Y);
    box.addChild(text);
  }
  return box;
}

/** A tag on its own plate. */
function chipBody(note: ChipNote, label: string, selected: boolean, inkScale: number): PIXI.Container {
  const box = new PIXI.Container();
  const X = note.x * TILE_SIZE;
  const Y = note.y * TILE_SIZE;
  const fs = INK_CELLS.text[note.size] * inkScale * TILE_SIZE;
  const text = makeText(label, {
    fontFamily: APP_FONT_FAMILY, fontSize: fs, fontWeight: '800', fill: isInk(note.color) ? INK : 0xffffff,
  });
  const padX = fs * 0.5;
  const h = fs * 1.6;
  const g = new PIXI.Graphics();
  g.lineStyle(Math.max(1.8, fs * 0.07), 0xffffff, 0.85);
  g.beginFill(hex(note.color), 1);
  g.drawRoundedRect(X - text.width / 2 - padX, Y - h / 2, text.width + padX * 2, h, h * 0.36);
  g.endFill();
  box.addChild(g);
  text.anchor.set(0.5, 0.5);
  text.position.set(X, Y);
  box.addChild(text);
  if (selected) box.addChild(selectionBox(X, Y, text.width + padX * 2 + fs * 0.4, h + fs * 0.4, inkScale));
  return box;
}

function routeBody(route: RouteNote, selected: boolean, inkScale: number): PIXI.Graphics {
  const g = new PIXI.Graphics();
  const lw = INK_CELLS.route * inkScale * TILE_SIZE;
  const color = hex(route.color);
  const pts: number[] = [];
  for (const [x, y] of routeSamples(route.points)) pts.push(x * TILE_SIZE, y * TILE_SIZE);
  if (pts.length < 4) {
    // A one-point draft: mark the anchor so the first tap visibly landed.
    if (pts.length === 2) {
      g.lineStyle(lw * 0.4, INK, 0.6);
      g.beginFill(color, 0.9);
      g.drawCircle(pts[0]!, pts[1]!, lw * 1.2);
      g.endFill();
      g.lineStyle();
    }
    return g;
  }
  // Route arrows use a 1.77-line-width halo, 2.4/2 dash rhythm and a 2.2-line-width head.
  g.lineStyle({ width: lw * 1.77, color: INK, alpha: 0.62, cap: PIXI.LINE_CAP.ROUND });
  dashOpenPolyline(g, pts, route.dashed ? lw * 2.4 : Infinity, lw * 2);
  g.lineStyle({ width: lw, color, alpha: 1, cap: PIXI.LINE_CAP.ROUND });
  dashOpenPolyline(g, pts, route.dashed ? lw * 2.4 : Infinity, lw * 2);
  g.lineStyle();
  // Arrowhead from the last segment's own direction.
  const n = pts.length;
  const ex = pts[n - 2]!;
  const ey = pts[n - 1]!;
  const qx = pts[Math.max(0, n - 8)]!;
  const qy = pts[Math.max(0, n - 7)]!;
  const ang = Math.atan2(ey - qy, ex - qx);
  const ah = lw * 2.2;
  g.lineStyle(lw * 0.6, INK, 0.62);
  g.beginFill(color, 1);
  g.drawPolygon([
    ex + Math.cos(ang) * ah * 0.9, ey + Math.sin(ang) * ah * 0.9,
    ex + Math.cos(ang + 2.5) * ah, ey + Math.sin(ang + 2.5) * ah,
    ex + Math.cos(ang - 2.5) * ah, ey + Math.sin(ang - 2.5) * ah,
  ]);
  g.endFill();
  g.lineStyle();
  if (selected) {
    selectionStroke(g, pts, lw * 0.35);
    for (const p of route.points) {
      g.lineStyle(lw * 0.3, INK, 0.62);
      g.beginFill(0xffffff, 1);
      g.drawCircle(p.x * TILE_SIZE, p.y * TILE_SIZE, lw);
      g.endFill();
      g.lineStyle();
    }
  }
  return g;
}

function selectionBox(cx: number, cy: number, w: number, h: number, inkScale: number): PIXI.Graphics {
  const g = new PIXI.Graphics();
  const lw = Math.max(1.5, INK_CELLS.outline * inkScale * TILE_SIZE * 0.5);
  selectionStroke(g, [
    cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2,
    cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2,
    cx - w / 2, cy - h / 2,
  ], lw);
  g.lineStyle();
  return g;
}

function makeText(content: string, style: Partial<PIXI.ITextStyle>): PIXI.Text {
  const text = new PIXI.Text(content, { ...style, trim: true });
  text.resolution = 2;
  return text;
}

function labelStyle(px: number, fill: number): Partial<PIXI.ITextStyle> {
  return {
    fontFamily: APP_FONT_FAMILY, fontSize: px, fontWeight: '800', fill,
    stroke: INK, strokeThickness: px * 0.15, lineJoin: 'round',
  };
}

/** PIXI.Graphics draws no dash of its own, so the dash is walked along the polyline by arc length.
 *  An `Infinity` dash draws the line solid through the same walk. */
function dashOpenPolyline(g: PIXI.Graphics, pts: number[], dash: number, gap: number): void {
  if (dash === Infinity) {
    g.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
    return;
  }
  let penDown = true;
  let remaining = dash;
  let x = pts[0]!;
  let y = pts[1]!;
  g.moveTo(x, y);
  for (let i = 2; i < pts.length; i += 2) {
    let tx = pts[i]!;
    let ty = pts[i + 1]!;
    let seg = Math.hypot(tx - x, ty - y);
    while (seg > remaining) {
      const f = remaining / seg;
      const mx = x + (tx - x) * f;
      const my = y + (ty - y) * f;
      if (penDown) g.lineTo(mx, my); else g.moveTo(mx, my);
      x = mx; y = my;
      seg -= remaining;
      penDown = !penDown;
      remaining = penDown ? dash : gap;
    }
    if (penDown) g.lineTo(tx, ty); else g.moveTo(tx, ty);
    remaining -= seg;
    x = tx; y = ty;
  }
}

function dashPolyline(g: PIXI.Graphics, closedPts: number[], dash: number, gap: number): void {
  dashOpenPolyline(g, closedPts, dash, gap);
}

function dimensionBody(drawing: DimensionDrawing, color: string, inkScale: number, selected = false): PIXI.Container {
  const box = new PIXI.Container();
  const g = new PIXI.Graphics();
  const width = Math.max(1, 0.065 * inkScale * TILE_SIZE);
  const path = ([a, b]: DimensionDrawing['lines'][number]): number[] => [a.x * TILE_SIZE, a.y * TILE_SIZE, b.x * TILE_SIZE, b.y * TILE_SIZE];
  g.lineStyle({ width, color: hex(color), alpha: 0.85, cap: PIXI.LINE_CAP.ROUND });
  for (const line of drawing.guides) dashOpenPolyline(g, path(line), 0.35 * inkScale * TILE_SIZE, 0.25 * inkScale * TILE_SIZE);
  for (const line of drawing.lines) {
    g.lineStyle({ width: width * 2.2, color: INK, alpha: 0.65, cap: PIXI.LINE_CAP.ROUND });
    dashOpenPolyline(g, path(line), Infinity, 0);
    g.lineStyle({ width, color: hex(color), alpha: 1, cap: PIXI.LINE_CAP.ROUND });
    dashOpenPolyline(g, path(line), Infinity, 0);
  }
  if (selected) for (const line of drawing.guides.slice(0, 4)) selectionStroke(g, path(line), width * 0.65);
  box.addChild(g);
  for (const { at, value } of drawing.labels) {
    const text = makeText(String(value), labelStyle(0.55 * inkScale * TILE_SIZE, MAP_TEXT));
    text.anchor.set(0.5, 0.5);
    text.position.set(at.x * TILE_SIZE, at.y * TILE_SIZE);
    box.addChild(text);
  }
  return box;
}

/** A white selection line with a dark rim stays visible over every note colour. */
function selectionStroke(g: PIXI.Graphics, points: number[], width: number): void {
  for (const [color, scale] of [[INK, 2.6], [0xffffff, 1]] as const) {
    g.lineStyle({ width: width * scale, color, alpha: 0.95, cap: PIXI.LINE_CAP.ROUND });
    dashOpenPolyline(g, points, Infinity, 0);
  }
  g.lineStyle();
}
