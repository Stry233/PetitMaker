import { median } from '../../../core/base/math';
import { CALIBRATED_FRAMING, CALIBRATED_WINDOW, type ScanFraming } from './framing';
import { SCAN_PROFILE, type HudAnchor } from '../profile';
import type { PixelRect, RgbaImage } from '../types';

// The map view's HUD read off a decoded frame: whether the frame shows the map view, and
// where the zoom slider's knob stands. Only plain colours of the HUD's structure are read (the
// bottom bar, the dark rims of its round buttons, the slider track), so no game artwork is needed.
// The HUD is laid out on the game window the recording's framing found (`framing.ts`): its edges
// are the window's, inset horizontally by the measured inset, and it is drawn at the scale the
// game's canvas scaler gives that window. Probe rectangles are measured in the calibrated window;
// each keeps its anchor and its offset from it in reference pixels.

const HUD = SCAN_PROFILE.hud;
const { height: FH } = SCAN_PROFILE.frame;

/** What one frame's HUD shows. */
export interface HudReading {
  /** The frame shows the map view. */
  readonly mapView: boolean;
  /** Every structure of the HUD matched, as at the start of a scan. */
  readonly whole: boolean;
  /** The zoom knob's centre row in the calibrated window's layout, or null where the zoom column
   *  was not read. */
  readonly knob: number | null;
}

/** Where the HUD lies in the frame: the edges of its rectangle and its drawing scale against the
 *  calibrated window's. */
export interface HudLayout {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly scale: number;
}

/** The canvas scaler's scale for a window `width` x `height`, up to a constant: it fits the
 *  reference resolution's width or height, whichever is smaller. */
const canvasScale = (width: number, height: number) => Math.min(width / HUD.reference.aspect, height);

/** The HUD's drawing scale in a window of the frame against the calibrated window's. */
export function hudScale(gameWindow: PixelRect): number {
  const w = CALIBRATED_WINDOW;
  return canvasScale(gameWindow.x1 - gameWindow.x0, gameWindow.y1 - gameWindow.y0) / canvasScale(w.x1 - w.x0, w.y1 - w.y0);
}

/** The HUD's layout in `window` with its edges `inset` frame pixels inside it on either side. */
export function windowLayout(gameWindow: PixelRect, inset: number): HudLayout {
  return { left: gameWindow.x0 + inset, right: gameWindow.x1 - inset, top: gameWindow.y0, bottom: gameWindow.y1, scale: hudScale(gameWindow) };
}

/** The HUD's layout under a recording's framing. */
export function hudLayout(framing: ScanFraming): HudLayout {
  return windowLayout(framing.window, framing.hudInset);
}

/** The layout the probes in `SCAN_PROFILE.hud` were measured in. */
export const CALIBRATED_LAYOUT: HudLayout = hudLayout(CALIBRATED_FRAMING);

/** Moves a frame column measured in the calibrated layout into `layout`, kept at its offset
 *  (scaled) from the HUD's left or right edge. */
function placeX(x: number, edge: 'left' | 'right', layout: HudLayout): number {
  const C = CALIBRATED_LAYOUT;
  return edge === 'left' ? layout.left + (x - C.left) * layout.scale : layout.right - (C.right - x) * layout.scale;
}

/** Moves a frame row measured in the calibrated layout into `layout`. */
function placeY(y: number, edge: HudAnchor['y'], layout: HudLayout): number {
  const C = CALIBRATED_LAYOUT;
  if (edge === 'top') return layout.top + (y - C.top) * layout.scale;
  if (edge === 'bottom') return layout.bottom - (C.bottom - y) * layout.scale;
  return (layout.top + layout.bottom) / 2 + (y - (C.top + C.bottom) / 2) * layout.scale;
}

/** A probe rectangle measured in the calibrated layout, moved into `layout` by its anchor and
 *  rounded to whole pixels. */
export function placeProbe(rect: PixelRect, anchor: HudAnchor, layout: HudLayout): PixelRect {
  const left = anchor.x === 'right' ? 'right' : 'left';
  const right = anchor.x === 'left' ? 'left' : 'right';
  const x0 = Math.round(placeX(rect.x0, left, layout));
  const y0 = Math.round(placeY(rect.y0, anchor.y, layout));
  return {
    x0,
    y0,
    x1: Math.max(x0 + 1, Math.round(placeX(rect.x1, right, layout))),
    y1: Math.max(y0 + 1, Math.round(placeY(rect.y1, anchor.y, layout))),
  };
}

/** Mean and the largest channel deviation of `rect`, sampled every `step` pixels. */
function patch(frame: RgbaImage, rect: PixelRect, step = 1): { mean: [number, number, number]; spread: number } {
  const { width, data } = frame;
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  let n = 0;
  for (let y = rect.y0; y < rect.y1; y += step) {
    for (let x = rect.x0; x < rect.x1; x += step) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c]!;
        sum[c]! += v;
        sq[c]! += v * v;
      }
      n++;
    }
  }
  const mean = sum.map((s) => s / n) as [number, number, number];
  let spread = 0;
  for (let c = 0; c < 3; c++) spread = Math.max(spread, Math.sqrt(Math.max(0, sq[c]! / n - mean[c]! ** 2)));
  return { mean, spread };
}

const near = (mean: readonly number[], color: readonly number[], tolerance: number) =>
  mean.every((m, c) => Math.abs(m - color[c]!) <= tolerance);

/** The opaque bottom bar: uniform and of its colour, in `layout`. */
export function barMatches(frame: RgbaImage, layout: HudLayout): boolean {
  const p = patch(frame, placeProbe(HUD.bar.region, HUD.bar.anchor, layout), HUD.bar.sampleStep);
  return near(p.mean, HUD.barColor, HUD.barTolerance) && p.spread <= HUD.barSpread;
}

