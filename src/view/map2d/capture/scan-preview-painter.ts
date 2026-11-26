/**
 * The video import's live picture: pass 1's mosaic under the camera's view and pass 2's cells over it in
 * zone colours with chunk dashes, units fading in and the view widening to keep everything read in sight
 * (the latest state at once under reduced motion). It works in cells (`ScanVocabulary.cell`), so a cell
 * is square on screen. The scan's vocabulary and the window's look arrive as arguments.
 */
import { ZONE_COLORS } from '../../../core/model/palette';
import { hexChannels, numberToHexString } from '../../../core/base/color';
import type { CellZone } from '../../../core/game/zones';
import { CHUNK_GRID_STYLE, chunkDashRects, chunkStrokeCells } from '../../shared/grid/reference-grid';
import { boundsWhere, rectsBounds, type Rect } from '../../../core/grid/rect';
import { fitCells, makeCanvas, sizeToCssBox } from '../../shared/viewport/dom-canvas';

/** One preview grid the scan posts, as the painter reads it. */
interface ScanPicturePreview {
  /** `coverage` in pass 1, `ground` in pass 2. */
  readonly kind: 'coverage' | 'ground';
  /** The grid's top-left corner on the ground, in the scan's pixels. */
  readonly x: number;
  readonly y: number;
  /** One unit's size on the ground, in the scan's pixels. */
  readonly unitW: number;
  readonly unitH: number;
  readonly cols: number;
  readonly rows: number;
  /** Pass 1: each unit's mean colour, `cols * rows` R, G, B triples, row-major. */
  readonly rgb?: Uint8Array;
  /** Pass 1: the camera's view of the ground, in the scan's pixels. */
  readonly view?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Pass 2: units per chunk side, with chunk lines on the grid's edges. */
  readonly chunk?: number;
}

/** What the scan's preview grids mean: a cell's size in the scan's pixels, each unit's class, the
 *  class of a unit not read yet, and the zone every other class shows as. */
export interface ScanVocabulary<P extends ScanPicturePreview> {
  readonly cell: { readonly width: number; readonly height: number };
  readonly unseen: number;
  classOf(preview: P, index: number): number;
  readonly zones: Readonly<Record<number, CellZone>>;
}

/** The window's colours and the two glides' timings, in ms. */
export interface ScanPictureLook {
  /** The stage behind the picture. */
  readonly inset: string;
  /** The dots on unexplored ground. */
  readonly line: string;
  /** The camera's view outline and wash. */
  readonly viewInk: string;
  /** A unit's fade in. */
  readonly revealMs: number;
  /** The frame's glide toward everything read. */
  readonly followMs: number;
}

/** Space kept around everything read, as a share of its larger side. */
const FIT_MARGIN = 0.08;
/** The camera's view: its outline width in css px and its corner radius in cells. */
const VIEW_LINE = 2;
const VIEW_RADIUS = 1.5;
/** The view's wash over the ground it shows. */
const VIEW_FILL = 0.12;
/** The faint dots marking unexplored ground, every this many cells. */
const DOT_STEP = 4;
const DOT_ALPHA = 0.5;
/** A glide closer than this to its target, in cells, has arrived. */
const SETTLED = 0.02;

const CHUNK_INK = numberToHexString(CHUNK_GRID_STYLE.planetPreview.ink);

/** One preview grid as drawn: its picture at one pixel a unit and when each unit was first read. */
class Layer<P extends ScanPicturePreview> {
  readonly canvas: HTMLCanvasElement | null;
  private readonly image: ImageData | null;
  /** Each unit's class, and the time it took that class (`-Infinity`: shown as read). */
  readonly cls: Uint8Array;
  readonly born: Float64Array;
  /** The unit's place on the ground: the grid's top-left unit index on each axis. */
  readonly ux0: number;
  readonly uy0: number;
  /** Units still fading in. */
  fading = true;

