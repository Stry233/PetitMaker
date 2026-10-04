import { describe, expect, it } from 'vitest';
import { barMatches, readHud, zoomDiffers } from '../../../io/planet-scan/hud';
import { SCAN_PROFILE } from '../../../io/planet-scan/profile';
import { hudFrame as buildFrame, plainFrame as frame, paintRect as paint } from './synthetic';

const { width: W, height: H } = SCAN_PROFILE.frame;
const HUD = SCAN_PROFILE.hud;

const read = (data: Uint8ClampedArray) => readHud({ width: W, height: H, data });

describe("the map view's HUD", () => {
  it('reads a map-view frame and the zoom knob centre', () => {
    const hud = read(buildFrame());
    expect(hud.mapView).toBe(true);
    expect(hud.whole).toBe(true);
    expect(Math.abs(hud.knob! - HUD.zoom.knobCentre)).toBeLessThan(1);
  });

  it('still reads the map view with one structure covered, but not as a whole HUD', () => {
    for (const skip of ['bar', 'discs', 'zoom'] as const) {
      const hud = read(buildFrame(HUD.zoom.knobCentre, skip));
      expect(hud.mapView).toBe(true);
      expect(hud.whole).toBe(false);
    }
  });

  it('reads the HUD as browsers decode it and as ffmpeg\'s default scaling does, 2 to 3 levels darker', () => {
    // Medians measured on a reference recording under each decoding.
    for (const [bar, disc] of [[[68, 66, 62], [54, 48, 45]], [[66, 63, 60], [52, 46, 42]]] as const) {
      const data = frame();
      paint(data, HUD.bar.region, bar);
      for (const r of HUD.discs.regions) paint(data, r, disc);
      const Z = HUD.zoom;
      paint(data, { x0: Z.x0, x1: Z.x1, y0: Z.y0, y1: Z.y1 }, bar);
      paint(data, { x0: Z.x0, x1: Z.x1, y0: Z.knobCentre - 11, y1: Z.knobCentre + 11 }, Z.knobColour);
      expect(read(data).whole).toBe(true);
    }
  });

  it('refuses frames without the HUD', () => {
    expect(read(frame()).mapView).toBe(false);
    const barOnly = frame();
    paint(barOnly, HUD.bar.region, HUD.barColor);
    expect(barMatches({ width: W, height: H, data: barOnly })).toBe(true);
    expect(read(barOnly).mapView).toBe(false);
  });

  it('tells a moved zoom knob from the calibrated zoom', () => {
    const knobs = (row: number) => Array.from({ length: 20 }, () => read(buildFrame(row)).knob!);
    expect(zoomDiffers(knobs(HUD.zoom.knobCentre))).toBe(false);
    expect(zoomDiffers(knobs(HUD.zoom.knobCentre - 40))).toBe(true);
    expect(zoomDiffers([])).toBe(false);
  });

  it('reads only frames of the calibrated size', () => {
    expect(() => readHud({ width: 640, height: 360, data: new Uint8ClampedArray(640 * 360 * 4) })).toThrow();
  });
});
