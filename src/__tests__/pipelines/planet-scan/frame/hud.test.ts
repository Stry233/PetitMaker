import { describe, expect, it, vi } from 'vitest';
import { CALIBRATED_WINDOW } from '../../../../pipelines/planet-scan/frame/framing';
import { barMatches, CALIBRATED_LAYOUT, hudScale, InsetSurvey, placeProbe, readHud, windowLayout, zoomDiffers, type HudLayout } from '../../../../pipelines/planet-scan/frame/hud';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import type { PixelRect } from '../../../../pipelines/planet-scan/types';
import { hudFrame as buildFrame, paintRect as paint, windowFrame } from '../synthetic';

vi.setConfig({ testTimeout: 30_000 });

const { width: W, height: H } = SCAN_PROFILE.frame;
const HUD = SCAN_PROFILE.hud;

const image = (data: Uint8ClampedArray) => ({ width: W, height: H, data });
const read = (data: Uint8ClampedArray, layout: HudLayout = CALIBRATED_LAYOUT) => readHud(image(data), layout);

/** Windows of the frame: the calibrated 16:10 one, a 16:9 one filling the frame, a 4:3 one and a
 *  21:9 one fit to the frame's width, each with the HUD's inset. */
const FULL: PixelRect = { x0: 0, y0: 0, x1: W, y1: H };
const NARROW: PixelRect = { x0: 120, y0: 0, x1: 840, y1: H };
const WIDE: PixelRect = { x0: 0, y0: (H - W * 9 / 21) / 2, x1: W, y1: (H + W * 9 / 21) / 2 };
const PILLARBOX: PixelRect = { x0: 48, y0: 0, x1: 912, y1: H };
const shapes: [string, PixelRect, number][] = [['16:10', PILLARBOX, 12], ['16:9', FULL, 0], ['4:3', NARROW, 6], ['21:9', WIDE, 0]];

describe('the HUD\'s scale and layout from the game window', () => {
  it('draws the HUD 10/9 as large in a 16:9 window as in the 16:10 window of the same height', () => {
    expect(hudScale(CALIBRATED_WINDOW)).toBe(1);
    expect(hudScale(FULL)).toBeCloseTo(10 / 9, 12);
  });

  it('scales with the width below the reference aspect and with the height above it', () => {
    // A 4:3 window as tall as the frame: its width against the calibrated window's.
    expect(hudScale(NARROW)).toBeCloseTo(720 / 864, 12);
    // A 21:9 window: the height decides, as for a 16:9 window of that height.
    const h = WIDE.y1 - WIDE.y0;
    expect(hudScale(WIDE)).toBeCloseTo((h / H) * (10 / 9), 12);
    // A window half the size draws the HUD half as large.
    expect(hudScale({ x0: 0, y0: 0, x1: 432, y1: 270 })).toBeCloseTo(0.5, 12);
  });

  it('lays the calibrated HUD out 12 px inside the calibrated window', () => {
    expect(CALIBRATED_LAYOUT).toEqual({ left: CALIBRATED_WINDOW.x0 + 12, right: CALIBRATED_WINDOW.x1 - 12, top: 0, bottom: H, scale: 1 });
    expect(windowLayout(CALIBRATED_WINDOW, HUD.inset.calibrated)).toEqual(CALIBRATED_LAYOUT);
  });
});

describe('probes anchored to the HUD layout', () => {
  const rect = { x0: 89, y0: 168, x1: 95, y1: 173 };

  it('leaves every probe where it was measured in the calibrated layout', () => {
    for (const x of ['left', 'right', 'span'] as const) {
      for (const y of ['top', 'middle', 'bottom'] as const) expect(placeProbe(rect, { x, y }, CALIBRATED_LAYOUT)).toEqual(rect);
    }
  });

  it('keeps a probe at its scaled offset from its edges in any layout', () => {
    for (const [, window, inset] of shapes) {
      const layout = windowLayout(window, inset);
      const s = layout.scale;
      const mid = (layout.top + layout.bottom) / 2;
      const left = placeProbe(rect, { x: 'left', y: 'middle' }, layout);
      expect(left.x0).toBe(Math.round(layout.left + (rect.x0 - CALIBRATED_LAYOUT.left) * s));
      expect(left.y0).toBe(Math.round(mid - (H / 2 - rect.y0) * s));
      const right = placeProbe({ x0: 842, y0: 26, x1: 848, y1: 31 }, { x: 'right', y: 'top' }, layout);
      expect(right.x1).toBe(Math.round(layout.right - (CALIBRATED_LAYOUT.right - 848) * s));
      expect(right.y0).toBe(Math.round(layout.top + 26 * s));
      const span = placeProbe(HUD.bar.region, HUD.bar.anchor, layout);
      expect(span.x0).toBe(Math.round(layout.left + (HUD.bar.region.x0 - CALIBRATED_LAYOUT.left) * s));
      expect(span.x1).toBe(Math.round(layout.right - (CALIBRATED_LAYOUT.right - HUD.bar.region.x1) * s));
      expect(span.y1).toBe(Math.round(layout.bottom - (H - HUD.bar.region.y1) * s));
    }
  });
});

