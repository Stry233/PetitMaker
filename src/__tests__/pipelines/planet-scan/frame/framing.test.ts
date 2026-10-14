/**
 * Finding the game window in a decoded picture and placing the picture so the window reads like the
 * calibrated one: bars of any width on any side, a window off the picture's centre or alone, the
 * game's own dark edges and compression noise; the world keeps the calibrated scale whenever the
 * window fits the frame at the frame's height.
 */
import { describe, expect, it, vi } from 'vitest';
import { CALIBRATED_FRAMING, CALIBRATED_WINDOW, placeWindow, surveyPlacement, WindowSurvey, worldMeasured, type Placement, type PictureSize } from '../../../../pipelines/planet-scan/frame/framing';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import { surveyFraming, surveyTimes } from '../../../../pipelines/planet-scan/media/survey';
import type { PixelRect, RgbaImage } from '../../../../pipelines/planet-scan/types';
import { hudFrame, rng } from '../synthetic';
import { hudLayout } from '../../../../pipelines/planet-scan/frame/hud';

vi.setConfig({ testTimeout: 60_000 });

const { width: FW, height: FH } = SCAN_PROFILE.frame;

/**
 * A picture of `picture` pixels holding a game window `window` (picture pixels) between black
 * margins, drawn at `at` into the frame by area sampling, as the scaler draws it. Inside the window
 * the content is `content(u, v)` in window shares, and `seed` varies it from picture to picture as
 * the camera moves. Margins carry compression noise of up to `noise` levels.
 */
function draw(
  picture: PictureSize, window: PixelRect, at: Placement, content: (u: number, v: number, seed: number) => readonly number[],
  grain: { seed: number; noise?: number },
): RgbaImage {
  const { seed, noise = 0 } = grain;
  const data = new Uint8ClampedArray(FW * FH * 4);
  const r = rng(seed + 101);
  const taps = 2;
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const sum = [0, 0, 0];
      for (let j = 0; j < taps; j++) {
        for (let i = 0; i < taps; i++) {
          const px = (x + (i + 0.5) / taps - at.x) / at.scale;
          const py = (y + (j + 0.5) / taps - at.y) / at.scale;
          let c: readonly number[] = [0, 0, 0];
          if (px >= 0 && py >= 0 && px < picture.width && py < picture.height) {
            if (px >= window.x0 && px < window.x1 && py >= window.y0 && py < window.y1) {
              c = content((px - window.x0) / (window.x1 - window.x0), (py - window.y0) / (window.y1 - window.y0), seed);
            } else if (noise > 0) {
              const n = Math.floor(r() * (noise + 1));
              c = [n, n, n];
            }
          }
          for (let k = 0; k < 3; k++) sum[k]! += c[k]!;
        }
      }
      const o = (y * FW + x) * 4;
      data[o] = sum[0]! / (taps * taps);
      data[o + 1] = sum[1]! / (taps * taps);
      data[o + 2] = sum[2]! / (taps * taps);
      data[o + 3] = 255;
    }
  }
  return { width: FW, height: FH, data };
}

/** Ground that moves with `seed`, with a dark vignette at the window's edges. */
const ground = (u: number, v: number, seed: number) => {
  const edge = Math.min(u, 1 - u, v, 1 - v);
  const fade = Math.min(1, 0.15 + edge * 8);
  const g = 60 + 40 * Math.sin(u * 37 + seed * 1.7) * Math.cos(v * 23 + seed);
  return [g * 0.6 * fade, g * fade, g * 0.4 * fade];
};

function survey(picture: PictureSize, window: PixelRect, pictures = 16, noise = 0, content = ground) {
  const s = new WindowSurvey(picture);
  for (let k = 0; k < pictures; k++) s.add(draw(picture, window, s.placement, content, { seed: k, noise }));
  return s.window();
}

const close = (a: PixelRect | null, b: PixelRect, tolerance: number) => {
  expect(a).not.toBeNull();
  for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(Math.abs(a![k] - b[k])).toBeLessThanOrEqual(tolerance);
};