function discsMatch(frame: RgbaImage, layout: HudLayout): boolean {
  const d = HUD.discs;
  return d.regions.every((r) => {
    const p = patch(frame, placeProbe(r.rect, r.anchor, layout));
    return near(p.mean, d.color, d.tolerance) && p.spread <= d.spread;
  });
}

/** The zoom column's knob centre row in the calibrated layout, or null when the column is not the
 *  slider's. */
function zoomKnob(frame: RgbaImage, layout: HudLayout): number | null {
  const Zc = HUD.zoom;
  const Z = placeProbe(Zc, Zc.anchor, layout);
  const { width, data } = frame;
  const rows = Z.y1 - Z.y0;
  let matched = 0;
  let knobRows = 0;
  let knobSum = 0;
  const mean = [0, 0, 0];
  for (let y = Z.y0; y < Z.y1; y++) {
    mean[0] = mean[1] = mean[2] = 0;
    for (let x = Z.x0; x < Z.x1; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) mean[c]! += data[i + c]!;
    }
    for (let c = 0; c < 3; c++) mean[c]! /= Z.x1 - Z.x0;
    if (near(mean, HUD.barColor, HUD.barTolerance)) matched++;
    else if (near(mean, Zc.knobColor, Zc.knobTolerance)) {
      matched++;
      knobRows++;
      knobSum += y;
    }
  }
  if (matched < Zc.minShare * rows || knobRows < Math.round(Zc.knobRows * layout.scale)) return null;
  // Back to the calibrated layout's rows, where the zoom check's knob centre was measured.
  const C = CALIBRATED_LAYOUT;
  return (C.top + C.bottom) / 2 + (knobSum / knobRows - (layout.top + layout.bottom) / 2) / layout.scale;
}

/** Reads one frame decoded at the profile's frame size, its HUD laid out as `layout`. */
export function readHud(frame: RgbaImage, layout: HudLayout): HudReading {
  if (frame.width !== SCAN_PROFILE.frame.width || frame.height !== FH) {
    throw new Error(`the HUD is read on ${SCAN_PROFILE.frame.width}x${FH} frames`);
  }
  const knob = zoomKnob(frame, layout);
  const matched = (barMatches(frame, layout) ? 1 : 0) + (discsMatch(frame, layout) ? 1 : 0) + (knob !== null ? 1 : 0);
  return { mapView: matched >= HUD.required, whole: matched === 3, knob };
}

/** Whether the scan's median knob row says the recording used another zoom than the calibration's. */
export function zoomDiffers(knobRows: readonly number[]): boolean {
  if (knobRows.length === 0) return false;
  return Math.abs(median(knobRows, 'upper') - HUD.zoom.knobCentre) > HUD.zoom.knobDrift;
}

/**
 * The HUD's horizontal inset inside a recording's window, from the bottom bar's ends: the bar
 * spans the HUD's width, so its ends are the HUD's edges. Pictures whose bar matches with the
 * widest inset searched give each end where the columns leave the bar's colour in that picture,
 * to a fraction of a pixel from the level of the column it cuts; the inset is the median over those pictures of the two ends' mean distance from the
 * window's edges, in frame pixels to a hundredth, and 0 when no picture showed the bar.
 */
export class InsetSurvey {
  private readonly probe: HudLayout;
  private readonly bar: PixelRect;
  private readonly found: number[] = [];

  constructor(private readonly gameWindow: PixelRect) {
    this.probe = windowLayout(gameWindow, HUD.inset.max * hudScale(gameWindow));
    this.bar = placeProbe(HUD.bar.region, HUD.bar.anchor, this.probe);
  }

  /** A picture drawn where the scan reads it. */
  add(frame: RgbaImage): void {
    if (!barMatches(frame, this.probe)) return;
    const { x0, y0, x1, y1 } = this.bar;
    // The bar's colour in this picture, which its decoding may shift within the bar's tolerance.
    const color = patch(frame, this.bar, HUD.bar.sampleStep).mean;
    const { width, data } = frame;
    const lo = Math.max(0, Math.floor(this.gameWindow.x0));
    const hi = Math.min(width, Math.ceil(this.gameWindow.x1));
    const column = (x: number) => {
      const mean = [0, 0, 0];
      for (let y = y0; y < y1; y++) for (let c = 0; c < 3; c++) mean[c]! += data[(y * width + x) * 4 + c]!;
      return mean.map((m) => m / (y1 - y0));
    };
    const level = (x: number) => (x < lo || x >= hi ? 0 : column(x).reduce((s, v) => s + v, 0) / 3);
    const plateau = color.reduce((s, v) => s + v, 0) / 3;
    // The bar's end beyond the last bar column from `from` in direction `dir`: the share of the
    // first other column the bar covers, from its level between the bar's and the one past it.
    const end = (from: number, dir: 1 | -1) => {
      let x = from;
      while (x >= lo && x < hi && near(column(x), color, HUD.barTolerance)) x += dir;
      if (x < lo || x >= hi) return dir > 0 ? hi : lo;
      const past = level(x + 2 * dir);
      const share = Math.abs(plateau - past) < 1 ? 0 : Math.min(1, Math.max(0, (level(x) - past) / (plateau - past)));
      return dir > 0 ? x + share : x + 1 - share;
    };
    const left = end(x0, -1) - this.gameWindow.x0;
    const right = this.gameWindow.x1 - end(x1 - 1, 1);
    this.found.push((left + right) / 2);
  }

  inset(): number {
    if (this.found.length === 0) return 0;
    return Math.max(0, Math.round(median(this.found, 'upper') * 100) / 100);
  }
}
