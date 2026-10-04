/**
 * The video import's live picture: the ground the scan has read so far, on the window's inset
 * cream where nothing has been seen. Pass 1's coverage fills in under the camera's view in the
 * colours the recording showed, a top-down mosaic of the planet as filmed; pass 2's cells resolve
 * over it in the map's own zone colours, with the chunk dashes the planet pictures use. Units fade in as they are first read, the camera's view glides
 * to where it went, and the picture widens to keep everything read in sight; with reduced motion
 * every frame is the latest state.
 *
 * The scan's previews place their grids in rectified path pixels; the painter works in cells
 * (`SCAN_PROFILE.cell`), so a cell is square on screen as it is in the planet pictures.
 */
import { ZONE_COLORS } from '../../../../core/model/constants';
import { numberToHexString } from '../../../../core/model/colors';
import { CellZone } from '../../../../core/model/types';
import { CHUNK_GRID_STYLE } from '../../../../canvas/reference-grid';
import { PREVIEW_GRASS, PREVIEW_SAND, PREVIEW_SEA, PREVIEW_UNSEEN, previewClass, type ScanPreview } from '../../../../io/planet-scan/preview';
import { SCAN_PROFILE } from '../../../../io/planet-scan/profile';
import { colors } from '../../../design/styles';
import { seconds } from '../../../design/motion';
import { skin } from '../../../design/window-skin';

const CELL = SCAN_PROFILE.cell;

/** A box in cells: `x0, y0` inclusive, `x1, y1` exclusive. */
interface Box { x0: number; y0: number; x1: number; y1: number }

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Each preview class's colour, from the map's zone colours. */
const CLASS_RGB: Record<number, [number, number, number]> = {
  [PREVIEW_SEA]: hexRgb(ZONE_COLORS[CellZone.Void]!),
  [PREVIEW_SAND]: hexRgb(ZONE_COLORS[CellZone.Beach]!),
  [PREVIEW_GRASS]: hexRgb(ZONE_COLORS[CellZone.Grass]!),
};

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
class Layer {
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

  constructor(readonly preview: ScanPreview, before: Layer | null, now: number, animate: boolean) {
    const { cols, rows } = preview;
    this.ux0 = Math.round(preview.x / preview.unitW);
    this.uy0 = Math.round(preview.y / preview.unitH);
    this.cls = new Uint8Array(cols * rows);
    this.born = new Float64Array(cols * rows);
    const same = before && before.preview.unitW === preview.unitW && before.preview.unitH === preview.unitH;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const v = previewClass(preview, i);
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
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const ctx = canvas?.getContext('2d') ?? null;
    if (canvas && ctx) {
      canvas.width = Math.max(1, cols);
      canvas.height = Math.max(1, rows);
      this.canvas = canvas;
      this.image = ctx.createImageData(canvas.width, canvas.height);
    } else {
      this.canvas = null;
      this.image = null;
    }
  }

  /** The units' box in cells. */
  get box(): Box {
    const p = this.preview;
    return { x0: p.x / CELL.width, y0: p.y / CELL.height, x1: (p.x + p.cols * p.unitW) / CELL.width, y1: (p.y + p.rows * p.unitH) / CELL.height };
  }

  /** The box of the units read, in cells, or null. */
  seenBox(): Box | null {
    const { cols, rows, unitW, unitH, x, y } = this.preview;
    let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
    for (let i = 0; i < cols * rows; i++) {
      if (this.cls[i] === PREVIEW_UNSEEN) continue;
      const c = i % cols, r = Math.floor(i / cols);
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
    }
    if (!(c1 >= c0)) return null;
    return { x0: (x + c0 * unitW) / CELL.width, y0: (y + r0 * unitH) / CELL.height, x1: (x + (c1 + 1) * unitW) / CELL.width, y1: (y + (r1 + 1) * unitH) / CELL.height };
  }