describe('placing the game window in the scan\'s frame', () => {
  it('puts the reference recordings\' 16:10 window where the calibration holds it, the picture on the frame\'s pixel grid', () => {
    // A pixel left of the picture's centre, as the reference recordings hold it.
    const placed = placeWindow({ x0: 95, y0: 0, x1: 1823, y1: 1080 }, { width: 1920, height: 1080 });
    expect(placed.placement).toEqual({ x: 0, y: 0, scale: FW / 1920 });
    expect(placed.window).toEqual(CALIBRATED_WINDOW);
    expect(placed.world).toBe(1);
  });

  it('maps a window filling a 16:9 picture onto the whole frame at the world\'s calibrated scale', () => {
    for (const [w, h] of [[1920, 1080], [3840, 2160], [1366, 768]] as const) {
      const placed = placeWindow({ x0: 0, y0: 0, x1: w, y1: h }, { width: w, height: h });
      // 1366 x 768 is a hair wider than 16:9, so the frame's width decides by 0.05 %.
      const scale = Math.min(FH / h, FW / w);
      expect(placed.placement.scale).toBeCloseTo(scale, 12);
      expect(placed.placement.x).toBeCloseTo((FW - w * scale) / 2, 6);
      expect(placed.placement.y).toBeCloseTo((FH - h * scale) / 2, 6);
      expect(Math.abs(placed.world - 1)).toBeLessThan(1e-3);
    }
  });

  it('centres a window off the picture\'s centre and gives it the frame\'s height', () => {
    const placed = placeWindow({ x0: 300, y0: 200, x1: 300 + 1728, y1: 200 + 1080 }, { width: 2560, height: 1440 });
    expect(placed.placement.scale).toBe(0.5);
    expect(placed.placement.x).toBe(FW / 2 - (300 + 864) * 0.5);
    expect(placed.placement.y).toBe(FH / 2 - (200 + 540) * 0.5);
    expect(placed.window).toEqual({ x0: 48, y0: 0, x1: 912, y1: FH });
  });

  it('keeps a narrow window at the frame\'s height and fits a wide one to the frame\'s width with a smaller world', () => {
    const narrow = placeWindow({ x0: 0, y0: 0, x1: 1440, y1: 1080 }, { width: 1440, height: 1080 });
    expect(narrow.world).toBe(1);
    expect(narrow.window).toEqual({ x0: 120, y0: 0, x1: 840, y1: FH });
    const wide = placeWindow({ x0: 0, y0: 0, x1: 2520, y1: 1080 }, { width: 2520, height: 1080 });
    expect(wide.placement.scale).toBeCloseTo(FW / 2520, 12);
    expect(wide.world).toBeCloseTo((1080 * FW) / 2520 / FH, 12);
    expect(wide.window.x0).toBeCloseTo(0, 9);
    expect(wide.window.x1).toBeCloseTo(FW, 9);
  });

  it('draws the whole picture for the survey, fit and centred', () => {
    expect(surveyPlacement({ width: 1920, height: 1080 })).toEqual({ x: 0, y: 0, scale: 0.5 });
    expect(surveyPlacement({ width: 1280, height: 1024 })).toEqual({ x: (FW - 1280 * (FH / 1024)) / 2, y: 0, scale: FH / 1024 });
    expect(surveyPlacement({ width: 2560, height: 1080 })).toEqual({ x: 0, y: (FH - 1080 * (FW / 2560)) / 2, scale: FW / 2560 });
  });

  it('marks the world as measured only between the recorded window shapes', () => {
    const framing = (w: number, h: number) => ({ ...placeWindow({ x0: 0, y0: 0, x1: w, y1: h }, { width: w, height: h }), hudInset: 0 });
    expect([worldMeasured(CALIBRATED_FRAMING), worldMeasured(framing(1920, 1080)), worldMeasured(framing(1680, 1050))]).toEqual([true, true, true]);
    expect([worldMeasured(framing(1440, 1080)), worldMeasured(framing(2560, 1080))]).toEqual([false, false]);
  });
});

