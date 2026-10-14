/*
 * The plan-notes layer of the 2D map: zone washes with rounded outlines and their number + tag
 * captions, tag chips, route arrows and measurements, drawn between the objects and the tool
 * overlay. Every line wears `view/shared/annotation/annotation-line.ts:ANNOTATION_LINE`.
 *
 * It draws from the store's annotation data rather than the EventBus — annotations are not grid
 * state, and their epoch is bumped by every slice verb. Every note is its own node, reconciled by
 * the note's identity: an unchanged note keeps the node (and the PIXI.Text raster) it already has,
 * an edited one rebuilds only itself, and an arriving or leaving one fades over `FADE_MS` instead
 * of popping — planning ink appears on a map someone is looking at, and a mark from nowhere reads
 * as a glitch. Under reduced motion the fade is skipped to the end state.
 *
 * Sizes come from `core/model/annotation/text-metrics.ts:INK_CELLS` × the map's own `annotationInkScale`, so
 * a note holds the same share of the whole-map picture on every template — the layer's home
 * framing is the shared image, not the close-up. Line widths alone follow the view's cell size
 * (`setCellPixels`), and only the line graphics are stroked again.
 */
import * as PIXI from 'pixi.js-legacy';
import { APP_FONT_FAMILY } from '../../../assets/fonts/family';
import { TILE_SIZE } from '../geometry/world';
import { chipTextSize, routeWidth, zoneHasCaption, type AnnotationsState, type ChipNote, type MapAnnotation, type RouteNote, type ZoneNote } from '../../../core/model/annotations';
import { INK_ZONE_DISC, isAnnotationInk } from '../../../config/annotation-palette';
import { INK_CELLS } from '../../../core/model/annotation/text-metrics';
import { routeSamples, zoneLabelAnchor } from '../../../core/model/annotation/geometry';
import type { AnnotationDrawBase } from '../../shared/annotation/draw-options';
import { cellEdges, dimensionDrawing, measureDrawing, type DimensionDrawing } from '../../../core/model/annotation/dimensions';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import { hexStringToNumber } from '../../../core/base/color';
import { MAP_INK, MAP_TEXT as MAP_TEXT_HEX } from '../../../assets/brand-palette';
import { easeOutQuad } from '../../shared/motion/anim-config';
import {
  ANNOTATION_LINE, annotationDashes, annotationLineCells, annotationLineColor, dashRuns, zoneBorderPaths,
} from '../../shared/annotation/annotation-line';

/** The map-label lettering ink and its outline, as numbers because a canvas takes no CSS. */
const MAP_TEXT = hexStringToNumber(MAP_TEXT_HEX);
const INK = hexStringToNumber(MAP_INK);

const WASH_ALPHA = 0.3;
const WASH_ALPHA_INK = 0.38;
const FADE_MS = 220;

/** A saved note colour may carry an alpha pair (`#rrggbbaa`): the ink draws its rgb, and white for
 *  one that does not parse. */
const hex = (color: string): number => {
  const n = hexStringToNumber(color.slice(0, 7));
  return Number.isFinite(n) ? n : 0xffffff;
};

export interface AnnotationDrawOpts extends AnnotationDrawBase {
  selectionIds: readonly string[];
  /** `annotationInkScale(template)`, handed in because the layer draws data, not a grid. */
  inkScale: number;
}

/** One note's screen presence: what it was built from (staleness by identity — the slice replaces
 *  an edited note's object), and the display parts standing in the passes. */
interface NoteNode {
  ref: MapAnnotation;
  selected: boolean;
  draft: boolean;
  label: string;
  inkScale: number;
  dimensions: boolean;
  parts: PIXI.Container[];
  /** Its line graphics, stroked again when the view's cell size moves the line width too far. */
  restroke: Restroke[];
  /** A fade in flight: negative-going means the note is leaving and the parts go at 0. */
  fade?: { from: number; to: number; start: number };
}

export class AnnotationLayer {
  public readonly container = new PIXI.Container();
  private readonly washPass = new PIXI.Container();
  private readonly routePass = new PIXI.Container();
  private readonly labelPass = new PIXI.Container();
  private readonly nodes = new Map<string, NoteNode>();
  private fadeRaf = 0;
  /** The line width in cells the standing lines were stroked at. */
  private lineCells = annotationLineCells(TILE_SIZE);

