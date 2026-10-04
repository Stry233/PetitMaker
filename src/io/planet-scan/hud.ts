import { SCAN_PROFILE } from './profile';
import type { PixelRect, RgbaImage } from './types';

// The map view's HUD read off a decoded frame: whether the frame shows the map view, and
// where the zoom slider's knob stands. Only plain colours of the HUD's structure are read (the
// bottom bar, the dark rims of its round buttons, the slider track), so no game artwork is needed.

const HUD = SCAN_PROFILE.hud;

/** What one frame's HUD shows. */
export interface HudReading {
  /** The frame shows the map view. */
  readonly mapView: boolean;
  /** Every structure of the HUD matched, as at the start of a scan. */
  readonly whole: boolean;
  /** The zoom knob's centre row, or null where the zoom column was not read. */
  readonly knob: number | null;
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

const near = (mean: readonly number[], colour: readonly number[], tolerance: number) =>
  mean.every((m, c) => Math.abs(m - colour[c]!) <= tolerance);

/** The opaque bottom bar: uniform and of its colour. */
export function barMatches(frame: RgbaImage): boolean {
  const p = patch(frame, HUD.bar.region, HUD.bar.sampleStep);
  return near(p.mean, HUD.barColor, HUD.barTolerance) && p.spread <= HUD.barSpread;
}

function discsMatch(frame: RgbaImage): boolean {
  const d = HUD.discs;
  return d.regions.every((r) => {
    const p = patch(frame, r);
    return near(p.mean, d.colour, d.tolerance) && p.spread <= d.spread;
  });
}

/** The zoom column's knob centre row, or null when the column is not the slider's. */
function zoomKnob(frame: RgbaImage): number | null {
  const Z = HUD.zoom;
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
    else if (near(mean, Z.knobColour, Z.knobTolerance)) {
      matched++;
      knobRows++;
      knobSum += y;
    }
  }
  if (matched < Z.minShare * rows || knobRows < Z.knobRows) return null;
  return knobSum / knobRows;
}

/** Reads one frame decoded at the profile's frame size. */
export function readHud(frame: RgbaImage): HudReading {
  if (frame.width !== SCAN_PROFILE.frame.width || frame.height !== SCAN_PROFILE.frame.height) {
    throw new Error(`the HUD is read on ${SCAN_PROFILE.frame.width}x${SCAN_PROFILE.frame.height} frames`);
  }
  const knob = zoomKnob(frame);
  const matched = (barMatches(frame) ? 1 : 0) + (discsMatch(frame) ? 1 : 0) + (knob !== null ? 1 : 0);
  return { mapView: matched >= HUD.required, whole: matched === 3, knob };
}

/** Whether the scan's median knob row says the recording used another zoom than the calibration's. */
export function zoomDiffers(knobRows: readonly number[]): boolean {
  if (knobRows.length === 0) return false;
  const sorted = [...knobRows].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return Math.abs(median - HUD.zoom.knobCentre) > HUD.zoom.knobDrift;
}