  constructor(private readonly read: Reading<P>, readonly preview: P, before: Layer<P> | null, now: number, animate: boolean) {
    const { cols, rows } = preview;
    this.ux0 = Math.round(preview.x / preview.unitW);
    this.uy0 = Math.round(preview.y / preview.unitH);
    this.cls = new Uint8Array(cols * rows);
    this.born = new Float64Array(cols * rows);
    const same = before && before.preview.unitW === preview.unitW && before.preview.unitH === preview.unitH;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const v = read.vocabulary.classOf(preview, i);
        this.cls[i] = v;
        let born = animate ? now : -Infinity;
        if (same) {
          const oc = c + this.ux0 - before.ux0;
          const or = r + this.uy0 - before.uy0;
          if (oc >= 0 && or >= 0 && oc < before.preview.cols && or < before.preview.rows && before.cls[or * before.preview.cols + oc] === v) {
            born = before.born[or * before.preview.cols + oc]!;
          }
        } else if (before) born = -Infinity;
        this.born[i] = born;
      }
    }
    const made = makeCanvas(cols, rows);
    this.canvas = made?.canvas ?? null;
    this.image = made ? made.ctx.createImageData(made.canvas.width, made.canvas.height) : null;
  }

  /** The units' box in cells. */
  get box(): Rect {
    return this.unitsBox({ x: 0, y: 0, w: this.preview.cols, h: this.preview.rows });
  }

  /** The box of the units read, in cells, or null. */
  seenBox(): Rect | null {
    const { cols, rows } = this.preview;
    const unseen = this.read.vocabulary.unseen;
    const seen = boundsWhere(cols, rows, (c, r) => this.cls[r * cols + c] !== unseen);
    return seen && this.unitsBox(seen);
  }

  /** A box of units, in units from the grid's corner, as a box in cells. */
  private unitsBox(units: Rect): Rect {
    const { x, y, unitW, unitH } = this.preview, cell = this.read.vocabulary.cell;
    return {
      x: (x + units.x * unitW) / cell.width, y: (y + units.y * unitH) / cell.height,
      w: (units.w * unitW) / cell.width, h: (units.h * unitH) / cell.height,
    };
  }

  /** Repaints the picture at `now`; returns whether any unit is still fading in. */
  render(now: number, fade: number): boolean {
    if (!this.canvas || !this.image) return false;
    if (!this.fading) return false;
    const data = this.image.data;
    const filmed = this.preview.rgb;
    let still = false;
    const unseen = this.read.vocabulary.unseen;
    for (let i = 0; i < this.cls.length; i++) {
      const v = this.cls[i]!;
      const o = i * 4;
      if (v === unseen) { data[o + 3] = 0; continue; }
      const t = fade > 0 ? (now - this.born[i]!) / fade : 1;
      const a = t >= 1 ? 1 : t <= 0 ? 0 : 1 - (1 - t) * (1 - t);
      if (t < 1) still = true;
      if (filmed) {
        data[o] = filmed[i * 3]!;
        data[o + 1] = filmed[i * 3 + 1]!;
        data[o + 2] = filmed[i * 3 + 2]!;
      } else {
        const rgb = this.read.rgb[v]!;
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
      }
      data[o + 3] = Math.round(a * 255);
    }
    this.canvas.getContext('2d')!.putImageData(this.image, 0, 0);
    this.fading = still;
    return still;
  }
}

const isRect = (r: Rect | null): r is Rect => r !== null;

/** Steps `from` toward `to` by the share an exponential glide of time constant `tau` covers in `dt`. */
const follow = (from: number, to: number, dt: number, tau: number) => (tau > 0 ? from + (to - from) * (1 - Math.exp(-dt / tau)) : to);

/** The vocabulary a painter reads its grids with, and each class's colour channels. */
interface Reading<P extends ScanPicturePreview> {
  readonly vocabulary: ScanVocabulary<P>;
  readonly rgb: Readonly<Record<number, [number, number, number]>>;
}

export class ScanPreviewPainter<P extends ScanPicturePreview> {
  private readonly read: Reading<P>;
  private coverage: Layer<P> | null = null;
  private ground: Layer<P> | null = null;
  /** The box the picture shows and the camera's view, as drawn and as aimed at, in cells. */
  private shown: Rect | null = null;
  private aim: Rect | null = null;
  private view: Rect | null = null;
  private viewAim: Rect | null = null;
  private last = 0;

  /** Each class's colour is its zone's map colour. */
  constructor(vocabulary: ScanVocabulary<P>, private readonly look: ScanPictureLook) {
    const rgb: Record<number, [number, number, number]> = {};
    for (const [cls, zone] of Object.entries(vocabulary.zones)) rgb[Number(cls)] = hexChannels(ZONE_COLORS[zone] ?? ZONE_COLORS[0]!);
    this.read = { vocabulary, rgb };
  }

  /** Takes a preview in at `now` (ms); `animate` false shows it as read, without fading. */
  ingest(preview: P, now: number, animate: boolean): void {
    const cell = this.read.vocabulary.cell;
    if (preview.kind === 'coverage') {
      this.coverage = new Layer(this.read, preview, this.coverage, now, animate);
      const v = preview.view;
      this.viewAim = v ? { x: v.x / cell.width, y: v.y / cell.height, w: v.w / cell.width, h: v.h / cell.height } : null;
    } else {
      this.ground = new Layer(this.read, preview, this.ground, now, animate);
      this.viewAim = null;
    }
    this.aim = rectsBounds([this.coverage?.seenBox() ?? null, this.ground?.box ?? null, this.viewAim].filter(isRect));
    if (!animate || !this.shown) this.shown = this.aim;
    if (!animate || !this.view) this.view = this.viewAim;
    if (!this.viewAim) this.view = null;
  }