  /** Opens the owning renderer's render window. */
  constructor(readonly requestRender: () => void) {
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
          || node.inkScale !== opts.inkScale || node.label !== label || node.dimensions !== (opts.zoneDimensions !== false)
          ? this.rebuild(note, label, opts, node)
          : node;
      // Later notes paint over earlier within each pass, the same order the hit test reads back.
      for (const part of fresh.parts) part.parent?.addChild(part);
    }
  }

  /** Follow the view's cell size in css px (the live zoom, or a capture's resolution, times
   *  `TILE_SIZE`). Live zooms restroke only past `restrokeStep` of drift; `exact` always restrokes,
   *  so a capture's borders are the width its own resolution asks for. */
  setCellPixels(cellPixels: number, exact = false): void {
    if (!(cellPixels > 0)) return;
    const next = annotationLineCells(cellPixels);
    if (next === this.lineCells) return;
    if (!exact && Math.abs(next / this.lineCells - 1) < ANNOTATION_LINE.restrokeStep) return;
    this.lineCells = next;
    for (const node of this.nodes.values()) for (const restroke of node.restroke) restroke(next);
    this.requestRender();
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
    const restroke: Restroke[] = [];
    const node: NoteNode = {
      ref: note, selected, draft: note === opts.draft, label, inkScale: opts.inkScale, dimensions: opts.zoneDimensions !== false,
      parts: this.build(note, selected, label, opts, restroke), restroke,
    };
    this.nodes.set(note.id, node);
    if (!wasHere) this.beginFade(note.id, node, 1, arriveFrom);
    return node;
  }

  private build(note: MapAnnotation, selected: boolean, label: string, opts: AnnotationDrawOpts, restroke: Restroke[]): PIXI.Container[] {
    const w = this.lineCells;
    const ink: LabelInk = { inkScale: opts.inkScale, lineCells: w, restroke };
    if (note.kind === 'zone') {
      const parts: PIXI.Container[] = [
        this.washPass.addChild(zoneWash(note)),
        this.washPass.addChild(zoneOutline(note, selected, w, restroke)),
      ];
      const caption = zoneLabel(note, label, opts.inkScale);
      if (caption) parts.push(this.labelPass.addChild(caption));
      const bounds = cellEdges(note.cells);
      if (bounds && opts.zoneDimensions !== false && (selected || note === opts.draft)) {
        parts.push(this.labelPass.addChild(dimensionBody(dimensionDrawing(bounds, opts.inkScale), note.color, ink)));
      }
      return parts;
    }
    if (note.kind === 'measure') return [this.labelPass.addChild(dimensionBody(measureDrawing(note.points, opts.inkScale, note.flipped), note.color, ink, selected))];
    if (note.kind === 'route') return [this.routePass.addChild(routeBody(note, selected, w, restroke))];
    return [this.labelPass.addChild(chipBody(note, label, selected, ink))];
  }

  private drop(node: NoteNode): void {
    for (const part of node.parts) part.destroy({ children: true });
    node.parts = [];
    node.restroke = [];
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
        const eased = easeOutQuad(t);
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

/** Strokes a line graphic again at a new width; the layer calls each on a zoom past the drift. */
export type Restroke = (lineCells: number) => void;

/** How a label body inks: the text scale, the line width in cells, and where its line graphics register for restroking. */
export interface LabelInk { inkScale: number; lineCells: number; restroke: Restroke[] }

/** A graphic of annotation lines, painted at `lineCells` and registered for restroking. */
function lineGraphic(paint: (g: PIXI.Graphics, w: number) => void, lineCells: number, restroke: Restroke[]): PIXI.Graphics {
  const g = new PIXI.Graphics();
  paint(g, lineCells * TILE_SIZE);
  restroke.push((next) => { g.clear(); paint(g, next * TILE_SIZE); });
  return g;
}

/** World px of a path in cells. */
const px = (path: ReadonlyArray<readonly [number, number]>): number[] => path.flatMap(([x, y]) => [x * TILE_SIZE, y * TILE_SIZE]);

/** One run as one continuous path; a run whose ends meet is closed so its joint is a real join. */
function tracePath(g: PIXI.Graphics, pts: readonly number[]): void {
  const n = pts.length;
  if (n < 4) return;
  const closed = n > 4 && Math.hypot(pts[0]! - pts[n - 2]!, pts[1]! - pts[n - 1]!) < 1e-3;
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < (closed ? n - 2 : n); i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  if (closed) g.closePath();
}

/** The annotation line: each run over its halo, in the note's line colour, `w` world px wide. */
function strokeLine(g: PIXI.Graphics, runs: readonly (readonly number[])[], color: string, w: number): void {
  const L = ANNOTATION_LINE;
  const join = PIXI.LINE_JOIN.ROUND, cap = PIXI.LINE_CAP.ROUND;
  g.lineStyle({ width: w * L.halo.scale, color: hexStringToNumber(L.halo.color), alpha: L.halo.alpha, join, cap });
  for (const run of runs) tracePath(g, run);
  g.lineStyle({ width: w, color: hex(annotationLineColor(color)), alpha: L.alpha, join, cap });
  for (const run of runs) tracePath(g, run);
  g.lineStyle();
}

/** The dashed variant's runs of one path, in world px. */
function dashedRuns(path: ReadonlyArray<readonly [number, number]>, w: number): number[][] {
  return dashRuns(path.map(([x, y]) => [x, y] as [number, number]), annotationDashes(w / TILE_SIZE)).map(px);
}

/** A white selection line with a dark rim stays visible over every note colour. */
function selectionStroke(g: PIXI.Graphics, runs: readonly (readonly number[])[], w: number): void {
  const S = ANNOTATION_LINE.selection;
  for (const [color, scale] of [[INK, S.rim], [0xffffff, 1]] as const) {
    g.lineStyle({ width: w * S.width * scale, color, alpha: S.alpha, join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND });
    for (const run of runs) tracePath(g, run);
  }
  g.lineStyle();
}

function zoneWash(zone: ZoneNote): PIXI.Graphics {
  const g = new PIXI.Graphics();
  g.beginFill(hex(zone.color), isAnnotationInk(zone.color) ? WASH_ALPHA_INK : WASH_ALPHA);
  // Zone ink lives on the road grid: the wash covers whole road cells.
  for (const c of zone.cells) g.drawRect(c.x * TILE_SIZE, c.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  g.endFill();
  return g;
}

/** The border: one closed annotation line per outline, and its selection stroke. */
function zoneOutline(zone: ZoneNote, selected: boolean, lineCells: number, restroke: Restroke[]): PIXI.Graphics {
  return lineGraphic((g, w) => {
    const runs = zoneBorderPaths(zone.cells, w / TILE_SIZE).map(px);
    strokeLine(g, runs, zone.color, w);
    if (selected) selectionStroke(g, runs, w);
  }, lineCells, restroke);
}

function zoneLabel(zone: ZoneNote, label: string, inkScale: number): PIXI.Container | null {
  if (!zoneHasCaption(zone, label)) return null;
  const withNum = zone.num > 0;
  const box = new PIXI.Container();
  const fs = INK_CELLS.zoneLabel[chipTextSize(zone.size ?? 'm')] * inkScale * TILE_SIZE;
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
    g.beginFill(isAnnotationInk(zone.color) ? hexStringToNumber(INK_ZONE_DISC) : hex(zone.color), 1);
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
function chipBody(note: ChipNote, label: string, selected: boolean, ink: LabelInk): PIXI.Container {
  const { inkScale, lineCells, restroke } = ink;
  const box = new PIXI.Container();
  const X = note.x * TILE_SIZE;
  const Y = note.y * TILE_SIZE;
  const fs = INK_CELLS.text[note.size] * inkScale * TILE_SIZE;
  const text = makeText(label, {
    fontFamily: APP_FONT_FAMILY, fontSize: fs, fontWeight: '800', fill: isAnnotationInk(note.color) ? INK : 0xffffff,
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
  if (selected) {
    const fw = text.width + padX * 2 + fs * 0.4, fh = h + fs * 0.4;
    const frame = [X - fw / 2, Y - fh / 2, X + fw / 2, Y - fh / 2, X + fw / 2, Y + fh / 2, X - fw / 2, Y + fh / 2, X - fw / 2, Y - fh / 2];
    box.addChild(lineGraphic((sg, w) => selectionStroke(sg, [frame], w), lineCells, restroke));
  }
  return box;
}

function routeBody(route: RouteNote, selected: boolean, lineCells: number, restroke: Restroke[]): PIXI.Graphics {
  const L = ANNOTATION_LINE;
  const samples = routeSamples(route.points);
  const halo = hexStringToNumber(L.halo.color);
  const ink = hex(annotationLineColor(route.color));
  return lineGraphic((g, base) => {
    const w = base * routeWidth(route);
    if (samples.length < 2) {
      // A one-point draft: mark the anchor so the first tap visibly landed.
      const p = samples[0];
      if (!p) return;
      g.lineStyle(w * (L.halo.scale - 1) / 2, halo, L.halo.alpha);
      g.beginFill(ink, L.alpha);
      g.drawCircle(p[0] * TILE_SIZE, p[1] * TILE_SIZE, w * L.selection.dot);
      g.endFill();
      g.lineStyle();
      return;
    }
    const whole = px(samples);
    strokeLine(g, route.dashed ? dashedRuns(samples, w) : [whole], route.color, w);
    // The arrowhead from the last segment's own direction, sized in line widths.
    const n = whole.length;
    const ex = whole[n - 2]!, ey = whole[n - 1]!;
    const qx = whole[Math.max(0, n - 8)]!, qy = whole[Math.max(1, n - 7)]!;
    const ang = Math.atan2(ey - qy, ex - qx);
    const ah = w * L.arrowHead;
    g.lineStyle({ width: w * (L.halo.scale - 1), color: halo, alpha: L.halo.alpha, join: PIXI.LINE_JOIN.ROUND });
    g.beginFill(ink, 1);
    g.drawPolygon([
      ex + Math.cos(ang) * ah * 0.9, ey + Math.sin(ang) * ah * 0.9,
      ex + Math.cos(ang + 2.5) * ah, ey + Math.sin(ang + 2.5) * ah,
      ex + Math.cos(ang - 2.5) * ah, ey + Math.sin(ang - 2.5) * ah,
    ]);
    g.endFill();
    g.lineStyle();
    if (selected) {
      selectionStroke(g, [whole], w);
      for (const p of route.points) {
        g.lineStyle(w * (L.halo.scale - 1) / 2, INK, L.halo.alpha);
        g.beginFill(0xffffff, 1);
        g.drawCircle(p.x * TILE_SIZE, p.y * TILE_SIZE, w * L.selection.dot);
        g.endFill();
        g.lineStyle();
      }
    }
  }, lineCells, restroke);
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

/** Measurement lines and their ticks as the annotation line, the guides as its dashed variant.
 *  `restroke` collects the line graphic for callers that follow the zoom. */
export function dimensionBody(
  drawing: DimensionDrawing, color: string, ink: LabelInk, selected = false,
): PIXI.Container {
  const { inkScale, lineCells, restroke } = ink;
  const box = new PIXI.Container();
  const path = ([a, b]: DimensionDrawing['lines'][number]): Array<[number, number]> => [[a.x, a.y], [b.x, b.y]];
  box.addChild(lineGraphic((g, w) => {
    strokeLine(g, drawing.guides.flatMap((line) => dashedRuns(path(line), w)), color, w);
    strokeLine(g, drawing.lines.map((line) => px(path(line))), color, w);
    if (selected) selectionStroke(g, drawing.guides.slice(0, 4).map((line) => px(path(line))), w);
  }, lineCells, restroke));
  for (const { at, value } of drawing.labels) {
    const text = makeText(String(value), labelStyle(0.55 * inkScale * TILE_SIZE, MAP_TEXT));
    text.anchor.set(0.5, 0.5);
    text.position.set(at.x * TILE_SIZE, at.y * TILE_SIZE);
    box.addChild(text);
  }
  return box;
}