describe('finding the game window over a recording\'s pictures', () => {
  it('finds a 16:10 window between pillarbox bars to a fraction of a pixel', () => {
    close(survey({ width: 1920, height: 1080 }, { x0: 96, y0: 0, x1: 1824, y1: 1080 }), { x0: 96, y0: 0, x1: 1824, y1: 1080 }, 0.6);
    // Edges between survey pixels against the game's darkened edge: within a survey pixel.
    close(survey({ width: 1920, height: 1080 }, { x0: 95, y0: 0, x1: 1823, y1: 1080 }), { x0: 95, y0: 0, x1: 1823, y1: 1080 }, 2);
  });

  it('finds a window alone, letterboxed, boxed on all sides, off the centre, and in odd canvases', () => {
    const cases: [PictureSize, PixelRect][] = [
      [{ width: 1728, height: 1080 }, { x0: 0, y0: 0, x1: 1728, y1: 1080 }],
      [{ width: 1280, height: 1024 }, { x0: 0, y0: 152, x1: 1280, y1: 872 }],
      [{ width: 2560, height: 1440 }, { x0: 300, y0: 200, x1: 2028, y1: 1280 }],
      [{ width: 2560, height: 1080 }, { x0: 320, y0: 0, x1: 2240, y1: 1080 }],
      [{ width: 1366, height: 768 }, { x0: 0, y0: 0, x1: 1366, y1: 768 }],
      [{ width: 1366, height: 768 }, { x0: 40, y0: 90, x1: 1006, y1: 694 }],
    ];
    for (const [picture, window] of cases) {
      const tolerance = 1 / surveyPlacement(picture).scale;
      close(survey(picture, window), window, tolerance);
    }
  });

  it('keeps the game\'s dark edges inside the window and tolerates noisy bars and a passing cursor', () => {
    const picture = { width: 1920, height: 1080 };
    const window = { x0: 96, y0: 0, x1: 1824, y1: 1080 };
    // Ground darkened almost to black at the window's edges, its level changing from picture to
    // picture as the camera moves (4 to 9 levels on a reference recording's edge column).
    const dark = (u: number, v: number, seed: number) => {
      const edge = Math.min(u, 1 - u);
      const g = edge < 0.01 ? 4 + 5 * (0.5 + 0.5 * Math.sin(seed * 1.9)) + Math.sin(v * 40) : 60;
      return [g, g, g];
    };
    close(survey(picture, window, 16, 0, dark), window, 1.2);
    close(survey(picture, window, 16, 3), window, 1.2);
    // A white cursor over the left bar in one picture.
    const s = new WindowSurvey(picture);
    for (let k = 0; k < 16; k++) {
      const frame = draw(picture, window, s.placement, ground, { seed: k });
      if (k === 3) for (let y = 200; y < 230; y++) for (let x = 10; x < 20; x++) frame.data.set([255, 255, 255], (y * FW + x) * 4);
      s.add(frame);
    }
    close(s.window(), window, 0.6);
  });

  it('finds no window in black pictures or one too small to read', () => {
    const black = new WindowSurvey({ width: 1920, height: 1080 });
    for (let k = 0; k < 4; k++) black.add({ width: FW, height: FH, data: new Uint8ClampedArray(FW * FH * 4) });
    expect(black.window()).toBeNull();
    expect(new WindowSurvey({ width: 1920, height: 1080 }).window()).toBeNull();
    const small = { x0: 800, y0: 400, x1: 800 + SCAN_PROFILE.window.minWidth - 40, y1: 400 + SCAN_PROFILE.window.minHeight - 40 };
    expect(survey({ width: 1920, height: 1080 }, small, 4)).toBeNull();
  });

  it('surveys a recording for its framing: the window, then the HUD\'s inset where the scan reads it', async () => {
    // A 1366 x 768 canvas holding the calibrated window scaled down, off the centre: drawn where the
    // scan reads it, it shows the calibrated HUD.
    const picture = { width: 1366, height: 768 };
    const scale = 600 / 1080;
    const window = { x0: 100, y0: 100, x1: 100 + 1728 * scale, y1: 700 };
    const placements: Placement[] = [];
    const framing = await surveyFraming(picture, async (at, each) => {
      placements.push(at);
      for (let k = 0; k < 16; k++) {
        if (placements.length === 1) each(draw(picture, window, at, ground, { seed: k }));
        else each({ width: FW, height: FH, data: hudFrame() });
      }
    });
    expect(placements[0]).toEqual(surveyPlacement(picture));
    expect(framing).not.toBeNull();
    expect(framing!.placement.scale).toBeCloseTo(FH / 600, 2);
    expect(framing!.world).toBeCloseTo(1, 9);
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(Math.abs(framing!.window[k] - CALIBRATED_WINDOW[k])).toBeLessThanOrEqual(1);
    // The second pass draws the calibrated HUD, whose window lies within a pixel of the one found.
    expect(Math.abs(framing!.hudInset - SCAN_PROFILE.hud.inset.calibrated)).toBeLessThan(1);
    expect(hudLayout(framing!).scale).toBeCloseTo(1, 2);
  });

  it('spreads the survey across the recording', () => {
    expect(surveyTimes(16, 4)).toEqual([2, 6, 10, 14]);
    expect(surveyTimes(10).length).toBe(SCAN_PROFILE.window.frames);
  });
});