  /** Whether there is anything to draw. */
  get empty(): boolean {
    return !this.coverage && !this.ground;
  }

  /**
   * Draws the picture at `now` (ms) into `canvas` at its css size and device pixel ratio. Returns
   * whether it is still moving, so the caller knows to draw again next frame.
   */
  draw(canvas: HTMLCanvasElement, now: number, animate: boolean): boolean {
    const dt = this.last ? Math.min(100, now - this.last) : 0;
    this.last = now;
    const fade = animate ? this.look.revealMs : 0;
    const tau = animate ? this.look.followMs / 3 : 0;
    let moving = false;
    if (this.coverage?.render(now, fade)) moving = true;
    if (this.ground?.render(now, fade)) moving = true;
    const glide = (from: Rect | null, to: Rect | null): Rect | null => {
      if (!from || !to) return to;
      const next = { x: follow(from.x, to.x, dt, tau), y: follow(from.y, to.y, dt, tau), w: follow(from.w, to.w, dt, tau), h: follow(from.h, to.h, dt, tau) };
      if (Math.max(Math.abs(next.x - to.x), Math.abs(next.y - to.y), Math.abs(next.w - to.w), Math.abs(next.h - to.h)) < SETTLED) return to;
      moving = true;
      return next;
    };
    this.shown = glide(this.shown, this.aim);
    this.view = glide(this.view, this.viewAim);

    const sized = sizeToCssBox(canvas);
    if (!sized) return false;
    const { ctx, cssW, cssH, scale: dpr } = sized;
    ctx.fillStyle = this.look.inset;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const box = this.shown;
    if (!box) return moving;

    // Fit the box less a margin, centred, cells square.
    const { cell, x: ox, y: oy } = fitCells(cssW, cssH, box, 0, FIT_MARGIN * Math.max(1, box.w, box.h));
    ctx.setTransform(dpr * cell, 0, 0, dpr * cell, dpr * ox, dpr * oy);
    ctx.imageSmoothingEnabled = false;

    // Dots on the unexplored ground, on whole cells so they hold still as the picture widens.
    const left = -ox / cell, top = -oy / cell, right = (cssW - ox) / cell, bottom = (cssH - oy) / cell;
    ctx.fillStyle = this.look.line;
    ctx.globalAlpha = DOT_ALPHA;
    const dot = Math.min(0.5, 1.5 / cell);
    const step = DOT_STEP * Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, 6 / (DOT_STEP * cell)))));
    for (let y = Math.floor(top / step) * step; y <= bottom; y += step) {
      for (let x = Math.floor(left / step) * step; x <= right; x += step) ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    ctx.globalAlpha = 1;

    const paint = (layer: Layer<P>, alpha: number) => {
      if (!layer.canvas) return;
      const b = layer.box;
      ctx.globalAlpha = alpha;
      ctx.drawImage(layer.canvas, b.x, b.y, b.w, b.h);
      ctx.globalAlpha = 1;
    };
    if (this.coverage) paint(this.coverage, 1);
    if (this.ground) {
      paint(this.ground, 1);
      const g = this.ground.preview;
      const chunk = g.chunk;
      if (chunk) {
        const b = this.ground.box;
        const grid = this.read.vocabulary.cell;
        const cw = (g.unitW * chunk) / grid.width;
        const ch = (g.unitH * chunk) / grid.height;
        const S = CHUNK_GRID_STYLE.planetPreview;
        const lines = (from: number, to: number, step: number): number[] => {
          const at: number[] = [];
          for (let v = from; v < to - 1e-6; v += step) at.push(v);
          return at;
        };
        ctx.fillStyle = CHUNK_INK;
        ctx.globalAlpha = S.opacity;
        const frame = { x: b.x, y: b.y, width: b.w, height: b.h };
        for (const r of chunkDashRects(frame, lines(b.x, b.x + b.w, cw), lines(b.y, b.y + b.h, ch), chunkStrokeCells(cell, S.widthPx))) {
          ctx.fillRect(r.x, r.y, r.width, r.height);
        }
        ctx.globalAlpha = 1;
      }
    }
    const v = this.view;
    if (v) {
      ctx.strokeStyle = this.look.viewInk;
      ctx.lineWidth = VIEW_LINE / cell;
      ctx.beginPath();
      // Older engines draw the view square.
      if (typeof ctx.roundRect === 'function') ctx.roundRect(v.x, v.y, v.w, v.h, VIEW_RADIUS);
      else ctx.rect(v.x, v.y, v.w, v.h);
      ctx.fillStyle = this.look.viewInk;
      ctx.globalAlpha = VIEW_FILL;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    return moving;
  }
}