  /** Repaints the picture at `now`; returns whether any unit is still fading in. */
  render(now: number, fade: number): boolean {
    if (!this.canvas || !this.image) return false;
    if (!this.fading) return false;
    const data = this.image.data;
    const filmed = this.preview.rgb;
    let still = false;
    for (let i = 0; i < this.cls.length; i++) {
      const v = this.cls[i]!;
      const o = i * 4;
      if (v === PREVIEW_UNSEEN) { data[o + 3] = 0; continue; }
      const t = fade > 0 ? (now - this.born[i]!) / fade : 1;
      const a = t >= 1 ? 1 : t <= 0 ? 0 : 1 - (1 - t) * (1 - t);
      if (t < 1) still = true;
      if (filmed) {
        data[o] = filmed[i * 3]!;
        data[o + 1] = filmed[i * 3 + 1]!;
        data[o + 2] = filmed[i * 3 + 2]!;
      } else {
        const rgb = CLASS_RGB[v]!;
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

const union = (a: Box | null, b: Box | null): Box | null => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/** Steps `from` toward `to` by the share an exponential glide of time constant `tau` covers in `dt`. */
const follow = (from: number, to: number, dt: number, tau: number) => (tau > 0 ? from + (to - from) * (1 - Math.exp(-dt / tau)) : to);

export class ScanPreviewPainter {
  private coverage: Layer | null = null;
  private ground: Layer | null = null;
  /** The box the picture shows and the camera's view, as drawn and as aimed at, in cells. */
  private shown: Box | null = null;
  private aim: Box | null = null;
  private view: Box | null = null;
  private viewAim: Box | null = null;
  private last = 0;

  /** Takes a preview in at `now` (ms); `animate` false shows it as read, without fading. */
  ingest(preview: ScanPreview, now: number, animate: boolean): void {
    if (preview.kind === 'coverage') {
      this.coverage = new Layer(preview, this.coverage, now, animate);
      const v = preview.view;
      this.viewAim = v ? { x0: v.x / CELL.width, y0: v.y / CELL.height, x1: (v.x + v.w) / CELL.width, y1: (v.y + v.h) / CELL.height } : null;
    } else {
      this.ground = new Layer(preview, this.ground, now, animate);
      this.viewAim = null;
    }
    this.aim = union(union(this.coverage?.seenBox() ?? null, this.ground?.box ?? null), this.viewAim);
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
    const fade = animate ? seconds('scan.preview.reveal') * 1000 : 0;
    const tau = animate ? (seconds('scan.preview.follow') * 1000) / 3 : 0;
    let moving = false;
    if (this.coverage?.render(now, fade)) moving = true;
    if (this.ground?.render(now, fade)) moving = true;
    const glide = (from: Box | null, to: Box | null): Box | null => {
      if (!from || !to) return to;
      const next = { x0: follow(from.x0, to.x0, dt, tau), y0: follow(from.y0, to.y0, dt, tau), x1: follow(from.x1, to.x1, dt, tau), y1: follow(from.y1, to.y1, dt, tau) };
      if (Math.max(Math.abs(next.x0 - to.x0), Math.abs(next.y0 - to.y0), Math.abs(next.x1 - to.x1), Math.abs(next.y1 - to.y1)) < SETTLED) return to;
      moving = true;
      return next;
    };
    this.shown = glide(this.shown, this.aim);
    this.view = glide(this.view, this.viewAim);

    const dpr = globalThis.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.width / dpr;
    const cssH = canvas.clientHeight || canvas.height / dpr;
    const backW = Math.max(1, Math.round(cssW * dpr));
    const backH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== backW) canvas.width = backW;
    if (canvas.height !== backH) canvas.height = backH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = skin.inset;
    ctx.fillRect(0, 0, backW, backH);
    const box = this.shown;
    if (!box) return moving;

    // Fit the box less a margin, centred, cells square.
    const bw = Math.max(1, box.x1 - box.x0);
    const bh = Math.max(1, box.y1 - box.y0);
    const pad = FIT_MARGIN * Math.max(bw, bh);
    const cell = Math.min(cssW / (bw + 2 * pad), cssH / (bh + 2 * pad));
    const ox = cssW / 2 - ((box.x0 + box.x1) / 2) * cell;
    const oy = cssH / 2 - ((box.y0 + box.y1) / 2) * cell;
    ctx.setTransform(dpr * cell, 0, 0, dpr * cell, dpr * ox, dpr * oy);
    ctx.imageSmoothingEnabled = false;

    // Dots on the unexplored ground, on whole cells so they hold still as the picture widens.
    const left = -ox / cell, top = -oy / cell, right = (cssW - ox) / cell, bottom = (cssH - oy) / cell;
    ctx.fillStyle = skin.line;
    ctx.globalAlpha = DOT_ALPHA;
    const dot = Math.min(0.5, 1.5 / cell);
    const step = DOT_STEP * Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, 6 / (DOT_STEP * cell)))));
    for (let y = Math.floor(top / step) * step; y <= bottom; y += step) {
      for (let x = Math.floor(left / step) * step; x <= right; x += step) ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    ctx.globalAlpha = 1;

    const paint = (layer: Layer, alpha: number) => {
      if (!layer.canvas) return;
      const b = layer.box;
      ctx.globalAlpha = alpha;
      ctx.drawImage(layer.canvas, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.globalAlpha = 1;
    };
    if (this.coverage) paint(this.coverage, 1);
    if (this.ground) {
      paint(this.ground, 1);
      const g = this.ground.preview;
      const chunk = g.chunk;
      if (chunk) {
        const b = this.ground.box;
        const cw = (g.unitW * chunk) / CELL.width;
        const ch = (g.unitH * chunk) / CELL.height;
        const S = CHUNK_GRID_STYLE.planetPreview;
        ctx.strokeStyle = CHUNK_INK;
        ctx.globalAlpha = S.opacity;
        ctx.lineWidth = S.widthPx / cell;
        ctx.setLineDash([CHUNK_GRID_STYLE.dashCells, CHUNK_GRID_STYLE.gapCells]);
        ctx.beginPath();
        for (let x = b.x0; x <= b.x1 + 1e-6; x += cw) { ctx.moveTo(x, b.y0); ctx.lineTo(x, b.y1); }
        for (let y = b.y0; y <= b.y1 + 1e-6; y += ch) { ctx.moveTo(b.x0, y); ctx.lineTo(b.x1, y); }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
    const v = this.view;
    if (v) {
      ctx.strokeStyle = colors.white;
      ctx.lineWidth = VIEW_LINE / cell;
      ctx.beginPath();
      // Older engines draw the view square.
      if (typeof ctx.roundRect === 'function') ctx.roundRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, VIEW_RADIUS);
      else ctx.rect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
      ctx.fillStyle = colors.white;
      ctx.globalAlpha = VIEW_FILL;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    return moving;
  }
}