describe("the map view's HUD", () => {
  it('reads a map-view frame and the zoom knob centre in a window of any shape', () => {
    for (const [, window, inset] of shapes) {
      const layout = windowLayout(window, inset);
      const hud = read(buildFrame(HUD.zoom.knobCentre, null, layout, window), layout);
      expect(hud).toMatchObject({ mapView: true, whole: true });
      expect(Math.abs(hud.knob! - HUD.zoom.knobCentre)).toBeLessThan(1);
    }
  });

  it('reads the HUD only in the layout of the window the frame holds', () => {
    const wide = windowLayout(FULL, 0);
    expect(read(buildFrame(HUD.zoom.knobCentre, null, CALIBRATED_LAYOUT), wide).mapView).toBe(false);
    expect(read(buildFrame(HUD.zoom.knobCentre, null, wide, FULL)).mapView).toBe(false);
  });

  it('still reads the map view with one structure covered, but not as a whole HUD', () => {
    for (const [, window, inset] of shapes) {
      const layout = windowLayout(window, inset);
      for (const skip of ['bar', 'discs', 'zoom'] as const) {
        const hud = read(buildFrame(HUD.zoom.knobCentre, skip, layout, window), layout);
        expect(hud.mapView).toBe(true);
        expect(hud.whole).toBe(false);
      }
    }
  });

  it('reads the HUD as browsers decode it and as ffmpeg\'s default scaling does, 2 to 3 levels darker', () => {
    // Medians measured on a reference recording under each decoding.
    for (const [bar, disc] of [[[68, 66, 62], [54, 48, 45]], [[66, 63, 60], [52, 46, 42]]] as const) {
      const data = windowFrame(48, 912);
      paint(data, HUD.bar.region, bar);
      for (const r of HUD.discs.regions) paint(data, r.rect, disc);
      const Z = HUD.zoom;
      paint(data, { x0: Z.x0, x1: Z.x1, y0: Z.y0, y1: Z.y1 }, bar);
      paint(data, { x0: Z.x0, x1: Z.x1, y0: Z.knobCentre - 11, y1: Z.knobCentre + 11 }, Z.knobColor);
      expect(read(data).whole).toBe(true);
    }
  });

  it('refuses frames without the HUD', () => {
    expect(read(windowFrame(48, 912)).mapView).toBe(false);
    const barOnly = windowFrame(48, 912);
    paint(barOnly, HUD.bar.region, HUD.barColor);
    expect(barMatches(image(barOnly), CALIBRATED_LAYOUT)).toBe(true);
    expect(read(barOnly).mapView).toBe(false);
  });

  it('tells a moved zoom knob from the calibrated zoom in a window of any shape', () => {
    for (const [, window, inset] of shapes) {
      const layout = windowLayout(window, inset);
      const knobs = (row: number) => Array.from({ length: 20 }, () => read(buildFrame(row, null, layout, window), layout).knob!);
      expect(zoomDiffers(knobs(HUD.zoom.knobCentre))).toBe(false);
      expect(zoomDiffers(knobs(HUD.zoom.knobCentre - 40))).toBe(true);
    }
    expect(zoomDiffers([])).toBe(false);
  });

  it('reads only frames of the calibrated size', () => {
    expect(() => readHud({ width: 640, height: 360, data: new Uint8ClampedArray(640 * 360 * 4) }, CALIBRATED_LAYOUT)).toThrow();
  });
});

describe('the HUD\'s inset from the bottom bar', () => {
  /** A frame of `window` whose bar spans the layout `inset` px inside it, its ends blended into
   *  the dark ground beyond by `share` of a pixel. */
  function barFrame(window: PixelRect, inset: number, share = 0) {
    const layout = windowLayout(window, inset);
    const data = buildFrame(HUD.zoom.knobCentre, null, layout, window);
    // Dark ground under the bar's ends, then the bar across the HUD's width at the bar's rows.
    const rows = placeProbe(HUD.bar.region, HUD.bar.anchor, layout);
    paint(data, { x0: Math.round(window.x0), x1: Math.round(window.x1), y0: rows.y0, y1: rows.y1 }, [10, 12, 6]);
    const x0 = Math.ceil(layout.left);
    const x1 = Math.floor(layout.right);
    paint(data, { x0, x1, y0: rows.y0, y1: rows.y1 }, HUD.barColor);
    const blend = HUD.barColor.map((c, k) => Math.round(c * share + [10, 12, 6][k]! * (1 - share)));
    if (share > 0) {
      paint(data, { x0: x0 - 1, x1: x0, y0: rows.y0, y1: rows.y1 }, blend);
      paint(data, { x0: x1, x1: x1 + 1, y0: rows.y0, y1: rows.y1 }, blend);
    }
    return image(data);
  }

  it('measures the bar\'s ends inside the window', () => {
    for (const [, window, inset] of shapes) {
      const survey = new InsetSurvey(window);
      survey.add(barFrame(window, inset));
      expect(survey.inset()).toBe(inset);
    }
  });

  it('places a blended end column between the bar and the ground', () => {
    const survey = new InsetSurvey(PILLARBOX);
    // The column beside each end three quarters covered: the HUD 11.25 px inside.
    survey.add(barFrame(PILLARBOX, 12, 0.75));
    expect(survey.inset()).toBeCloseTo(11.25, 1);
  });

  it('takes the median over pictures and ignores pictures without the bar', () => {
    const survey = new InsetSurvey(PILLARBOX);
    for (const inset of [12, 12, 20]) survey.add(barFrame(PILLARBOX, inset));
    survey.add(image(windowFrame(48, 912)));
    expect(survey.inset()).toBe(12);
    expect(new InsetSurvey(PILLARBOX).inset()).toBe(0);
  });
});
